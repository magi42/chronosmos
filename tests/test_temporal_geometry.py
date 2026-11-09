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
