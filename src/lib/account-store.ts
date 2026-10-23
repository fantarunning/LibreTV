import crypto from 'node:crypto';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { AccountSession } from './cloud-types';
import { credentialEpoch, newSessionToken, SESSION_DAY_MS, tokenFromRequest, tokenHash, TV_SESSION_DAYS, WEB_SESSION_DAYS } from './auth';
import { AccountError, getMysqlPool, withTransaction } from './mysql';

interface SessionRow extends RowDataPacket {
  id: string; user_id: string; account_name: string; device_name: string;
  device_type: 'web' | 'tv'; expires_at: string; credential_epoch: string;
}

const requestSessions = new WeakMap<Request, Promise<AccountSession | null>>();

export async function getRequestSession(req: Request): Promise<AccountSession | null> {
  const cached = requestSessions.get(req);
  if (cached) return cached;
  const pending = (async () => {
    const token = tokenFromRequest(req);
    if (!token) return null;
    const [rows] = await getMysqlPool().execute<SessionRow[]>(
      `SELECT d.id,d.user_id,u.account_name,d.device_name,d.device_type,d.expires_at,d.credential_epoch
       FROM ltv_devices d JOIN ltv_users u ON u.id=d.user_id
       WHERE d.token_hash=? AND d.revoked_at IS NULL AND d.expires_at>? LIMIT 1`,
      [tokenHash(token), Date.now()],
    );
    const row = rows[0];
    if (!row || row.credential_epoch !== credentialEpoch()) return null;
    return {
      user: { id: row.user_id, name: row.account_name },
      device: { id: row.id, name: row.device_name, type: row.device_type, expiresAt: Number(row.expires_at) },
      syncEnabled: true,
    };
  })();
  requestSessions.set(req, pending);
  return pending;
}

export function sanitizeDeviceName(value: unknown, fallback = '浏览器'): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !value.trim() || value.length > 120 || /[\x00-\x1f]/.test(value)) {
    throw new AccountError('设备名称必须为 1–120 个字符', 400);
  }
  return value.trim();
}

async function insertDevice(connection: PoolConnection, user: AccountSession['user'], name: string, type: 'web' | 'tv') {
  const id = crypto.randomUUID();
  const token = newSessionToken();
  const expiresAt = Date.now() + (type === 'tv' ? TV_SESSION_DAYS : WEB_SESSION_DAYS) * SESSION_DAY_MS;
  await connection.execute(
    `INSERT INTO ltv_devices (id,user_id,device_name,device_type,token_hash,credential_epoch,expires_at,created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [id, user.id, name, type, tokenHash(token), credentialEpoch(), expiresAt, Date.now()],
  );
  return { token, session: { user, device: { id, name, type, expiresAt }, syncEnabled: true } satisfies AccountSession };
}

export async function createWebSession(deviceName: string) {
  const accountName = (process.env.ACCOUNT_NAME || '家庭账号').trim();
  if (!accountName || accountName.length > 100) throw new AccountError('ACCOUNT_NAME 配置无效');
  return withTransaction(async connection => {
    await connection.execute('INSERT IGNORE INTO ltv_users (id,account_name,created_at) VALUES (?,?,?)',
      [crypto.randomUUID(), accountName, Date.now()]);
    const [users] = await connection.execute<(RowDataPacket & { id: string })[]>(
      'SELECT id FROM ltv_users WHERE account_name=?', [accountName]);
    return insertDevice(connection, { id: users[0].id, name: accountName }, deviceName, 'web');
  });
}

export async function revokeDevice(userId: string, deviceId: string): Promise<void> {
  await getMysqlPool().execute('UPDATE ltv_devices SET revoked_at=? WHERE id=? AND user_id=?',
    [Date.now(), deviceId, userId]);
}

export async function listDevices(userId: string) {
  const [rows] = await getMysqlPool().execute<(RowDataPacket & {
    id: string; device_name: string; device_type: 'web' | 'tv'; expires_at: string; created_at: string;
  })[]>('SELECT id,device_name,device_type,expires_at,created_at FROM ltv_devices WHERE user_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 100',
  [userId, Date.now()]);
  return rows.map(row => ({ id: row.id, name: row.device_name, type: row.device_type,
    expiresAt: Number(row.expires_at), createdAt: Number(row.created_at) }));
}

const PAIRING_TTL_MS = 5 * 60 * 1000;
function pairingKey(): Buffer { return crypto.createHash('sha256').update(credentialEpoch() + ':pairing').digest(); }
function encryptPairToken(token: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', pairingKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}
function decryptPairToken(value: string): string {
  const data = Buffer.from(value, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', pairingKey(), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
}

export async function createPairing(deviceName: string, origin: string) {
  const deviceCode = crypto.randomBytes(32).toString('hex');
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const userCode = Array.from(crypto.randomBytes(8), n => alphabet[n % alphabet.length]).join('');
  const expiresAt = Date.now() + PAIRING_TTL_MS;
  await getMysqlPool().execute('DELETE FROM ltv_pairings WHERE expires_at<?', [Date.now()]);
  await getMysqlPool().execute('INSERT INTO ltv_pairings (device_code_hash,user_code,device_name,expires_at) VALUES (?,?,?,?)',
    [tokenHash(deviceCode), userCode, deviceName, expiresAt]);
  return { deviceCode, userCode, expiresAt, verificationUrl: `${origin}/account/tv?code=${userCode}` };
}

interface PairRow extends RowDataPacket {
  expires_at: string; device_name: string; authorized_device_id: string | null; encrypted_token: string | null;
}

export async function approvePairing(session: AccountSession, rawCode: unknown): Promise<void> {
  if (session.device.type !== 'web') throw new AccountError('请使用已登录的手机或平板确认电视配对', 403);
  if (typeof rawCode !== 'string') throw new AccountError('配对码无效', 400);
  const userCode = rawCode.toUpperCase().replace(/[\s-]/g, '');
  if (!/^[A-Z2-9]{8}$/.test(userCode)) throw new AccountError('配对码必须为 8 位字母或数字', 400);
  await withTransaction(async connection => {
    const [rows] = await connection.execute<PairRow[]>('SELECT * FROM ltv_pairings WHERE user_code=? FOR UPDATE', [userCode]);
    const pair = rows[0];
    if (!pair || Number(pair.expires_at) <= Date.now()) throw new AccountError('配对码无效或已过期', 410);
    if (pair.authorized_device_id) throw new AccountError('配对码已使用', 409);
    const created = await insertDevice(connection, session.user, pair.device_name, 'tv');
    await connection.execute('UPDATE ltv_pairings SET authorized_device_id=?,encrypted_token=? WHERE user_code=?',
      [created.session.device.id, encryptPairToken(created.token), userCode]);
  });
}

export async function pollPairing(deviceCode: string) {
  if (!/^[a-f0-9]{64}$/.test(deviceCode)) throw new AccountError('设备配对凭证无效', 400);
  const [rows] = await getMysqlPool().execute<(PairRow & { device_expires_at: string | null; revoked_at: string | null })[]>(
    `SELECT p.*,d.expires_at AS device_expires_at,d.revoked_at FROM ltv_pairings p
     LEFT JOIN ltv_devices d ON d.id=p.authorized_device_id WHERE p.device_code_hash=?`, [tokenHash(deviceCode)]);
  const pair = rows[0];
  if (!pair || Number(pair.expires_at) <= Date.now() || pair.revoked_at) return { status: 'expired' as const };
  if (!pair.encrypted_token) return { status: 'pending' as const };
  return { status: 'authorized' as const, token: decryptPairToken(pair.encrypted_token), expiresAt: Number(pair.device_expires_at) };
}
