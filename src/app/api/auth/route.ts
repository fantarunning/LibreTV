import { NextResponse } from 'next/server';
import { SESSION_COOKIE, checkRateLimit, checkPassword, clearRateLimit, isPasswordConfigured, isTrustedWrite, clientIp } from '@/lib/auth';
import { createWebSession, getRequestSession, revokeDevice, sanitizeDeviceName } from '@/lib/account-store';
import { readLimitedJson } from '@/lib/account-http';
import { AccountError, accountErrorResponse } from '@/lib/mysql';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  if (!isTrustedWrite(req)) return NextResponse.json({ error: '拒绝跨站登录请求' }, { status: 403 });
  if (!isPasswordConfigured()) return NextResponse.json({ error: '服务器未设置 PASSWORD 环境变量' }, { status: 503 });
  const rateKey = `login:${clientIp(req)}`;
  if (!checkRateLimit(rateKey)) return NextResponse.json({ error: '尝试次数过多，请 10 分钟后再试' }, { status: 429 });
  try {
    const body = await readLimitedJson(req, 8192);
    if (typeof body.password !== 'string' || body.password.length > 1024) throw new AccountError('密码格式无效', 400);
    if (!checkPassword(body.password)) return NextResponse.json({ error: '密码错误' }, { status: 401 });
    const { token, session } = await createWebSession(sanitizeDeviceName(body.deviceName));
    clearRateLimit(rateKey);
    const response = NextResponse.json({ success: true, account: session }, { headers: { 'Cache-Control': 'no-store' } });
    const secure = process.env.COOKIE_SECURE === 'true' ? true : process.env.COOKIE_SECURE === 'false' ? false
      : (req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || new URL(req.url).protocol.slice(0, -1)) === 'https';
    response.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure,
      expires: new Date(session.device.expiresAt), maxAge: Math.floor((session.device.expiresAt - Date.now()) / 1000), path: '/' });
    return response;
  } catch (error) { return accountErrorResponse(error); }
}

export async function GET(req: Request) {
  try {
    const account = await getRequestSession(req);
    return NextResponse.json({ success: true, verified: !!account, account }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return accountErrorResponse(error); }
}

export async function DELETE(req: Request) {
  if (!isTrustedWrite(req)) return NextResponse.json({ error: '拒绝跨站退出请求' }, { status: 403 });
  try {
    const session = await getRequestSession(req);
    if (session) await revokeDevice(session.user.id, session.device.id);
    const response = NextResponse.json({ success: true }, { headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', maxAge: 0, path: '/' });
    return response;
  } catch (error) { return accountErrorResponse(error); }
}
