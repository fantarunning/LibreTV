// Discover titles/categories only. A 4K name is not resolution verification.
import fs from 'node:fs/promises';
const [input, output] = process.argv.slice(2);
const sources = JSON.parse(await fs.readFile(input, 'utf8')).sources;
const queries = ['4K', '2160', '杜比'];
const results = new Array(sources.length); let next = 0;
async function json(base, params) {
  const url = new URL(base); for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: {'User-Agent':'Mozilla/5.0 LibreTV-4KAudit/1.0'} });
  if (!res.ok) throw Error(`http-${res.status}`);
  const text = await res.text(); if (text.length > 3*1024*1024) throw Error('oversize');
  return JSON.parse(text.replace(/^\uFEFF/, ''));
}
await Promise.all(Array.from({length:4}, async () => {
  while (next < sources.length) {
    const index = next++; const source = sources[index];
    const result = {name:source.name, url:source.url, categories:[], searches:[], titles:[]};
    try {
      const listed = await json(source.url, {ac:'list'});
      result.categories = (listed.class || []).filter(x => /4k|2160|杜比|超清|蓝光/i.test(x.type_name));
      const seen = new Set();
      const requests = result.categories.slice(0,2).flatMap(x => Array.from({length:Number(process.env.PROBE_CATEGORY_PAGES||1)},(_,i)=>({ac:'videolist',t:String(x.type_id),pg:String(i+1)}))).concat(queries.map(wd => ({ac:'videolist',wd})));
      for (const params of requests) {
        try {
          const data = await json(source.url, params);
          result.searches.push({query:params.wd || `category:${params.t}`,total:data.total,returned:data.list?.length || 0});
          for (const item of (data.list || []).slice(0,Number(process.env.PROBE_TITLE_LIMIT||3))) {
            if (seen.has(item.vod_id)) continue; seen.add(item.vod_id);
            result.titles.push({id:item.vod_id,title:item.vod_name,remarks:item.vod_remarks,category:item.type_name});
          }
        } catch(err) { result.searches.push({query:params.wd || `category:${params.t}`,error:err.message}); }
      }
    } catch(err) { result.error = /^[a-z0-9-]+$/.test(err.message) ? err.message : err.name; }
    results[index]=result; console.log(`${index+1}/${sources.length} ${source.name}: candidates=${result.titles.length} ${result.error || ''}`);
  }
}));
await fs.writeFile(output,JSON.stringify({checkedAt:new Date().toISOString(),vantage:process.env.PROBE_VANTAGE || 'local',note:'Discovery only; no resolution claims.',results},null,2)+'\n');
