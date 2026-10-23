import { createPairing, pollPairing, sanitizeDeviceName } from '@/lib/account-store';
import { checkRateLimit, clientIp, isPasswordConfigured, isTrustedWrite, requestOrigin } from '@/lib/auth';
import { readLimitedJson } from '@/lib/account-http';
import { AccountError, accountErrorResponse } from '@/lib/mysql';
export const runtime = 'nodejs';
export async function POST(req: Request) {
  if (!isPasswordConfigured()) return Response.json({ error: '服务器未配置密码' }, { status: 503 });
  if (!isTrustedWrite(req)) return Response.json({ error: '拒绝跨站配对请求' }, { status: 403 });
  if (!checkRateLimit(`pair-create:${clientIp(req)}`)) return Response.json({ error: '配对请求过多，请稍后再试' }, { status: 429 });
  try {
    const body = await readLimitedJson(req, 4096);
    return Response.json(await createPairing(sanitizeDeviceName(body.deviceName, 'Android TV'), requestOrigin(req)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return accountErrorResponse(error); }
}
export async function GET(req: Request) {
  if (!checkRateLimit(`pair-poll:${clientIp(req)}`, 300)) return Response.json({ error: '轮询过于频繁' }, { status: 429 });
  try {
    const deviceCode = new URL(req.url).searchParams.get('deviceCode');
    if (!deviceCode) throw new AccountError('缺少设备配对凭证', 400);
    return Response.json(await pollPairing(deviceCode), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return accountErrorResponse(error); }
}
