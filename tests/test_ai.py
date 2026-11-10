import copy
import io
import json
import pytest
from chronosmos import ai, db
from chronosmos.sample import sample

URL = 'https://www.britannica.com/event/Renaissance'

def response():
    return dict(id='resp_test',status='completed',output=[
        dict(type='web_search_call',action=dict(type='search',sources=[dict(url=URL)])),
        dict(type='message',content=[dict(type='output_text',text=json.dumps(dict(
            title='Renaissance',description='A researched interval.',translations={'fi':{'title':'Renessanssi','description':'Tutkittu ajanjakso'}},bars=[dict(id='renaissance',label='Renaissance',start=1300,end=1600,translations={'fi':{'label':'Renessanssi'}},note='Approximate conventional period; endpoints differ by region.',sources=[dict(url=URL,title='Renaissance — Britannica')])])))]),
    ])


def test_ai_requires_login_csrf_and_key(client, auth):
    assert client.get('/api/ai/status').json['configured'] is False
    assert client.post('/api/ai/jobs',json={'prompt':'Research Renaissance'}).status_code == 403
    assert client.post('/api/ai/jobs',json={'prompt':'Research Renaissance'},headers=auth).status_code == 503
    client.post('/api/logout',headers=auth)
    assert client.get('/api/ai/status').status_code == 401
    assert client.get('/api/ai/jobs/unknown').status_code == 401


def test_background_jobs_are_owned_additive_and_keep_key_server_side(client, auth, app, monkeypatch):
    app.config['OPENAI_API_KEY'] = 'private-test-token'
    calls = []
    def upstream(key, path='', payload=None):
        assert key == 'private-test-token'
        calls.append((path, payload))
        if payload:
            return dict(id='resp_test',status='queued')
        from urllib.parse import urlsplit, parse_qs
        assert urlsplit(path).path == '/resp_test'
        assert parse_qs(urlsplit(path).query) == {'include[]': ['web_search_call.action.sources']}
        return response()
    monkeypatch.setattr(ai,'api_request',upstream)
    doc = sample()
    result = client.post('/api/ai/jobs',json=dict(prompt='Research the Renaissance dates with sources',document=doc),headers=auth)
    assert result.status_code == 202
    job = result.json['job']
    payload = calls[0][1]
    assert payload['model'] == 'gpt-6.1-sol'
    assert payload['background'] and payload['store'] is False
    assert payload['tool_choice'] == 'required' and payload['tools'] == [{'type':'web_search'}]
    assert payload['text']['format']['strict']
    context = json.loads(payload['input'])['existing_timeline']
    assert set(context) == {'title','description','start','end','bars','overlays','events','joinedPeriods','translations'}
    assert not any('research' in b or 'mediaId' in b for b in context['bars'])
    assert client.post('/api/ai/jobs',json={'prompt':'Another research request'},headers=auth).status_code == 409
    assert client.get('/api/ai/status').json['job'] == job
    # Another editor cannot access a job even with its opaque id.
    with app.app_context():
        db.execute('INSERT INTO users (username,password_hash) VALUES (?,?)',('other','unused'))
        db.connect().commit()
    with app.test_client() as other:
        with other.session_transaction() as session:
            session.update(username='other',user_version=1)
        assert other.get('/api/ai/jobs/'+job).status_code == 404
    result = client.get('/api/ai/jobs/'+job)
    assert result.json['status'] == 'completed'
    assert result.json['proposal']['bars'][0]['research']['sources'][0]['url'] == URL
    assert 'private-test-token' not in result.text
    assert len(client.get('/api/timelines?editor=1').json) == 0
    # Completed proposals are cached, not billed/retrieved repeatedly.
    count = len(calls)
    assert client.get('/api/ai/jobs/'+job).json == result.json
    assert len(calls) == count
    again=client.post('/api/ai/jobs',json=dict(prompt='Another sourced timeline request',document=doc),headers=auth)
    assert again.status_code==202
    with app.app_context():
        assert db.execute('SELECT count(*) AS n FROM ai_job_context').fetchone()['n']==1
        assert db.execute('SELECT job_id FROM ai_job_context').fetchone()['job_id']==again.json['job']


