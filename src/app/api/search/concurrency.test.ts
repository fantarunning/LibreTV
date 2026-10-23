import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import { fetchUpstream } from '@/lib/fetch-utils';
import type { SourceConfig } from '@/lib/types';

vi.mock('@/lib/api-guard', () => ({ guardRequest: vi.fn(async () => null) }));
vi.mock('@/lib/ssrf', () => ({ checkUpstreamAllowed: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/fetch-utils', async () => ({
  ...await vi.importActual<typeof import('@/lib/fetch-utils')>('@/lib/fetch-utils'), fetchUpstream: vi.fn(),
}));

const sources = (test: string, count: number): SourceConfig[] => Array.from({ length: count }, (_, index) => ({
  key: `s${index}`, name: `Source ${index}`, url: `https://source-${index}.example.com/${test}`,
}));
const page = (id: string, pagecount = 1) => new Response(JSON.stringify({ pagecount,
  list: [{ vod_id: id, vod_name: '并发验收', type_name: '电影' }] }), { headers: { 'content-type': 'application/json' } });
const request = (test: string, count: number, stream = false, signal?: AbortSignal) => new Request(
  `https://local.test/api/search${stream ? '?stream=1' : ''}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ wd: '并发验收', sources: sources(test, count), filterAdult: true }),
  });

beforeEach(() => { vi.mocked(fetchUpstream).mockReset(); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('bounded source aggregation', () => {
  it.each([{ configured: '4', expected: 4 }, { configured: '99', expected: 8 }, { configured: 'invalid', expected: 4 }])(
    'limits active sources to $expected when SEARCH_CONCURRENCY=$configured', async ({ configured, expected }) => {
      vi.stubEnv('SEARCH_CONCURRENCY', configured);
      let active = 0;
      let peak = 0;
      let releaseAutomatically = false;
      const gates: (() => void)[] = [];
      vi.mocked(fetchUpstream).mockImplementation(async url => {
        active++; peak = Math.max(peak, active);
        if (!releaseAutomatically) await new Promise<void>(resolve => gates.push(resolve));
        active--;
        return page(new URL(url).hostname);
      });
      const pending = POST(request(`source-bound-${configured}`, 12));
      await vi.waitFor(() => expect(fetchUpstream).toHaveBeenCalledTimes(expected));
      expect(active).toBe(expected);
      releaseAutomatically = true; gates.forEach(release => release());
      const response = await pending;
      expect(peak).toBe(expected);
      expect(fetchUpstream).toHaveBeenCalledTimes(12);
      expect((await response.json()).list).toHaveLength(12);
    },
  );

  it('allows only two extra pages per source and preserves successes if one page fails', async () => {
    let active = 0;
    let peak = 0;
    const seen: number[] = [];
    vi.mocked(fetchUpstream).mockImplementation(async url => {
      const number = Number(new URL(url).searchParams.get('pg'));
      seen.push(number);
      if (number === 1) return page('1', 5);
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      return number === 3 ? new Response('failure', { status: 500 }) : page(String(number));
    });
    const result = await (await POST(request('page-bound', 1))).json();
    expect(peak).toBe(2);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
    expect(result.list.map((item: { vodId: string }) => item.vodId).sort()).toEqual(['1', '2', '4', '5']);
    expect(result.failures).toEqual([]);
  });

  it('emits a healthy source before a blocked source finishes and still emits one final done', async () => {
    vi.stubEnv('SEARCH_CONCURRENCY', '2');
    let release!: () => void;
    vi.mocked(fetchUpstream).mockImplementation(async url => {
      if (new URL(url).hostname === 'source-0.example.com') await new Promise<void>(resolve => { release = resolve; });
      return page(new URL(url).hostname);
    });
    const response = await POST(request('progressive-stream', 3, true));
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(JSON.parse(new TextDecoder().decode(first.value))).toMatchObject({ type: 'source', sourceKey: 's1' });
    release();
    let tail = '';
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; tail += new TextDecoder().decode(chunk.value); }
    const events = tail.trim().split('\n').map(line => JSON.parse(line));
    expect(events.filter(event => event.type === 'done')).toHaveLength(1);
    expect(events.at(-1).type).toBe('done');
  });

  it('reader.cancel aborts active fetches, never starts queued sources, and never caches cancellation', async () => {
    vi.stubEnv('SEARCH_CONCURRENCY', '2');
    let active = 0;
    vi.mocked(fetchUpstream).mockImplementation(async (_url, options) => new Promise<Response>((_resolve, reject) => {
      active++;
      options!.signal!.addEventListener('abort', () => { active--; reject(options!.signal!.reason); }, { once: true });
    }));
    const response = await POST(request('cancel-stream', 10, true));
    await vi.waitFor(() => expect(active).toBe(2));
    await response.body!.getReader().cancel();
    await vi.waitFor(() => expect(active).toBe(0));
    expect(fetchUpstream).toHaveBeenCalledTimes(2);
    vi.mocked(fetchUpstream).mockImplementation(async url => page(new URL(url).hostname));
    const fresh = await (await POST(request('cancel-stream', 10))).json();
    expect(fetchUpstream).toHaveBeenCalledTimes(12);
    expect(fresh.list).toHaveLength(10);
  });

  it('request abort returns 499 and cancels both active fetches without scheduling the remaining sources', async () => {
    vi.stubEnv('SEARCH_CONCURRENCY', '2');
    let active = 0;
    vi.mocked(fetchUpstream).mockImplementation(async (_url, options) => new Promise<Response>((_resolve, reject) => {
      active++;
      options!.signal!.addEventListener('abort', () => { active--; reject(options!.signal!.reason); }, { once: true });
    }));
    const controller = new AbortController();
    const pending = POST(request('cancel-json', 10, false, controller.signal));
    await vi.waitFor(() => expect(active).toBe(2)); controller.abort();
    expect((await pending).status).toBe(499);
    expect(active).toBe(0);
    expect(fetchUpstream).toHaveBeenCalledTimes(2);
  });

  it('source deadline keeps timeout semantics and cancels queued extra pages', async () => {
    vi.useFakeTimers();
    let aborted = 0;
    vi.mocked(fetchUpstream).mockImplementation(async (url, options) => {
      if (new URL(url).searchParams.get('pg') === '1') return page('1', 5);
      return new Promise<Response>((_resolve, reject) => {
        options!.signal!.addEventListener('abort', () => { aborted++; reject(options!.signal!.reason); }, { once: true });
      });
    });
    const pending = POST(request('deadline-pages', 1));
    await vi.waitFor(() => expect(fetchUpstream).toHaveBeenCalledTimes(3));
    await vi.advanceTimersByTimeAsync(10001);
    const result = await (await pending).json();
    expect(result.failures[0]).toMatchObject({ sourceKey: 's0', timedOut: true });
    expect(aborted).toBe(2);
    expect(fetchUpstream).toHaveBeenCalledTimes(3);
  });
});
