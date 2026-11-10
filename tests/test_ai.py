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
            title='Renaissance',description='A researched interval.',bars=[dict(label='Renaissance',start=1300,end=1600,note='Approximate conventional period; endpoints differ by region.',sources=[dict(url=URL,title='Renaissance — Britannica')])])))]),
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
    assert set(context) == {'title','start','end','bars'}
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
    assert result.json['proposal']['bars'][0]['sources'][0]['url'] == URL
    assert 'private-test-token' not in result.text
    assert len(client.get('/api/timelines?editor=1').json) == 0
    # Completed proposals are cached, not billed/retrieved repeatedly.
    count = len(calls)
    assert client.get('/api/ai/jobs/'+job).json == result.json
    assert len(calls) == count


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
