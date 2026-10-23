'use client';

import { api } from './client-api';
import { cloudDocumentId, db, getLocalSyncAccount, queueCloudChange, setLocalSyncAccount, type CloudQueueEntry, type HistoryEntry, type ProgressEntry } from './db';
import type { AccountSession, CloudRecord } from './cloud-types';
import { useAppStore } from './store';
import { migrateSkipMarks } from './skip-marks';
import type { SourceConfig } from './types';

export type SyncState = { status: 'idle' | 'syncing' | 'synced' | 'offline' | 'error'; lastSyncedAt?: number; message?: string };
let state: SyncState = { status: 'idle' };
const listeners = new Set<() => void>();
let dispose: (() => void) | undefined;
let running: Promise<void> | undefined;
let generation = 0;
let applyingRemote = false;

export const getSyncState = () => state;
export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function publish(patch: SyncState) {
  state = patch;
  listeners.forEach((listener) => listener());
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function applyRecord(record: CloudRecord): Promise<void> {
  const value = record.value;
  applyingRemote = true;
  try {
    if (record.kind === 'history') {
      if (value === null) await db.history.delete(record.key);
      else if (object(value) && typeof value.sourceKey === 'string' && typeof value.vodId === 'string') {
        await db.history.put({ ...(value as unknown as HistoryEntry), id: record.key });
      }
    } else if (record.kind === 'progress') {
      if (value === null) await db.progress.delete(record.key);
      else if (object(value) && typeof value.position === 'number' && Number.isFinite(value.position)) {
        await db.progress.put({ ...(value as unknown as ProgressEntry), key: record.key });
      }
    } else if (record.kind === 'skip') {
      const marks = { ...useAppStore.getState().skipMarks };
      if (value === null) delete marks[record.key];
      else Object.assign(marks, migrateSkipMarks({ [record.key]: value }));
      useAppStore.setState({ skipMarks: marks });
    } else if (record.kind === 'favorite') {
      const favorites = new Set(useAppStore.getState().liveFavorites);
      if (value === null) favorites.delete(record.key);
      else favorites.add(record.key);
      useAppStore.setState({ liveFavorites: [...favorites] });
    } else if (record.kind === 'preferences' && object(value)) {
      if (record.key === 'sources' && Array.isArray(value.customAPIs) && Array.isArray(value.selectedKeys)) {
        const sources = value.customAPIs.filter((source): source is SourceConfig =>
          object(source) && typeof source.key === 'string' && typeof source.name === 'string' && typeof source.url === 'string' && /^https?:\/\//.test(source.url)
        ).slice(0, 100);
        useAppStore.setState({ customAPIs: sources, selectedKeys: value.selectedKeys.filter((key): key is string => typeof key === 'string').slice(0, 150) });
      } else if (record.key === 'playback') {
        const patch: Partial<ReturnType<typeof useAppStore.getState>> = {};
        for (const key of ['autoplayNext', 'autoSkipSegments', 'adFilter'] as const) {
          if (typeof value[key] === 'boolean') patch[key] = value[key];
        }
        useAppStore.setState(patch);
      }
    }
  } finally {
    applyingRemote = false;
  }
}

function isCurrent(accountId: string, epoch: number): boolean {
  return generation === epoch && getLocalSyncAccount() === accountId;
}

async function saveRecord(accountId: string, record: CloudRecord, apply: boolean, epoch: number): Promise<void> {
  const id = cloudDocumentId(accountId, record.kind, record.key);
  if (!isCurrent(accountId, epoch)) return;
  await db.cloudRecords.put({ ...record, id, accountId });
  if (apply && isCurrent(accountId, epoch)) await applyRecord(record);
}

async function push(accountId: string, epoch: number): Promise<void> {
  // Keep request size below the server's 256 KiB body bound even for large source lists.
  const pending = await db.cloudQueue.where('accountId').equals(accountId).sortBy('queuedAt');
  if (!isCurrent(accountId, epoch)) return;
  const batch: CloudQueueEntry[] = [];
  let size = 32;
  for (const entry of pending.slice(0, 50)) {
    const bytes = new TextEncoder().encode(JSON.stringify(entry)).byteLength;
    if (batch.length && size + bytes > 190_000) break;
    batch.push(entry);
    size += bytes;
  }
  if (!batch.length) return;
  const result = await api.cloudPush(batch.map(({ eventId, kind, key, value, baseVersion }) => ({ eventId, kind, key, value, baseVersion })), accountId);
  if (generation !== epoch || getLocalSyncAccount() !== accountId) return;
  const accepted = new Set(result.accepted);
  const conflicts = new Map(result.conflicts.map((record) => [cloudDocumentId(accountId, record.kind, record.key), record]));
  const records = new Map([...result.records, ...result.conflicts].map((record) => [cloudDocumentId(accountId, record.kind, record.key), record]));
  for (const sent of batch) {
    if (!isCurrent(accountId, epoch)) return;
    const current = await db.cloudQueue.get(sent.id);
    if (!isCurrent(accountId, epoch)) return;
    const record = records.get(sent.id);
    if (record) await saveRecord(accountId, record, false, epoch);
    if (current?.eventId === sent.eventId && (accepted.has(sent.eventId) || conflicts.has(sent.id))) {
      await db.cloudQueue.delete(sent.id);
      if (conflicts.has(sent.id) && record && isCurrent(accountId, epoch)) await applyRecord(record);
    } else if (current && record) {
      // A new local action during this request must build on the acknowledged version.
      await db.cloudQueue.update(current.id, { baseVersion: record.version });
    }
  }
}

async function pull(accountId: string, epoch: number): Promise<void> {
  const cursorKey = `cursor:${accountId}`;
  let cursor = Number((await db.cloudMeta.get(cursorKey))?.value ?? 0);
  for (let page = 0; page < 100; page++) {
    if (!isCurrent(accountId, epoch)) return;
    const result = await api.cloudPull(cursor, accountId);
    if (generation !== epoch || getLocalSyncAccount() !== accountId) return;
    for (const record of result.records) {
      const pending = await db.cloudQueue.get(cloudDocumentId(accountId, record.kind, record.key));
      await saveRecord(accountId, record, !pending, epoch);
    }
    if (result.cursor < cursor || (result.hasMore && result.cursor === cursor)) throw new Error('同步游标未向前推进');
    cursor = result.cursor;
    await db.cloudMeta.put({ key: cursorKey, value: String(cursor) });
    if (!result.hasMore) return;
  }
  throw new Error('历史同步尚未完成，将在下一轮继续');
}

export async function syncNow(): Promise<void> {
  if (running) return running;
  const accountId = getLocalSyncAccount();
  if (!accountId) return;
  if (!navigator.onLine) { publish({ ...state, status: 'offline', message: '记录已保存在本地，联网后同步' }); return; }
  const epoch = generation;
  running = (async () => {
    publish({ ...state, status: 'syncing' });
    try {
      await push(accountId, epoch);
      await pull(accountId, epoch);
      if (generation === epoch) {
        const queued = await db.cloudQueue.where('accountId').equals(accountId).count();
        publish({ status: queued ? 'syncing' : 'synced', lastSyncedAt: Date.now() });
      }
    } catch (error) {
      if (generation === epoch) publish({ ...state, status: navigator.onLine ? 'error' : 'offline', message: error instanceof Error ? error.message : '同步暂不可用，记录保留在本地' });
    }
  })().finally(() => { running = undefined; });
  return running;
}

function watchSettings(): () => void {
  return useAppStore.subscribe((next, previous) => {
    if (applyingRemote || !getLocalSyncAccount()) return;
    if (next.skipMarks !== previous.skipMarks) {
      for (const key of new Set([...Object.keys(next.skipMarks), ...Object.keys(previous.skipMarks)])) {
        if (next.skipMarks[key] !== previous.skipMarks[key]) void queueCloudChange('skip', key, next.skipMarks[key] ?? null);
      }
    }
    if (next.liveFavorites !== previous.liveFavorites) {
      for (const url of new Set([...next.liveFavorites, ...previous.liveFavorites])) {
        if (next.liveFavorites.includes(url) !== previous.liveFavorites.includes(url)) void queueCloudChange('favorite', url, next.liveFavorites.includes(url) ? { url } : null);
      }
    }
    if (next.customAPIs !== previous.customAPIs || next.selectedKeys !== previous.selectedKeys) {
      void queueCloudChange('preferences', 'sources', { customAPIs: next.customAPIs, selectedKeys: next.selectedKeys });
    }
    if (next.autoplayNext !== previous.autoplayNext || next.autoSkipSegments !== previous.autoSkipSegments || next.adFilter !== previous.adFilter) {
      void queueCloudChange('preferences', 'playback', { autoplayNext: next.autoplayNext, autoSkipSegments: next.autoSkipSegments, adFilter: next.adFilter });
    }
  });
}

export async function startCloudSync(account: AccountSession): Promise<void> {
  stopCloudSync();
  const epoch = generation;
  const accountId = account.user.id;
  if (!useAppStore.persist.hasHydrated()) await useAppStore.persist.rehydrate();
  if (generation !== epoch) return;
  const owner = (await db.cloudMeta.get('owner'))?.value;
  if (generation !== epoch) return;
  const legacyHistory = !owner ? await db.history.toArray() : [];
  const legacyProgress = !owner ? await db.progress.toArray() : [];
  const legacySettings = !owner ? useAppStore.getState() : undefined;
  if (generation !== epoch) return;
  if (owner && owner !== accountId) {
    await Promise.all([db.history.clear(), db.progress.clear(), db.searchHistory.clear()]);
    if (generation !== epoch) return;
    // This browser now projects another account. Replay the target account from its beginning,
    // retaining each account's durable outbox and server-version metadata.
    await db.cloudMeta.put({ key: `cursor:${accountId}`, value: '0' });
    useAppStore.setState({ skipMarks: {}, liveFavorites: [], customAPIs: [], selectedKeys: [], subscriptions: [] });
  }
  if (generation !== epoch) return;
  await db.cloudMeta.put({ key: 'owner', value: accountId });
  if (generation !== epoch) return;
  setLocalSyncAccount(accountId);
  if (!owner) {
    // Import existing local records once, never overwriting an existing cloud document or tombstone.
    try { await pull(accountId, epoch); } catch { /* Durable import queue below retries once connected. */ }
    if (!isCurrent(accountId, epoch)) return;
    for (const entry of legacyHistory) {
      if (!isCurrent(accountId, epoch)) return;
      if (!await db.cloudRecords.get(cloudDocumentId(accountId, 'history', entry.id))) await queueCloudChange('history', entry.id, entry);
    }
    for (const entry of legacyProgress) {
      if (!isCurrent(accountId, epoch)) return;
      if (!await db.cloudRecords.get(cloudDocumentId(accountId, 'progress', entry.key))) await queueCloudChange('progress', entry.key, entry);
    }
    if (legacySettings) {
      for (const [key, value] of Object.entries(legacySettings.skipMarks)) {
        if (!await db.cloudRecords.get(cloudDocumentId(accountId, 'skip', key))) await queueCloudChange('skip', key, value);
      }
      if (!await db.cloudRecords.get(cloudDocumentId(accountId, 'preferences', 'sources'))) {
        await queueCloudChange('preferences', 'sources', { customAPIs: legacySettings.customAPIs, selectedKeys: legacySettings.selectedKeys });
      }
    }
  }
  if (!isCurrent(accountId, epoch)) return;
  const unsubscribe = watchSettings();
  const timer = setInterval(() => { void syncNow(); }, 15_000);
  const onWake = () => { if (document.visibilityState === 'visible') void syncNow(); };
  const onOffline = () => publish({ ...state, status: 'offline', message: '记录已保存在本地，联网后同步' });
  window.addEventListener('online', onWake);
  window.addEventListener('offline', onOffline);
  window.addEventListener('focus', onWake);
  document.addEventListener('visibilitychange', onWake);
  dispose = () => {
    unsubscribe(); clearInterval(timer);
    window.removeEventListener('online', onWake); window.removeEventListener('offline', onOffline);
    window.removeEventListener('focus', onWake); document.removeEventListener('visibilitychange', onWake);
  };
  await syncNow();
}

export function stopCloudSync(): void {
  generation++;
  dispose?.(); dispose = undefined;
  setLocalSyncAccount(null);
  publish({ status: 'idle' });
}
