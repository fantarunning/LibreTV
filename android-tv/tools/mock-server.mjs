// Deterministic Android emulator protocol fixture; never a production data source.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const port=19888;
const media=path.join(import.meta.dirname,'fixtures','sample.mp4');
const icon=path.resolve(import.meta.dirname,'../../public/icons/icon-512.png');
const source={key:'fixture',name:'模拟器验证源',url:'http://example.com/api.php/provide/vod'};
let version=0;
const records=new Map();
const requests=[];
let pairPolls=0;
let commands=[];
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,`http://localhost:${port}`);
 const raw=await new Promise(resolve=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>resolve(b));});
 const body=raw?JSON.parse(raw):{};
 requests.push({path:url.pathname,query:Object.fromEntries(url.searchParams),at:Date.now(),method:req.method,account:req.headers['x-libretv-account'],body:url.pathname==='/api/sync'?body:undefined});
 const json=(j,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(j));};
 const card=i=>({id:`film-${i}`,title:`演示影片 ${String(i+1).padStart(2,'0')}`,cover:`http://10.0.2.2:${port}/poster.png`,rating:'8.6'});
 if(url.pathname==='/api/tv/pair')return json(req.method==='POST'?{deviceCode:'fixture-device',userCode:'12345678',expiresAt:Date.now()+600000,verificationUrl:`http://localhost:${port}/account/tv?code=12345678`}:{status:++pairPolls>1?'authorized':'pending',token:pairPolls>1?'emulator-fixture-token':undefined});
 if(url.pathname==='/api/account/me')return json({user:{id:'fixture-user',name:'模拟验证账号'},device:{id:'fixture-tv',name:'TV emulator',type:'tv',expiresAt:Date.now()+365*86400000},syncEnabled:true});
 if(url.pathname==='/api/status')return json({defaultSources:[source]});
 if(url.pathname==='/sources/4k.json'){
  const catalogue=path.resolve(import.meta.dirname,'../../public/sources/4k.json');
  return fs.existsSync(catalogue)?json(JSON.parse(fs.readFileSync(catalogue,'utf8'))):json({items:[]});
 }
 if(url.pathname==='/api/tv/commands')return json({commands:commands.filter(c=>c.id>Number(url.searchParams.get('after')||0)),cursor:commands.at(-1)?.id||0});
 if(url.pathname==='/fixture/command'){commands.push({id:commands.length+1,...body});return json({ok:true});}
 if(url.pathname==='/api/sync'){
  if(req.headers['x-libretv-account']!=='fixture-user')return json({error:'account mismatch'},403);
  if(req.method==='POST'){
   const accepted=[];for(const m of body.mutations||[]){const r={kind:m.kind,key:m.key,value:m.value,version:++version,updatedAt:Date.now()};records.set(`${r.kind}\n${r.key}`,r);accepted.push(m.eventId);}
   return json({accepted,records:[...records.values()],conflicts:[]});
  }
  return json({records:[...records.values()].filter(r=>r.version>Number(url.searchParams.get('cursor')||0)),cursor:version,hasMore:false});
 }
 if(url.pathname==='/api/douban'){const start=Number(url.searchParams.get('pageStart')||0),size=Number(url.searchParams.get('pageSize')||20);return json({items:Array.from({length:Math.max(0,Math.min(size,60-start))},(_,i)=>card(start+i))});}
 if(url.pathname==='/api/search')return json({list:[{...card(0),vodId:'film-0',name:body.wd,sourceKey:'fixture',sourceName:source.name,sourceUrl:source.url}],failures:[]});
 if(url.pathname==='/api/detail')return json({episodes:[0,1,2].map(()=>`http://10.0.2.2:${port}/media.mp4`),videoInfo:{title:'演示影片 01',desc:'用于验证配对、D-pad、真实解码与跨设备同步的模拟数据。'}});
 if(url.pathname==='/fixture/state')return json({requests,records:[...records.values()],commands});
 if(url.pathname==='/api/proxy'||url.pathname==='/poster.png'){res.writeHead(200,{'content-type':'image/png'});return fs.createReadStream(icon).pipe(res);}
 if(url.pathname==='/media.mp4'&&fs.existsSync(media)){
  const total=fs.statSync(media).size;const match=req.headers.range?.match(/bytes=(\d+)-(\d*)/);const start=match?Number(match[1]):0,end=match?.[2]?Number(match[2]):total-1;
  res.writeHead(match?206:200,{'content-type':'video/mp4','accept-ranges':'bytes','content-length':end-start+1,...(match?{'content-range':`bytes ${start}-${end}/${total}`}:{})});
  return fs.createReadStream(media,{start,end}).pipe(res);
 }
 return json({error:'fixture route not found'},404);
});
server.listen(port,'0.0.0.0',()=>console.log(`Emulator-only fixture listening on ${port}`));
