import { vi } from 'vitest';

/** Route tests replace only the database identity lookup, keeping the actual guard/CSRF. */
export async function mockAccountStore() {
  const actual = await vi.importActual<typeof import('@/lib/account-store')>('@/lib/account-store');
  const { tokenFromRequest } = await import('@/lib/auth');
  return { ...actual, getRequestSession: vi.fn(async (req: Request) => tokenFromRequest(req) === `lt2_${'a'.repeat(64)}` ? {
    user: { id: 'test-user', name: '测试账号' },
    device: { id: 'test-device', name: '浏览器', type: 'web', expiresAt: Date.now() + 60000 },
    syncEnabled: true,
  } : null) };
}

export function testSessionToken() { return { token: `lt2_${'a'.repeat(64)}` }; }
