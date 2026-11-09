"""Test and deploy a committed release using ignored workstation configuration."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shlex
import subprocess
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OPS_FILES = (
    'deploy.sh', 'backup.sh', 'verify-restore.sh', 'import-initial-data.py',
    'chronosmos.env.example', 'chronosmos.service', 'chronosmos-backup.service',
    'chronosmos-backup.timer', 'apache.conf', 'apache-acme.conf', 'README.md',
)


def run(args, **kwargs):
    return subprocess.run(args, cwd=ROOT, check=True, **kwargs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=ROOT / 'chronosmos.local.json')
    parser.add_argument('--skip-checks', action='store_true', help='Use only when checks already passed for unchanged inputs')
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    host = config.get('ssh_host')
    if not isinstance(host, str) or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.@-]*', host):
        parser.error('Set ssh_host to your production SSH alias in local configuration.')
    ops_value = config.get('upcloud_repository')
    if not isinstance(ops_value, str) or not ops_value.strip():
        parser.error('Set upcloud_repository in local configuration.')
    ops_root = Path(ops_value).expanduser()
    if not ops_root.is_absolute():
        ops_root = args.config.resolve().parent / ops_root
    ops = ops_root / 'services/chronosmos'
    for name in OPS_FILES:
        if not (ops / name).is_file():
            parser.error(f'Missing canonical deployment file: {ops / name}')
    if subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT):
        parser.error('Commit the intended release before deploying; the working tree must be clean.')
    if not args.skip_checks:
        run([str(ROOT / '.venv/bin/python'), '-m', 'pytest', '-q'])
        run(['npm', 'test'])
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    release = '0.1.0-' + commit[:12]
    remote = '/tmp/chronosmos-deploy-' + commit[:12]
    with tempfile.TemporaryDirectory(prefix='chronosmos-deploy-') as temporary:
        archive = Path(temporary) / 'source.tar.gz'
        run(['git', 'archive', '--format=tar.gz', '--output=' + str(archive), 'HEAD'])
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        run(['ssh', host, 'mkdir -p ' + shlex.quote(remote + '/ops')])
        run(['scp', str(archive), host + ':' + remote + '/source.tar.gz'])
        run(['scp', *[str(ops / name) for name in OPS_FILES], host + ':' + remote + '/ops/'])
        command = shlex.join(['bash', remote + '/ops/deploy.sh', remote + '/source.tar.gz', release, digest])
        run(['ssh', host, command])
    url = 'https://chronosmos.magi.fi'
    with urllib.request.urlopen(url + '/healthz', timeout=30) as response:
        if json.load(response).get('status') != 'ok':
            raise RuntimeError('The public health endpoint did not report success.')
    with urllib.request.urlopen(url + '/', timeout=30) as response:
        if response.status != 200:
            raise RuntimeError('The public homepage did not return HTTP 200.')
    print(f'Deployed {commit} as {release}: {url}')


if __name__ == '__main__':
    main()
