# Chronosmos — käyttöönotto ja ylläpito

Tämän hakemiston asetukset kuuluvat erillisen palvelinprojektin
`services/chronosmos/`-hakemistoon. Palvelinprojektin paikallinen sijainti
määritetään Gitin ohittaman `chronosmos.local.json`-tiedoston
`upcloud_repository`-asetuksessa.
Lähdeprojektin `deploy/upcloud/` sisältää valmistelukopion; palvelinprojektin
kopio on käyttöönoton ja jatkoylläpidon lähde. Todellinen käyttöön otettu
julkaisu ja tarkistustulokset kirjataan palvelinprojektin tilannetietoihin.
Käyttäjän ohjeen mukaan valmiit muutokset julkaistaan tuotantoon jatkossa
oletusarvoisesti. Tuotannon tietoja ei korvata kehityskannalla päivityksissä.

## Palvelu ja tiedostot

| Asia | Määritys |
| --- | --- |
| Lähdekoodi | Chronosmos-lähdearkisto; paikallinen sijainti `chronosmos.local.json`-tiedostossa |
| Versio | 0.1.0 |
| Julkinen nimi | `chronosmos.magi.fi` |
| Käyttäjä ja tietokanta | `chronosmos`, PostgreSQL, Unix-socketin peer-tunnistus |
| Sovellus | Flask 3.1.2, Gunicorn 23.0.0, Psycopg 3.2.12, Pillow 12.2.0 |
| Python | 3.10+; palvelimen Python tarkistettava ennen asennusta |
| Paikallinen portti | `127.0.0.1:8020`, tarkistettava vapaaksi |
| Julkaisut | `/srv/chronosmos/releases/<versio>` |
| Aktiivinen julkaisu | `/srv/chronosmos/current`-symlinkki |
| Edellinen julkaisu | `/srv/chronosmos/previous-release` |
| Pysyvät tiedostot | `/var/lib/chronosmos/media/`, käyttäjä chronosmos, 0750 |
| Salaisuudet | `/etc/chronosmos/chronosmos.env`, root:chronosmos, 0640 |
| systemd | `chronosmos.service`, 1 worker / 2 threads, MemoryMax=192M |
| Apache | `/etc/apache2/sites-available/chronosmos.conf`, välitys paikalliseen porttiin |
| Varmistukset | `/var/backups/chronosmos/<UTC-aika>-<pid>/`, root, 0700 |

Palvelimen aikaisemmin havaitussa tilassa vapaata muistia oli vähän. Tarkista
muisti, levytila, PostgreSQL-versio, DNS ja vapaa portti ennen asennusta. Älä
muuta ODFuckin porttia 8018 tai olemassa olevia Apache-sivustoja. Sovellus
ei vaadi Node.js:ää palvelimella. Kuvien käsittely ja suuret viennit voivat
kuluttaa resursseja; PNG-viennit tehdään selaimessa, lataukset palvelimella.

## Asennus

Tavallinen julkaisu tehdään puhtaasta, commitoidusta lähdearkistosta
komennolla `python3 scripts/deploy.py`. Gitin ohittaman paikallisen asetustiedoston
`upcloud_repository` ja `ssh_host` valitsevat palvelinprojektin ja SSH-kohteen.
Komento suorittaa testit, luo vain Gitissä olevista tiedostoista lähdepaketin,
siirtää palvelinprojektin asetukset, asentaa commitista yksilöidyn julkaisun
ja tarkistaa julkisen HTTPS-terveystilan ja etusivun.

Lue ensin palvelinprojektin `AGENTS.md`, `README.md` ja
`docs/current-state.md`. Tallenna tämä hakemisto palvelinprojektiin **ennen**
palvelinmuutoksia. Suorita paikalliset testit ja tee lähdepaketti projektin
juuresta:

```sh
.venv/bin/python -m pytest -q
npm test
tar -czf /tmp/chronosmos-0.1.0.tar.gz chronosmos wsgi.py requirements.txt examples README.md
sha256sum /tmp/chronosmos-0.1.0.tar.gz
```

