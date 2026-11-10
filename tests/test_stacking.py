import pytest
from chronosmos.sample import sample


@pytest.mark.parametrize('value', [True, False, None, '1', .5, 1.0, 1000001, -1000001, float('nan'), float('inf')])
def test_invalid_stacking_order_is_rejected(client, auth, value):
    doc=sample();doc['bars'][0]['zIndex']=value
    assert client.post('/api/timelines',json=doc,headers=auth).status_code==400


def test_bar_stacking_persists_without_reordering_composition_or_changing_public_draft_isolation(client,auth):
    doc=sample();order=[b['id'] for b in doc['bars']]
    doc['bars'][0]['zIndex']=1000000
    doc['bars'][1]['zIndex']=-1000000
    made=client.post('/api/timelines',json=doc,headers=auth)
    assert made.status_code==201,made.json
    ident=made.json['id']
    assert client.post(f'/api/timelines/{ident}/publish',json=dict(published=True,revision=1),headers=auth).status_code==200
    public=client.get(f'/api/timelines/{ident}').json
    assert public['document']==doc
    doc['bars'][0]['zIndex']=-1
    saved=client.put(f'/api/timelines/{ident}',json=dict(document=doc,revision=public['revision']),headers=auth)
    assert saved.status_code==200
    draft=client.get(f'/api/timelines/{ident}?editor=1').json['document']
    assert [b['id'] for b in draft['bars']]==order
    assert draft['bars'][0]['zIndex']==-1
    assert client.get(f'/api/timelines/{ident}').json['document']['bars'][0]['zIndex']==1000000
