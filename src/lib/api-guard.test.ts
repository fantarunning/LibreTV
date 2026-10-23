import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardRequest } from './api-guard';
import { getRequestSession } from './account-store';
import { SESSION_COOKIE, newSessionToken } from './auth';
vi.mock('./account-store', () => ({ getRequestSession: vi.fn() }));
beforeEach(() => { vi.stubEnv('PASSWORD', 'configured'); vi.mocked(getRequestSession).mockReset(); });
afterEach(() => { vi.unstubAllEnvs(); });
describe('database-backed API guard', () => {
  it('fails closed on a database outage without treating a signed legacy cookie as authorization', async () => {
    vi.mocked(getRequestSession).mockRejectedValue(new Error('database password=secret'));
    const response = await guardRequest(new Request('https://local.test/api/sync', { headers: { cookie: `${SESSION_COOKIE}=${newSessionToken()}` } }));
    expect(response?.status).toBe(503);
    expect(await response?.text()).not.toContain('secret');
  });
  it('returns 401 for a missing/revoked session and 403 before DB access for cross-origin writes', async () => {
    vi.mocked(getRequestSession).mockResolvedValue(null);
    expect((await guardRequest(new Request('https://local.test/api/sync')))?.status).toBe(401);
    vi.mocked(getRequestSession).mockClear();
    const response = await guardRequest(new Request('https://local.test/api/sync', { method: 'POST', headers: { Origin: 'https://evil.test' } }));
    expect(response?.status).toBe(403);
    expect(getRequestSession).not.toHaveBeenCalled();
  });
});