Poista paketista mahdolliset `__pycache__`-hakemistot käyttämällä tarvittaessa
`tar --exclude='__pycache__'`-valitsinta. Tarkista palvelin lukevasti ja siirrä
paketti sekä tämän hakemiston tiedostot:

```sh
ssh upcloud 'free -m; df -h /; ss -lnt; python3 --version; pg_lsclusters'
getent ahostsv4 chronosmos.magi.fi
scp /tmp/chronosmos-0.1.0.tar.gz upcloud:/tmp/
scp -r services/chronosmos upcloud:/tmp/chronosmos-ops
ssh upcloud 'bash /tmp/chronosmos-ops/deploy.sh /tmp/chronosmos-0.1.0.tar.gz 0.1.0 PAKETIN_SHA256'
```

`scp services/chronosmos` ajetaan palvelinprojektin juuresta. Ensimmäisellä
asennuksella skripti luo palvelukäyttäjän, kannan, satunnaisen allekirjoitusavaimen,
hakemistot ja taulut. Se ei julkaise esimerkkiaikajanaa eikä luo käyttäjätunnusta.
Skripti säilyttää olemassa olevan ympäristötiedoston ja datan. Se ottaa vanhasta
asennuksesta varmistuksen ennen päivitystä, vaihtaa aktiivisen symlinkin,
tarkistaa terveystilan ja palauttaa vanhan julkaisun automaattisesti, jos
paikallinen terveystarkistus epäonnistuu. Tämä versio sisältää vain idempotentin
skeeman luonnin; tulevat skeemamuutokset tarvitsevat numeroidut migraatiot.

HTTPS-asennus hakee Let's Encrypt -varmenteen webroot-menetelmällä. Se edellyttää,
että DNS osoittaa palvelimeen ja portti 80 on saavutettavissa. Certbot hyväksyy
ACME-käyttöehdot automaattisesti; käytä tätä menettelyä vasta kun palvelimen
varmennehallinta ja käyttöönotto on hyväksytty osana asennustehtävää.

## Muokkaajien määrittely

Luo tunnus palvelimella. Salasana kysytään terminaalissa eikä näy komentorivillä:

```sh
cd /srv/chronosmos/current
set -a
source /etc/chronosmos/chronosmos.env
set +a
runuser -u chronosmos --preserve-environment -- .venv/bin/python -m flask --app wsgi set-password TUNNUS
```

Kirjaudu osoitteessa `https://chronosmos.magi.fi/manage`.
Julkisilla sivuilla ei näytetä kirjautumislinkkiä. Rekisteröitymistä ei ole.
`remove-user TUNNUS` poistaa muokkausoikeuden; `set-password` vaihtaa salasanan
ja mitätöi käyttäjän vanhat istunnot. Ensimmäinen aikajana luodaan editorissa;
esimerkin voi tuoda `examples/traditions.chronosmos.json`-tiedostosta.

Ensimmäisessä käyttöönotossa olemassa olevat paikalliset käyttäjät, aikajanat ja
media voidaan siirtää kertaluonteisesti. `import-initial-data.py` lukee JSON:n
stdinistä ja kieltäytyy, jos tuotantokannan users-, timelines- tai media-taulu
ei ole tyhjä. Suorita se sovellusjulkaisun työhakemistosta palvelukäyttäjänä ja
palvelun ympäristömuuttujilla. Kopioi viitatut kuvat ennen importtia. Siirrä
salasanatiivisteet sisältävä aineisto yksityisesti SSH:n kautta; älä tallenna
sitä Gitiin tai tulosta sitä lokeihin. Säilytä julkaisu-/luonnostila ja käyttäjien
salasanatiivisteet. Älä käytä tätä komentoa myöhemmissä sovelluspäivityksissä.

## Tarkistus käyttöönoton jälkeen

```sh
systemctl is-active chronosmos postgresql apache2 chronosmos-backup.timer
apache2ctl configtest
curl --fail https://chronosmos.magi.fi/healthz
curl --fail https://chronosmos.magi.fi/
journalctl -u chronosmos --since '10 minutes ago' --no-pager
certbot renew --dry-run
```

