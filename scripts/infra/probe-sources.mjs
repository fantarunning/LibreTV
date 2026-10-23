// Bounded AppleCMS chain probe. Writes source URLs, never expiring media URLs/tokens.
// node scripts/infra/probe-sources.mjs candidates.json report.json curated.json
import fs from 'node:fs/promises';
import dns from 'node:dns/promises';
import { isIP } from 'node:net';

const [input, reportPath, curatedPath] = process.argv.slice(2);
if (!curatedPath) throw new Error('Usage: probe-sources.mjs candidates.json report.json curated.json');
const candidates = JSON.parse(await fs.readFile(input, 'utf8')).sources;
const timeout = Number(process.env.PROBE_TIMEOUT_MS || 8000);
const concurrency = Number(process.env.PROBE_CONCURRENCY || 4);
const query = process.env.PROBE_QUERY || '西游记';
const cache = new Map();
function privateIP(ip) {
  if (ip.includes(':')) return /^(::|fc|fd|fe8|fe9|fea|feb)/i.test(ip) || ip.includes('127.0.0.1');
  const [a,b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a >= 224;
}
async function publicURL(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('unsafe-url');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses = cache.get(host);
  if (!addresses) {
    addresses = isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
    cache.set(host, addresses);
  }
  if (!addresses.length || addresses.some(x => privateIP(x.address))) throw new Error('unsafe-address');
  return url;
}
async function request(value, cap = 2 * 1024 * 1024, range = false, depth = 0) {
  if (depth > 4) throw new Error('redirect-limit');
  const url = await publicURL(value);
  const res = await fetch(url, {
    redirect: 'manual', signal: AbortSignal.timeout(timeout),
    headers: { 'User-Agent': 'Mozilla/5.0 LibreTV-SourceAudit/1.0', ...(range ? { Range: 'bytes=0-65535' } : {}) },
  });
  if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
    await res.body?.cancel();
    return request(new URL(res.headers.get('location'), url), cap, range, depth + 1);
  }
  if (!res.ok) { await res.body?.cancel(); throw new Error(`http-${res.status}`); }
  const chunks = []; let size = 0; const reader = res.body.getReader();
  try {
    while (size < cap) {
      const { value: part, done } = await reader.read();
      if (done) break;
      const retained = part.subarray(0, cap - size); chunks.push(retained); size += retained.length;
    }
  } finally { await reader.cancel(); }
  return { body: Buffer.concat(chunks), type: res.headers.get('content-type') || '', url: String(url) };
}
function withParams(base, params) {
  const url = new URL(base); for (const [k,v] of Object.entries(params)) url.searchParams.set(k, v); return String(url);
}
async function json(url) {
  const response = await request(url);
  try { return JSON.parse(response.body.toString('utf8').replace(/^\uFEFF/, '')); }
  catch { throw new Error('not-json'); }
}
async function media(url, depth = 0, onManifest = () => {}) {
  if (depth > 3) throw new Error('playlist-depth');
  const res = await request(url);
  const text = res.body.toString('utf8');
  if (!text.startsWith('#EXTM3U')) throw new Error('not-hls');
  onManifest();
  const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (lines.some(x => x.startsWith('#EXT-X-STREAM-INF'))) {
    const variant = lines.find((x,i) => i > 0 && lines[i-1].startsWith('#EXT-X-STREAM-INF') && !x.startsWith('#'));
    if (!variant) throw new Error('missing-variant');
    return media(new URL(variant, res.url), depth + 1, onManifest);
  }
  const key = lines.find(x => x.startsWith('#EXT-X-KEY:') && !x.includes('METHOD=NONE'));
  if (key) {
    const uri = /URI="([^"]+)"/.exec(key)?.[1];
    if (!uri) throw new Error('missing-key');
    const keyData = await request(new URL(uri, res.url), 64);
    if (keyData.body.length !== 16) throw new Error('invalid-aes-key');
  }
  const segments = lines.filter(x => !x.startsWith('#'));
  if (!segments.length) throw new Error('empty-playlist');
  const segment = segments[Math.floor(segments.length / 2)];
  const sample = await request(new URL(segment, res.url), 64 * 1024, true);
  if (sample.body.length < 1024 || /text\/html|application\/json/i.test(sample.type) || /^\s*(<!doctype|<html)/i.test(sample.body.toString('utf8',0,40))) throw new Error('invalid-segment');
  return { segmentBytes: sample.body.length, encrypted: !!key, segmentCount: segments.length };
}
async function probe(source) {
  const began = Date.now(); const result = { name: source.name, url: source.url, stages: [], status: 'failed' };
  try {
    const found = await json(withParams(source.url, { ac: 'videolist', wd: query, pg: '1' }));
    const entries = Array.isArray(found.list) ? found.list : [];
    if (!entries.length) throw new Error('no-search-results');
    result.stages.push('search');
    let lastError;
    for (const item of entries.slice(0, 3)) {
      try {
        const details = await json(withParams(source.url, { ac: 'videolist', ids: String(item.vod_id) }));
        const detail = details.list?.[0]; if (!detail) throw new Error('empty-detail');
        if (!result.stages.includes('detail')) result.stages.push('detail');
        const urls = String(detail.vod_play_url || '').split('$$$').flatMap(group => group.split('#').map(ep => ep.slice(ep.indexOf('$')+1))).filter(url => /^https?:\/\//.test(url) && /\.m3u8(?:[?#]|$)/i.test(url));
        if (!urls.length) throw new Error('no-direct-hls');
        for (const url of urls.slice(0, 2)) {
          try {
            const summary = await media(url, 0, () => { if (!result.stages.includes('manifest')) result.stages.push('manifest'); });
            result.stages = ['search', 'detail', 'manifest', 'segment'];
            Object.assign(result, summary, { status: 'chain-passed' });
            return { ...result, elapsedMs: Date.now() - began };
          } catch (err) { lastError = err; }
        }
      } catch (err) { lastError = err; }
    }
    throw lastError || new Error('no-playable-sample');
  } catch (err) { result.reason = err.code || (/^[a-z0-9-]+$/.test(err.message) ? err.message : err.name); }
  return { ...result, elapsedMs: Date.now() - began };
}
const results = new Array(candidates.length); let next = 0;
await Promise.all(Array.from({length: Math.min(concurrency, candidates.length)}, async () => {
  while (next < candidates.length) {
    const index = next++; results[index] = await probe(candidates[index]);
    console.log(`${index+1}/${candidates.length} ${candidates[index].name}: ${results[index].status} ${results[index].reason || ''}`);
  }
}));
const passed = new Set(results.filter(x => x.status === 'chain-passed').map(x => x.url));
await fs.writeFile(reportPath, JSON.stringify({checkedAt: new Date().toISOString(), vantage: process.env.PROBE_VANTAGE || 'local', query, note: 'Search, detail, HLS manifest and one middle segment checked; device decoding and sustained playback were not tested.', results}, null, 2)+'\n');
await fs.writeFile(curatedPath, JSON.stringify({name: 'LibreTV 家庭候选源（链路实测）', sources: candidates.filter(x => passed.has(x.url)), liveSources: []}, null, 2)+'\n');
console.log(`chain_passed=${passed.size}/${candidates.length}`);