@pytest.mark.parametrize('mutation',[
    lambda r: r.update(status='incomplete'),
    lambda r: r['output'].pop(0),
    lambda r: r['output'][0]['action'].update(sources=[]),
    lambda r: r['output'][1]['content'][0].update(text='not json'),
])
def test_unresearched_or_incomplete_proposals_are_rejected(mutation):
    value=response(); mutation(value)
    with pytest.raises(ai.AIError): ai.proposal(value)


@pytest.mark.parametrize('mutation',[
    lambda b: b.update(start=0), lambda b: b.update(end=1200),
    lambda b: b.update(start=True),lambda b: b.update(start=-10**13),
    lambda b: b.update(sources=[]),
    lambda b: b['sources'][0].update(url='https://invented.example/source'),
    lambda b: b['sources'][0].update(url='javascript:alert(1)'),
])
def test_dates_and_per_bar_sources_are_validated(mutation):
    value=response(); content=value['output'][1]['content'][0]
    data=json.loads(content['text']); mutation(data['bars'][0]);content['text']=json.dumps(data)
    with pytest.raises(ai.AIError): ai.proposal(value)


def test_upstream_error_is_sanitized(monkeypatch):
    from urllib.error import HTTPError
    def fail(*args,**kwargs):
        raise HTTPError('https://api.openai.com',401,'private secret',{},io.BytesIO(b'private token'))
    monkeypatch.setattr(ai,'urlopen',fail)
    with pytest.raises(ai.AIError) as error: ai.api_request('private token')
    assert 'private' not in str(error.value)


def test_research_metadata_validates_and_roundtrips_in_package(client,auth):
    doc=sample()
    bar=doc['bars'][0]
    bar['research']=dict(model=ai.MODEL,checkedAt='2026-11-10',note='Approximate dates',sources=[dict(url=URL,title='Reference')])
    doc['joinedPeriods']=[dict(id='joined',fromBarId='egypt',toBarId='jewish',start=-100,end=100,transitionYears=30)]
    result=client.post('/api/packages/export',json=doc,headers=auth)
    assert result.status_code == 200
    imported=client.post('/api/packages/import',data={'file':(io.BytesIO(result.data),'timeline.zip')},headers=auth)
    assert imported.status_code == 201
    saved=client.get('/api/timelines/'+imported.json['id']+'?editor=1').json['document']
    assert saved['bars'][0]['research'] == bar['research']
    assert saved['joinedPeriods'] == doc['joinedPeriods']
    bar['research']['sources'][0]['url']='javascript:alert(1)'
    assert client.post('/api/timelines',json=doc,headers=auth).status_code == 400


def graph_value():
    source = [dict(url=URL,title='Fixture chronology source')]
    def bar(ident,label,start,end,fi):
        return dict(id=ident,label=label,start=start,end=end,translations={'fi':{'label':fi}},note='Fixture date note',sources=source)
    return dict(title='Relationships',description='A sourced relationship timeline',translations={'fi':{'title':'Ihmissuhteet','description':'Lähteistetty ihmissuhdeaikajana'}},
        bars=[bar('person','Main person',1800,1870,'Päähenkilö'),bar('partner','Partner',1805,1880,'Puoliso')],
        joinedPeriods=[dict(id='marriage',fromBarId='person',toBarId='partner',start=1820,end=1840,note='Marriage interval',sources=source)],
        events=[dict(id='wedding',label='Wedding',year=1820,startBarId='person',endBarId='partner',translations={'fi':{'label':'Häät'}},note='Marriage event',sources=source),
                dict(id='milestone',label='Personal milestone',year=1850,startBarId='',endBarId='person',translations={'fi':{'label':'Henkilökohtainen merkkipaalu'}},note='Individual event',sources=source)],
        translationUpdates=[])


def graph_response(value=None):
    r=response()
    r['output'][1]['content'][0]['text']=json.dumps(value if value is not None else graph_value())
    return r