Tarkista oikeassa selaimessa kirjautuminen, aikajanan luonti, kuvalataus,
luonnoksen tallennus, julkaisu, julkinen polku, SVG:n sisällytetyt kuvat,
PNG, PDF/tulostus ja kielenvaihto. Tarkista, ettei anonyymi käyttäjä näe
luonnoksia tai niiden julkaisemattomia kuvia. Päivitä palvelinprojektin README:n
palvelutaulukko ja muutoshistoria, `docs/current-state.md` sekä `docs/backups.md`
vasta todellisen asennuksen ja varmistuspalautuksen testauksen jälkeen.

## Varmistus ja palautus

Ajastin tekee varmistuksen päivittäin noin 02.20 UTC. Varmistusskripti pysäyttää
Chronosmoksen hetkeksi, jotta kanta ja kuvat ovat yhtenäinen pari, ja käynnistää
sen lopuksi myös virhetilanteessa. Hakemistossa ovat `database.dump`,
`media.tar.gz`, salaisuudet sisältävä `chronosmos.env`, julkaisutieto, SHA-256-
tarkisteet ja vasta onnistuneen varmistuksen jälkeen kirjoitettava `COMPLETE`.
Varmistuksia ei poisteta automaattisesti; valvo pienen levyn kapasiteettia ja
siirrä varmistukset salattuina palvelimen ulkopuolelle. Ulkopuolista kohdetta
tai hälytysvalvontaa ei ole määritelty.

```sh
/usr/local/sbin/chronosmos-backup
bash /tmp/chronosmos-ops/verify-restore.sh /var/backups/chronosmos/VALITTU_HAKEMISTO
```

Palautustesti luo uuden väliaikaisen kannan, tarkistaa tietueet ja jokaisen
mediatiedoston ja kuvan viittauksen, ja poistaa vain oman testikantansa ja
väliaikaistiedostonsa. Se ei korvaa tuotantokantaa. Kirjaa palvelinvarmistuksen
ja palautustestin todellinen tulos palvelinprojektin ylläpitodokumentaatioon.

Todellinen palautus tehdään huoltokatkossa: tarkista valitun varmistuksen
tarkisteet ja palautustesti, pysäytä palvelu, säilytä erillinen varmistus nykyisestä
kannasta ja mediasta, palauta valittu kanta ja media yhdessä, palauta tarvittaessa
ympäristötiedosto oikeuksineen, aseta media `chronosmos:chronosmos`-omistukseen,
vaihda yhteensopivaan sovellusjulkaisuun, käynnistä ja tarkista terveystila,
käyttäjät, julkiset polut ja kuvat.

## Sovellusjulkaisun palautus

Aikajanamuodon 1 valinnaiset `captionYear`- sekä `anchorBarId`/`offsetY`-kentät
mahdollistavat otsikon siirron ja grafiikan kiinnityksen palkkiin. Uusi julkaisu
lukee vanhat aikajanat ilman tietomigraatiota. Näitä kenttiä edeltävä julkaisu
ei osaa näyttää tai muokata uusia sijoituksia oikein; käytä niitä tukevaa
julkaisua, kun uusia ominaisuuksia on tallennettu. Tuotantokantaa ei korvata
kehityskannalla sovelluspäivityksen yhteydessä.

Version 0.1.0 taulut ovat yhteiset kaikille sen korjausjulkaisuille.
Älä palauta tulevaa skeemaa ymmärtämättömään julkaisuun ilman vastaavaa
kantapalautusta. Pelkkä nykyisen version symlinkkipalautus:

```sh
previous=$(cat /srv/chronosmos/previous-release)
test -f "$previous/wsgi.py"
ln -sfn "$previous" /srv/chronosmos/current
systemctl restart chronosmos
curl --fail --header 'Host: chronosmos.magi.fi' http://127.0.0.1:8020/healthz
```

Säilytä vanha julkaisu ja varmistukset, kunnes uusi julkaisu on tarkistettu.
Skriptit ja Apache/systemd-asetukset on tarkistettava uudelleen palvelimen
todellista ympäristöä vasten ennen niiden ensimmäistä käyttöä.
