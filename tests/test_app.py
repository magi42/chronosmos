import copy
import io
import json
import pytest
from PIL import Image
from chronosmos import db
from chronosmos.model import ordinal, validate
from chronosmos.sample import sample


def create(client, auth, doc=None):
    response = client.post('/api/timelines', json=doc or sample(), headers=auth)
    assert response.status_code == 201, response.json
    return response.json['id']


def publish(client, auth, ident, revision=1):
    response = client.post(f'/api/timelines/{ident}/publish', json=dict(published=True, revision=revision), headers=auth)
    assert response.status_code == 200, response.json
    return response.json['revision']


def test_authentication_and_csrf(client, auth):
    assert client.get('/manage').status_code == 200
    assert client.post('/api/timelines', json=sample()).status_code == 403
    client.post('/api/logout', headers=auth)
    assert client.get('/manage').location.endswith('/manage/login')
    assert client.get('/api/timelines?editor=1').status_code == 401
    assert client.get('/api/media').status_code == 401
    assert client.post('/api/timelines', json=sample(), headers=auth).status_code == 403


def test_draft_publish_save_isolation_and_path_changes(client, auth, app):
    ident = create(client, auth)
    anonymous = app.test_client()
    assert anonymous.get('/api/timelines').json == []
    assert anonymous.get(f'/api/timelines/{ident}').status_code == 404
    revision = publish(client, auth, ident)
    assert anonymous.get('/traditions').status_code == 200
    doc = sample()
    doc.update(title='New title', slug='history/traditions')
    saved = client.put(f'/api/timelines/{ident}', json=dict(document=doc, revision=revision), headers=auth)
    assert saved.status_code == 200
    assert anonymous.get(f'/api/timelines/{ident}').json['document']['title'] != 'New title'
    assert anonymous.get('/traditions').status_code == 200
    assert anonymous.get('/history/traditions').status_code == 404
    publish(client, auth, ident, saved.json['revision'])
    assert anonymous.get('/traditions').status_code == 404
    assert anonymous.get('/history/traditions').status_code == 200
    assert anonymous.get(f'/api/timelines/{ident}').json['document']['title'] == 'New title'


def test_stale_saves_and_publish_are_rejected(client, auth):
    ident = create(client, auth)
    doc = sample()
    doc['title'] = 'First edit'
    assert client.put(f'/api/timelines/{ident}', json=dict(document=doc, revision=1), headers=auth).status_code == 200
    doc['title'] = 'Stale edit'
    assert client.put(f'/api/timelines/{ident}', json=dict(document=doc, revision=1), headers=auth).status_code == 409
    assert client.post(f'/api/timelines/{ident}/publish', json=dict(published=True, revision=1), headers=auth).status_code == 409
    assert client.get(f'/api/timelines/{ident}?editor=1').json['document']['title'] == 'First edit'


def test_paths_remain_reserved_until_republish(client, auth):
    ident = create(client, auth)
    revision = publish(client, auth, ident)
    doc = sample()
    doc['slug'] = 'new-path'
    assert client.put(f'/api/timelines/{ident}', json=dict(document=doc, revision=revision), headers=auth).status_code == 200
    assert client.post('/api/timelines', json=sample(), headers=auth).status_code == 409
    publish(client, auth, ident, revision+1)
    assert client.post('/api/timelines', json=sample(), headers=auth).status_code == 201


def test_unpublish_and_delete(client, auth, app):
    ident = create(client, auth)
    rev = publish(client, auth, ident)
    assert client.post(f'/api/timelines/{ident}/publish', json=dict(published=False, revision=rev), headers=auth).status_code == 200
    assert app.test_client().get('/traditions').status_code == 404
    assert client.get(f'/api/timelines/{ident}?editor=1').status_code == 200
    assert client.delete(f'/api/timelines/{ident}', json=dict(revision=rev+1), headers=auth).status_code == 200
    assert client.get(f'/api/timelines/{ident}?editor=1').status_code == 404


@pytest.mark.parametrize('mutation', [
    lambda d: d.update(start=0),
    lambda d: d.update(end=-1000),
    lambda d: d.update(mmPerYear=-1),
    lambda d: d.update(background='red" onload="alert(1)'),
    lambda d: d.update(slug='manage/login'),
    lambda d: d.update(slug='../x'),
    lambda d: d['bars'][0].update(start=1.5),
    lambda d: d['bars'][0].update(mergeInto='missing'),
    lambda d: d['bars'][2].update(mergeInto='missing'),
    lambda d: d['bars'][0].update(mergeInto=['invalid']),
    lambda d: d['bars'][0].update(id='bad"identifier'),
    lambda d: d['bars'][0].update(fadeIn=float('nan')),
    lambda d: d['bars'][0].update(y=-3),
    lambda d: d['overlays'][0].update(type='html'),
    lambda d: d['events'][0].update(width=0),
])
def test_invalid_documents_rejected(client, auth, mutation):
    doc = sample()
    mutation(doc)
    response = client.post('/api/timelines', json=doc, headers=auth)
    assert response.status_code == 400, response.json


