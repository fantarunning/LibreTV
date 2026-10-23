import { createHash } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import type { CloudKind, CloudMutation, CloudPullResponse, CloudPushResponse, CloudRecord } from './cloud-types';
import { AccountError, getMysqlPool, withTransaction } from './mysql';

const KINDS: CloudKind[] = ['history', 'progress', 'skip', 'favorite', 'preferences'];
export const MAX_SYNC_MUTATIONS = 50;
export const MAX_SYNC_VALUE_BYTES = 64 * 1024;

function validateJson(value: unknown, depth = 0): void {
  if (depth > 16) throw new AccountError('同步内容嵌套过深', 400);
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value === 'string' && value.length <= 32768) return;
  if (Array.isArray(value)) {
    if (value.length > 2000) throw new AccountError('同步数组过长', 400);
    for (const entry of value) validateJson(entry, depth + 1);
    return;
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const entries = Object.entries(value);
    if (entries.length > 2000) throw new AccountError('同步对象字段过多', 400);
    for (const [key, entry] of entries) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new AccountError('同步字段名无效', 400);
      validateJson(entry, depth + 1);
    }
    return;
  }
  throw new AccountError('同步值必须为合法 JSON', 400);
}

export function validateMutations(input: unknown): CloudMutation[] {
  if (!Array.isArray(input) || !input.length || input.length > MAX_SYNC_MUTATIONS) throw new AccountError(`每批同步必须包含 1–${MAX_SYNC_MUTATIONS} 条记录`, 400);
  const eventIds = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AccountError('同步记录格式无效', 400);
    const item = raw as Record<string, unknown>;
    if (Object.keys(item).some(k => !['eventId', 'kind', 'key', 'value', 'baseVersion'].includes(k))) throw new AccountError('同步记录含未知字段；账号由当前会话决定', 400);
    if (typeof item.eventId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(item.eventId) || eventIds.has(item.eventId)) throw new AccountError('同步事件 ID 无效或批次内重复', 400);
    eventIds.add(item.eventId);
    if (!KINDS.includes(item.kind as CloudKind)) throw new AccountError('不支持的同步记录类型', 400);
    if (typeof item.key !== 'string' || !item.key.trim() || item.key.length > 512 || /[\x00-\x1f]/.test(item.key) || ['__proto__', 'constructor', 'prototype'].includes(item.key)) throw new AccountError('同步记录键无效', 400);
    if (!Number.isSafeInteger(item.baseVersion) || Number(item.baseVersion) < 0) throw new AccountError('同步版本无效', 400);
    validateJson(item.value);
    if (Buffer.byteLength(JSON.stringify(item.value), 'utf8') > MAX_SYNC_VALUE_BYTES) throw new AccountError('单条同步内容超过 64 KiB', 413);
  }
  return input as CloudMutation[];
}

interface RecordRow extends RowDataPacket { kind: CloudKind; doc_key: string; doc_value: unknown; version: string; updated_at: string; }
function toRecord(row: RecordRow): CloudRecord {
  return { kind: row.kind, key: row.doc_key, value: row.doc_value, version: Number(row.version), updatedAt: Number(row.updated_at) };
}

export async function pullCloud(userId: string, cursor: number, limit = 100): Promise<CloudPullResponse> {
  const pageSize = Math.min(100, Math.max(1, limit));
  // Advance only over actual records; concurrent updates receive larger versions.
  const [rows] = await getMysqlPool().query<RecordRow[]>(
    'SELECT kind,doc_key,doc_value,version,updated_at FROM ltv_sync_records WHERE user_id=? AND version>? ORDER BY version LIMIT ?',
    [userId, cursor, pageSize + 1]);
  const records = rows.slice(0, pageSize).map(toRecord);
  return { records, cursor: records.at(-1)?.version ?? cursor, hasMore: rows.length > pageSize };
}

export async function pushCloud(userId: string, mutations: CloudMutation[]): Promise<CloudPushResponse> {
  return withTransaction(async connection => {
    // Serialize account version allocation, compare-and-swap and event insertion.
    const [users] = await connection.execute<(RowDataPacket & { sync_version: string })[]>(
      'SELECT sync_version FROM ltv_users WHERE id=? FOR UPDATE', [userId]);
    if (!users[0]) throw new AccountError('账号不存在', 401);
    let version = Number(users[0].sync_version);
    const accepted: string[] = [];
    const records: CloudRecord[] = [];
    const conflicts: CloudRecord[] = [];
    for (const mutation of mutations) {
      const payloadHash = createHash('sha256').update(JSON.stringify(mutation)).digest('hex');
      const [events] = await connection.execute<(RowDataPacket & { payload_hash: string })[]>(
        'SELECT payload_hash FROM ltv_sync_events WHERE user_id=? AND event_id=?', [userId, mutation.eventId]);
      const [currentRows] = await connection.execute<RecordRow[]>(
        'SELECT kind,doc_key,doc_value,version,updated_at FROM ltv_sync_records WHERE user_id=? AND kind=? AND doc_key=?',
        [userId, mutation.kind, mutation.key]);
      const current = currentRows[0] ? toRecord(currentRows[0]) : { kind: mutation.kind, key: mutation.key, value: null, version: 0, updatedAt: 0 };
      if (events[0]) {
        if (events[0].payload_hash !== payloadHash) throw new AccountError('事件 ID 已用于其他内容', 409);
        accepted.push(mutation.eventId);
        records.push(current);
        continue;
      }
      if (current.version !== mutation.baseVersion) { conflicts.push(current); continue; }
      version += 1;
      if (!Number.isSafeInteger(version)) throw new AccountError('账号同步版本已达上限');
      const updatedAt = Date.now();
      const record: CloudRecord = { kind: mutation.kind, key: mutation.key, value: mutation.value, version, updatedAt };
      await connection.execute(
        `INSERT INTO ltv_sync_records (user_id,kind,doc_key,doc_value,version,updated_at) VALUES (?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE doc_value=VALUES(doc_value),version=VALUES(version),updated_at=VALUES(updated_at)`,
        [userId, mutation.kind, mutation.key, mutation.value === null ? null : JSON.stringify(mutation.value), version, updatedAt]);
      await connection.execute('INSERT INTO ltv_sync_events (user_id,event_id,payload_hash,created_at) VALUES (?,?,?,?)',
        [userId, mutation.eventId, payloadHash, updatedAt]);
      accepted.push(mutation.eventId);
      records.push(record);
    }
    await connection.execute('UPDATE ltv_users SET sync_version=? WHERE id=?', [version, userId]);
    return { accepted, records, conflicts };
  });
}
