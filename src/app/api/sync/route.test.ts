import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';
import { getRequestSession } from '@/lib/account-store';
import { pullCloud, pushCloud } from '@/lib/cloud-store';
vi.mock('@/lib/account-store', () => ({ getRequestSession: vi.fn() }));
vi.mock('@/lib/cloud-store', async () => ({
  ...await vi.importActual<typeof import('@/lib/cloud-store')>('@/lib/cloud-store'),
  pullCloud: vi.fn(), pushCloud: vi.fn(),
}));
beforeEach(() => {
  process.env.PASSWORD = 'configured';
  vi.mocked(getRequestSession).mockResolvedValue({ user: { id: 'account-b', name: 'B' },
    device: { id: 'device-b', name: 'B', type: 'web', expiresAt: Date.now() + 10000 }, syncEnabled: true });
  vi.mocked(pushCloud).mockClear(); vi.mocked(pullCloud).mockClear();
});
describe('sync account binding', () => {
  it('refuses a delayed account-A outbox when cookies now authenticate account B, with no write', async () => {
    const response = await POST(new Request('https://local.test/api/sync', { method: 'POST',
      headers: { Origin: 'https://local.test', 'content-type': 'application/json', 'x-libretv-account': 'account-a' },
      body: JSON.stringify({ mutations: [{ eventId: 'pending-event-a', kind: 'progress', key: 'show:1', baseVersion: 0, value: { position: 123 } }] }) }));
    expect(response.status).toBe(403);
    expect(pushCloud).not.toHaveBeenCalled();
  });
  it('refuses an account-A cursor under account B without reading B documents', async () => {
    const response = await GET(new Request('https://local.test/api/sync?cursor=0', { headers: { 'x-libretv-account': 'account-a' } }));
    expect(response.status).toBe(403);
    expect(pullCloud).not.toHaveBeenCalled();
  });
});
