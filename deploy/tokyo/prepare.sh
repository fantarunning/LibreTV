#!/usr/bin/env bash
# Prepare only: preserve the live env, service, release and running process.
set -euo pipefail
umask 077
origin=${1:?Usage: prepare.sh https://site.example}
[[ "$origin" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || { echo 'HTTPS origin required' >&2; exit 1; }
backup="/home/libretv/backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup" /etc/libretv
chmod 700 "$backup"
cp -p /etc/libretv/prod.env "$backup/prod.env"
cp -p /etc/systemd/system/libretv.service "$backup/libretv.service"
readlink -f /home/libretv/current > "$backup/previous-release.txt"
mysql_pid=$(systemctl show tripick-mysql -p MainPID | cut -d= -f2)
loader=$(readlink "/proc/$mysql_pid/exe")
libpath=$(tr '\0' '\n' < "/proc/$mysql_pid/cmdline" | awk '$0=="--library-path" {getline; print; exit}')
mysql_admin() { "$loader" --library-path "$libpath" /opt/tripick/runtime/mysql/bin/mysql --defaults-extra-file=/etc/tripick/mysql-root.cnf "$@"; }
if mysql_admin -N -e "SHOW DATABASES LIKE 'libretv'" | grep -qx libretv; then
  "$loader" --library-path "$libpath" /opt/tripick/runtime/mysql/bin/mysqldump --defaults-extra-file=/etc/tripick/mysql-root.cnf --single-transaction --routines --events --triggers libretv > "$backup/libretv.sql"
else
  touch "$backup/DATABASE_WAS_ABSENT"
fi
# A separate generated credential file lets repeat preparations reuse the same account.
if [[ ! -f /etc/libretv/mysql.env ]]; then
  password=$(openssl rand -hex 32)
  mysql_admin <<SQL
CREATE DATABASE IF NOT EXISTS libretv CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
CREATE USER IF NOT EXISTS 'libretv_app'@'127.0.0.1' IDENTIFIED BY '$password';
CREATE USER IF NOT EXISTS 'libretv_app'@'localhost' IDENTIFIED BY '$password';
GRANT SELECT, INSERT, UPDATE, DELETE ON libretv.* TO 'libretv_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON libretv.* TO 'libretv_app'@'localhost';
SQL
  printf 'MYSQL_HOST=127.0.0.1\nMYSQL_PORT=3307\nMYSQL_DATABASE=libretv\nMYSQL_USER=libretv_app\nMYSQL_PASSWORD=%s\nMYSQL_CONNECTION_LIMIT=2\n' "$password" > /etc/libretv/mysql.env
fi
# The existing prod.env is left intact until activate.sh is explicitly invoked.
grep -Ev '^(MYSQL_|DATABASE_URL=|APP_ORIGIN=|COOKIE_SECURE=)' /etc/libretv/prod.env > /etc/libretv/prod.env.next
cat /etc/libretv/mysql.env >> /etc/libretv/prod.env.next
printf 'APP_ORIGIN=%s\nCOOKIE_SECURE=true\n' "$origin" >> /etc/libretv/prod.env.next
chmod 600 /etc/libretv/mysql.env /etc/libretv/prod.env.next
printf '%s\n' "$backup" > /etc/libretv/prepared-backup
printf 'Prepared backup: %s\nLive service unchanged.\n' "$backup"
