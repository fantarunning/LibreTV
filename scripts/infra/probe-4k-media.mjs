// Verify manifest/segment encoding; never infer resolution from a title or label.
// Input: discovery report, public report, private media-URL report (keep ignored).
import fs from 'node:fs/promises';
import dns from 'node:dns/promises';
import { isIP } from 'node:net';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const codec = require(process.env.PROBE_CODEC_HELPER);
const [input, output, privateOutput] = process.argv.slice(2);
const discovery = JSON.parse(await fs.readFile(input,'utf8'));
const results = []; const privateItems = []; const cache = new Map();
let next = 0;
function isPrivate(ip) {
  if (ip.includes(':')) return /^(::|fc|fd|fe[89ab])/i.test(ip);
  const [a,b]=ip.split('.').map(Number);
  return a===0||a===10||a===127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a>=224;
}
async function bytes(value,cap=2*1024*1024,range=false,redirects=0) {
  const url=new URL(value); if(!['https:','http:'].includes(url.protocol)||url.username||url.password||redirects>4)throw Error('unsafe-url');
  const host=url.hostname.replace(/^\[|\]$/g,'');
  let addresses=cache.get(host);if(!addresses){addresses=isIP(host)?[{address:host}]:await dns.lookup(host,{all:true});cache.set(host,addresses);}
  if(!addresses.length||addresses.some(x=>isPrivate(x.address)))throw Error('unsafe-address');
  const res=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(8000),headers:{'User-Agent':'Mozilla/5.0 LibreTV-4KAudit/1.0',...(range?{Range:`bytes=0-${cap-1}`}:{})}});
  if(res.status>=300&&res.status<400&&res.headers.get('location')){await res.body?.cancel();return bytes(new URL(res.headers.get('location'),url),cap,range,redirects+1);}
  if(!res.ok){await res.body?.cancel();throw Error(`http-${res.status}`);}
  const chunks=[];let size=0;const reader=res.body.getReader();
  try{while(size<cap){const {value:part,done}=await reader.read();if(done)break;const kept=part.subarray(0,cap-size);chunks.push(kept);size+=kept.length;}}finally{await reader.cancel();}
  const total=Number(/\/(\d+)$/.exec(res.headers.get('content-range')||'')?.[1]||res.headers.get('content-length'))||undefined;
  return {body:Buffer.concat(chunks),url:String(url),total};
}
function attrs(line){return Object.fromEntries([...line.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)].map(m=>[m[1],m[2].replace(/^"|"$/g,'')]));}
function ivFor(value){return Buffer.from(BigInt(value).toString(16).padStart(32,'0'),'hex');}
async function probeMedia(url,declared={},depth=0){
  if(depth>3)throw Error('playlist-depth');
  const res=await bytes(url);const text=res.body.toString('utf8');
  if(!text.startsWith('#EXTM3U'))throw Error('not-hls');
  const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const variants=[];
  for(let i=0;i<lines.length-1;i++)if(lines[i].startsWith('#EXT-X-STREAM-INF:')){
    const a=attrs(lines[i]);const [width,height]=(a.RESOLUTION||'').split('x').map(Number);
    variants.push({url:new URL(lines[i+1],res.url),width,height,codec:a.CODECS,bandwidth:Number(a.BANDWIDTH)||undefined});
  }
  if(variants.length){variants.sort((a,b)=>(b.height||0)-(a.height||0)||(b.bandwidth||0)-(a.bandwidth||0));const best=variants[0];return probeMedia(best.url,best,depth+1);}
  let sequence=Number((lines.find(x=>x.startsWith('#EXT-X-MEDIA-SEQUENCE:'))||'').split(':')[1])||0;
  let duration,key,map;const segments=[];
  for(const line of lines){
    if(line.startsWith('#EXT-X-KEY:'))key=attrs(line);
    else if(line.startsWith('#EXT-X-MAP:'))map=attrs(line).URI;
    else if(line.startsWith('#EXTINF:'))duration=Number(line.slice(8).split(',')[0]);
    else if(!line.startsWith('#'))segments.push({url:new URL(line,res.url),duration,key,sequence:sequence++});
  }
  if(!segments.length)throw Error('empty-playlist');
  const segment=segments[Math.floor(segments.length/2)];const sample=await bytes(segment.url,1024*1024,true);
  if(sample.body.length<1024)throw Error('short-segment');
  let payload=sample.body;
  if(segment.key?.METHOD&&segment.key.METHOD!=='NONE'){
    if(segment.key.METHOD!=='AES-128'||!segment.key.URI)throw Error('unsupported-encryption');
    const keyData=await bytes(new URL(segment.key.URI,res.url),64);
    const iv=segment.key.IV?Buffer.from(segment.key.IV.replace(/^0x/,''),'hex'):ivFor(segment.sequence);
    payload=Buffer.from(codec.decryptAes128CbcPrefix(payload,keyData.body,iv));
  }
  const tsResolution=codec.parseTsVideoResolution(payload);
  let decoded=tsResolution||codec.parseMp4VideoResolution(payload);
  if(!decoded&&map){const init=await bytes(new URL(map,res.url),1024*1024,true);decoded=codec.parseMp4VideoResolution(init.body);}
  let codecName=tsResolution?'h264':decoded?'mp4-visual-sample-entry':declared.codec;
  if(process.env.PROBE_FFPROBE){
    const ff=spawnSync(process.env.PROBE_FFPROBE,['-v','error','-probesize','1048576','-analyzeduration','2000000','-show_entries','stream=codec_name,codec_type,width,height,bit_rate','-of','json','-i','pipe:0'],{input:payload,timeout:8000,maxBuffer:2*1024*1024});
    try{const video=JSON.parse(String(ff.stdout)).streams?.find(x=>x.codec_type==='video'&&x.width&&x.height);if(video){decoded={width:video.width,height:video.height};codecName=video.codec_name;}}catch{}
  }
  const width=decoded?.width||declared.width;const height=decoded?.height||declared.height;
  return {width,height,codec:codecName,method:decoded?'media-header':'master-manifest',declaredBandwidth:declared.bandwidth,estimatedSegmentBitrate:sample.total&&segment.duration?Math.round(sample.total*8/segment.duration):undefined,sampleBytes:sample.body.length,segmentCount:segments.length,verified2160:!!(width>=3840&&height>=2160),verified4k:!!(width>=3840&&height>=1600),croppedUhd:!!(width>=3840&&height>=1600&&height<2160),stages:['manifest','segment']};
}
async function detail(source,id){const url=new URL(source);url.searchParams.set('ac','videolist');url.searchParams.set('ids',String(id));const res=await bytes(url);return JSON.parse(res.body.toString('utf8')).list?.[0];}
if(Array.isArray(discovery.items)){
 const checkedAt=new Date().toISOString();
 const liveResults=await Promise.all(discovery.items.map(async item=>{
  try{const proof=await probeMedia(item.url);console.log(`${item.id}: ${proof.width||'?'}x${proof.height||'?'} ${proof.codec||'?'} 2160=${proof.verified2160}`);return {...item,...proof,verifiedAt:checkedAt};}
  catch(err){console.log(`${item.id}: failed ${err.name}`);return {...item,error:/^[a-z0-9-]+$/.test(err.message)?err.message:err.name};}
 }));
 await fs.writeFile(output,JSON.stringify({checkedAt,vantage:process.env.PROBE_VANTAGE||'local',results:liveResults},null,2)+'\n');
 const items=liveResults.filter(x=>x.verified4k).map(({id,title,url,kind,width,height,codec,verifiedAt,provider})=>({id,title,url,kind,width,height,codec,verifiedAt,provider}));
 await fs.writeFile(privateOutput,JSON.stringify({updatedAt:checkedAt,items},null,2)+'\n');
 process.exit(0);
}
await Promise.all(Array.from({length:Math.min(Number(process.env.PROBE_CONCURRENCY||2),discovery.results.length)},async()=>{
 while(next<discovery.results.length){
  const source=discovery.results[next++];const out={name:source.name,url:source.url,searches:source.searches,categories:source.categories,samples:[]};
  for(const title of source.titles.slice(0,Number(process.env.PROBE_MAX_TITLES||4))){
   const sample={id:title.id,title:title.title,category:title.category,remarks:title.remarks};
   try{
    const d=await detail(source.url,title.id);if(!d)throw Error('empty-detail');
    const groups=String(d.vod_play_url||'').split('$$$').map((value,i)=>({value,label:String(d.vod_play_from||'').split('$$$')[i]||''}));
    groups.sort((a,b)=>Number(/4k|2160|蓝光|uhd/i.test(b.label))-Number(/4k|2160|蓝光|uhd/i.test(a.label)));
    const urls=groups.map(x=>x.value.split('#').map(v=>v.slice(v.indexOf('$')+1)).find(v=>/^https?:\/\//.test(v)&&/\.m3u8(?:[?#]|$)/i.test(v))).filter(Boolean);
    if(!urls.length)throw Error('no-direct-hls');
    let last;
    for(const mediaUrl of urls.slice(0,2))try{const proof=await probeMedia(mediaUrl);if(!sample.stages||(proof.width||0)*(proof.height||0)>(sample.width||0)*(sample.height||0))Object.assign(sample,proof);privateItems.push({source:source.name,sourceUrl:source.url,id:title.id,title:title.title,url:mediaUrl});if(sample.verified2160)break;}catch(err){last=err;}
    if(!sample.stages)throw last||Error('media-unverified');
   }catch(err){sample.error=/^[a-z0-9-]+$/.test(err.message)?err.message:err.name;}
   out.samples.push(sample);
  }
  results.push(out);console.log(`${source.name}: sampled=${out.samples.length},2160=${out.samples.filter(x=>x.verified2160).length},sizes=${out.samples.map(x=>`${x.width||'?'}x${x.height||'?'}`).join(',')}`);
 }
}));
await fs.writeFile(output,JSON.stringify({checkedAt:new Date().toISOString(),vantage:process.env.PROBE_VANTAGE||'local',note:'4K titles are discovery only. verified2160 requires at least 3840x2160 from media headers or a master manifest plus a reachable segment.',results},null,2)+'\n');
await fs.writeFile(privateOutput,JSON.stringify(privateItems,null,2)+'\n',{mode:0o600});
