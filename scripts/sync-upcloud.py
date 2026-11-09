"""Copy reviewed deployment files into the canonical server repository.

The destination is read from ignored local configuration unless supplied as an
argument. Refuses to overwrite divergent operational files. After initial sync,
maintain the operational repository's copy as the deployment source of truth.
"""
import argparse
import json
from pathlib import Path
import shutil

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def sync(root):
    root = root.expanduser().resolve()
    source = PROJECT_ROOT / 'deploy/upcloud/services/chronosmos'
    target = root / 'services/chronosmos'
    readme_path = root / 'README.md'
    if not (root / 'AGENTS.md').is_file() or not readme_path.is_file():
        raise ValueError('Expected the UpCloud configuration repository with AGENTS.md and README.md.')
    files = sorted(item for item in source.iterdir() if item.is_file())
    for item in files:
        destination = target / item.name
        if destination.exists() and destination.read_bytes() != item.read_bytes():
            raise ValueError(f'Refusing to overwrite divergent operational file: {destination}')
    readme = readme_path.read_text()
    service = '| Chronosmos | Valmisteltu 0.1.0, ei asennettu; 9.11.2026 | [Palvelun asetukset](services/chronosmos/README.md) |'
    history = '- 9.11.2026: Valmisteltu Chronosmos 0.1.0 osoitteeseen chronosmos.magi.fi: PostgreSQL, tiedostomedia, systemd, Apache/HTTPS, päivitys ja varmistuspalautuksen tarkistus. Palvelinta ei ole muutettu; käyttöönotto ja tuotantopalautustesti ovat tekemättä.'
    if 'services/chronosmos/README.md' not in readme:
        marker = '## Salaisuudet ja varmuuskopiot'
        if marker not in readme:
            raise ValueError('Could not identify the service table boundary in README.md.')
        before, after = readme.split(marker, 1)
        readme = before.rstrip() + '\n' + service + '\n\n' + marker + after
    if history not in readme:
        readme = readme.rstrip() + '\n\n' + history + '\n'
    target.mkdir(parents=True, exist_ok=True)
    for item in files:
        shutil.copy2(item, target / item.name)
    if readme_path.read_text() != readme:
        readme_path.write_text(readme)
    print(f'Prepared configuration synchronized to {target}; no server changes made.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', nargs='?', type=Path,
                        help='Root of the UpCloud configuration checkout (overrides local configuration)')
    parser.add_argument('--config', type=Path, default=PROJECT_ROOT / 'chronosmos.local.json',
                        help='Local configuration JSON file')
    args = parser.parse_args()
    destination = args.destination
    if destination is None:
        try:
            config = json.loads(args.config.read_text())
        except (OSError, ValueError) as exc:
            parser.error(f'Cannot read local configuration: {exc}. Copy chronosmos.local.example.json and configure upcloud_repository.')
        value = config.get('upcloud_repository') if isinstance(config, dict) else None
        if not isinstance(value, str) or not value.strip():
            parser.error('Set upcloud_repository in local configuration or provide a destination argument.')
        destination = Path(value).expanduser()
        if not destination.is_absolute():
            destination = args.config.resolve().parent / destination
    try:
        sync(destination)
    except (OSError, ValueError) as exc:
        parser.error(str(exc))


if __name__ == '__main__':
    main()
