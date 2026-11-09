"""Version 1 timeline format. Historical years are signed integers, never zero."""
import math
import re

MAX_YEAR = 10**12


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
        v = num(obj, key, -MAX_YEAR, MAX_YEAR)
        ordinal(v)
        return v

    def color(obj, key):
        if not re.fullmatch(r'#[0-9a-fA-F]{6}', str(obj.get(key, ''))):
            raise ValueError(f'Invalid {key} color.')

    def translations(obj, fields):
        values = obj.get('translations', {})
        if not isinstance(values, dict) or len(values) > 20:
            raise ValueError('Invalid translations.')
        for language, content in values.items():
            if not isinstance(language, str) or not re.fullmatch(r'[a-z]{2,3}(?:-[a-z0-9]{2,8})*', language) or language.split('-')[0] == 'en':
                raise ValueError('Translation language must be a language code other than English; English uses the base fields.')
            if not isinstance(content, dict) or any(key not in fields for key in content):
                raise ValueError('Invalid translated fields.')
            for key in content:
                text(content, key, fields[key], False)

    text(doc, 'title', 160)
    text(doc, 'description', 4000, False)
    translations(doc, {'title': 160, 'description': 4000})
    slug = text(doc, 'slug', 160)
    if not re.fullmatch(r'[a-z0-9]+(?:[/-][a-z0-9]+)*', slug) or slug.split('/')[0] in {'api', 'manage', 'static', 'media', 'healthz', 'assets'}:
        raise ValueError('Use a unique path with lowercase letters, numbers, hyphens and optional slashes.')
    start, end = year(doc, 'start'), year(doc, 'end')
    if ordinal(end) <= ordinal(start):
        raise ValueError('End year must be after start year.')
    num(doc, 'mmPerYear', 1e-12, 100)
    if doc.get('timeUnit', 'auto') not in ('auto', 'years', 'thousands', 'millions'):
        raise ValueError('Invalid time unit.')
    for key in ('labelInterval', 'minorTickInterval'):
        if key in doc:
            interval = num(doc, key, 0, 2 * MAX_YEAR)
            if not isinstance(interval, int):
                raise ValueError(f'{key} must be a whole number of years (0 means automatic).')
    if not isinstance(doc.get('majorGrid', False), bool):
        raise ValueError('Invalid major grid setting.')
    num(doc, 'height', 200, 4000)
    color(doc, 'background')
    if doc.get('scale') not in ('top', 'bottom', 'both', 'none'):
        raise ValueError('Invalid scale position.')
    bars, overlays, events = (doc.get(k) for k in ('bars', 'overlays', 'events'))
    branches = doc.get('branches', [])
    if not all(isinstance(v, list) and len(v) <= 500 for v in (bars, overlays, events, branches)):
        raise ValueError('Each timeline supports up to 500 bars, overlays, event lines and branches.')
    ids = set()
    for item in bars + overlays + events + branches:
        if not isinstance(item, dict):
            raise ValueError('Invalid timeline element.')
        ident = text(item, 'id', 80)
        if not re.fullmatch(r'[a-zA-Z0-9_-]+', ident) or ident in ids:
            raise ValueError('Element identifiers must be unique.')
        ids.add(ident)
    bar_ids = {b['id']: b for b in bars}
    for b in bars:
        text(b, 'label', 250, False)
        translations(b, {'label': 250})
        a, z = year(b, 'start'), year(b, 'end')
        if ordinal(z) <= ordinal(a):
            raise ValueError('A bar must end after it starts.')
        num(b, 'y', 60, doc['height'] - 60)
        num(b, 'height', 4, 160)
        color(b, 'background')
        color(b, 'foreground')
        num(b, 'fadeIn', 0, 2 * MAX_YEAR)
        num(b, 'fadeOut', 0, 2 * MAX_YEAR)
        if b.get('heightAlignment', 'center') not in ('top', 'center', 'bottom'):
            raise ValueError('Invalid height alignment.')
        if 'captionYear' in b:
            caption = year(b, 'captionYear')
            if not ordinal(a) <= ordinal(caption) <= ordinal(z):
                raise ValueError('Caption year must be within its time bar.')
        periods = b.get('heightPeriods', [])
        if not isinstance(periods, list) or len(periods) > 50:
            raise ValueError('A bar supports up to 50 height-change periods.')
        period_ids = set()
        spans = []
        for period in periods:
            if not isinstance(period, dict):
                raise ValueError('Invalid height-change period.')
            ident = text(period, 'id', 80)
            if not re.fullmatch(r'[a-zA-Z0-9_-]+', ident) or ident in period_ids:
                raise ValueError('Height-change identifiers must be unique within their bar.')
            period_ids.add(ident)
            p, q = year(period, 'start'), year(period, 'end')
            if not ordinal(a) <= ordinal(p) < ordinal(q) <= ordinal(z):
                raise ValueError('A height-change period must be within its bar and end after it starts.')
            num(period, 'height', 4, 160)
            spans.append((ordinal(p), ordinal(q)))
        ordered = sorted(spans)
        if any(ordered[i][0] < ordered[i-1][1] for i in range(1, len(ordered))):
            raise ValueError('Height-change periods cannot overlap.')
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
    for branch in branches:
        source = bar_ids.get(text(branch, 'fromBarId', 80))
        target = bar_ids.get(text(branch, 'toBarId', 80))
        if not source or not target or source is target:
            raise ValueError('A branch needs two different existing time bars.')
        for bar, key in ((source, 'fromYear'), (target, 'toYear')):
            point = year(branch, key)
            if not ordinal(bar['start']) <= ordinal(point) <= ordinal(bar['end']):
                raise ValueError('A branch endpoint must be within its time bar.')
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
        translations(o, {'text': 4000})
        color(o, 'color')
        color(o, 'fill')
        num(o, 'fontSize', 6, 120)
        if o.get('type') == 'image' and not re.fullmatch(r'[a-f0-9]{32}', str(o.get('mediaId', ''))):
            raise ValueError('Choose an image from the media library.')
    for e in events:
        year(e, 'year')
        text(e, 'label', 250, False)
        translations(e, {'label': 250})
        num(e, 'y', 0, doc['height'])
        num(e, 'height', 1, doc['height'])
        for side in ('start', 'end'):
            if side + 'Y' in e:
                num(e, side + 'Y', -4000, 8000)
            endpoint = text(e, side + 'BarId', 80, False)
            axis = e.get(side + 'Axis', '')
            if axis not in ('', 'top', 'bottom') or (axis and endpoint):
                raise ValueError('Choose either an axis or a time bar for each event endpoint.')
            if endpoint:
                bar = bar_ids.get(endpoint)
                if not bar or not ordinal(bar['start']) <= ordinal(e['year']) <= ordinal(bar['end']):
                    raise ValueError('Both event endpoints must exist at the event year.')
            if e.get(side + 'Edge', 'center') not in ('top', 'center', 'bottom'):
                raise ValueError('Invalid event endpoint alignment.')
        num(e, 'width', .25, 20)
        color(e, 'color')
        if e.get('layer') not in ('under', 'over'):
            raise ValueError('Invalid event line layer.')
    return doc
