#!/usr/bin/env bash
# SQL is uploaded separately; administrator credentials stay on the host.
set -euo pipefail
sql=${1:?Usage: migrate.sh /absolute/path/001-accounts-sync.sql}
[[ "$sql" == /home/libretv/* && -f "$sql" ]] || { echo 'Migration must be staged under /home/libretv' >&2; exit 1; }
mysql_pid=$(systemctl show tripick-mysql -p MainPID | cut -d= -f2)
loader=$(readlink "/proc/$mysql_pid/exe")
libpath=$(tr '\0' '\n' < "/proc/$mysql_pid/cmdline" | awk '$0=="--library-path" {getline; print; exit}')
"$loader" --library-path "$libpath" /opt/tripick/runtime/mysql/bin/mysql --defaults-extra-file=/etc/tripick/mysql-root.cnf libretv < "$sql"
if [[ -f /etc/libretv/prepared-backup ]]; then
  backup=$(cat /etc/libretv/prepared-backup)
  [[ "$backup" == /home/libretv/backups/* && -d "$backup" ]] || exit 1
  umask 077
  "$loader" --library-path "$libpath" /opt/tripick/runtime/mysql/bin/mysqldump --defaults-extra-file=/etc/tripick/mysql-root.cnf --single-transaction --routines --events --triggers libretv > "$backup/libretv-preactivate.sql"
fi
"$loader" --library-path "$libpath" /opt/tripick/runtime/mysql/bin/mysql --defaults-extra-file=/etc/tripick/mysql-root.cnf -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='libretv' AND table_name LIKE 'ltv_%'; SHOW GRANTS FOR 'libretv_app'@'localhost';"
