import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { cmsRequestHeaders, filterAdultResults, filterRelevantResults, normalizeTitle, parseSearchList } from '@/lib/cms-parser';
import { fetchUpstream, getCache, setCache } from '@/lib/fetch-utils';
import { checkUpstreamAllowed } from '@/lib/ssrf';
import { forEachBounded } from '@/lib/bounded-work';
import type { SearchResponse, SearchStreamEvent, SourceConfig, SourceSearchOutcome } from '@/lib/types';

export const runtime = 'nodejs';

interface SearchBody {
  wd: string;
  sources: SourceConfig[];
  filterAdult?: boolean;
}

/** 搜索结果短缓存：同一关键词 + 同一组源在 TTL 内直接返回（播放页返回搜索页等场景） */
const SEARCH_CACHE_TTL = 60 * 1000;

/** 缓存键：wd + 成人过滤 + 排序后的源地址集合（直接用完整字符串，避免哈希碰撞串缓存） */
function searchCacheKey(wd: string, sources: SourceConfig[], filterAdult: boolean): string {
  const urls = sources.map((s) => s.url.replace(/\/+$/, '')).sort().join('|');
  return `search:${wd}\n${filterAdult ? 1 : 0}\n${urls}`;
}

/**
 * 每个源最多抓取的页数。
 * 第一页响应会带回 pagecount（源站真实总页数），实际抓取页数 = min(pagecount, 该值)。
 * 默认 5；后续页最多 2 个并行请求，单页失败只丢弃该页。
 */
const SEARCH_MAX_PAGES = (() => {
  const n = parseInt(process.env.SEARCH_MAX_PAGES || '5', 10);
  if (!Number.isFinite(n)) return 5;
  return Math.min(50, Math.max(1, n));
})();

/**
 * 单源总死线（毫秒）：该源所有分页请求必须在时限内完成，到点中断在途请求并标记超时。
 * 没有它时慢源最坏要等「首页 8s + 后续页并行 8s」，拖垮整体响应。
 * 环境变量 SEARCH_SOURCE_TIMEOUT_MS 可配，默认 10s。
 */
const SEARCH_SOURCE_TIMEOUT_MS = (() => {
  const n = parseInt(process.env.SEARCH_SOURCE_TIMEOUT_MS || '10000', 10);
  if (!Number.isFinite(n)) return 10000;
  return Math.min(60000, Math.max(3000, n));
})();

function searchConcurrency(): number {
  const value = parseInt(process.env.SEARCH_CONCURRENCY || '4', 10);
  return Number.isFinite(value) ? Math.min(8, Math.max(1, value)) : 4;
}

