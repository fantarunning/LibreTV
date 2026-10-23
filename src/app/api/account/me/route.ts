import { guardRequest } from '@/lib/api-guard';
import { getRequestSession } from '@/lib/account-store';
export const runtime = 'nodejs';
export async function GET(req: Request) {
  const guarded = await guardRequest(req);
  if (guarded) return guarded;
  return Response.json(await getRequestSession(req), { headers: { 'Cache-Control': 'no-store' } });
}
