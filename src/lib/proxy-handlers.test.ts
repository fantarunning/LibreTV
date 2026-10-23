import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleProxyRequest } from './proxy-handlers';
import { fetchWithSafeRedirects } from './fetch-utils';

vi.mock('./api-guard', () => ({ guardRequest: vi.fn(async () => null), jsonError: vi.fn() }));
vi.mock('./ssrf', () => ({ isValidProxyUrl: () => true, isBlockedByDNS: async () => false }));
vi.mock('./fetch-utils', () => ({ fetchWithSafeRedirects: vi.fn() }));

const fetchMock = vi.mocked(fetchWithSafeRedirects);
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('4K HLS 点播代理', () => {
  it('重写带查询参数的 fMP4 清单，初始化段和分片使用重定向后的目录', async () => {
    const playlist = '#EXTM3U\n#EXT-X-MAP:URI="init.mp4",BYTERANGE="1024@0"\n#EXTINF:2,\n0001.m4s';
    fetchMock.mockResolvedValue({
      res: new Response(playlist, { headers: { 'content-type': 'text/plain' } }),
      finalUrl: 'https://cdn.example.com/movie/4K/index.m3u8?token=public',
    });
    const response = await handleProxyRequest(new Request('http://localhost/api/proxy'), 'https://origin.example.com/index.m3u8?quality=4K');
    const body = await response.text();
    expect(body).toContain('URI="/api/proxy?url=' + encodeURIComponent('https://cdn.example.com/movie/4K/init.mp4') + '",BYTERANGE="1024@0"');
    expect(body).toContain('/api/proxy?url=' + encodeURIComponent('https://cdn.example.com/movie/4K/0001.m4s'));
    expect(response.headers.get('content-type')).toBe('application/vnd.apple.mpegurl');
  });

  it('保留 fMP4 的 Range/206，流式读取并允许响应体传输超过头部等待期限', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const segment = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
    fetchMock.mockResolvedValue({
      res: new Response(segment, { status: 206, headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-7/1024', 'accept-ranges': 'bytes' } }),
      finalUrl: 'https://cdn.example.com/0001.m4s',
    });
    const response = await handleProxyRequest(new Request('http://localhost/api/proxy', { headers: { range: 'bytes=0-7' } }), 'https://cdn.example.com/0001.m4s');
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Range: 'bytes=0-7' });
    expect(timeout.mock.calls[0][0]).toBeGreaterThan(fetchMock.mock.calls[0][2]!.headerTimeoutMs!);
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 0-7/1024');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(segment);
  });

  it('客户端取消会中断上游分片请求且不重试', async () => {
    const client = new AbortController();
    fetchMock.mockImplementation(async (_url, init) => {
      client.abort();
      expect(init?.signal?.aborted).toBe(true);
      throw new DOMException('Aborted', 'AbortError');
    });
    const response = await handleProxyRequest(new Request('http://localhost/api/proxy', { signal: client.signal }), 'https://cdn.example.com/0001.m4s');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(502);
  });
});
