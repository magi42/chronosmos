"""Install an API key from ignored .env configuration or a hidden prompt over SSH stdin."""
import argparse
import getpass
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=ROOT / 'chronosmos.local.json')
    parser.add_argument('--env-file', type=Path, default=ROOT / '.env')
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    host = config.get('ssh_host', '')
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.@-]*', host):
        parser.error('Set ssh_host in ignored local configuration.')
    key = ''
    if args.env_file.exists():
        args.env_file.chmod(0o600)
        for line in args.env_file.read_text().splitlines():
            if line.startswith('OPENAI_API_KEY='):
                key = line.split('=', 1)[1].strip().strip('\"\'')
    if not key:
        key = getpass.getpass('OpenAI API key (hidden): ').strip()
    if not re.fullmatch(r'[A-Za-z0-9_.-]+', key):
        parser.error('Use an API key containing only letters, digits, underscores, dots or hyphens.')
    # Code contains no key. Only stdin carries the secret, inside the SSH transport.
    code = """import os, pathlib, re, sys, tempfile
p=pathlib.Path('/etc/chronosmos/chronosmos.env')
key=sys.stdin.read().strip()
if not re.fullmatch(r'[A-Za-z0-9_.-]+',key): raise SystemExit('Invalid key')
s=p.stat()
lines=[v for v in p.read_text().splitlines() if not v.startswith('OPENAI_API_KEY=')]
fd,name=tempfile.mkstemp(dir=p.parent,prefix='.openai-')
try:
 os.fchmod(fd,0o640); os.fchown(fd,s.st_uid,s.st_gid)
 with os.fdopen(fd,'w') as f: f.write('\\n'.join(lines)+'\\nOPENAI_API_KEY='+key+'\\n')
 os.replace(name,p)
finally:
 if os.path.exists(name): os.unlink(name)
"""
    import shlex
    command = 'sudo python3 -c ' + shlex.quote(code)
    subprocess.run(['ssh', host, command], input=key, text=True, check=True, capture_output=True)
    subprocess.run(['ssh', host, 'sudo systemctl restart chronosmos && sudo systemctl is-active chronosmos'], check=True)
    print('OpenAI API key installed in the private server environment; service restarted.')


if __name__ == '__main__':
    main()
