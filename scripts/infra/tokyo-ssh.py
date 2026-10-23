"""Send a UTF-8/LF script through existing OpenSSH without PowerShell quoting.

Usage: python scripts/infra/tokyo-ssh.py deploy/tokyo/prepare.sh --target user@host --arg value
The remote script may handle credentials; this wrapper never reads or prints them.
"""
import argparse
import pathlib
import shlex
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("script", type=pathlib.Path)
parser.add_argument("--target", required=True)
parser.add_argument("--arg", action="append", default=[])
args = parser.parse_args()
script = args.script.read_text(encoding="utf-8-sig").replace("\r\n", "\n")
command = "bash -s -- " + " ".join(shlex.quote(arg) for arg in args.arg)
raise SystemExit(subprocess.run([
    "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5",
    "-o", "StrictHostKeyChecking=yes", args.target, command,
], input=(script + "\n").encode("utf-8")).returncode)
