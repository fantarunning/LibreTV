import { AccountError } from './mysql';

export async function readLimitedJson(req: Request, maximum = 256 * 1024): Promise<Record<string, unknown>> {
  if (!req.headers.get('content-type')?.toLowerCase().includes('application/json')) throw new AccountError('请使用 application/json 请求', 415);
  if (Number(req.headers.get('content-length') || 0) > maximum) throw new AccountError('请求内容过大', 413);
  const reader = req.body?.getReader();
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  if (reader) {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maximum) { await reader.cancel(); throw new AccountError('请求内容过大', 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new AccountError('请求必须为合法 JSON 对象', 400); }
}
