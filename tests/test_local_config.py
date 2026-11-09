"""Local paths stay configurable and never enter generated deployment files."""
import json
from pathlib import Path
import subprocess
import sys


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/sync-upcloud.py'


def fixture_checkout(tmp_path):
    root = tmp_path / 'operations'
    root.mkdir()
    (root / 'AGENTS.md').write_text('Local operations instructions\n')
    (root / 'README.md').write_text('| Palvelu | Tila | Ohje |\n| --- | --- | --- |\n\n## Salaisuudet ja varmuuskopiot\n')
    return root


def run(*args):
    return subprocess.run([sys.executable, str(SCRIPT), *map(str, args)], capture_output=True, text=True)


def test_sync_reads_config_relative_to_config_file_and_is_idempotent(tmp_path):
    root = fixture_checkout(tmp_path)
    config = tmp_path / 'local.json'
    config.write_text(json.dumps({'upcloud_repository': root.name}))
    first = run('--config', config)
    assert first.returncode == 0, first.stderr
    readme = (root / 'README.md').read_text()
    assert readme.count('services/chronosmos/README.md') == 1
    assert str(tmp_path) not in readme
    assert (root / 'services/chronosmos/chronosmos.service').is_file()
    assert run('--config', config).returncode == 0
    assert (root / 'README.md').read_text() == readme


def test_explicit_destination_overrides_missing_config_and_protects_operational_changes(tmp_path):
    root = fixture_checkout(tmp_path)
    missing = tmp_path / 'missing.json'
    assert run(root, '--config', missing).returncode == 0
    service = root / 'services/chronosmos/chronosmos.service'
    service.write_text('Operator changes\n')
    result = run(root)
    assert result.returncode != 0
    assert 'Refusing to overwrite' in result.stderr
    assert service.read_text() == 'Operator changes\n'


def test_empty_or_missing_local_config_requires_explicit_setup(tmp_path):
    config = tmp_path / 'local.json'
    assert run('--config', config).returncode != 0
    config.write_text(json.dumps({'upcloud_repository': None}))
    result = run('--config', config)
    assert result.returncode != 0
    assert 'Set upcloud_repository' in result.stderr
