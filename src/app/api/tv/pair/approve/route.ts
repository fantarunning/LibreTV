import { guardRequest } from '@/lib/api-guard';
import { getRequestSession, approvePairing } from '@/lib/account-store';
import { checkRateLimit, clientIp } from '@/lib/auth';
import { readLimitedJson } from '@/lib/account-http';
import { accountErrorResponse } from '@/lib/mysql';
export const runtime = 'nodejs';
export async function POST(req: Request) {
  const guarded = await guardRequest(req);
  if (guarded) return guarded;
  if (!checkRateLimit(`pair-approve:${clientIp(req)}`)) return Response.json({ error: '配对尝试过多，请稍后再试' }, { status: 429 });
  try {
    const session = (await getRequestSession(req))!;
    const body = await readLimitedJson(req, 4096);
    await approvePairing(session, body.userCode);
    return Response.json({ success: true });
  } catch (error) { return accountErrorResponse(error); }
}
