"""Small, parameterized storage layer shared by SQLite and PostgreSQL."""
import sqlite3
from flask import current_app, g


def connect():
    if 'db' not in g:
        url = current_app.config['DATABASE_URL']
        if url:
            import psycopg
            from psycopg.rows import dict_row
            g.db = psycopg.connect(url, row_factory=dict_row)
        else:
            g.db = sqlite3.connect(current_app.config['SQLITE_PATH'], timeout=10)
            g.db.row_factory = sqlite3.Row
            g.db.execute('PRAGMA foreign_keys=ON')
            g.db.execute('PRAGMA journal_mode=WAL')
    return g.db


def execute(sql, args=()):
    if current_app.config['DATABASE_URL']:
        sql = sql.replace('?', '%s')
    return connect().execute(sql, args)


def close(error=None):
    conn = g.pop('db', None)
    if conn:
        conn.close()


def init_db():
    for statement in [
        '''CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY, password_hash TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1)''',
        '''CREATE TABLE IF NOT EXISTS timelines (
            id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, document TEXT NOT NULL,
            published TEXT, published_slug TEXT UNIQUE,
            revision INTEGER NOT NULL DEFAULT 1, updated TEXT NOT NULL)''',
        '''CREATE TABLE IF NOT EXISTS media (
            id TEXT PRIMARY KEY, filename TEXT NOT NULL, name TEXT NOT NULL,
            width INTEGER NOT NULL, height INTEGER NOT NULL, created TEXT NOT NULL)''',
        '''CREATE TABLE IF NOT EXISTS ai_jobs (
            id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
            response_id TEXT NOT NULL, created REAL NOT NULL,
            result TEXT, error TEXT)''',
        '''CREATE TABLE IF NOT EXISTS ai_job_context (
            job_id TEXT PRIMARY KEY REFERENCES ai_jobs(id) ON DELETE CASCADE,
            payload TEXT NOT NULL)''',
        '''CREATE TABLE IF NOT EXISTS login_attempts (
            address TEXT PRIMARY KEY, attempts INTEGER NOT NULL, started REAL NOT NULL)''',
    ]:
        execute(statement)
    connect().commit()
