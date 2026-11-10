"""Compile bounded AI additions into ordinary, validated timeline elements."""
import copy
from datetime import datetime, timezone
import re
import uuid

from .model import validate, ordinal
from .provenance import source_url


def obj(properties):
    return dict(type='object', properties=properties, required=list(properties), additionalProperties=False)


S = {'type': 'string'}
I = {'type': 'integer'}
SOURCES = {'type': 'array', 'items': obj({'url': S, 'title': S})}
LABEL_TRANSLATIONS = obj({'fi': obj({'label': S})})
SCHEMA = obj({
    'title': S, 'description': S,
    'translations': obj({'fi': obj({'title': S, 'description': S})}),
    'bars': {'type': 'array', 'items': obj({'id': S, 'label': S, 'start': I, 'end': I,
        'translations': LABEL_TRANSLATIONS, 'note': S, 'sources': SOURCES})},
    'joinedPeriods': {'type': 'array', 'items': obj({'id': S, 'fromBarId': S, 'toBarId': S,
        'start': I, 'end': I, 'note': S, 'sources': SOURCES})},
    'events': {'type': 'array', 'items': obj({'id': S, 'label': S, 'year': I,
        'startBarId': S, 'endBarId': S, 'translations': LABEL_TRANSLATIONS, 'note': S, 'sources': SOURCES})},
    'translationUpdates': {'type': 'array', 'items': obj({
        'kind': {'type': 'string', 'enum': ['timeline', 'bars', 'overlays', 'events']},
        'id': S, 'language': {'type': 'string', 'enum': ['fi']},
        'fields': {'type': 'array', 'items': obj({'field': {'type': 'string', 'enum': ['title', 'description', 'label', 'text', 'topText', 'bottomText']}, 'text': S})},
    })},
})


def model_context(doc):
    if doc is None:
        return None
    result = {k: doc[k] for k in ('title', 'description', 'start', 'end')}
    result['translations'] = doc.get('translations', {})
    fields = {
        'bars': ('id', 'label', 'start', 'end', 'mergeInto', 'mergeYears', 'translations'),
        'events': ('id', 'label', 'year', 'startBarId', 'endBarId', 'translations'),
        'overlays': ('id', 'type', 'text', 'topText', 'bottomText', 'translations'),
        'joinedPeriods': ('id', 'fromBarId', 'toBarId', 'start', 'end'),
    }
    for kind, keys in fields.items():
        result[kind] = [{k: item[k] for k in keys if k in item} for item in doc.get(kind, [])]
    return result


def require(condition):
    if not condition:
        raise ValueError('Invalid AI proposal.')


def text(value, limit, empty=True):
    require(isinstance(value, str) and len(value) <= limit and (empty or bool(value.strip())))
    return value


