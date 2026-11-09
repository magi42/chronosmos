"""Version 1 timeline format. Historical years are signed integers, never zero."""
import math
import re


def ordinal(year):
    if not isinstance(year, int) or isinstance(year, bool) or year == 0:
        raise ValueError('A year must be an integer other than zero.')
    return year if year < 0 else year - 1


def validate(doc):
    if not isinstance(doc, dict) or doc.get('version') != 1:
        raise ValueError('Unsupported timeline format.')

    def text(obj, key, limit=500, required=True):
        v = obj.get(key, '')
        if not isinstance(v, str) or len(v) > limit or (required and not v.strip()):
            raise ValueError(f'Invalid {key}.')
        return v

    def num(obj, key, low, high):
        v = obj.get(key)
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not low <= v <= high:
            raise ValueError(f'{key} must be between {low} and {high}.')
        return v

    def year(obj, key):
        v = num(obj, key, -100000, 100000)
        ordinal(v)
        return v

    def color(obj, key):
        if not re.fullmatch(r'#[0-9a-fA-F]{6}', str(obj.get(key, ''))):
            raise ValueError(f'Invalid {key} color.')

    text(doc, 'title', 160)
    text(doc, 'description', 4000, False)
    slug = text(doc, 'slug', 160)
    if not re.fullmatch(r'[a-z0-9]+(?:[/-][a-z0-9]+)*', slug) or slug.split('/')[0] in {'api', 'manage', 'static', 'media', 'healthz', 'assets'}:
        raise ValueError('Use a unique path with lowercase letters, numbers, hyphens and optional slashes.')
    start, end = year(doc, 'start'), year(doc, 'end')
    if ordinal(end) <= ordinal(start):
        raise ValueError('End year must be after start year.')
    num(doc, 'mmPerYear', .01, 100)
    num(doc, 'height', 200, 4000)
    color(doc, 'background')
    if doc.get('scale') not in ('top', 'bottom', 'both', 'none'):
        raise ValueError('Invalid scale position.')
    bars, overlays, events = (doc.get(k) for k in ('bars', 'overlays', 'events'))
    if not all(isinstance(v, list) and len(v) <= 500 for v in (bars, overlays, events)):
        raise ValueError('Each timeline supports up to 500 bars, overlays and event lines.')
    ids = set()
    for item in bars + overlays + events:
        if not isinstance(item, dict):
            raise ValueError('Invalid timeline element.')
        ident = text(item, 'id', 80)
        if not re.fullmatch(r'[a-zA-Z0-9_-]+', ident) or ident in ids:
            raise ValueError('Element identifiers must be unique.')
        ids.add(ident)
    bar_ids = {b['id']: b for b in bars}
    for b in bars:
        text(b, 'label', 250, False)
        a, z = year(b, 'start'), year(b, 'end')
        if ordinal(z) <= ordinal(a):
            raise ValueError('A bar must end after it starts.')
        num(b, 'y', 60, doc['height'] - 60)
        num(b, 'height', 4, 160)
        color(b, 'background')
        color(b, 'foreground')
        num(b, 'fadeIn', 0, 100000)
        num(b, 'fadeOut', 0, 100000)
        if 'captionYear' in b:
            caption = year(b, 'captionYear')
            if not ordinal(a) <= ordinal(caption) <= ordinal(z):
                raise ValueError('Caption year must be within its time bar.')
    for b in bars:
        a, z = b['start'], b['end']
        merge = text(b, 'mergeInto', 80, False)
        if merge:
            target = bar_ids.get(merge)
            if not target or target is b:
                raise ValueError('A merge needs a different target bar.')
            if not ordinal(target['start']) <= ordinal(z) <= ordinal(target['end']):
                raise ValueError('The target bar must exist at the merge year.')
            num(b, 'mergeYears', 1, max(1, ordinal(z) - ordinal(a)))
    for b in bars:
        # Check directed merge cycles, including indirect cycles.
        seen, cur = {b['id']}, b.get('mergeInto', '')
        while cur:
            if cur in seen:
                raise ValueError('Bar merges cannot form a cycle.')
            seen.add(cur)
            cur = text(bar_ids[cur], 'mergeInto', 80, False)
    for o in overlays:
        if o.get('type') not in ('text', 'box', 'image'):
            raise ValueError('Invalid overlay type.')
        year(o, 'year')
        anchor = text(o, 'anchorBarId', 80, False)
        if anchor:
            bar = bar_ids.get(anchor)
            if not bar:
                raise ValueError('Choose an existing time bar for the overlay anchor.')
            if not ordinal(bar['start']) <= ordinal(o['year']) <= ordinal(bar['end']):
                raise ValueError('Anchor year must be within its time bar.')
            num(o, 'offsetY', -4000, 4000)
        num(o, 'y', 0, doc['height'])
        num(o, 'width', 10, 2000)
        num(o, 'height', 10, 2000)
        text(o, 'text', 4000, False)
        color(o, 'color')
        color(o, 'fill')
        num(o, 'fontSize', 6, 120)
        if o.get('type') == 'image' and not re.fullmatch(r'[a-f0-9]{32}', str(o.get('mediaId', ''))):
            raise ValueError('Choose an image from the media library.')
    for e in events:
        year(e, 'year')
        text(e, 'label', 250, False)
        num(e, 'y', 0, doc['height'])
        num(e, 'height', 1, doc['height'])
        num(e, 'width', .25, 20)
        color(e, 'color')
        if e.get('layer') not in ('under', 'over'):
            raise ValueError('Invalid event line layer.')
    return doc
