import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys

from chronosmos import create_app, db
from chronosmos.sample import sample


SCRIPT = Path(__file__).resolve().parents[1] / 'deploy/upcloud/services/chronosmos/import-initial-data.py'


def test_initial_import_preserves_accounts_publication_and_refuses_overwrite(tmp_path, monkeypatch):
    monkeypatch.setenv('CHRONOSMOS_DATA_DIR', str(tmp_path))
    monkeypatch.setenv('CHRONOSMOS_DATABASE_URL', '')
    with create_app().app_context():
        db.init_db()
    raw = json.dumps(sample())
    payload = dict(users=[dict(username='configured-editor', password_hash='test-only-hash', version=3)],
                   timelines=[dict(id='migration-example', slug='traditions', document=raw,
                                   published=raw, published_slug='traditions', revision=7, updated='2026-11-09')], media=[])
    result = subprocess.run([sys.executable, str(SCRIPT)], input=json.dumps(payload), text=True, capture_output=True)
    assert result.returncode == 0, result.stderr
    connection = sqlite3.connect(tmp_path / 'chronosmos.sqlite3')
    assert connection.execute('SELECT username,version FROM users').fetchone() == ('configured-editor', 3)
    assert connection.execute('SELECT published_slug,revision FROM timelines').fetchone() == ('traditions', 7)
    payload['users'][0]['username'] = 'replacement'
    retry = subprocess.run([sys.executable, str(SCRIPT)], input=json.dumps(payload), text=True, capture_output=True)
    assert retry.returncode != 0
    assert 'not empty' in retry.stderr
    assert connection.execute('SELECT username FROM users').fetchone()[0] == 'configured-editor'
    connection.close()


def test_initial_import_rejects_missing_illustrations_before_writing(tmp_path, monkeypatch):
    monkeypatch.setenv('CHRONOSMOS_DATA_DIR', str(tmp_path))
    monkeypatch.setenv('CHRONOSMOS_DATABASE_URL', '')
    with create_app().app_context():
        db.init_db()
    doc = sample()
    doc['overlays'][0].update(type='image', mediaId='a'*32)
    payload = dict(users=[], media=[], timelines=[dict(document=json.dumps(doc), published=None)])
    result = subprocess.run([sys.executable, str(SCRIPT)], input=json.dumps(payload), text=True, capture_output=True)
    assert result.returncode != 0
    assert 'missing media' in result.stderr
    with sqlite3.connect(tmp_path / 'chronosmos.sqlite3') as connection:
        assert connection.execute('SELECT COUNT(*) FROM timelines').fetchone()[0] == 0
