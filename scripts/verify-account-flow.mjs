import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Run against the staged server with its PASSWORD in the environment. Never logs credentials.
const base = (process.env.CHECK_BASE_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const origin = process.env.APP_ORIGIN || new URL(base).origin;
if (!process.env.PASSWORD) throw new Error('PASSWORD is required to run the staged integration check');
const request = async (path, options = {}, auth = {}) => {
  const headers = { ...auth, ...options.headers };
  if (options.body !== undefined) { headers['Content-Type'] = 'application/json'; headers.Origin = origin; }
  if (options.method === 'DELETE') headers.Origin = origin;
  const response = await fetch(`${base}${path}`, { ...options, headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const data = await response.json();
  return { response, data };
};
const login = async name => {
  const result = await request('/api/auth', { method: 'POST', body: { password: process.env.PASSWORD, deviceName: name } });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  const cookie = result.response.headers.get('set-cookie')?.split(';')[0];
  assert(cookie);
  const ttl = result.data.account.device.expiresAt - Date.now();
  assert(ttl > 29.99 * 86400000 && ttl <= 30 * 86400000);
  assert.match(result.response.headers.get('set-cookie'), /HttpOnly/i);
  return { auth: { Cookie: cookie }, session: result.data.account };
};

const sessions = [];
let recordVersion = 0;
const key = `acceptance:${randomUUID()}:0`;
const makeMutation = (baseVersion, value, eventId = randomUUID()) => ({ eventId, kind: 'progress', key, value, baseVersion });
try {
  const web = await login('Acceptance web A'); sessions.push(web);
  const other = await login('Acceptance web B'); sessions.push(other);
  assert.equal(web.session.user.id, other.session.user.id);
  assert.notEqual(web.session.device.id, other.session.device.id);
  assert.equal((await request('/api/account/me', {}, web.auth)).data.user.id, web.session.user.id);

  const pair = await request('/api/tv/pair', { method: 'POST', body: { deviceName: 'Acceptance TV' } });
  assert.equal(pair.response.status, 200);
  const pollPath = `/api/tv/pair?deviceCode=${encodeURIComponent(pair.data.deviceCode)}`;
  assert.equal((await request(pollPath)).data.status, 'pending');
  const approved = await request('/api/tv/pair/approve', { method: 'POST', body: { userCode: pair.data.userCode } }, web.auth);
  assert.equal(approved.response.status, 200);
  assert(!('token' in approved.data));
  const authorized = await request(pollPath);
  assert.equal(authorized.data.status, 'authorized');
  const tvAuth = { Authorization: `Bearer ${authorized.data.token}` };
  const tv = await request('/api/account/me', {}, tvAuth);
  assert.equal(tv.data.device.type, 'tv');
  const tvTtl = tv.data.device.expiresAt - Date.now();
  assert(tvTtl > 364.99 * 86400000 && tvTtl <= 365 * 86400000);
  sessions.push({ auth: tvAuth, session: tv.data });
  assert.equal((await request('/api/tv/pair/approve', { method: 'POST', body: { userCode: pair.data.userCode } }, web.auth)).response.status, 409);

  const mutation = makeMutation(0, { key, position: 123, duration: 1000, updatedAt: Date.now() });
  const pushed = await request('/api/sync', { method: 'POST', body: { mutations: [mutation] } }, web.auth);
  assert.deepEqual(pushed.data.accepted, [mutation.eventId]);
  recordVersion = pushed.data.records[0].version;
  const replay = await request('/api/sync', { method: 'POST', body: { mutations: [mutation] } }, other.auth);
  assert.equal(replay.data.records[0].version, recordVersion);
  assert.deepEqual(replay.data.accepted, [mutation.eventId]);
  const stale = await request('/api/sync', { method: 'POST', body: { mutations: [makeMutation(0, { position: 999 })] } }, tvAuth);
  assert.equal(stale.data.conflicts[0].version, recordVersion);
  assert.equal(stale.data.conflicts[0].value.position, 123);

  let cursor = 0;
  let found = false;
  for (let page = 0; page < 1000; page++) {
    const pulled = await request(`/api/sync?cursor=${cursor}&limit=1`, {}, tvAuth);
    assert.equal(pulled.response.status, 200);
    found ||= pulled.data.records.some(record => record.key === key && record.value?.position === 123);
    if (!pulled.data.hasMore) break;
    assert(pulled.data.cursor > cursor);
    cursor = pulled.data.cursor;
  }
  assert(found, 'TV must receive web playback progress from MySQL');
  const removed = await request('/api/sync', { method: 'POST', body: { mutations: [makeMutation(recordVersion, null)] } }, tvAuth);
  recordVersion = removed.data.records[0].version;
  assert.equal(removed.data.records[0].value, null);
  const resurrect = await request('/api/sync', { method: 'POST', body: { mutations: [makeMutation(recordVersion - 1, { position: 456 })] } }, web.auth);
  assert.equal(resurrect.data.conflicts[0].value, null);

  const command = await request('/api/tv/commands', { method: 'POST', body: { deviceId: tv.data.device.id, action: 'pause' } }, web.auth);
  assert.equal(command.response.status, 200, JSON.stringify(command.data));
  const commands = await request('/api/tv/commands?after=0', {}, tvAuth);
  assert.equal(commands.data.commands.at(-1).action, 'pause');
  assert.equal((await request(`/api/tv/commands?after=${commands.data.cursor}`, {}, tvAuth)).data.commands.length, 0);

  const malicious = await fetch(`${base}/api/sync`, { method: 'POST', headers: { ...web.auth, Origin: 'https://untrusted.invalid', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(malicious.status, 403);
  assert.equal((await request('/api/account/me', {}, { Cookie: 'ltv_session=9999999999999.legacy-hmac' })).response.status, 401);

  await request(`/api/account/devices?id=${tv.data.device.id}`, { method: 'DELETE' }, web.auth);
  assert.equal((await request('/api/account/me', {}, tvAuth)).response.status, 401);
  const devices = await request('/api/account/devices', {}, web.auth);
  assert(!devices.data.devices.some(device => device.id === tv.data.device.id));
  console.log(JSON.stringify({ ok: true, checks: ['web-30d', 'TV-pair-365d', 'web-to-TV-progress', 'event-idempotence', 'CAS-conflict', 'pagination', 'persistent-delete', 'TV-remote', 'CSRF', 'legacy-cookie-rejected', 'device-revocation'] }));
} finally {
  // Cleanup only the synthetic progress record and devices created by this run.
  const web = sessions[0];
  if (web) {
    if (recordVersion) await request('/api/sync', { method: 'POST', body: { mutations: [makeMutation(recordVersion, null)] } }, web.auth).catch(() => {});
    for (const created of sessions.slice(1)) await request(`/api/account/devices?id=${created.session.device.id}`, { method: 'DELETE' }, web.auth).catch(() => {});
    await request('/api/auth', { method: 'DELETE' }, web.auth).catch(() => {});
  }
}
