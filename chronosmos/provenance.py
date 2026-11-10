"""Safe, portable source links for authored research metadata."""
from urllib.parse import urlsplit


def source_url(value):
    if not isinstance(value, str) or len(value) > 2000:
        return False
    try:
        u = urlsplit(value)
        return u.scheme in ('http', 'https') and bool(u.hostname) and not u.username and not u.password and not any(ord(c) < 33 for c in value)
    except ValueError:
        return False
