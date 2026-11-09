import hmac
import io
import json
import os
from pathlib import Path
import secrets
import time
import uuid
import sqlite3
import tempfile
from datetime import datetime, timezone, timedelta
from functools import wraps

import click
from flask import Flask, abort, g, jsonify, redirect, render_template, request, send_from_directory, session, url_for, send_file
from PIL import Image, ImageOps, UnidentifiedImageError
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.middleware.proxy_fix import ProxyFix

from . import db
from .model import validate
from .packages import build_package, read_package, media_ids, MAX_PACKAGE


def now():
    return datetime.now(timezone.utc).isoformat()


def create_app(config=None):
    app = Flask(__name__)
    data = Path(os.environ.get('CHRONOSMOS_DATA_DIR', Path(app.root_path).parent / 'instance'))
    data.mkdir(parents=True, exist_ok=True)
    secret = os.environ.get('CHRONOSMOS_SECRET_KEY')
    if not secret:
        # Persist the local development key; production must supply an environment key.
        keyfile = data / 'secret.key'
        try:
            fd = os.open(keyfile, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            pass
        else:
            with os.fdopen(fd, 'w') as f:
                f.write(secrets.token_hex(32))
        secret = keyfile.read_text()
    app.config.update(
        SECRET_KEY=secret, DATABASE_URL=os.environ.get('CHRONOSMOS_DATABASE_URL', ''),
        SQLITE_PATH=str(data / 'chronosmos.sqlite3'), MEDIA_DIR=str(data / 'media'),
        MAX_CONTENT_LENGTH=12 * 1024 * 1024, MAX_FORM_PARTS=10,
        SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Lax',
        SESSION_COOKIE_SECURE=os.environ.get('CHRONOSMOS_SECURE_COOKIES') == '1',
        PERMANENT_SESSION_LIFETIME=timedelta(hours=12),
        TRUSTED_HOSTS=os.environ.get('CHRONOSMOS_HOSTS', 'localhost,127.0.0.1,[::1]').split(','),
    )
    if config:
        app.config.update(config)
    Path(app.config['MEDIA_DIR']).mkdir(parents=True, exist_ok=True)
    if os.environ.get('CHRONOSMOS_TRUST_PROXY') == '1':
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)
    app.teardown_appcontext(db.close)

    def editor():
        if 'user' not in g:
            row = db.execute('SELECT * FROM users WHERE username=?', (session.get('username', ''),)).fetchone()
            g.user = row if row and row['version'] == session.get('user_version') else None
        return g.user

    def require_editor(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            if not editor():
                abort(401)
            return fn(*args, **kwargs)
        return wrapped

    def csrf():
        if 'csrf' not in session:
            session['csrf'] = secrets.token_urlsafe(32)
        return session['csrf']

    @app.before_request
    def protect_writes():
        if request.path == "/api/packages/import" and request.method == "POST":
            request.max_content_length = MAX_PACKAGE
        if request.method in {'POST', 'PUT', 'PATCH', 'DELETE'}:
            token = request.headers.get('X-CSRF-Token', '') or request.form.get('csrf', '')
            if not token or not hmac.compare_digest(token, session.get('csrf', '')):
                abort(403, 'Your session expired. Reload the page and try again.')

    @app.after_request
    def headers(response):
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'same-origin'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
        if request.path.startswith(('/api/', '/manage')) or request.path.startswith('/media/'):
            response.headers['Cache-Control'] = 'no-store'
        return response

    @app.errorhandler(HTTPException)
    def http_error(e):
        if request.path.startswith('/api/'):
            return jsonify(error=e.description), e.code
        return render_template('error.html', code=e.code, message=e.description), e.code

    @app.errorhandler(ValueError)
    def bad_value(e):
        return jsonify(error=str(e)), 400

    import psycopg

    @app.errorhandler(sqlite3.IntegrityError)
    @app.errorhandler(psycopg.IntegrityError)
    def integrity_error(e):
        db.connect().rollback()
        return jsonify(error='That path is already in use. Choose a different path.'), 409

    def json_body():
        body = request.get_json()
        if not isinstance(body, dict):
            abort(400, 'Expected a JSON object.')
        return body

    def expected_revision(body):
        value = body.get('revision')
        if type(value) is not int or value < 1:
            abort(400, 'A positive integer revision is required.')
        return value

    def metadata(row, private=False):
        doc = json.loads(row['document'] if private else row['published'])
        return dict(id=row['id'], title=doc['title'], description=doc['description'],
                    slug=doc['slug'], start=doc['start'], end=doc['end'],
                    bars=len(doc['bars']), revision=row['revision'], updated=row['updated'],
                    published=bool(row['published']), publishedSlug=row['published_slug'],
                    translations=doc.get('translations', {}))

    @app.get('/healthz')
    def health():
        db.execute('SELECT 1 FROM timelines LIMIT 1')
        return jsonify(status='ok', version='0.1.0')

    @app.get('/')
    def index():
        return render_template('index.html')

    @app.get('/manage')
    def manage():
        if not editor():
            return redirect(url_for('login', **({'timeline': request.args['timeline']} if request.args.get('timeline') else {})))
        return render_template('editor.html', csrf=csrf())

    @app.route('/manage/login', methods=['GET', 'POST'])
    def login():
        error = None
        if request.method == 'POST':
            address = request.remote_addr or 'unknown'
            attempt = db.execute('SELECT * FROM login_attempts WHERE address=?', (address,)).fetchone()
            stamp = time.time()
            if attempt and stamp - attempt['started'] < 900 and attempt['attempts'] >= 10:
                abort(429, 'Too many attempts. Try again in 15 minutes.')
            user = db.execute('SELECT * FROM users WHERE username=?', (request.form.get('username', ''),)).fetchone()
            # Always do a password hash check, including for unknown users.
            valid = check_password_hash(user['password_hash'] if user else app.config['DUMMY_HASH'], request.form.get('password', ''))
            if user and valid:
                db.execute('DELETE FROM login_attempts WHERE address=?', (address,))
                db.connect().commit()
                session.clear()
                session.update(username=user['username'], user_version=user['version'])
                session.permanent = True
                csrf()
                return redirect(url_for('manage', **({'timeline': request.args['timeline']} if request.args.get('timeline') else {})))
            count = attempt['attempts'] + 1 if attempt and stamp - attempt['started'] < 900 else 1
            started = attempt['started'] if count > 1 else stamp
            db.execute('INSERT INTO login_attempts (address,attempts,started) VALUES (?,?,?) ON CONFLICT(address) DO UPDATE SET attempts=excluded.attempts,started=excluded.started', (address, count, started))
            db.connect().commit()
            error = 'Invalid username or password.'
        return render_template('login.html', csrf=csrf(), error=error)

    @app.post('/api/logout')
    @require_editor
    def logout():
        session.clear()
        return jsonify(ok=True)

    @app.get('/api/timelines')
    def timelines():
        private = request.args.get('editor') == '1'
        if private and not editor():
            abort(401)
        rows = db.execute('SELECT * FROM timelines' + ('' if private else ' WHERE published IS NOT NULL') + ' ORDER BY updated DESC').fetchall()
        return jsonify([metadata(r, private) for r in rows])

    @app.get('/api/timelines/<ident>')
    def timeline(ident):
        row = db.execute('SELECT * FROM timelines WHERE id=?', (ident,)).fetchone()
        if not row:
            abort(404)
        private = request.args.get('editor') == '1'
        if private and not editor():
            abort(401)
        if not private and not row['published']:
            abort(404)
        return jsonify(id=row['id'], revision=row['revision'], published=bool(row['published']),
                       publishedSlug=row['published_slug'], document=json.loads(row['document'] if private else row['published']))

    def validate_media(doc):
        for overlay in doc['overlays']:
            if overlay['type'] == 'image' and not db.execute('SELECT id FROM media WHERE id=?', (overlay['mediaId'],)).fetchone():
                raise ValueError('An illustration is missing from the media library.')

    @app.post('/api/validate')
    @require_editor
    def validate_document():
        doc = validate(request.get_json())
        validate_media(doc)
        return jsonify(document=doc)

    @app.post('/api/timelines')
    @require_editor
    def create_timeline():
        doc = validate(request.get_json())
        validate_media(doc)
        if db.execute('SELECT id FROM timelines WHERE slug=? OR published_slug=?', (doc['slug'], doc['slug'])).fetchone():
            abort(409, 'That path is already in use.')
        ident = uuid.uuid4().hex
        try:
            db.execute('INSERT INTO timelines (id,slug,document,updated) VALUES (?,?,?,?)', (ident, doc['slug'], json.dumps(doc), now()))
            db.connect().commit()
        except Exception:
            db.connect().rollback()
            raise
        return jsonify(id=ident, revision=1), 201

    @app.put('/api/timelines/<ident>')
    @require_editor
    def save_timeline(ident):
        body = json_body()
        expected_revision(body)
        doc = validate(body.get('document'))
        validate_media(doc)
        if db.execute('SELECT id FROM timelines WHERE (slug=? OR published_slug=?) AND id<>?', (doc['slug'], doc['slug'], ident)).fetchone():
            abort(409, 'That path is already in use.')
        # Revision predicate makes competing saves atomic on both databases.
        cur = db.execute('UPDATE timelines SET slug=?,document=?,revision=revision+1,updated=? WHERE id=? AND revision=?',
                         (doc['slug'], json.dumps(doc), now(), ident, body.get('revision')))
        if cur.rowcount != 1:
            db.connect().rollback()
            abort(409, 'This timeline changed in another session. Download your JSON before reloading.')
        db.connect().commit()
        return jsonify(id=ident, revision=body['revision'] + 1)

    @app.post('/api/timelines/<ident>/publish')
    @require_editor
    def publish(ident):
        body = json_body()
        expected_revision(body)
        if type(body.get('published')) is not bool:
            abort(400, 'A published boolean is required.')
        published = body.get('published') is True
        cur = db.execute('UPDATE timelines SET published=' + ('document,published_slug=slug' if published else 'NULL,published_slug=NULL') + ',revision=revision+1,updated=? WHERE id=? AND revision=?', (now(), ident, body.get('revision')))
        if cur.rowcount != 1:
            db.connect().rollback()
            abort(409, 'This timeline changed. Reload before publishing.')
        db.connect().commit()
        return jsonify(ok=True, revision=body['revision'] + 1)

    @app.delete('/api/timelines/<ident>')
    @require_editor
    def delete_timeline(ident):
        cur = db.execute('DELETE FROM timelines WHERE id=? AND revision=?', (ident, expected_revision(json_body())))
        if cur.rowcount != 1:
            db.connect().rollback()
            abort(409, 'This timeline changed. Reload before deleting.')
        db.connect().commit()
        return jsonify(ok=True)

    def package_response(doc):
        resources = {ident: db.execute('SELECT * FROM media WHERE id=?', (ident,)).fetchone() for ident in media_ids(doc)}
        output = build_package(doc, resources, app.config['MEDIA_DIR'])
        response = send_file(output, mimetype='application/zip', as_attachment=True,
                             download_name=doc['slug'].replace('/', '-') + '.chronosmos.zip')
        response.call_on_close(output.close)
        return response

    @app.post('/api/packages/export')
    @require_editor
    def export_package():
        doc = validate(request.get_json())
        validate_media(doc)
        return package_response(doc)

    @app.get('/api/timelines/<ident>/package')
    def public_package(ident):
        row = db.execute('SELECT published FROM timelines WHERE id=?', (ident,)).fetchone()
        if not row or not row['published']:
            abort(404)
        return package_response(json.loads(row['published']))

    @app.post('/api/packages/import')
    @require_editor
    def import_package():
        file = request.files.get('file')
        if not file:
            abort(400, 'Choose a Chronosmos ZIP package.')
        installed = []
        with tempfile.TemporaryDirectory(prefix='.import-', dir=app.config['MEDIA_DIR']) as staging:
            doc, resources = read_package(file.stream, staging)
            try:
                if app.config['DATABASE_URL']:
                    db.execute('LOCK TABLE timelines IN SHARE ROW EXCLUSIVE MODE')
                else:
                    db.execute('BEGIN IMMEDIATE')
                # Include published paths/titles, including snapshots whose draft was renamed.
                paths, titles = set(), set()
                for row in db.execute('SELECT slug,published_slug,document,published FROM timelines').fetchall():
                    paths.update(filter(None, (row['slug'], row['published_slug'])))
                    for raw in (row['document'], row['published']):
                        if raw:
                            titles.add(json.loads(raw)['title'].strip().casefold())
                base_title, base_slug = doc['title'], doc['slug']
                number = 2
                while doc['title'].strip().casefold() in titles:
                    suffix = f' ({number})'
                    doc['title'] = base_title[:160-len(suffix)] + suffix
                    number += 1
                number = 2
                while doc['slug'] in paths:
                    suffix = f'-{number}'
                    doc['slug'] = base_slug[:160-len(suffix)].rstrip('/-') + suffix
                    number += 1
                validate(doc)
                stamp = now()
                for resource in resources:
                    path = Path(app.config['MEDIA_DIR']) / resource['filename']
                    os.link(Path(staging) / resource['filename'], path)
                    installed.append(path)
                    db.execute('INSERT INTO media (id,filename,name,width,height,created) VALUES (?,?,?,?,?,?)',
                               (resource['id'], resource['filename'], resource['name'], resource['width'], resource['height'], stamp))
                ident = uuid.uuid4().hex
                db.execute('INSERT INTO timelines (id,slug,document,updated) VALUES (?,?,?,?)', (ident, doc['slug'], json.dumps(doc), stamp))
                db.connect().commit()
            except Exception:
                db.connect().rollback()
                for path in installed:
                    path.unlink(missing_ok=True)
                raise
        return jsonify(id=ident, revision=1, published=False, document=doc, mediaCount=len(resources)), 201

    @app.get('/api/media')
    @require_editor
    def media_list():
        return jsonify([dict(r) for r in db.execute('SELECT * FROM media ORDER BY created DESC').fetchall()])

    @app.post('/api/media')
    @require_editor
    def upload():
        file = request.files.get('file')
        if not file:
            abort(400, 'Choose a PNG, JPEG or WebP illustration.')
        try:
            Image.MAX_IMAGE_PIXELS = 20_000_000
            with Image.open(file.stream) as image:
                if image.format not in ('PNG', 'JPEG', 'WEBP') or image.width * image.height > 20_000_000:
                    raise ValueError('Use PNG, JPEG or WebP up to 20 megapixels.')
                image = ImageOps.exif_transpose(image).convert('RGBA')
                image.thumbnail((4096, 4096))
                ident = uuid.uuid4().hex
                filename = ident + '.png'
                output = io.BytesIO()
                image.save(output, 'PNG')
                width, height = image.size
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
            abort(400, 'The image could not be read. Use PNG, JPEG or WebP.')
        path = Path(app.config['MEDIA_DIR']) / filename
        path.write_bytes(output.getvalue())
        name = (file.filename or 'Illustration')[:160]
        try:
            db.execute('INSERT INTO media (id,filename,name,width,height,created) VALUES (?,?,?,?,?,?)', (ident, filename, name, width, height, now()))
            db.connect().commit()
        except Exception:
            path.unlink(missing_ok=True)
            raise
        return jsonify(id=ident, filename=filename, name=name, width=width, height=height), 201

    @app.delete('/api/media/<ident>')
    @require_editor
    def delete_media(ident):
        for row in db.execute('SELECT document,published FROM timelines').fetchall():
            for raw in (row['document'], row['published']):
                if raw and any(o.get('mediaId') == ident for o in json.loads(raw)['overlays']):
                    abort(409, 'This image is used by a timeline. Remove it from drafts and published timelines first.')
        row = db.execute('SELECT * FROM media WHERE id=?', (ident,)).fetchone()
        if not row:
            abort(404)
        db.execute('DELETE FROM media WHERE id=?', (ident,))
        db.connect().commit()
        (Path(app.config['MEDIA_DIR']) / row['filename']).unlink(missing_ok=True)
        return jsonify(ok=True)

    @app.get('/media/<ident>.png')
    def media_file(ident):
        row = db.execute('SELECT * FROM media WHERE id=?', (ident,)).fetchone()
        if not row:
            abort(404)
        if not editor():
            referenced = False
            for timeline in db.execute('SELECT published FROM timelines WHERE published IS NOT NULL').fetchall():
                if any(o.get('mediaId') == ident for o in json.loads(timeline['published'])['overlays']):
                    referenced = True
                    break
            if not referenced:
                abort(404)
        return send_from_directory(app.config['MEDIA_DIR'], row['filename'], mimetype='image/png')

    @app.get('/<path:slug>')
    def viewer(slug):
        row = db.execute('SELECT id FROM timelines WHERE published_slug=? AND published IS NOT NULL', (slug,)).fetchone()
        if not row:
            abort(404)
        return render_template('viewer.html', timeline_id=row['id'])

    app.config['DUMMY_HASH'] = generate_password_hash(secrets.token_hex(16))

    @app.cli.command('init-db')
    @click.option('--demo', is_flag=True, help='Add the public, editable example composition.')
    def init_command(demo):
        db.init_db()
        if demo and not db.execute('SELECT id FROM timelines LIMIT 1').fetchone():
            from .sample import sample
            doc = validate(sample())
            raw = json.dumps(doc)
            db.execute('INSERT INTO timelines (id,slug,document,published,published_slug,updated) VALUES (?,?,?,?,?,?)', (uuid.uuid4().hex, doc['slug'], raw, raw, doc['slug'], now()))
            db.connect().commit()
        click.echo('Database initialized.')

    @app.cli.command('set-password')
    @click.argument('username')
    @click.password_option(confirmation_prompt=True)
    def set_password(username, password):
        if len(password) < 12:
            raise click.ClickException('Use at least 12 characters.')
        db.execute('INSERT INTO users (username,password_hash) VALUES (?,?) ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash,version=users.version+1', (username, generate_password_hash(password)))
        db.connect().commit()
        click.echo('Editor configured. Existing sessions for this user are revoked.')

    @app.cli.command('remove-user')
    @click.argument('username')
    def remove_user(username):
        db.execute('DELETE FROM users WHERE username=?', (username,))
        db.connect().commit()
        click.echo('Editor removed and sessions revoked.')

    return app
