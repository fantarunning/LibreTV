import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './client-api';
import { cloudDocumentId, db, getLocalSyncAccount, queueCloudChange, type HistoryEntry } from './db';
import { getSyncState, startCloudSync, stopCloudSync, syncNow } from './cloud-sync';
import { useAppStore } from './store';
import type { AccountSession, CloudMutation, CloudPullResponse, CloudPushResponse, CloudRecord } from './cloud-types';

vi.mock('./client-api', () => ({ api: { cloudPull: vi.fn(), cloudPush: vi.fn() } }));

const server = new Map<string, Map<string, CloudRecord>>();
const versions = new Map<string, number>();
const events = new Set<string>();
const recordId = (record: Pick<CloudRecord, 'kind' | 'key'>) => JSON.stringify([record.kind, record.key]);
const account = (id: string): AccountSession => ({ user: { id, name: id },
  device: { id: `${id}-web`, name: '浏览器', type: 'web', expiresAt: Date.now() + 100000 }, syncEnabled: true });
const history = (title: string): HistoryEntry => ({ id: 'src_film', sourceKey: 'src', vodId: 'film', title,
  episodeIndex: 0, totalEpisodes: 2, playbackPosition: 100, duration: 1000, timestamp: 100 });
const progress = (position: number) => ({ key: 'src_film_0', position, duration: 1000, updatedAt: 100 });
function seed(id: string, record: CloudRecord): void {
  const documents = server.get(id) || new Map<string, CloudRecord>();
  documents.set(recordId(record), structuredClone(record)); server.set(id, documents);
  versions.set(id, Math.max(versions.get(id) || 0, record.version));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}
async function serverPush(mutations: CloudMutation[], id: string): Promise<CloudPushResponse> {
  const response: CloudPushResponse = { accepted: [], records: [], conflicts: [] };
  for (const mutation of mutations) {
    const documents = server.get(id) || new Map<string, CloudRecord>();
    const current = documents.get(recordId(mutation)) || { kind: mutation.kind, key: mutation.key, value: null, version: 0, updatedAt: 0 };
    if (events.has(`${id}:${mutation.eventId}`)) { response.accepted.push(mutation.eventId); response.records.push(current); continue; }
    if (mutation.baseVersion !== current.version) { response.conflicts.push(current); continue; }
    const record = { kind: mutation.kind, key: mutation.key, value: mutation.value, version: (versions.get(id) || 0) + 1, updatedAt: Date.now() };
    seed(id, record); events.add(`${id}:${mutation.eventId}`);
    response.accepted.push(mutation.eventId); response.records.push(record);
  }
  return structuredClone(response);
}

beforeEach(async () => {
  stopCloudSync();
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  vi.stubGlobal('navigator', { onLine: true });
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  await Promise.all(db.tables.map(table => table.clear()));
  useAppStore.setState({ customAPIs: [], selectedKeys: [], subscriptions: [], skipMarks: {}, liveFavorites: [] });
  server.clear(); versions.clear(); events.clear();
  vi.mocked(api.cloudPush).mockReset().mockImplementation(serverPush);
  vi.mocked(api.cloudPull).mockReset().mockImplementation(async (cursor: number, id: string): Promise<CloudPullResponse> => {
    const records = [...(server.get(id)?.values() || [])].filter(record => record.version > cursor).sort((a, b) => a.version - b.version);
    return structuredClone({ records, cursor: records.at(-1)?.version ?? cursor, hasMore: false });
  });
  await db.cloudMeta.put({ key: 'owner', value: 'a' });
});
afterEach(() => { stopCloudSync(); vi.unstubAllGlobals(); });