def test_relationships_compile_to_joined_periods_anchored_events_and_translations(client,auth):
    p=ai.proposal(graph_response())
    assert p['translations']['fi']['title']=='Ihmissuhteet'
    a,b=p['bars']
    assert a['id']!='person' and b['id']!='partner'
    assert a['translations']['fi']['label']=='Päähenkilö'
    join=p['joinedPeriods'][0]
    assert (join['fromBarId'],join['toBarId'])==(a['id'],b['id'])
    assert join['transitionYears']==5
    wedding,individual=p['events']
    assert wedding['startBarId']==a['id'] and wedding['endBarId']==b['id']
    assert individual['startAxis']=='top' and individual['endBarId']==a['id']
    assert wedding['translations']['fi']['label']=='Häät'
    doc=sample()
    doc.update(title=p['title'],description=p['description'],translations=p['translations'],**p['bounds'])
    for kind in ('bars','joinedPeriods','events'):doc[kind]=p[kind]
    doc['overlays']=[];doc['branches']=[]
    created=client.post('/api/timelines',json=doc,headers=auth)
    assert created.status_code==201,created.json
    ident=created.json['id']
    assert client.post(f'/api/timelines/{ident}/publish',json=dict(published=True,revision=1),headers=auth).status_code==200
    assert client.get(f'/api/timelines/{ident}').json['document']==doc


@pytest.mark.parametrize('mutate',[
    lambda v:v['joinedPeriods'][0].update(toBarId='missing'),
    lambda v:v['joinedPeriods'][0].update(start=1790),
    lambda v:v['joinedPeriods'].append(dict(v['joinedPeriods'][0],id='overlap',start=1830,end=1850)),
    lambda v:v['events'][0].update(year=1790),
    lambda v:v['events'][0].update(endBarId='missing'),
    lambda v:v['bars'][1].update(id='person'),
    lambda v:v['events'][0]['sources'][0].update(url='https://invented.example/source'),
])
def test_ai_connections_require_valid_dates_references_and_searched_sources(mutate):
    value=graph_value();mutate(value)
    with pytest.raises(ai.AIError):ai.proposal(graph_response(value))


def test_existing_bars_can_be_connected_without_adding_bars():
    doc=sample();v=graph_value();v['bars']=[]
    v['joinedPeriods'][0].update(fromBarId='egypt',toBarId='jewish',start=-100,end=100)
    v['events']=v['events'][:1];v['events'][0].update(startBarId='egypt',endBarId='jewish',year=-1)
    p=ai.proposal(graph_response(v),doc)
    assert p['bars']==[] and p['joinedPeriods'][0]['fromBarId']=='egypt'
    assert p['events'][0]['year']==-1


def test_translation_only_fills_missing_fields_and_preserves_authored_translations():
    doc=sample();doc['translations']={'fi':{'title':'Kirjoitettu otsikko'}}
    doc['bars'][0]['translations']={'fi':{'label':'Oma nimi'}}
    v=graph_value();v.update(bars=[],joinedPeriods=[],events=[])
    v['translationUpdates']=[
        dict(kind='timeline',id='',language='fi',fields=[dict(field='title',text='Changed'),dict(field='description',text='Uusi kuvaus')]),
        dict(kind='bars',id=doc['bars'][0]['id'],language='fi',fields=[dict(field='label',text='Changed')]),
        dict(kind='overlays',id=doc['overlays'][0]['id'],language='fi',fields=[dict(field='text',text='Suomennettu teksti')]),
    ]
    r=graph_response(v);r['output'].pop(0)
    p=ai.proposal(r,doc,'translate')
    assert len(p['translationUpdates'])==2
    assert p['translationUpdates'][0]['fields']==[dict(field='description',text='Uusi kuvaus')]
    assert doc['translations']['fi']['title']=='Kirjoitettu otsikko'
    assert doc['bars'][0]['translations']['fi']['label']=='Oma nimi'
    v['translationUpdates'][0]['fields'][0]['field']='password'
    with pytest.raises(ai.AIError):ai.proposal(graph_response(v),doc,'translate')


def test_translation_mode_has_no_web_tools_and_rejects_dated_additions(monkeypatch):
    calls=[]
    monkeypatch.setattr(ai,'api_request',lambda key,path='',payload=None:(calls.append(payload) or dict(id='resp_translation',status='queued')))
    ai.start('private-test-token','Fill missing Finnish translations',sample(),'translate')
    assert 'tools' not in calls[0] and 'tool_choice' not in calls[0]
    assert calls[0]['text']['format']['schema']['properties']['translationUpdates']
    assert 'mediaId' not in calls[0]['input']
    with pytest.raises(ai.AIError):ai.proposal(graph_response(),sample(),'translate')


def test_new_ai_caption_translations_are_required_by_default():
    v=graph_value();v['bars'][0]['translations']['fi']['label']=''
    with pytest.raises(ai.AIError):ai.proposal(graph_response(v))
