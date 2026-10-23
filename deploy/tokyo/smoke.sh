#!/usr/bin/env bash
# Start an isolated loopback instance with the staged env and a 256 MiB cap.
set -euo pipefail
release=${1:?Usage: smoke.sh /home/libretv/releases/release-id}
[[ "$release" == /home/libretv/releases/* && -f "$release/server.js" ]] || exit 1
umask 077
grep -Ev '^(PORT|HOSTNAME)=' /etc/libretv/prod.env.next > /etc/libretv/staging.env
printf 'PORT=18082\nHOSTNAME=127.0.0.1\n' >> /etc/libretv/staging.env
unit=libretv-staging
systemctl stop "$unit" 2>/dev/null || true
systemctl reset-failed "$unit" 2>/dev/null || true
cat > "/etc/systemd/system/$unit.service" <<UNIT
[Unit]
Description=Isolated LibreTV release smoke test
After=network.target tripick-mysql.service
[Service]
Type=simple
User=libretv
Group=libretv
WorkingDirectory=$release
EnvironmentFile=/etc/libretv/staging.env
ExecStart=/home/libretv/runtime/node24 --max-old-space-size=128 $release/server.js
MemoryLimit=268435456
Restart=no
UNIT
systemctl daemon-reload
systemctl start "$unit"
for attempt in $(seq 1 30); do
  if curl --silent --fail --max-time 2 http://127.0.0.1:18082/api/status > /dev/null; then
    systemctl show "$unit" -p MainPID -p MemoryCurrent -p MemoryLimit
    echo 'Staging ready on 127.0.0.1:18082; stop libretv-staging after end-to-end checks.'
    exit 0
  fi
  sleep 1
done
systemctl stop "$unit"
echo 'Staging failed; live instance was not changed.' >&2
exit 1
