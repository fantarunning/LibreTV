#!/usr/bin/env bash
# Write native UTF-8 JSON: systemd EnvironmentFile must not consume \u escapes.
set -euo pipefail
curated=${1:?Usage: curated-sources.sh /home/libretv/source-audit/curated-tokyo.json}
[[ "$curated" == /home/libretv/* && -f "$curated" ]] || exit 1
python - "$curated" <<'PY'
import json,sys
env_path='/etc/libretv/prod.env.next'
sources=json.load(open(sys.argv[1]))['sources']
value=json.dumps(sources,ensure_ascii=False,separators=(',',':')).encode('utf-8')
if b"'" in value: raise SystemExit('Source fields must not contain a single quote')
current=open(env_path,'rb').read()
kept=b'\n'.join(line for line in current.splitlines() if not line.startswith(b'DEFAULT_SOURCES='))
with open(env_path,'wb') as env_file:
    env_file.write(kept+b"\nDEFAULT_SOURCES='"+value+b"'\n")
print('Prepared UTF-8 source count: '+str(len(sources)))
PY
chmod 600 /etc/libretv/prod.env.next
