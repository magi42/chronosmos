#!/usr/bin/env bash
# Root on UpCloud. Usage: deploy.sh SOURCE.tar.gz RELEASE SHA256
set -euo pipefail
umask 027
[[ $EUID -eq 0 && $# -eq 3 ]] || { echo 'Run as root: deploy.sh archive release sha256' >&2; exit 1; }
archive=$(realpath "$1")
release_id=$2
expected_sha=$3
[[ $release_id =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ && $expected_sha =~ ^[0-9a-f]{64}$ ]] || exit 2
printf '%s  %s\n' "$expected_sha" "$archive" | sha256sum -c -
ops=$(cd -- "$(dirname -- "$0")" && pwd)
# Check the existing server and DNS before running this installer; see README.
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y python3-venv postgresql apache2 certbot ca-certificates
id chronosmos >/dev/null 2>&1 || useradd --system --home-dir /var/lib/chronosmos --create-home --shell /usr/sbin/nologin chronosmos
install -d -m 755 /srv/chronosmos/releases
install -d -m 750 -o chronosmos -g chronosmos /var/lib/chronosmos /var/lib/chronosmos/media
install -d -m 750 -o root -g chronosmos /etc/chronosmos
install -d -m 755 /var/www/letsencrypt/.well-known/acme-challenge
systemctl enable --now postgresql
if ! runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='chronosmos'" | grep -q 1; then
    runuser -u postgres -- createuser --no-superuser --no-createrole --no-createdb chronosmos
fi
if ! runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='chronosmos'" | grep -q 1; then
    runuser -u postgres -- createdb --owner=chronosmos chronosmos
fi
if [[ ! -f /etc/chronosmos/chronosmos.env ]]; then
    python3 - "$ops/chronosmos.env.example" <<'PY'
from pathlib import Path
import secrets, sys
Path('/etc/chronosmos/chronosmos.env').write_text(Path(sys.argv[1]).read_text().replace('GENERATE_ON_SERVER', secrets.token_hex(48)))
PY
    chown root:chronosmos /etc/chronosmos/chronosmos.env
    chmod 640 /etc/chronosmos/chronosmos.env
fi
release="/srv/chronosmos/releases/$release_id"
if [[ -e "$release" ]]; then
    [[ $(cat "$release/.source-sha256") == "$expected_sha" ]] || { echo 'Release id already has different source' >&2; exit 3; }
else
    install -d -m 755 "$release"
    tar -xzf "$archive" -C "$release" --no-same-owner
    printf '%s\n' "$expected_sha" > "$release/.source-sha256"
    chmod -R a+rX "$release"
fi
python3 -m venv "$release/.venv"
"$release/.venv/bin/pip" install --disable-pip-version-check --no-cache-dir -r "$release/requirements.txt"
chmod -R a+rX "$release/.venv"
install -m 755 "$ops/backup.sh" /usr/local/sbin/chronosmos-backup
if [[ -L /srv/chronosmos/current ]]; then /usr/local/sbin/chronosmos-backup; fi
exec 9>/run/lock/chronosmos-maintenance.lock
flock -x 9
set -a
source /etc/chronosmos/chronosmos.env
set +a
(cd "$release" && runuser -u chronosmos --preserve-environment -- "$release/.venv/bin/python" -m flask --app wsgi init-db)
install -m 644 "$ops/chronosmos.service" /etc/systemd/system/chronosmos.service
install -m 644 "$ops/chronosmos-backup.service" /etc/systemd/system/chronosmos-backup.service
install -m 644 "$ops/chronosmos-backup.timer" /etc/systemd/system/chronosmos-backup.timer
previous=""
if [[ -L /srv/chronosmos/current ]]; then previous=$(readlink -f /srv/chronosmos/current); fi
if [[ "$previous" != "$release" ]]; then printf '%s\n' "$previous" > /srv/chronosmos/previous-release; fi
ln -sfn "$release" /srv/chronosmos/current.next
mv -Tf /srv/chronosmos/current.next /srv/chronosmos/current
systemctl daemon-reload
systemctl enable chronosmos chronosmos-backup.timer
systemctl restart chronosmos
healthy=0
for attempt in {1..20}; do
    if curl --fail --silent --header 'Host: chronosmos.magi.fi' http://127.0.0.1:8020/healthz; then healthy=1; break; fi
    sleep 1
done
if [[ $healthy != 1 ]]; then
    if [[ -n "$previous" ]]; then
        ln -sfn "$previous" /srv/chronosmos/current
        systemctl restart chronosmos
    fi
    echo 'Health check failed; previous release restored when available.' >&2
    exit 4
fi
a2enmod proxy proxy_http ssl headers rewrite
if [[ ! -f /etc/letsencrypt/live/chronosmos.magi.fi/fullchain.pem ]]; then
    install -m 644 "$ops/apache-acme.conf" /etc/apache2/sites-available/chronosmos.conf
    a2ensite chronosmos
    apache2ctl configtest
    systemctl reload apache2
    certbot certonly --webroot -w /var/www/letsencrypt -d chronosmos.magi.fi --non-interactive --agree-tos --register-unsafely-without-email
fi
install -m 644 "$ops/apache.conf" /etc/apache2/sites-available/chronosmos.conf
a2ensite chronosmos
apache2ctl configtest
systemctl reload apache2
install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
printf '#!/bin/sh\napache2ctl configtest && systemctl reload apache2\n' > /etc/letsencrypt/renewal-hooks/deploy/chronosmos-apache
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/chronosmos-apache
systemctl enable --now certbot.timer chronosmos-backup.timer
curl --fail --silent --resolve chronosmos.magi.fi:443:127.0.0.1 https://chronosmos.magi.fi/healthz
systemctl is-active chronosmos postgresql apache2 chronosmos-backup.timer
echo 'Configure the first editor with the set-password CLI before editing.'
