#!/usr/bin/env bash
# Revert code and settings only. Additive tables are preserved; never drop user data.
set -euo pipefail
backup=${1:?Usage: rollback.sh /home/libretv/backups/backup-id}
[[ "$backup" == /home/libretv/backups/* && -f "$backup/libretv.service" && -f "$backup/prod.env" ]] || exit 1
cp -p "$backup/prod.env" /etc/libretv/prod.env
cp -p "$backup/libretv.service" /etc/systemd/system/libretv.service
ln -sfn "$(cat "$backup/previous-release.txt")" /home/libretv/current
systemctl daemon-reload
systemctl restart libretv
curl --silent --fail --max-time 5 http://127.0.0.1:18081/api/status > /dev/null
echo 'Previous code and settings restored; database preserved.'
