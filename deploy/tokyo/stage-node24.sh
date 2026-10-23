#!/usr/bin/env bash
# Download and verify on the workstation first; extraction here performs no build.
set -euo pipefail
archive=${1:?Usage: stage-node24.sh /home/libretv/staging/node-v24.x-linux-x64.tar.xz sha256}
checksum=${2:?SHA256 required}
[[ "$archive" =~ ^/home/libretv/staging/(node-v24\.[0-9]+\.[0-9]+-linux-x64)\.tar\.xz$ ]] || exit 1
name=${BASH_REMATCH[1]}
[[ "$checksum" =~ ^[a-f0-9]{64}$ ]] || exit 1
printf '%s  %s\n' "$checksum" "$archive" | sha256sum -c -
install -d -m 755 -o libretv -g libretv /home/libretv/runtime
[[ ! -e "/home/libretv/runtime/$name" ]] && tar -xJf "$archive" -C /home/libretv/runtime --no-same-owner
chown -R libretv:libretv "/home/libretv/runtime/$name"
mysql_pid=$(systemctl show tripick-mysql -p MainPID | cut -d= -f2)
loader=$(readlink "/proc/$mysql_pid/exe")
libpath=$(tr '\0' '\n' < "/proc/$mysql_pid/cmdline" | awk '$0=="--library-path" {getline; print; exit}')
# Patch only the staged binary's ELF interpreter. Directly invoking ld.so makes
# process.execPath point at ld.so and breaks child_process.fork. The shorter
# alias fits in the existing PT_INTERP slot; the original archive is preserved.
ln -sfn "$loader" /opt/glibc235/ld.so
python - "/home/libretv/runtime/$name/bin/node" <<'PY'
import struct,sys
with open(sys.argv[1],'r+b') as binary:
    header=binary.read(64)
    if header[:6] != b'\x7fELF\x02\x01': raise SystemExit('Expected little-endian ELF64')
    offset=struct.unpack_from('<Q',header,32)[0]
    size,count=struct.unpack_from('<HH',header,54)
    for i in range(count):
        binary.seek(offset+i*size)
        segment=binary.read(size)
        if struct.unpack_from('<I',segment,0)[0] == 3:
            start=struct.unpack_from('<Q',segment,8)[0]
            length=struct.unpack_from('<Q',segment,32)[0]
            interpreter=b'/opt/glibc235/ld.so\0'
            if len(interpreter)>length: raise SystemExit('Interpreter slot too small')
            binary.seek(start)
            binary.write(interpreter+b'\0'*(length-len(interpreter)))
            break
    else: raise SystemExit('Missing PT_INTERP')
PY
printf '#!/usr/bin/env bash\nexport LD_LIBRARY_PATH=%q\nexec %q "$@"\n' "$libpath" "/home/libretv/runtime/$name/bin/node" > /home/libretv/runtime/node24
chmod 755 /home/libretv/runtime/node24
runuser -u libretv -- /home/libretv/runtime/node24 --version
runuser -u libretv -- /home/libretv/runtime/node24 -e "require('node:crypto').randomBytes(16); require('node:fs').statSync('/home/libretv/current/server.js'); const r=require('node:child_process').spawnSync(process.execPath,['--version']); if(r.status!==0 || String(r.stdout).trim()!==process.version) throw Error('Child Node runtime failed'); console.log('crypto/fs/child runtime smoke passed')"
# Preserve all original service restrictions; only replace the runtime binary.
sed 's|^ExecStart=/usr/local/lib/nodejs/bin/node |ExecStart=/home/libretv/runtime/node24 |' /etc/systemd/system/libretv.service > /etc/libretv/libretv.service.next
chmod 600 /etc/libretv/libretv.service.next
echo 'Node24 staged; live service not switched.'