/** AbortSignal.timeout / 源级死线中断均以 TimeoutError 语义呈现（直接抛出或挂在 cause 上） */
function isTimeoutError(err: unknown): boolean {
  const candidates: unknown[] = [err, err instanceof Error ? err.cause : undefined];
  return candidates.some((e) => e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError'));
}

/**
 * 服务端聚合搜索：有界并发请求选中源，任一源失败不影响整体。
 * 每个源先取第一页并读取 pagecount，再以 2 个工作线程抓取后续页（上限 SEARCH_MAX_PAGES），
 * 整源受 SEARCH_SOURCE_TIMEOUT_MS 总死线约束。
 * 旧版在浏览器里打满 N 个请求（暴露用户 IP、无法缓存、超时失控），现全部上移。
 */
async function searchSource(source: SourceConfig, wd: string, requestSignal: AbortSignal): Promise<SourceSearchOutcome> {
  const start = Date.now();
  const finish = (outcome: Omit<SourceSearchOutcome, 'ms'>): SourceSearchOutcome => ({
    ...outcome,
    ms: Date.now() - start,
  });

  if (!/^https?:\/\//.test(source.url || '')) {
    return finish({ sourceKey: source.key, ok: false, list: [], error: '无效的源地址' });
  }
  // 死线到点中断该源所有在途分页请求，避免后台继续空耗
  const controller = new AbortController();
  const cancel = () => controller.abort(requestSignal.reason || new DOMException('搜索已取消', 'AbortError'));
  if (requestSignal.aborted) cancel();
  else requestSignal.addEventListener('abort', cancel, { once: true });
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<SourceSearchOutcome>((resolve) => {
    deadlineTimer = setTimeout(() => {
      controller.abort(new DOMException('源搜索超时', 'TimeoutError'));
      resolve(
        finish({
          sourceKey: source.key,
          ok: false,
          list: [],
          error: `请求超时（>${Math.round(SEARCH_SOURCE_TIMEOUT_MS / 1000)}s）`,
          timedOut: true,
        })
      );
    }, SEARCH_SOURCE_TIMEOUT_MS);
  });

  const base = source.url.replace(/\/+$/, '');
  const fetchPage = async (page: number) => {
    controller.signal.throwIfAborted();
    const api = `${base}?ac=videolist&wd=${encodeURIComponent(wd)}&pg=${page}`;
    const res = await fetchUpstream(api, {
      timeoutMs: 8000,
      headers: cmsRequestHeaders(),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };

  const run = async (): Promise<SourceSearchOutcome> => {
    controller.signal.throwIfAborted();
    // The deadline also covers DNS/SSRF checks. DNS itself cannot be canceled, so check again afterwards.
    const verdict = await checkUpstreamAllowed(source.url);
    controller.signal.throwIfAborted();
    if (!verdict.ok) return { sourceKey: source.key, ok: false, list: [], error: verdict.reason };
    const first = await fetchPage(1);
    const list = parseSearchList(first, source);
    // 源站真实总页数与配置上限取较小者；pagecount 缺失或非法时视为 1 页
    const rawPageCount = parseInt(String((first as { pagecount?: unknown }).pagecount ?? '1'), 10);
    const pageCount = Math.min(Number.isFinite(rawPageCount) ? Math.max(1, rawPageCount) : 1, SEARCH_MAX_PAGES);
    if (pageCount > 1) {
      const extraPages: ReturnType<typeof parseSearchList>[] = new Array(pageCount - 1);
      await forEachBounded(
        Array.from({ length: pageCount - 1 }, (_, i) => i + 2), 2, async (page, index) => {
          try {
            extraPages[index] = parseSearchList(await fetchPage(page), source);
          } catch {
            extraPages[index] = [];
          }
        }, controller.signal,
      );
      list.push(...extraPages.flat());
    }
    return { sourceKey: source.key, ok: true, list };
  };

  try {
    // 死线先到时 run 仍会在后台被 abort 并 reject，必须先挂 catch 防未处理 rejection
    const runPromise = run()
      .then(finish)
      .catch((err: unknown): SourceSearchOutcome =>
        finish({
          sourceKey: source.key,
          ok: false,
          list: [],
          error: err instanceof Error ? err.message : '请求失败',
          timedOut: isTimeoutError(err),
        })
      );
    // Finish cancellation immediately even if a custom upstream body ignores AbortSignal.
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<SourceSearchOutcome>((resolve) => {
      onAbort = () => resolve(finish({ sourceKey: source.key, ok: false, list: [],
        error: requestSignal.aborted ? '搜索已取消' : `请求超时（>${Math.round(SEARCH_SOURCE_TIMEOUT_MS / 1000)}s）`,
        timedOut: !requestSignal.aborted,
      }));
      if (controller.signal.aborted) onAbort();
      else controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    try { return await Promise.race([runPromise, deadline, aborted]); }
    finally { if (onAbort) controller.signal.removeEventListener('abort', onAbort); }
  } catch (err) {
    return finish({
      sourceKey: source.key,
      ok: false,
      list: [],
      error: err instanceof Error ? err.message : '请求失败',
      timedOut: isTimeoutError(err),
    });
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
    requestSignal.removeEventListener('abort', cancel);
  }
}

/** 合并 + 去重 + 过滤 + 排序，stream 与非 stream 两种模式共用 */
function aggregateOutcomes(outcomes: SourceSearchOutcome[], wd: string, filterAdult: boolean): SearchResponse {
  const seen = new Set<string>();
  let list = outcomes.flatMap((o) => o.list).filter((item) => {
    const key = `${item.sourceKey}_${item.vodId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  list = filterAdultResults(list, filterAdult);
  // 部分源站做分词/OR 模糊搜索（搜「摔跤吧！爸爸」返回一堆「爸爸XXX」），按关键词过滤
  list = filterRelevantResults(list, wd);

  // 精确命中（忽略标点差异）排在最前，其余按名称（与旧版一致），名称相同按源名
  const exact = normalizeTitle(wd);
  list.sort((a, b) => {
    const aExact = normalizeTitle(a.name || '') === exact ? 0 : 1;
    const bExact = normalizeTitle(b.name || '') === exact ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    const nameCompare = (a.name || '').localeCompare(b.name || '', 'zh-Hans-CN');
    if (nameCompare !== 0) return nameCompare;
    return (a.sourceName || '').localeCompare(b.sourceName || '', 'zh-Hans-CN');
  });

  const failures = outcomes
    .filter((o) => !o.ok)
    .map((o) => ({ sourceKey: o.sourceKey, error: o.error || '请求失败', timedOut: o.timedOut }));

  return { list, failures };
}

/**
 * 服务端聚合搜索：
 * - 默认返回完整 JSON（换源流程使用）；
 * - `?stream=1` 以 NDJSON 逐源推送（完成一个推一条，健康源的结果不再等坏源超时），
 *   最终推送聚合后的 done 事件并写入短缓存。
 */
export async function POST(req: Request) {
  const guarded = await guardRequest(req);
  if (guarded) return guarded;

  let body: SearchBody;
  try {
    body = (await req.json()) as SearchBody;
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }

  const wd = (body.wd || '').trim();
  if (!wd || wd.length > 100) {
    return NextResponse.json({ error: '搜索关键词无效' }, { status: 400 });
  }
  if (!Array.isArray(body.sources) || body.sources.length === 0) {
    return NextResponse.json({ error: '请至少选择一个点播源' }, { status: 400 });
  }
  const sources = body.sources.slice(0, 50);
  const filterAdult = body.filterAdult !== false;
  if (req.signal.aborted) return NextResponse.json({ error: '搜索已取消' }, { status: 499 });

  const cacheKey = searchCacheKey(wd, sources, filterAdult);
  const cached = getCache<SearchResponse>(cacheKey);
  if (cached) {
    // 流式模式下缓存命中也要走 done 事件，客户端解析逻辑保持单一
    if (new URL(req.url).searchParams.get('stream') === '1') {
      const event: SearchStreamEvent = { type: 'done', list: cached.list, failures: cached.failures };
      return new Response(JSON.stringify(event) + '\n', {
        headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    return NextResponse.json(cached);
  }

  const isStream = new URL(req.url).searchParams.get('stream') === '1';
  const searchController = new AbortController();
  const cancelSearch = () => searchController.abort(req.signal.reason || new DOMException('搜索已取消', 'AbortError'));
  if (req.signal.aborted) cancelSearch();
  else req.signal.addEventListener('abort', cancelSearch, { once: true });
  const cleanup = () => req.signal.removeEventListener('abort', cancelSearch);
  if (!isStream) {
    try {
      const outcomes: SourceSearchOutcome[] = new Array(sources.length);
      await forEachBounded(sources, searchConcurrency(), async (source, index) => {
        outcomes[index] = await searchSource(source, wd, searchController.signal);
      }, searchController.signal);
      if (searchController.signal.aborted) return NextResponse.json({ error: '搜索已取消' }, { status: 499 });
      const payload = aggregateOutcomes(outcomes, wd, filterAdult);
      setCache(cacheKey, payload, SEARCH_CACHE_TTL);
      return NextResponse.json(payload);
    } finally { cleanup(); }
  }

  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: SearchStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
        } catch {
          closed = true; // 客户端已断开
          cancelSearch();
        }
      };

      // 逐源结算即推送；outcomes 按下标回填保证聚合顺序稳定
      // Do not return the worker promise from start(): reader.cancel() must interrupt it immediately.
      void (async () => {
        try {
          const outcomes: SourceSearchOutcome[] = new Array(sources.length);
          await forEachBounded(sources, searchConcurrency(), async (source, index) => {
            const outcome = await searchSource(source, wd, searchController.signal);
            outcomes[index] = outcome;
            if (searchController.signal.aborted) return;
            const { list } = aggregateOutcomes([outcome], wd, filterAdult);
            send({ type: 'source', ...outcome, list });
          }, searchController.signal);
          if (searchController.signal.aborted) return;
          const payload = aggregateOutcomes(outcomes, wd, filterAdult);
          setCache(cacheKey, payload, SEARCH_CACHE_TTL);
          send({ type: 'done', list: payload.list, failures: payload.failures });
        } catch (error) {
          cancelSearch();
          if (!closed) controller.error(error);
          closed = true;
        } finally {
          cleanup();
          if (!closed) { closed = true; try { controller.close(); } catch { /* Client already closed. */ } }
        }
      })();
    },
    cancel() { closed = true; cancelSearch(); cleanup(); },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}
