import { guardRequest } from '@/lib/api-guard';
import { fetchWithSafeRedirects } from '@/lib/fetch-utils';
import { nativeManifest } from '@/lib/native-manifest';

export const runtime = 'nodejs';
const MAX_BYTES = 2 * 1024 * 1024;

export async function GET(req: Request): Promise<Response> {
  const guarded = await guardRequest(req);
  if (guarded) return guarded;
  const url = new URL(req.url);
  const target = url.searchParams.get('url') || '';
  if (!/^https?:\/\//i.test(target) || target.length > 8192) return Response.json({ error: '无效的播放清单地址' }, { status: 400 });
  try {
    const { res, finalUrl } = await fetchWithSafeRedirects(target, {
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(12_000)]),
      headers: { Accept: 'application/vnd.apple.mpegurl,application/x-mpegURL,text/plain', 'User-Agent': 'Mozilla/5.0 LibreTV', Referer: `${new URL(target).origin}/` },
    });
    if (!res.ok) { await res.body?.cancel(); return Response.json({ error: `片源返回 HTTP ${res.status}` }, { status: 502 }); }
    if (Number(res.headers.get('content-length') || 0) > MAX_BYTES) { await res.body?.cancel(); return Response.json({ error: '播放清单过大' }, { status: 413 }); }
    const reader = res.body?.getReader();
    if (!reader) return Response.json({ error: '片源未返回播放清单' }, { status: 502 });
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) { await reader.cancel(); return Response.json({ error: '播放清单过大' }, { status: 413 }); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const content = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '');
    if (!content.trimStart().startsWith('#EXTM3U')) return Response.json({ error: '片源未返回有效 HLS 清单' }, { status: 422 });
    return new Response(nativeManifest(content, finalUrl, url.searchParams.get('filterAds') === '1'), {
      headers: { 'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8', 'Cache-Control': 'private, no-store' },
    });
  } catch {
    return Response.json({ error: '播放清单加载失败，请重试或切换资源' }, { status: 502 });
  }
}
