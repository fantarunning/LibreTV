import { guardRequest } from '@/lib/api-guard';
import { getRequestSession } from '@/lib/account-store';
import { checkRateLimit } from '@/lib/auth';
import { readLimitedJson } from '@/lib/account-http';
import { AccountError, accountErrorResponse } from '@/lib/mysql';
import { pullTvCommands, sendTvCommand, validateTvCommand } from '@/lib/tv-commands';
export const runtime = 'nodejs';
export async function GET(req: Request) {
  const guarded = await guardRequest(req);
  if (guarded) return guarded;
  try {
    const session = (await getRequestSession(req))!;
    const raw = new URL(req.url).searchParams.get('after') || '0';
    const after = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(after)) throw new AccountError('遥控游标无效', 400);
    return Response.json(await pullTvCommands(session, after), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return accountErrorResponse(error); }
}
export async function POST(req: Request) {
  const guarded = await guardRequest(req);
  if (guarded) return guarded;
  try {
    const session = (await getRequestSession(req))!;
    if (!checkRateLimit(`remote:${session.device.id}`, 120, 60000)) throw new AccountError('遥控操作过于频繁', 429);
    const body = await readLimitedJson(req, 16384);
    return Response.json(await sendTvCommand(session, validateTvCommand(body)));
  } catch (error) { return accountErrorResponse(error); }
}
