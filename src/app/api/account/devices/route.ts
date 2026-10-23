import { guardRequest } from '@/lib/api-guard';
import { getRequestSession, listDevices, revokeDevice } from '@/lib/account-store';
import { AccountError, accountErrorResponse } from '@/lib/mysql';
export const runtime = 'nodejs';
export async function GET(req: Request) {
  const guarded = await guardRequest(req);
  if (guarded) return guarded;
  try {
    const session = (await getRequestSession(req))!;
    const devices = (await listDevices(session.user.id)).map(device => ({ ...device, current: device.id === session.device.id }));
    return Response.json({ devices }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return accountErrorResponse(error); }
}
export async function DELETE(req: Request) {
  const guarded = await guardRequest(req);
  if (guarded) return guarded;
  try {
    const session = (await getRequestSession(req))!;
    const id = new URL(req.url).searchParams.get('id');
    if (!id || !/^[a-f0-9-]{36}$/.test(id)) throw new AccountError('设备 ID 无效', 400);
    await revokeDevice(session.user.id, id);
    return Response.json({ success: true });
  } catch (error) { return accountErrorResponse(error); }
}
