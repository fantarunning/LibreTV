import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cloudDocumentId, db, queueCloudChange, saveProgress, clearProgress, setLocalSyncAccount } from './db';

beforeEach(async () => {
  setLocalSyncAccount(null);
  await Promise.all([db.cloudQueue.clear(), db.cloudRecords.clear(), db.progress.clear()]);
});
afterEach(() => setLocalSyncAccount(null));

describe('durable account sync queue', () => {
  it('coalesces edits while preserving a new event id and the acknowledged base version', async () => {
    setLocalSyncAccount('one');
    const id = cloudDocumentId('one', 'progress', 'episode');
    await db.cloudRecords.put({ id, accountId: 'one', kind: 'progress', key: 'episode', value: null, version: 7, updatedAt: 1 });
    await queueCloudChange('progress', 'episode', { position: 10 });
    const before = await db.cloudQueue.get(id);
    await queueCloudChange('progress', 'episode', { position: 2 });
    const after = await db.cloudQueue.get(id);
    expect(await db.cloudQueue.count()).toBe(1);
    expect(after?.baseVersion).toBe(7);
    expect(after?.value).toEqual({ position: 2 });
    expect(after?.eventId).not.toBe(before?.eventId);
  });
  it('keeps pending records isolated across accounts', async () => {
    setLocalSyncAccount('one'); await queueCloudChange('history', 'film', { title: 'A' });
    setLocalSyncAccount('two'); await queueCloudChange('history', 'film', { title: 'B' });
    expect(await db.cloudQueue.where('accountId').equals('one').count()).toBe(1);
    expect(await db.cloudQueue.where('accountId').equals('two').count()).toBe(1);
    setLocalSyncAccount(null); await queueCloudChange('history', 'guest', {});
    expect(await db.cloudQueue.count()).toBe(2);
  });
  it('persists a completion tombstone instead of allowing an old progress record to return', async () => {
    setLocalSyncAccount('one');
    await saveProgress('src', 'film', 0, 80, 100);
    await clearProgress('src', 'film', 0);
    expect(await db.progress.get('src_film_0')).toBeUndefined();
    const entry = await db.cloudQueue.get(cloudDocumentId('one', 'progress', 'src_film_0'));
    expect(entry?.value).toBeNull();
  });
});