def test_years_and_merge_cycles():
    assert ordinal(1) - ordinal(-1) == 1
    with pytest.raises(ValueError):
        ordinal(0)
    doc = sample()
    doc['bars'][1].update(mergeInto='roman', end=100)
    doc['bars'][2].update(mergeInto='greek', end=100)
    with pytest.raises(ValueError, match='cycle'):
        validate(doc)


def upload_image(client, auth):
    output = io.BytesIO()
    Image.new('RGB', (80, 40), 'red').save(output, 'PNG')
    output.seek(0)
    response = client.post('/api/media', data={'file': (output, 'example.png')}, headers=auth)
    assert response.status_code == 201
    return response.json


def test_media_publication_access_export_source_and_reference_protection(client, auth, app):
    media = upload_image(client, auth)
    path = f"/media/{media['id']}.png"
    assert client.get(path).status_code == 200
    anonymous = app.test_client()
    assert anonymous.get(path).status_code == 404
    doc = sample()
    overlay = copy.deepcopy(doc['overlays'][0])
    overlay.update(id='image', type='image', mediaId=media['id'])
    doc['overlays'].append(overlay)
    ident = create(client, auth, doc)
    assert client.delete('/api/media/'+media['id'], headers=auth).status_code == 409
    rev = publish(client, auth, ident)
    assert anonymous.get(path).status_code == 200
    assert anonymous.get(path).mimetype == 'image/png'
    doc['overlays'].pop()
    client.put(f'/api/timelines/{ident}', json=dict(document=doc, revision=rev), headers=auth)
    assert client.delete('/api/media/'+media['id'], headers=auth).status_code == 409
    publish(client, auth, ident, rev+1)
    assert anonymous.get(path).status_code == 404
    assert client.delete('/api/media/'+media['id'], headers=auth).status_code == 200


def test_reject_active_and_missing_media(client, auth):
    response = client.post('/api/media', data={'file': (io.BytesIO(b'<svg onload="alert(1)"/>'), 'x.svg')}, headers=auth)
    assert response.status_code == 400
    doc = sample()
    doc['overlays'][0].update(type='image', mediaId='a'*32)
    assert client.post('/api/validate', json=doc, headers=auth).status_code == 400


def test_login_rate_limit(client):
    client.get('/manage/login')
    with client.session_transaction() as s:
        token = s['csrf']
    for _ in range(10):
        response = client.post('/manage/login', data=dict(username='editor', password='incorrect', csrf=token))
        assert response.status_code == 200
    assert client.post('/manage/login', data=dict(username='editor', password='incorrect', csrf=token)).status_code == 429


def test_password_reset_and_removal_revoke_sessions(app, client, auth):
    runner = app.test_cli_runner()
    assert runner.invoke(args=['set-password', 'editor'], input='new long password\nnew long password\n').exit_code == 0
    assert client.get('/manage').status_code == 302
    with client.session_transaction() as session:
        token = session['csrf']
    assert client.post('/manage/login', data=dict(username='editor', password='new long password', csrf=token)).status_code == 302
    assert runner.invoke(args=['remove-user','editor']).exit_code == 0
    assert client.get('/manage').status_code == 302


def test_no_public_login_link_headers_and_health(client):
    response = client.get('/')
    assert b'/manage' not in response.data
    assert response.headers['X-Content-Type-Options'] == 'nosniff'
    assert "frame-ancestors 'none'" in response.headers['Content-Security-Policy']
    assert client.get('/healthz').json['status'] == 'ok'


def test_malformed_json_and_duplicate_ids(client, auth):
    doc = sample()
    doc['events'][0]['id'] = doc['bars'][0]['id']
    assert client.post('/api/validate', json=doc, headers=auth).status_code == 400
    ident = create(client, auth)
    assert client.put('/api/timelines/'+ident, json=[], headers=auth).status_code == 400
    assert client.post('/api/timelines/'+ident+'/publish', json=[], headers=auth).status_code == 400
    assert client.put('/api/timelines/'+ident, json=dict(document=sample(), revision='abc'), headers=auth).status_code == 400
    assert client.post('/api/timelines/'+ident+'/publish', json=dict(published='yes',revision=1), headers=auth).status_code == 400


def test_demo_is_opt_in_and_idempotent(app, client):
    runner = app.test_cli_runner()
    assert runner.invoke(args=['init-db']).exit_code == 0
    assert client.get('/api/timelines').json == []
    assert runner.invoke(args=['init-db', '--demo']).exit_code == 0
    assert runner.invoke(args=['init-db', '--demo']).exit_code == 0
    assert len(client.get('/api/timelines').json) == 1
