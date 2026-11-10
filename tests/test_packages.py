import copy
import io
import json
import stat
import zipfile
from pathlib import Path

import pytest
from PIL import Image

from chronosmos.sample import sample
from chronosmos import db


def png():
    output = io.BytesIO()
    Image.new('RGB', (80, 40), '#315d50').save(output, 'PNG')
    return output.getvalue()


def package_bytes(doc, resources=None, extra=None, format_name="chronosmos-package"):
    output = io.BytesIO()
    resources = resources or []
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('manifest.json', json.dumps(dict(format=format_name,version=1,media=[dict(id=i,path=f'media/{i}.png',name='An illustration') for i, _ in resources])))
        archive.writestr('timeline.json', json.dumps(doc))
        for ident, content in resources:
            archive.writestr(f'media/{ident}.png', content)
        if extra:
            if isinstance(extra[0], str) and extra[0] in archive.namelist():
                with pytest.warns(UserWarning):
                    archive.writestr(*extra)
            else:
                archive.writestr(*extra)
    return output.getvalue()


def import_package(client, auth, content):
    return client.post('/api/packages/import', data={'file': (io.BytesIO(content), 'timeline.chronosmos.zip')}, headers=auth)


def illustrated():
    doc = sample()
    ident = 'a'*32
    doc['overlays'].append(dict(doc['overlays'][0],id='picture',type='image',mediaId=ident))
    return doc, ident


def test_package_roundtrip_preserves_all_settings_and_media_without_overwriting(client, auth, app):
    uploaded = client.post('/api/media',data={'file':(io.BytesIO(png()),'test.png')},headers=auth).json
    doc = sample()
    doc['overlays'].append(dict(doc['overlays'][0],id='picture',type='image',mediaId=uploaded['id']))
    doc['overlays'].append(dict(doc['overlays'][-1],id='same-picture'))
    doc.update(labelInterval=1000,minorTickInterval=100,majorGrid=True,translations={'fi':{'title':'Aikajana'}})
    doc['events'][0].update(labelPosition='free',labelY=250,labelOffsetX=-20)
    doc['bars'][0].update(captionPosition='right',captionFontSize=22,captionColor='#223344',showCaption=False)
    doc['events'][0]['dotted']=True
    doc['bars'][0]['zIndex']=7
    doc['bars'][1]['zIndex']=-2
    doc['overlays'].append(dict(id='brace1',type='brace',year=-1,y=100,width=240,height=300,text='Group',topText='Top',bottomText='Bottom',color='#223344',fill='#ffffff',fontSize=14,braceWidth=24,strokeWidth=2,translations={'fi':{'text':'Ryhmä','topText':'Alku','bottomText':'Loppu'}}))
    created = client.post('/api/timelines',json=doc,headers=auth).json
    original = created['id']
    response = client.post('/api/packages/export',json=doc,headers=auth)
    assert response.status_code == 200
    assert response.mimetype == 'application/zip'
    content = response.data
    response.close()
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        assert set(archive.namelist()) == {'manifest.json','timeline.json',f'media/{uploaded["id"]}.png'}
        assert json.loads(archive.read('timeline.json')) == doc
        assert Image.open(io.BytesIO(archive.read(f'media/{uploaded["id"]}.png'))).size == (80,40)
    for suffix in ('2','3'):
        result = import_package(client,auth,content)
        assert result.status_code == 201, result.json
        imported = result.json
        assert imported['id'] != original and imported['revision'] == 1 and imported['published'] is False
        expected = copy.deepcopy(doc)
        expected.update(title=doc['title']+f' ({suffix})',slug=doc['slug']+'-'+suffix)
        mapped = next(o['mediaId'] for o in imported['document']['overlays'] if o['type']=='image')
        assert mapped != uploaded['id']
        for overlay in expected['overlays']:
            if overlay['type'] == 'image':
                overlay['mediaId'] = mapped
        assert imported['document'] == expected
        assert imported['mediaCount'] == 1
        assert client.get(f'/media/{mapped}.png').status_code == 200
        assert app.test_client().get(f'/media/{mapped}.png').status_code == 404
    assert client.get(f'/api/timelines/{original}?editor=1').json['document'] == doc
    assert client.get(f'/api/timelines/{original}?editor=1').json['revision'] == 1


