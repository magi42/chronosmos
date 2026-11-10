import pytest
from chronosmos.sample import sample


def brace():
    return dict(id='brace1',type='brace',year=-1,y=120,width=240,height=360,braceWidth=24,strokeWidth=2,
                text='A group',topText='Beginning',bottomText='End',fontSize=16,color='#315d50',fill='#ffffff',
                anchorBarId='egypt',offsetY=-20,translations={'fi':{'text':'Ryhmä','topText':'Alku','bottomText':'Loppu'}})


def test_annotations_survive_save_and_publication(client,auth):
    doc=sample()
    doc['bars'][0]['showCaption']=False
    doc['events'][0]['dotted']=True
    doc['overlays'].append(brace())
    created=client.post('/api/timelines',json=doc,headers=auth)
    assert created.status_code==201,created.json
    ident=created.json['id']
    assert client.get(f'/api/timelines/{ident}?editor=1').json['document']==doc
    assert client.post(f'/api/timelines/{ident}/publish',json=dict(published=True,revision=1),headers=auth).status_code==200
    assert client.get(f'/api/timelines/{ident}').json['document']==doc
    assert client.get(f'/api/timelines/{ident}').json['document']['bars'][0]['label']==doc['bars'][0]['label']


@pytest.mark.parametrize('mutate',[
    lambda d:d['bars'][0].update(showCaption='false'),
    lambda d:d['bars'][0].update(showCaption=0),
    lambda d:d['events'][0].update(dotted='true'),
    lambda d:d['events'][0].update(dotted=1),
    lambda d:d['overlays'][-1].update(braceWidth=0),
    lambda d:d['overlays'][-1].update(width=30),
    lambda d:d['overlays'][-1].update(strokeWidth=float('nan')),
    lambda d:d['overlays'][-1].update(topText=['invalid']),
    lambda d:d['overlays'][-1].update(translations={'fi':{'bottomText':'x'*4001}}),
])
def test_invalid_annotation_settings_are_rejected(client,auth,mutate):
    doc=sample();doc['overlays'].append(brace());mutate(doc)
    response=client.post('/api/timelines',json=doc,headers=auth)
    assert response.status_code==400,response.json
