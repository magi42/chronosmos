import copy
import pytest
from chronosmos.sample import sample


def document():
    doc = sample()
    doc['bars'][0]['heightPeriods'] = [dict(id='p1', start=-100, end=100, height=72)]
    doc['branches'] = [dict(id='branch1', fromBarId='egypt', toBarId='jewish', fromYear=-1, toYear=1)]
    return doc


@pytest.mark.parametrize('mutation', [
    lambda d: d['bars'][0]['heightPeriods'][0].update(start=0),
    lambda d: d['bars'][0]['heightPeriods'][0].update(end=-100),
    lambda d: d['bars'][0]['heightPeriods'][0].update(height=0),
    lambda d: d['bars'][0]['heightPeriods'][0].update(start=-1001),
    lambda d: d['bars'][0]['heightPeriods'].append(dict(id='p2',start=1,end=200,height=40)),
    lambda d: d['bars'][0]['heightPeriods'].append(dict(id='p1',start=200,end=300,height=40)),
    lambda d: d['bars'][0].update(heightPeriods={}),
    lambda d: d['branches'][0].update(toBarId='egypt'),
    lambda d: d['branches'][0].update(toBarId='missing'),
    lambda d: d['branches'][0].update(fromYear=0),
    lambda d: d['branches'][0].update(fromYear=500),
    lambda d: d['branches'][0].update(toYear=2027),
    lambda d: d['branches'][0].update(id='egypt'),
    lambda d: d.update(branches={}),
])
def test_invalid_temporal_geometry_is_rejected(client, auth, mutation):
    doc = document()
    mutation(doc)
    assert client.post('/api/timelines', json=doc, headers=auth).status_code == 400


def test_height_periods_and_arbitrary_branches_survive_publication(client, auth):
    doc = document()
    doc['bars'][0]['heightPeriods'].append(dict(id='p2',start=200,end=300,height=20))
    doc['branches'].append(dict(id='same-year',fromBarId='egypt',toBarId='jewish',fromYear=1,toYear=1))
    doc['branches'].append(dict(id='reverse',fromBarId='jewish',toBarId='egypt',fromYear=300,toYear=-300))
    created = client.post('/api/timelines',json=doc,headers=auth)
    assert created.status_code == 201
    ident = created.json['id']
    assert client.get(f'/api/timelines/{ident}?editor=1').json['document'] == doc
    result = client.post(f'/api/timelines/{ident}/publish',json=dict(published=True,revision=1),headers=auth)
    assert result.status_code == 200
    assert client.get(f'/api/timelines/{ident}').json['document'] == doc


@pytest.mark.parametrize('mutation', [
    lambda d: d['bars'][0].update(heightAlignment='invalid'),
    lambda d: d['events'][0].update(endBarId='missing'),
    lambda d: d['events'][0].update(endBarId='egypt',year=2026),
    lambda d: d['events'][0].update(endEdge='invalid'),
    lambda d: d['events'][0].update(endY=float('inf')),
    lambda d: d.update(timeUnit='invalid'),
    lambda d: d.update(start=-10**12-1),
    lambda d: d.update(mmPerYear=1e-13),
])
def test_invalid_new_scale_and_endpoint_settings(client, auth, mutation):
    doc = document()
    mutation(doc)
    assert client.post('/api/timelines', json=doc, headers=auth).status_code == 400


def test_geological_scale_alignment_and_event_targets_survive_publication(client, auth):
    doc = document()
    doc.update(start=-4500000000, timeUnit='millions', mmPerYear=1e-8)
    doc['bars'][0].update(start=-65000000, heightAlignment='bottom')
    doc['events'][0].update(year=-1, endBarId='egypt', endEdge='center')
    created = client.post('/api/timelines', json=doc, headers=auth)
    assert created.status_code == 201
    ident = created.json['id']
    assert client.post(f'/api/timelines/{ident}/publish', json=dict(published=True,revision=1), headers=auth).status_code == 200
    assert client.get(f'/api/timelines/{ident}').json['document'] == doc


def test_manage_preserves_only_timeline_parameter_through_login(client):
    response = client.get('/manage?timeline=example&next=https://example.com')
    assert response.location == '/manage/login?timeline=example'
    client.get(response.location)
    with client.session_transaction() as session:
        token = session['csrf']
    response = client.post('/manage/login?timeline=example&next=https://example.com', data=dict(username='editor',password='a long test password',csrf=token))
    assert response.location == '/manage?timeline=example'
    assert b'id="timeline-chooser"' in client.get('/manage').data


