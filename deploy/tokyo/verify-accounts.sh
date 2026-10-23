#!/usr/bin/env bash
set -euo pipefail
# Credentials stay inside the host and are never echoed or passed in command arguments.
python3 - "${1:-/etc/libretv/staging.env}" "${2:-http://127.0.0.1:18082}" <<'PY'
import os
import pathlib
import sys
from urllib.parse import urlparse

env = dict(os.environ)
if sys.argv[1] not in ('/etc/libretv/staging.env', '/etc/libretv/prod.env'):
    raise SystemExit('Invalid environment path')
base = urlparse(sys.argv[2])
if base.scheme not in ('http', 'https') or not base.hostname or base.username or base.password:
    raise SystemExit('Invalid acceptance URL')
for line in pathlib.Path(sys.argv[1]).read_text(encoding='utf-8').splitlines():
    if not line or line.lstrip().startswith('#') or '=' not in line:
        continue
    key, value = line.split('=', 1)
    if key in ('PASSWORD', 'APP_ORIGIN'):
        env[key] = value.strip().strip('"').strip("'")
env['CHECK_BASE_URL'] = sys.argv[2].rstrip('/')
os.execve('/home/libretv/runtime/node24', [
    '/home/libretv/runtime/node24', '/home/libretv/staging/verify-account-flow.mjs'
], env)
PY