def test_public_package_uses_only_published_snapshot_and_its_media(client, auth, app):
    doc = sample()
    original = client.post('/api/timelines',json=doc,headers=auth).json['id']
    public = app.test_client()
    assert public.get(f'/api/timelines/{original}/package').status_code == 404
    client.post(f'/api/timelines/{original}/publish',json=dict(published=True,revision=1),headers=auth)
    changed = copy.deepcopy(doc)
    changed['title'] = 'Private draft title'
    changed['slug'] = 'renamed-draft'
    client.put(f'/api/timelines/{original}',json=dict(document=changed,revision=2),headers=auth)
    response = public.get(f'/api/timelines/{original}/package')
    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.data)) as archive:
        assert json.loads(archive.read('timeline.json')) == doc
    response.close()
    imported = import_package(client,auth,package_bytes(doc)).json['document']
    assert imported['title'] == doc['title'] + ' (2)'
    assert imported['slug'] == doc['slug'] + '-2'


@pytest.mark.parametrize('kind', ['traversal','extra','duplicate','missing-media','invalid-image','invalid-document','wrong-format','symlink','bad-zip'])
def test_invalid_packages_leave_no_rows_or_files(client, auth, app, kind):
    doc, ident = illustrated()
    resources = [(ident,png())]
    extra = None
    if kind == 'traversal': extra = ('../../outside.png',b'bad')
    if kind == 'extra': extra = ('unused.txt',b'bad')
    if kind == 'duplicate': extra = ('timeline.json',json.dumps(doc))
    if kind == 'missing-media': resources=[]
    if kind == 'invalid-image': resources=[(ident,b'not an image')]
    if kind == 'invalid-document': doc['start']=0

    if kind == 'symlink':
        info=zipfile.ZipInfo('link');info.create_system=3;info.external_attr=(stat.S_IFLNK | 0o777)<<16
        extra=(info,b'/etc/passwd')
    content = b'not a zip' if kind == 'bad-zip' else package_bytes(doc,resources,extra,format_name="other" if kind == "wrong-format" else "chronosmos-package")
    response = import_package(client,auth,content)
    assert response.status_code == 400, response.data
    with app.app_context():
        assert db.execute('SELECT COUNT(*) AS n FROM timelines').fetchone()['n'] == 0
        assert db.execute('SELECT COUNT(*) AS n FROM media').fetchone()['n'] == 0
    assert list(Path(app.config['MEDIA_DIR']).iterdir()) == []


def test_package_endpoints_require_editor_and_csrf(client, auth, app):
    public=app.test_client()
    assert public.post('/api/packages/import',data={'file':(io.BytesIO(package_bytes(sample())),'t.zip')}).status_code in (401,403)
    assert public.post('/api/packages/export',json=sample()).status_code in (401,403)
    assert client.post('/api/packages/export',json=sample()).status_code == 403
    assert client.post('/api/packages/import',data={'file':(io.BytesIO(package_bytes(sample())),'t.zip')}).status_code == 403
    assert client.post('/api/packages/export',json=sample(),headers=auth).status_code == 200


def test_package_size_limits_and_existing_upload_limit(client, auth, app, monkeypatch):
    from chronosmos import packages
    monkeypatch.setattr(packages, 'MAX_PACKAGE', 1024)
    assert import_package(client,auth,package_bytes(sample())).status_code == 400
    response=client.post('/api/packages/import',data=b'x',headers=auth,content_type='application/zip',environ_overrides={'CONTENT_LENGTH':str(65*1024*1024)})
    assert response.status_code == 413
    response=client.post('/api/media',data=b'x',headers=auth,content_type='application/octet-stream',environ_overrides={'CONTENT_LENGTH':str(13*1024*1024)})
    assert response.status_code == 413


def test_failed_import_rolls_back_media_rows_and_installed_files(client, auth, app, monkeypatch):
    doc, ident = illustrated()
    original_execute = db.execute
    def execute(sql, args=()):
        if sql.startswith('INSERT INTO timelines'):
            raise RuntimeError('Simulated database write failure')
        return original_execute(sql,args)
    monkeypatch.setattr(db,'execute',execute)
    with pytest.raises(RuntimeError,match='Simulated database'):
        import_package(client,auth,package_bytes(doc,[(ident,png())]))
    with app.app_context():
        assert original_execute('SELECT COUNT(*) AS n FROM media').fetchone()['n'] == 0
        assert original_execute('SELECT COUNT(*) AS n FROM timelines').fetchone()['n'] == 0
    assert list(Path(app.config['MEDIA_DIR']).iterdir()) == []