@pytest.mark.parametrize('mutation', [
    lambda d: d.update(labelInterval=-1),
    lambda d: d.update(labelInterval=100.5),
    lambda d: d.update(minorTickInterval=True),
    lambda d: d.update(minorTickInterval=2*10**12+1),
    lambda d: d.update(majorGrid='true'),
    lambda d: d['events'][0].update(startBarId='missing'),
    lambda d: d['events'][0].update(startBarId='egypt',year=2026),
    lambda d: d['events'][0].update(startAxis='invalid'),
    lambda d: d['events'][0].update(endAxis='invalid'),
    lambda d: d['events'][0].update(startAxis='top',startBarId='egypt'),
    lambda d: d['events'][0].update(endAxis='bottom',endBarId='egypt'),
    lambda d: d['events'][0].update(startEdge='invalid'),
])
def test_invalid_axis_settings_and_event_sources_are_rejected(client, auth, mutation):
    doc = document()
    mutation(doc)
    assert client.post('/api/timelines', json=doc, headers=auth).status_code == 400


@pytest.mark.parametrize('source,target', [('top','bottom'), ('bottom','top'), ('egypt','bottom'), ('top','jewish'), ('egypt','jewish')])
def test_independent_event_endpoints_and_axis_settings_survive_publication(client, auth, source, target):
    doc = document()
    doc.update(labelInterval=1000,minorTickInterval=100,majorGrid=True)
    event = doc['events'][0]
    event.update(year=-1)
    for side, value in [('start',source),('end',target)]:
        event[side + ('Axis' if value in ('top','bottom') else 'BarId')] = value
    created = client.post('/api/timelines',json=doc,headers=auth)
    assert created.status_code == 201
    ident = created.json['id']
    assert client.post(f'/api/timelines/{ident}/publish',json=dict(published=True,revision=1),headers=auth).status_code == 200
    assert client.get(f'/api/timelines/{ident}').json['document'] == doc


@pytest.mark.parametrize('mutation', [
    lambda d: d.update(start=-10**500),
    lambda d: d['events'][0].update(labelPosition='invalid'),
    lambda d: d['events'][0].update(labelPosition='free'),
    lambda d: d['events'][0].update(labelPosition='free',labelY=float('nan')),
    lambda d: d['bars'][0].update(captionPosition='invalid'),
    lambda d: d['bars'][0].update(captionFontSize=0),
    lambda d: d['bars'][0].update(captionFontSize=True),
    lambda d: d['bars'][0].update(captionOffsetX=3000),
    lambda d: d['bars'][0].update(captionColor='red'),
])
def test_invalid_caption_settings_are_rejected(client, auth, mutation):
    doc = document();mutation(doc)
    assert client.post('/api/timelines',json=doc,headers=auth).status_code == 400


def test_caption_positions_and_sizes_survive_publication(client, auth):
    doc=document()
    doc['bars'][0].update(captionPosition='free',captionYear=2500,captionFontSize=24,captionOffsetX=40,captionOffsetY=-30,captionColor='#223344')
    doc['events'][0].update(labelPosition='free',labelY=450,labelOffsetX=30)
    result=client.post('/api/timelines',json=doc,headers=auth)
    assert result.status_code == 201
    ident=result.json['id']
    client.post(f'/api/timelines/{ident}/publish',json=dict(published=True,revision=1),headers=auth)
    assert client.get(f'/api/timelines/{ident}').json['document'] == doc


def joined_document():
    doc=sample()
    doc['joinedPeriods']=[dict(id='join1',fromBarId='egypt',toBarId='jewish',start=-100,end=100,transitionYears=30)]
    return doc


@pytest.mark.parametrize('mutation',[
    lambda d: d['joinedPeriods'][0].update(start=0),
    lambda d: d['joinedPeriods'][0].update(end=-100),
    lambda d: d['joinedPeriods'][0].update(start=-2000),
    lambda d: d['joinedPeriods'][0].update(toBarId='egypt'),
    lambda d: d['joinedPeriods'][0].update(fromBarId='missing'),
    lambda d: d['joinedPeriods'][0].update(transitionYears=0),
    lambda d: d['joinedPeriods'][0].update(transitionYears=101),
    lambda d: d['joinedPeriods'][0].update(id='egypt'),
    lambda d: d['joinedPeriods'].append(dict(id='join2',fromBarId='jewish',toBarId='christian',start=1,end=150,transitionYears=10)),
    lambda d: d['bars'][0].update(mergeInto='jewish',mergeYears=600),
    lambda d: d.update(joinedPeriods={}),
])
def test_invalid_joined_periods(client,auth,mutation):
    doc=joined_document();mutation(doc)
    assert client.post('/api/timelines',json=doc,headers=auth).status_code == 400


def test_joined_periods_preserved_in_draft_and_public_snapshot(client,auth):
    doc=joined_document()
    result=client.post('/api/timelines',json=doc,headers=auth)
    assert result.status_code == 201
    ident=result.json['id']
    assert client.post(f'/api/timelines/{ident}/publish',json=dict(published=True,revision=1),headers=auth).status_code == 200
    assert client.get(f'/api/timelines/{ident}').json['document'] == doc
