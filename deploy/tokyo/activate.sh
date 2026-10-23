#!/usr/bin/env bash
# Run only after the staged release passes its local and remote smoke checks.
set -euo pipefail
release=${1:?Usage: activate.sh /home/libretv/releases/release-id}
[[ "$release" == /home/libretv/releases/* && -f "$release/server.js" ]] || { echo 'Invalid standalone release' >&2; exit 1; }
[[ -f /etc/libretv/prod.env.next && -f /etc/libretv/prepared-backup ]] || { echo 'Run prepare.sh first' >&2; exit 1; }
backup=$(cat /etc/libretv/prepared-backup)
[[ "$backup" == /home/libretv/backups/* && -f "$backup/libretv.service" ]] || exit 1
rollback() {
  cp -p "$backup/prod.env" /etc/libretv/prod.env
  cp -p "$backup/libretv.service" /etc/systemd/system/libretv.service
  ln -sfn "$(cat "$backup/previous-release.txt")" /home/libretv/current
  systemctl daemon-reload
  systemctl restart libretv
}
trap 'rollback' ERR
cp -p /etc/libretv/prod.env.next /etc/libretv/prod.env
ln -sfn "$release" /home/libretv/current
# A reviewed staged unit is optional; the current unit remains the default.
if [[ -f /etc/libretv/libretv.service.next ]]; then
  cp -p /etc/libretv/libretv.service.next /etc/systemd/system/libretv.service
fi
systemctl daemon-reload
systemctl restart libretv
for attempt in $(seq 1 30); do
  if curl --silent --fail --max-time 2 http://127.0.0.1:18081/api/status > /dev/null; then
    trap - ERR
    printf 'Activated: %s\nRollback backup: %s\n' "$release" "$backup"
    exit 0
  fi
  sleep 1
done
echo 'Health check failed; restoring previous service' >&2
false
