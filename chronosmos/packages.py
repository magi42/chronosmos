"""Portable ZIP timelines. Read named members only; never extract archive paths."""
import copy
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import uuid
import zipfile
import zlib

from PIL import Image, ImageOps, UnidentifiedImageError

from .model import validate

MAX_PACKAGE = 64 * 1024 * 1024
MAX_DOCUMENT = 12 * 1024 * 1024


def media_ids(doc):
    return {o['mediaId'] for o in doc['overlays'] if o['type'] == 'image'}


def build_package(doc, media, directory):
    validate(doc)
    resources = []
    total = 0
    for ident in sorted(media_ids(doc)):
        row = media.get(ident)
        if not row:
            raise ValueError('An illustration is missing from the media library.')
        path = Path(directory) / row['filename']
        if not path.is_file():
            raise ValueError('An illustration file is missing.')
        total += path.stat().st_size
        resources.append(dict(id=ident, path=f'media/{ident}.png', name=row['name']))
    document = json.dumps(doc, ensure_ascii=False, indent=2).encode('utf-8')
    manifest = json.dumps(dict(format='chronosmos-package', version=1, media=resources), ensure_ascii=False).encode('utf-8')
    if len(document) > MAX_DOCUMENT or total + len(document) + len(manifest) > MAX_PACKAGE - 1024 * 1024:
        raise ValueError('This package exceeds the 64 MiB limit.')
    output = tempfile.SpooledTemporaryFile(max_size=1024 * 1024)
    try:
        with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('manifest.json', manifest)
            archive.writestr('timeline.json', document)
            for resource in resources:
                archive.write(Path(directory) / media[resource['id']]['filename'], resource['path'], compress_type=zipfile.ZIP_STORED)
        output.seek(0)
        return output
    except Exception:
        output.close()
        raise


def read_package(stream, staging):
    """Validate the entire archive and stage sanitized media before any DB writes."""
    # Python 3.10's upload spool lacks seekable(), required by ZipFile reads.
    if not hasattr(stream, 'seekable'):
        with os.fdopen(os.dup(stream.fileno()), 'rb') as compatible:
            return read_package(compatible, staging)
    try:
        with zipfile.ZipFile(stream) as archive:
            members = archive.infolist()
            names = [m.filename for m in members]
            if len(members) > 502 or len(set(names)) != len(names) or sum(m.file_size for m in members) > MAX_PACKAGE:
                raise ValueError('Invalid or oversized timeline package.')
            for member in members:
                mode = member.external_attr >> 16
                if member.is_dir() or stat.S_ISDIR(mode) or member.flag_bits & 1 or stat.S_ISLNK(mode) or member.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                    raise ValueError('Unsupported package member.')
            if 'manifest.json' not in names or 'timeline.json' not in names:
                raise ValueError('The package needs manifest.json and timeline.json.')
            if archive.getinfo('manifest.json').file_size > 1024 * 1024 or archive.getinfo('timeline.json').file_size > MAX_DOCUMENT:
                raise ValueError('The package document is too large.')
            manifest = json.loads(archive.read('manifest.json'))
            doc = validate(json.loads(archive.read('timeline.json')))
            if not isinstance(manifest, dict) or manifest.get('format') != 'chronosmos-package' or manifest.get('version') != 1:
                raise ValueError('Unsupported timeline package.')
            resources = manifest.get('media')
            if not isinstance(resources, list) or len(resources) > 500:
                raise ValueError('Invalid package media list.')
            expected = {'manifest.json', 'timeline.json'}
            ids = set()
            staged = []
            mapping = {}
            for resource in resources:
                if not isinstance(resource, dict):
                    raise ValueError('Invalid package media.')
                ident, name = resource.get('id'), resource.get('name')
                if not isinstance(ident, str) or not re.fullmatch(r'[a-f0-9]{32}', ident) or ident in ids:
                    raise ValueError('Invalid or duplicate package media identifier.')
                member = f'media/{ident}.png'
                if resource.get('path') != member or member not in names or not isinstance(name, str) or len(name) > 160:
                    raise ValueError('Invalid package media path or name.')
                expected.add(member)
                ids.add(ident)
                fresh = uuid.uuid4().hex
                filename = fresh + '.png'
                path = Path(staging) / filename
                with archive.open(member) as source, Image.open(source) as image:
                    if image.format != 'PNG' or image.width * image.height > 20_000_000 or max(image.size) > 4096:
                        raise ValueError('Package illustrations must be PNG up to 4096 pixels per dimension.')
                    sanitized = ImageOps.exif_transpose(image).convert('RGBA')
                    sanitized.save(path, 'PNG')
                    width, height = sanitized.size
                    sanitized.close()
                mapping[ident] = fresh
                staged.append(dict(id=fresh, filename=filename, name=name, width=width, height=height))
            if set(names) != expected or ids != media_ids(doc):
                raise ValueError('Package resources must exactly match the timeline illustrations.')
            doc = copy.deepcopy(doc)
            for overlay in doc['overlays']:
                if overlay['type'] == 'image':
                    overlay['mediaId'] = mapping[overlay['mediaId']]
            return doc, staged
    except (zipfile.BadZipFile, zipfile.LargeZipFile, KeyError, UnicodeError, json.JSONDecodeError, UnidentifiedImageError, OSError, Image.DecompressionBombError, RuntimeError, NotImplementedError, EOFError, RecursionError, zlib.error) as error:
        raise ValueError('The timeline package is damaged or unsupported.') from error
