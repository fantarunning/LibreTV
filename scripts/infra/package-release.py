"""Package a Next.js standalone build and static assets, excluding local env files."""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import tarfile

parser = argparse.ArgumentParser()
parser.add_argument("release_id")
args = parser.parse_args()
if not re.fullmatch(r"libretv-[a-zA-Z0-9_.-]+", args.release_id):
    raise SystemExit("Invalid release ID")
root = pathlib.Path(__file__).resolve().parents[2]
standalone = root / ".next/standalone"
if not (standalone / "server.js").is_file():
    raise SystemExit("Build with DOCKER_BUILD=1 before packaging")
output = root / "deploy/.artifacts"
output.mkdir(exist_ok=True, parents=True)
archive = output / (args.release_id + ".tar.gz")

def exclude_secrets(info):
    if any(part.startswith(".env") for part in pathlib.PurePosixPath(info.name).parts):
        return None
    if info.issym() or info.islnk():
        raise ValueError("Standalone archive must contain files, not external links")
    return info

with tarfile.open(archive, "w:gz") as tar:
    tar.add(standalone, arcname=".", filter=exclude_secrets)
    tar.add(root / ".next/static", arcname=".next/static", filter=exclude_secrets)
    tar.add(root / "public", arcname="public", filter=exclude_secrets)
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(output / (archive.name + ".sha256")).write_text(digest + "  " + archive.name + "\n")
print(json.dumps({"archive": str(archive), "sha256": digest, "bytes": archive.stat().st_size}))
