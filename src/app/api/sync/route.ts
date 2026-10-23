import { guardRequest } from '@/lib/api-guard';
import { getRequestSession } from '@/lib/account-store';
import { readLimitedJson } from '@/lib/account-http';
import { pullCloud, pushCloud, validateMutations } from '@/lib/cloud-store';
import { AccountError, accountErrorResponse } from '@/lib/mysql';
export const runtime = 'nodejs';
export async function GET(req: Request) {
  const guarded = await guardRequest(req);
  if (guarded) return guarded;
  try {
    const session = (await getRequestSession(req))!;
    const query = new URL(req.url).searchParams;
    const rawCursor = query.get('cursor') || '0';
    const cursor = Number(rawCursor);
    const limit = Number(query.get('limit') || 100);
    if (!/^\d+$/.test(rawCursor) || !Number.isSafeInteger(cursor) || cursor < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new AccountError('同步游标或分页大小无效', 400);
    return Response.json(await pullCloud(session.user.id, cursor, limit), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return accountErrorResponse(error); }
}
export async function POST(req: Request) {
  const guarded = await guardRequest(req);
  if (guarded) return guarded;
  try {
    const session = (await getRequestSession(req))!;
    const body = await readLimitedJson(req);
    if (Object.keys(body).some(key => key !== 'mutations')) throw new AccountError('请求仅接受 mutations，账号由当前会话决定', 400);
    return Response.json(await pushCloud(session.user.id, validateMutations(body.mutations)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return accountErrorResponse(error); }
}
