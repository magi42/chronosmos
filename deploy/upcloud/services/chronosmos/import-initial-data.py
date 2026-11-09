"""Read an initial private migration JSON stream. Refuse a nonempty database.

Run with the service environment and user, from the application release directory.
Never use for later application updates: production data is authoritative.
"""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path.cwd()))
from chronosmos import create_app, db
from chronosmos.model import validate


payload = json.load(sys.stdin)
app = create_app()
with app.app_context():
    tables = {
        'users': ('username', 'password_hash', 'version'),
        'timelines': ('id', 'slug', 'document', 'published', 'published_slug', 'revision', 'updated'),
        'media': ('id', 'filename', 'name', 'width', 'height', 'created'),
    }
    for table in tables:
        if db.execute('SELECT COUNT(*) AS count FROM ' + table).fetchone()['count']:
            raise SystemExit('Initial import refused: production database is not empty.')
    media_ids = {record['id'] for record in payload['media']}
    for record in payload['timelines']:
        for raw in (record['document'], record['published']):
            if raw:
                document = validate(json.loads(raw))
                if any(o.get('mediaId') not in media_ids for o in document['overlays'] if o['type'] == 'image'):
                    raise SystemExit('A timeline references missing media metadata.')
    for record in payload['media']:
        if Path(record['filename']).name != record['filename']:
            raise SystemExit('Invalid media filename.')
        if not (Path(app.config['MEDIA_DIR']) / record['filename']).is_file():
            raise SystemExit('Copy the referenced media files before importing.')
    for table, columns in tables.items():
        sql = 'INSERT INTO ' + table + ' (' + ','.join(columns) + ') VALUES (' + ','.join('?' for _ in columns) + ')'
        for record in payload[table]:
            db.execute(sql, tuple(record[column] for column in columns))
    db.connect().commit()
    print('Initial migration complete: ' + ', '.join(f'{len(payload[table])} {table}' for table in tables))
