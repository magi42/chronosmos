#!/usr/bin/env bash
# Verify in a NEW database. Does not overwrite the production database or media.
set -euo pipefail
umask 077
[[ $EUID -eq 0 && $# -eq 1 ]] || { echo 'Run as root: verify-restore.sh backup-directory' >&2; exit 1; }
backup=$(realpath "$1")
[[ -f "$backup/COMPLETE" ]] || { echo 'Incomplete backup' >&2; exit 2; }
(cd "$backup" && sha256sum -c SHA256SUMS)
name="chronosmos_restore_$(date +%s)_$$"
tmp=$(mktemp -d /tmp/chronosmos-restore.XXXXXX)
cleanup(){ runuser -u postgres -- dropdb --if-exists "$name"; rm -rf -- "$tmp"; }
trap cleanup EXIT
runuser -u postgres -- createdb --owner=chronosmos "$name"
runuser -u postgres -- pg_restore --no-owner --role=chronosmos --dbname="$name" < "$backup/database.dump"
tar -xzf "$backup/media.tar.gz" -C "$tmp"
chown -R postgres:postgres "$tmp"
runuser -u postgres -- env CHRONOSMOS_RESTORE_DB="$name" CHRONOSMOS_RESTORE_MEDIA="$tmp/media" /srv/chronosmos/current/.venv/bin/python - <<'PY'
import json, os
from pathlib import Path
import psycopg
with psycopg.connect(dbname=os.environ['CHRONOSMOS_RESTORE_DB'], user='postgres') as db:
    with db.cursor() as cur:
        for table in ('users','timelines','media'):
            cur.execute('SELECT count(*) FROM '+table)
            print(table, cur.fetchone()[0])
        cur.execute('SELECT document,published FROM timelines')
        documents=[json.loads(raw) for row in cur.fetchall() for raw in row if raw]
        cur.execute('SELECT id,filename FROM media')
        media=dict(cur.fetchall())
        folder=Path(os.environ['CHRONOSMOS_RESTORE_MEDIA'])
        for filename in media.values():
            assert (folder/filename).is_file(), 'Media file missing'
        for doc in documents:
            assert doc['version']==1
            for o in doc['overlays']:
                if o['type']=='image': assert o['mediaId'] in media, 'Media reference missing'
print('Database and media restore verified.')
PY
