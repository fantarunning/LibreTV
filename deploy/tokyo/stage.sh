#!/usr/bin/env bash
set -euo pipefail
archive=${1:?Usage: stage.sh /home/libretv/staging/release.tar.gz sha256 release-id}
checksum=${2:?SHA256 required}
release_id=${3:?Release ID required}
[[ "$archive" == /home/libretv/staging/*.tar.gz && "$checksum" =~ ^[a-f0-9]{64}$ && "$release_id" =~ ^libretv-[a-zA-Z0-9_.-]+$ ]] || exit 1
release="/home/libretv/releases/$release_id"
[[ ! -e "$release" ]] || { echo 'Release already exists; choose a new ID' >&2; exit 1; }
printf '%s  %s\n' "$checksum" "$archive" | sha256sum -c -
if tar -tzf "$archive" | grep -E '(^/|(^|/)\.\.(/|$))'; then echo 'Unsafe archive path' >&2; exit 1; fi
install -d -m 755 -o libretv -g libretv "$release"
tar -xzf "$archive" -C "$release" --no-same-owner
chown -R libretv:libretv "$release"
test -f "$release/server.js"
printf 'Staged release: %s\nRun isolated Next.js smoke checks before activate.sh.\n' "$release"