def compile_proposal(value, context, consulted, searched, model, mode='compose'):
    require(isinstance(value, dict))
    title = text(value.get('title'), 160)
    description = text(value.get('description'), 4000)
    bars, joins, events, patches = [value.get(k, []) for k in ('bars', 'joinedPeriods', 'events', 'translationUpdates')]
    for items, limit in ((bars, 12), (joins, 24), (events, 48), (patches, 1501)):
        require(isinstance(items, list) and len(items) <= limit)
    if bars or joins or events:
        require(searched and mode != 'translate')
    require(mode in ('compose', 'translate'))
    if mode == 'translate':
        require(context is not None)
    stamp = datetime.now(timezone.utc).isoformat()

    def research(item):
        note = text(item.get('note'), 4000)
        sources = item.get('sources')
        require(isinstance(sources, list) and 1 <= len(sources) <= 20)
        checked = []
        for source in sources:
            require(isinstance(source, dict) and source_url(source.get('url')) and source['url'] in consulted)
            checked.append(dict(url=source['url'], title=text(source.get('title'), 500, False)))
        return dict(model=model, checkedAt=stamp, note=note, sources=checked)

    def translated(item, fields):
        values = item.get('translations', {})
        require(isinstance(values, dict) and not set(values)-{'fi'})
        fi = values.get('fi', {})
        require(isinstance(fi, dict) and not set(fi)-set(fields))
        for key, limit in fields.items():
            if isinstance(item.get(key), str) and item[key].strip():
                text(fi.get(key), limit, False)
        return {'fi': {key: text(v, fields[key]) for key, v in fi.items()}}

    doc = copy.deepcopy(context) if context is not None else dict(
        version=1, title=title or 'AI timeline', description=description, slug='ai-proposal',
        start=-1000, end=datetime.now(timezone.utc).year, height=200,
        mmPerYear=.35, background='#faf8f2', scale='both', bars=[], overlays=[], events=[], joinedPeriods=[])
    doc.setdefault('joinedPeriods', [])
    bar_map = {b['id']: b['id'] for b in doc['bars']}
    used = {i['id'] for kind in ('bars', 'events', 'overlays', 'joinedPeriods', 'branches') for i in doc.get(kind, [])}
    references = set(used)

    def ident(item, fallback):
        ref = item.get('id', fallback)
        require(isinstance(ref, str) and re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', ref) and ref not in references)
        references.add(ref)
        return ref, uuid.uuid4().hex

    additions = []
    colors = ['#526a55', '#8d6550', '#5f6c83', '#876780', '#8a7e4f']
    for index, bar in enumerate(bars):
        require(isinstance(bar, dict))
        ref, new_id = ident(bar, 'new-bar-'+str(index))
        bar_map[ref] = new_id
        # Validate years before doing arithmetic or allocating coordinates.
        require(all(type(bar.get(k)) is int and 0 < abs(bar[k]) <= 10**12 for k in ('start', 'end')))
        require(ordinal(bar['start']) < ordinal(bar['end']))
        y = min(3940, max([100]+[b['y']+max(b['height'], 32)+32 for b in doc['bars']]))
        doc['height'] = max(doc['height'], min(4000, y+100))
        added = dict(id=new_id, label=text(bar.get('label'), 250, False), start=bar['start'], end=bar['end'],
                     y=y, height=32, background=colors[len(doc['bars']) % len(colors)], foreground='#ffffff',
                     fadeIn=0, fadeOut=0, mergeInto='', mergeYears=1,
                     translations=translated(bar, {'label': 250}), research=research(bar))
        additions.append(added)
        doc['bars'].append(added)
    joined = []
    for index, period in enumerate(joins):
        require(isinstance(period, dict))
        _, new_id = ident(period, 'new-join-'+str(index))
        require(all(type(period.get(k)) is int and 0 < abs(period[k]) <= 10**12 for k in ('start', 'end')))
        span = ordinal(period['end'])-ordinal(period['start'])
        require(span > 0)
        added = dict(id=new_id, fromBarId=bar_map[period['fromBarId']], toBarId=bar_map[period['toBarId']],
                     start=period['start'], end=period['end'], transitionYears=max(.01, span/4), research=research(period))
        joined.append(added)
        doc['joinedPeriods'].append(added)
    event_additions = []
    label_base = max([80]+[b['y']+max([b['height']]+[p['height'] for p in b.get('heightPeriods', [])]) for b in doc['bars']])+28
    if events:
        doc['height'] = max(doc['height'], min(4000, label_base+(len(events)-1)*22+90))
    for index, event in enumerate(events):
        require(isinstance(event, dict))
        _, new_id = ident(event, 'new-event-'+str(index))
        require(type(event.get('year')) is int and 0 < abs(event['year']) <= 10**12)
        added = dict(id=new_id, label=text(event.get('label'), 250, False), year=event['year'], y=80,
                     height=max(1, doc['height']-150), width=1.2, color='#6c7166', layer='over',
                     labelPosition='free', labelY=min(doc['height']-70, label_base+index*22),
                     translations=translated(event, {'label': 250}), research=research(event))
        for side, axis in [('start', 'top'), ('end', 'bottom')]:
            ref = event.get(side+'BarId', '')
            if ref:
                added[side+'BarId'] = bar_map[ref]
                added[side+'Edge'] = 'center'
            else:
                added[side+'Axis'] = axis
        event_additions.append(added)
        doc['events'].append(added)
    if additions:
        bounds = [b[k] for b in additions for k in ('start', 'end')]
        if context is not None:
            bounds += [doc['start'], doc['end']]
        doc['start'], doc['end'] = min(bounds, key=ordinal), max(bounds, key=ordinal)
        if context is None:
            doc['mmPerYear'] = max(1e-12, min(100, 800/(ordinal(doc['end'])-ordinal(doc['start']))))
    updates = []
    for patch in patches:
        require(isinstance(patch, dict) and patch.get('language') == 'fi')
        kind = patch.get('kind')
        require(kind in ('timeline', 'bars', 'events', 'overlays'))
        # Translation patches target only elements that existed when research began.
        target = context if kind == 'timeline' else next((i for i in (context or {}).get(kind, []) if i['id'] == patch.get('id')), None)
        require(target is not None)
        fields = {'title': 160, 'description': 4000} if kind == 'timeline' else {'text': 4000, 'topText': 4000, 'bottomText': 4000} if kind == 'overlays' else {'label': 250}
        if kind == 'overlays' and target.get('type') != 'brace':
            fields = {'text': 4000}
        require(isinstance(patch.get('fields'), list) and len(patch['fields']) <= len(fields))
        missing = []
        for field in patch['fields']:
            require(isinstance(field, dict))
            key = field.get('field')
            require(key in fields)
            content = text(field.get('text'), fields[key])
            if content.strip() and not target.get('translations', {}).get('fi', {}).get(key, '').strip():
                missing.append(dict(field=key, text=content))
        if missing:
            updates.append(dict(kind=kind, id=target.get('id', ''), language='fi', fields=missing))
    for patch in updates:
        target = doc if patch['kind'] == 'timeline' else next(i for i in doc[patch['kind']] if i['id'] == patch['id'])
        target.setdefault('translations', {}).setdefault('fi', {}).update({f['field']: f['text'] for f in patch['fields']})
    proposed_translations = translated(value, {'title': 160, 'description': 4000})
    if context is None:
        doc['translations'] = proposed_translations
    validate(doc)
    return dict(title=title, description=description, translations=proposed_translations,
                model=model, checkedAt=stamp, bars=additions, joinedPeriods=joined,
                events=event_additions, translationUpdates=updates,
                bounds={k: doc[k] for k in ('start', 'end', 'height', 'mmPerYear')})
