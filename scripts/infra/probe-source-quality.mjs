// Public AppleCMS audit: search relevance, independent detail, real HLS bytes and encoded dimensions.
// No media links, cookies, encryption keys or expiring URL parameters are retained in the public report.
import fs from 'node:fs/promises';
import dns from 'node:dns/promises';
import { isIP } from 'node:net';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
const require = createRequire(import.meta.url);
const codec = require(process.env.PROBE_CODEC_HELPER);
const [input, output] = process.argv.slice(2);
if (!output) throw Error('Usage: probe-source-quality.mjs input.json report.json');
const sources = JSON.parse(await fs.readFile(input, 'utf8')).sources;
const queries = (process.env.PROBE_QUERIES || '流浪地球,庆余年,斗罗大陆').split(',');
const timeout = Number(process.env.PROBE_TIMEOUT_MS || 7000);
const budget = Number(process.env.PROBE_SOURCE_BUDGET_MS || 45000);
const concurrency = Math.min(4, Number(process.env.PROBE_CONCURRENCY || 2));
const cache = new Map();
const apiStarts = new Map();
function privateIP(ip) {
  if (ip.includes(':')) return /^(::|fc|fd|fe[89ab])/i.test(ip);
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a >= 224;
}
async function request(value, signal, cap = 2 * 1024 * 1024, range = false, depth = 0) {
  signal.throwIfAborted();
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || depth > 4) throw Error('unsafe-url');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses = cache.get(host);
  if (!addresses) {
    addresses = isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
    cache.set(host, addresses);
  }
  if (!addresses.length || addresses.some(x => privateIP(x.address))) throw Error('unsafe-address');
  const started = Date.now();
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
    headers: { 'User-Agent': 'Mozilla/5.0 LibreTV-SourceAudit/2.0', ...(range ? { Range: `bytes=0-${cap - 1}` } : {}) } });
  if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
    await response.body?.cancel();
    return request(new URL(response.headers.get('location'), url), signal, cap, range, depth + 1);
  }
  if (!response.ok) { await response.body?.cancel(); throw Error(`http-${response.status}`); }
  const chunks = []; let size = 0; const reader = response.body.getReader();
  try {
    while (size < cap) {
      const { value: part, done } = await reader.read(); if (done) break;
      const kept = part.subarray(0, cap - size); chunks.push(kept); size += kept.length;
    }
  } finally { await reader.cancel(); }
  return { body: Buffer.concat(chunks), type: response.headers.get('content-type') || '', url: String(url), ms: Date.now() - started };
}
function withParams(base, values) {
  const url = new URL(base); for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value); return url;
}
async function json(url, signal) {
  // The provider's public collection instructions require at least one second between API calls.
  const host = new URL(url).hostname;
  const limitedProvider = /(?:^|\.)hhzyapi\.com$/i.test(host) ? 'hhzyapi' : /(?:^|\.)(?:subocj|subocaiji)\.com$/i.test(host) ? 'subo' : null;
  if (limitedProvider) {
    const now = Date.now(); const scheduled = Math.max(now, apiStarts.get(limitedProvider) || 0);
    apiStarts.set(limitedProvider, scheduled + 1000);
    if (scheduled > now) await delay(scheduled - now, undefined, { signal });
  }
  const response = await request(url, signal);
  try { return { value: JSON.parse(response.body.toString('utf8').replace(/^\uFEFF/, '')), ms: response.ms }; }
  catch { throw Error('not-json'); }
}
function attrs(line) { return Object.fromEntries([...line.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)].map(m => [m[1], m[2].replace(/^"|"$/g, '')])); }
async function media(value, signal, depth = 0) {
  if (depth > 3) throw Error('playlist-depth');
  const response = await request(value, signal); const text = response.body.toString('utf8').trimStart();
  if (!text.startsWith('#EXTM3U')) throw Error('not-hls');
  const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const variants = [];
  for (let i = 0; i < lines.length - 1; i++) if (lines[i].startsWith('#EXT-X-STREAM-INF:')) {
    const a = attrs(lines[i]); variants.push({ url: new URL(lines[i + 1], response.url), bandwidth: Number(a.BANDWIDTH) || 0 });
  }
  if (variants.length) { variants.sort((a, b) => b.bandwidth - a.bandwidth); return media(variants[0].url, signal, depth + 1); }
  let key, map, duration, sequence = Number(lines.find(x => x.startsWith('#EXT-X-MEDIA-SEQUENCE:'))?.split(':')[1]) || 0;
  const segments = [];
  for (const line of lines) {
    if (line.startsWith('#EXT-X-KEY:')) key = attrs(line);
    else if (line.startsWith('#EXT-X-MAP:')) map = attrs(line).URI;
    else if (line.startsWith('#EXTINF:')) duration = Number(line.slice(8).split(',')[0]);
    else if (!line.startsWith('#')) segments.push({ url: new URL(line, response.url), key, sequence: sequence++, map, duration });
  }
  if (!segments.length) throw Error('empty-playlist');
  const sample = segments[Math.floor(segments.length / 2)];
  const segment = await request(sample.url, signal, 256 * 1024, true);
  if (segment.body.length < 1024 || /text\/html|application\/json/i.test(segment.type) || /^\s*(<!doctype|<html)/i.test(segment.body.toString('utf8', 0, 40))) throw Error('invalid-segment');
  let bytes = segment.body;
  if (sample.key?.METHOD && sample.key.METHOD !== 'NONE') {
    if (sample.key.METHOD !== 'AES-128' || !sample.key.URI) throw Error('unsupported-encryption');
    const aesKey = await request(new URL(sample.key.URI, response.url), signal, 64);
    const iv = sample.key.IV ? Buffer.from(sample.key.IV.replace(/^0x/, ''), 'hex') : Buffer.from(BigInt(sample.sequence).toString(16).padStart(32, '0'), 'hex');
    bytes = Buffer.from(codec.decryptAes128CbcPrefix(bytes, aesKey.body, iv));
  }
  let resolution = codec.parseTsVideoResolution(bytes) || codec.parseMp4VideoResolution(bytes);
  if (!resolution && sample.map) resolution = codec.parseMp4VideoResolution((await request(new URL(sample.map, response.url), signal, 256 * 1024, true)).body);
  return { manifestMs: response.ms, segmentMs: segment.ms, bytes: segment.body.length, segmentCount: segments.length,
    durationSeconds: Math.round(segments.reduce((sum, entry) => sum + (entry.duration || 0), 0)),
    mediaHost: new URL(response.url).hostname, segmentHost: new URL(segment.url).hostname,
    encrypted: Boolean(sample.key && sample.key.METHOD !== 'NONE'), ...(resolution || {}) };
}
const normalized = title => String(title).normalize('NFKC').replace(/[\p{P}\p{S}\s]/gu, '').toLowerCase();
const excluded = item => /解说|预告|短剧|花絮|速看|混剪|影评|幕后|访谈|伦理|色情|成人|里番|三级/.test(`${item.vod_name || ''} ${item.type_name || ''}`);
const reason = error => error?.code || (/^[a-z0-9-]+$/.test(error?.message) ? error.message : error?.name || 'unknown-error');
async function probe(source) {
  const started = Date.now(); const signal = AbortSignal.timeout(budget);
  const result = { name: source.name, url: source.url, provenance: source.provenance || [], queries: [] };
  for (const query of queries) {
    const check = { query, matches: 0, chain: false };
    try {
      const found = await json(withParams(source.url, { ac: 'videolist', wd: query, pg: '1' }), signal);
      const matches = (Array.isArray(found.value.list) ? found.value.list : [])
        .filter(x => normalized(x.vod_name).includes(normalized(query)) && !excluded(x))
        .sort((a, b) => Number(normalized(b.vod_name) === normalized(query)) - Number(normalized(a.vod_name) === normalized(query)));
      check.searchMs = found.ms; check.matches = matches.length;
      if (!matches.length) throw Error('no-matching-results');
      let last;
      for (const item of matches.slice(0, 2)) {
        try {
          const detail = await json(withParams(source.url, { ac: 'videolist', ids: String(item.vod_id) }), signal);
          const movie = detail.value.list?.[0];
          if (!movie || !normalized(movie.vod_name).includes(normalized(query)) || excluded(movie)) throw Error('wrong-detail');
          const urls = String(movie.vod_play_url || '').split('$$$').flatMap(group => group.split('#').map(x => x.slice(x.indexOf('$') + 1))).filter(x => /^https?:\/\//i.test(x) && /\.m3u8(?:[?#]|$)/i.test(x));
          if (!urls.length) throw Error('no-direct-hls');
          const proof = await media(urls[0], signal);
          if (proof.width && proof.height > proof.width) throw Error('portrait-clip');
          const minimumDuration = query === '流浪地球' ? 3600 : query === '庆余年' ? 900 : 300;
          if (proof.durationSeconds < minimumDuration) throw Error('short-clip');
          Object.assign(check, { title: movie.vod_name, category: movie.type_name, id: String(movie.vod_id), detailMs: detail.ms }, proof, { chain: true });
          break;
        } catch (error) { last = error; if (signal.aborted) break; }
      }
      if (!check.chain) throw last || Error('no-playable-sample');
    } catch (error) { check.reason = reason(error); }
    result.queries.push(check); if (signal.aborted) break;
  }
  const successful = result.queries.filter(x => x.chain);
  result.searchCoverage = result.queries.filter(x => x.matches > 0).length;
  result.chainCoverage = successful.length;
  result.actualHdSamples = successful.filter(x => x.width >= 1920 && x.height >= 700).length;
  result.elapsedMs = Date.now() - started;
  result.status = successful.length >= 2 ? 'multi-title-passed' : successful.length ? 'single-title-passed' : 'failed';
  return result;
}
const results = new Array(sources.length); let next = 0; let checkpoint = Promise.resolve();
await Promise.all(Array.from({ length: Math.min(concurrency, sources.length) }, async () => {
  while (next < sources.length) {
    const index = next++; results[index] = await probe(sources[index]);
    console.log(`${index + 1}/${sources.length} ${sources[index].name}: ${results[index].status} ${results[index].chainCoverage}/${queries.length} HD=${results[index].actualHdSamples}`);
    checkpoint = checkpoint.then(() => fs.writeFile(output, JSON.stringify({ checkedAt: new Date().toISOString(), complete: false, vantage: process.env.PROBE_VANTAGE || 'local', queries, results: results.filter(Boolean) }, null, 2) + '\n'));
    await checkpoint;
  }
}));
await fs.writeFile(output, JSON.stringify({ checkedAt: new Date().toISOString(), complete: true, vantage: process.env.PROBE_VANTAGE || 'local', queries,
  note: 'Matching search, independent detail and one real middle HLS segment per title. Dimensions come from media headers only. Limited samples do not establish long-term reliability, full playback or device performance.', results }, null, 2) + '\n');
