import os
import uuid
import pytest
from werkzeug.security import generate_password_hash
from chronosmos import create_app, db


@pytest.fixture
def app(tmp_path):
    url = os.environ.get('CHRONOSMOS_TEST_DATABASE_URL', '')
    schema = 'test_' + uuid.uuid4().hex
    if url:
        import psycopg
        from psycopg.conninfo import make_conninfo
        with psycopg.connect(url, autocommit=True) as conn:
            conn.execute(f'CREATE SCHEMA {schema}')
        test_url = make_conninfo(url, options=f'-c search_path={schema}')
    else:
        test_url = ''
    app = create_app(dict(TESTING=True, SECRET_KEY='test-secret', DATABASE_URL=test_url,
                          SQLITE_PATH=str(tmp_path / 'test.sqlite3'), MEDIA_DIR=str(tmp_path / 'media'),
                          SESSION_COOKIE_SECURE=False, TRUSTED_HOSTS=['localhost']))
    with app.app_context():
        db.init_db()
        db.execute('INSERT INTO users (username,password_hash) VALUES (?,?)', ('editor', generate_password_hash('a long test password')))
        db.connect().commit()
    yield app
    if url:
        with psycopg.connect(url, autocommit=True) as conn:
            conn.execute(f'DROP SCHEMA {schema} CASCADE')


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def auth(client):
    client.get('/manage/login')
    with client.session_transaction() as session:
        token = session['csrf']
    response = client.post('/manage/login', data=dict(username='editor', password='a long test password', csrf=token))
    assert response.status_code == 302
    with client.session_transaction() as session:
        token = session['csrf']
    return {'X-CSRF-Token': token}
