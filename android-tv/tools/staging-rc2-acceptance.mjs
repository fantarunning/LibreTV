// Explicitly invoked, temporary-device staging acceptance. Never logs credentials.
import fs from 'node:fs';
import crypto from 'node:crypto';
const origin = 'http://127.0.0.1:18082';
const evidence = 'android-tv/output/evidence/staging-rc2-acceptance.json';
const s = JSON.parse(fs.readFileSync('deploy/.artifacts/browser-session.json', 'utf8'));
const cookie = s.cookie.includes('=') ? s.cookie : `ltv_session=${s.cookie}`;
const headers = { cookie, Origin: 'https://comic.fenda.cc', 'Content-Type': 'application/json' };
async function api(path, body, method = body ? 'POST' : 'GET') {
  const res = await fetch(origin + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path.split('?')[0]} HTTP ${res.status}: ${data.error ?? 'request failed'}`);
  return data;
}
const mode = process.argv[2];
const save = data => fs.writeFileSync(evidence, JSON.stringify(data, null, 2));
if (mode === 'approve') {
  const me = await api('/api/account/me');
  headers['x-libretv-account'] = me.user.id;
  const before = await api('/api/account/devices');
  const xml = fs.readFileSync('android-tv/output/evidence/rc2-pair-private.xml', 'utf8');
  const userCode = xml.match(/text="([A-Z2-9]{4} [A-Z2-9]{4})"/)?.[1]?.replace(' ', '');
  if (!userCode) throw new Error('Native eight-character challenge missing');
  await api('/api/tv/pair/approve', { userCode });
  save({ at: Date.now(), accountId: me.user.id, baseline: before.devices.map(d => d.id) });
  console.log(JSON.stringify({ approvedNativeChallenge: true, codeLength: userCode.length }));
} else {
  const state = JSON.parse(fs.readFileSync(evidence, 'utf8'));
  headers['x-libretv-account'] = state.accountId;
  if (mode === 'send') {
    const devices = (await api('/api/account/devices')).devices.filter(d => d.type === 'tv' && !state.baseline.includes(d.id));
    if (devices.length !== 1) throw new Error(`Expected one own temporary device, got ${devices.length}`);
    state.device = devices[0];
    const catalogue = await api('/sources/4k.json');
    const item = catalogue.items.find(d => d.id === 'zuid-117536');
    if (!item) throw new Error('Expected real 4K VOD missing');
    state.sourceKey = 'acceptance_native_4k';
    state.vodId = `sample_${Date.now()}`;
    state.historyKey = `${state.sourceKey}_${state.vodId}`;
    state.progressKey = `${state.historyKey}_0`;
    state.item = item;
    save(state);
    const manifest = await fetch(`${origin}/api/playback/manifest?url=${encodeURIComponent(item.url)}&filterAds=1`, { headers });
    const text = await manifest.text();
    state.manifest = { status: manifest.status, hls: text.startsWith('#EXTM3U'), segmentUrlsAbsolute: text.split('\n').filter(x=>x && !x.startsWith('#')).every(x=>/^https?:|^\/api\/playback\/manifest/.test(x)) };
    if (!manifest.ok || !state.manifest.hls) throw new Error(`Manifest check failed HTTP ${manifest.status}`);
    state.sent = await api('/api/tv/commands', { deviceId: state.device.id, action: 'play', payload: {
      source: { key: state.sourceKey, name: item.provider, url: item.url }, vodId: state.vodId,
      title: item.title, episodeIndex: 0, position: 0, directUrl: item.url,
      width: item.width, height: item.height, codec: item.codec, isLive: false,
    } });
    save(state);
    console.log(JSON.stringify({ sent: state.sent, manifest: state.manifest, catalogueItems: catalogue.items.length, ttlDays: (state.device.expiresAt-state.device.createdAt)/86400000 }));
  } else if (mode === 'read' || mode === 'cleanup') {
    const records = []; let cursor = 0;
    for (let page=0; page<30; page++) {
      const data = await api(`/api/sync?cursor=${cursor}`);
      records.push(...data.records.filter(r=>[state.historyKey,state.progressKey].includes(r.key)));
      cursor = data.cursor; if (!data.hasMore) break;
    }
    state.returned = records.map(r=>({kind:r.kind,key:r.key,version:r.version,position:r.value?.position ?? r.value?.playbackPosition,duration:r.value?.duration}));
    if (mode === 'cleanup') {
      await api(`/api/account/devices?id=${state.device.id}`, undefined, 'DELETE');
      const mutations = records.map(r=>({eventId:crypto.randomUUID(),kind:r.kind,key:r.key,value:null,baseVersion:r.version}));
      const result = mutations.length ? await api('/api/sync', { mutations }) : { accepted: [] };
      state.cleanup = { deviceRevoked: !(await api('/api/account/devices')).devices.some(d=>d.id===state.device.id), tombstonesAccepted: result.accepted.length, at: Date.now() };
    }
    save(state); console.log(JSON.stringify({returned:state.returned,cleanup:state.cleanup}));
  } else throw new Error('Mode must be approve, send, read or cleanup');
}
