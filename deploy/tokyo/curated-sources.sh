#!/usr/bin/env bash
# Write native UTF-8 JSON: systemd EnvironmentFile must not consume \u escapes.
set -euo pipefail
curated=${1:?Usage: curated-sources.sh /home/libretv/source-audit/curated-tokyo.json}
[[ "$curated" == /home/libretv/* && -f "$curated" ]] || exit 1
python3 - "$curated" <<'PY'
import json,sys
env_path='/etc/libretv/prod.env.next'
catalogue=json.load(open(sys.argv[1],encoding='utf-8'))
updates={}
for field,variable in [('sources','DEFAULT_SOURCES'),('liveSources','DEFAULT_LIVE_SOURCES')]:
    if field not in catalogue: continue
    sources=catalogue[field]
    if not isinstance(sources,list): raise SystemExit('Source field must be an array: '+field)
    for source in sources:
        if not isinstance(source,dict) or not isinstance(source.get('name'),str) or not source['name'].strip():
            raise SystemExit('Source name is required: '+field)
        if not isinstance(source.get('url'),str) or not source['url'].startswith(('http://','https://')):
            raise SystemExit('HTTP(S) source URL is required: '+field)
    value=json.dumps(sources,ensure_ascii=False,separators=(',',':')).encode('utf-8')
    if b"'" in value: raise SystemExit('Source fields must not contain a single quote')
    updates[variable.encode('ascii')]=value
if b'DEFAULT_SOURCES' not in updates: raise SystemExit('Missing sources')
current=open(env_path,'rb').read()
kept=b'\n'.join(line for line in current.splitlines() if line.split(b'=',1)[0] not in updates)
with open(env_path,'wb') as env_file:
    env_file.write(kept+b'\n')
    for variable,value in updates.items(): env_file.write(variable+b"='"+value+b"'\n")
for field in ('sources','liveSources'):
    if field in catalogue: print('Prepared '+field+' count: '+str(len(catalogue[field])))
PY
chmod 600 /etc/libretv/prod.env.next
