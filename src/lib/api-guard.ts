import { NextResponse } from 'next/server';
import { isPasswordConfigured, isTrustedWrite } from './auth';
import { getRequestSession } from './account-store';
import { AccountError } from './mysql';

/** API Route 共享守卫：未配置密码返回 503，未登录返回 401 */
export async function guardRequest(req: Request): Promise<NextResponse | null> {
  if (!isPasswordConfigured()) {
    return NextResponse.json(
      { error: '服务器未设置 PASSWORD 环境变量' },
      { status: 503 }
    );
  }
  if (!isTrustedWrite(req)) return NextResponse.json({ error: '拒绝跨站写入请求' }, { status: 403 });
  try {
    const session = await getRequestSession(req);
    if (!session) return NextResponse.json({ error: '未登录或设备授权已失效' }, { status: 401 });
    const expectedAccount = req.headers.get('x-libretv-account');
    if (expectedAccount && expectedAccount !== session.user.id) return NextResponse.json({ error: '账号已切换，请重新同步当前账号' }, { status: 403 });
    return null;
  } catch (error) {
    return NextResponse.json({ error: error instanceof AccountError ? error.message : 'MySQL 账号服务不可用，请检查数据库连接和迁移' }, { status: 503 });
  }
}

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}