describe('real Dexie cloud-sync lifecycle', () => {
  it('rebuilds the local projection after A → B → A with separate cursors', async () => {
    seed('a', { kind: 'history', key: 'src_film', value: history('A 的影片'), version: 1, updatedAt: 1 });
    seed('b', { kind: 'history', key: 'src_film', value: history('B 的影片'), version: 1, updatedAt: 1 });
    await startCloudSync(account('a'));
    expect((await db.history.get('src_film'))?.title).toBe('A 的影片');
    await startCloudSync(account('b'));
    expect((await db.history.get('src_film'))?.title).toBe('B 的影片');
    await startCloudSync(account('a'));
    expect((await db.history.get('src_film'))?.title).toBe('A 的影片');
    expect(vi.mocked(api.cloudPull).mock.calls.filter(([cursor, id]) => cursor === 0 && id === 'a')).toHaveLength(2);
  });

  it('accepts the server conflict once and never retries a stale offline position over it', async () => {
    seed('a', { kind: 'progress', key: 'src_film_0', value: progress(100), version: 1, updatedAt: 1 });
    await startCloudSync(account('a'));
    await db.progress.put(progress(20)); await queueCloudChange('progress', 'src_film_0', progress(20));
    seed('a', { kind: 'progress', key: 'src_film_0', value: progress(400), version: 2, updatedAt: 2 });
    await syncNow();
    expect((await db.progress.get('src_film_0'))?.position).toBe(400);
    expect(await db.cloudQueue.count()).toBe(0);
    const calls = vi.mocked(api.cloudPush).mock.calls.length;
    await syncNow();
    expect(vi.mocked(api.cloudPush).mock.calls.length).toBe(calls);
  });

  it('preserves a rewind made during an in-flight acknowledgment and rebases its next CAS', async () => {
    seed('a', { kind: 'progress', key: 'src_film_0', value: progress(100), version: 1, updatedAt: 1 });
    await startCloudSync(account('a'));
    await queueCloudChange('progress', 'src_film_0', progress(200));
    const pending = deferred<CloudPushResponse>();
    vi.mocked(api.cloudPush).mockImplementationOnce(() => pending.promise);
    const sync = syncNow();
    await vi.waitFor(() => expect(api.cloudPush).toHaveBeenCalledTimes(1));
    const sent = vi.mocked(api.cloudPush).mock.calls[0][0][0];
    await db.progress.put(progress(10)); await queueCloudChange('progress', 'src_film_0', progress(10));
    const current = await db.cloudQueue.get(cloudDocumentId('a', 'progress', 'src_film_0'));
    const acknowledged = await serverPush([sent], 'a');
    pending.resolve(acknowledged); await sync;
    expect((await db.cloudQueue.get(current!.id))?.eventId).toBe(current?.eventId);
    expect((await db.cloudQueue.get(current!.id))?.baseVersion).toBe(2);
    expect((await db.progress.get('src_film_0'))?.position).toBe(10);
    await syncNow();
    expect(vi.mocked(api.cloudPush).mock.calls[1][0][0].baseVersion).toBe(2);
    expect((server.get('a')?.get(recordId({ kind: 'progress', key: 'src_film_0' }))?.value as { position: number }).position).toBe(10);
    expect(await db.cloudQueue.count()).toBe(0);
  });

  it('binds outgoing requests to their account and ignores acknowledgments after logout / switching', async () => {
    await startCloudSync(account('a'));
    await queueCloudChange('progress', 'src_film_0', progress(200));
    const pending = deferred<CloudPushResponse>();
    vi.mocked(api.cloudPush).mockImplementationOnce(() => pending.promise);
    const sync = syncNow();
    await vi.waitFor(() => expect(api.cloudPush).toHaveBeenCalledTimes(1));
    const [sent, expectedAccount] = vi.mocked(api.cloudPush).mock.calls[0];
    expect(expectedAccount).toBe('a');
    stopCloudSync();
    const switched = startCloudSync(account('b'));
    pending.resolve({ accepted: [sent[0].eventId], records: [{ kind: 'progress', key: 'src_film_0', value: progress(200), version: 1, updatedAt: 1 }], conflicts: [] });
    await Promise.all([sync, switched]); await syncNow();
    expect(getLocalSyncAccount()).toBe('b');
    expect(await db.progress.get('src_film_0')).toBeUndefined();
    expect(await db.cloudQueue.where('accountId').equals('a').count()).toBe(1);
    expect(await db.cloudQueue.where('accountId').equals('b').count()).toBe(0);
    expect(vi.mocked(api.cloudPull).mock.calls.every(([, id]) => id === 'a' || id === 'b')).toBe(true);
  });

  it('does not resurrect a server tombstone while importing old local history', async () => {
    await db.cloudMeta.delete('owner');
    await db.history.put(history('已被其他设备删除'));
    seed('a', { kind: 'history', key: 'src_film', value: null, version: 5, updatedAt: 1 });
    await startCloudSync(account('a'));
    expect(await db.history.get('src_film')).toBeUndefined();
    expect(vi.mocked(api.cloudPush).mock.calls.flatMap(([mutations]) => mutations).some(item => item.kind === 'history')).toBe(false);
    expect((await db.cloudRecords.get(cloudDocumentId('a', 'history', 'src_film')))?.value).toBeNull();
  });

  it('keeps the durable outbox while offline and resumes the same account after reconnecting', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    await startCloudSync(account('a'));
    await queueCloudChange('progress', 'src_film_0', progress(123));
    await syncNow();
    expect(getSyncState().status).toBe('offline');
    expect(api.cloudPush).not.toHaveBeenCalled();
    expect(await db.cloudQueue.count()).toBe(1);
    vi.stubGlobal('navigator', { onLine: true }); await syncNow();
    expect(vi.mocked(api.cloudPush).mock.calls[0][1]).toBe('a');
    expect(await db.cloudQueue.count()).toBe(0);
    expect(getSyncState().status).toBe('synced');
  });
});
