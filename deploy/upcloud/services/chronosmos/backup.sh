#!/usr/bin/env bash
# Root only. A short write pause makes database + media a consistent backup pair.
set -euo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo 'Run as root' >&2; exit 1; }
exec 9>/run/lock/chronosmos-maintenance.lock
flock -x 9
install -d -m 700 /var/backups/chronosmos
stamp=$(date -u +%Y%m%dT%H%M%S)-$$
target="/var/backups/chronosmos/$stamp"
install -d -m 700 "$target"
was_active=0
if systemctl is-active --quiet chronosmos; then
    was_active=1
    systemctl stop chronosmos
fi
finish() {
    if [[ $was_active == 1 ]]; then systemctl start chronosmos; fi
}
trap finish EXIT
runuser -u postgres -- pg_dump -Fc chronosmos > "$target/database.dump"
tar -czf "$target/media.tar.gz" -C /var/lib/chronosmos media
cp /etc/chronosmos/chronosmos.env "$target/chronosmos.env"
readlink -f /srv/chronosmos/current > "$target/release.txt"
(cd "$target" && sha256sum database.dump media.tar.gz chronosmos.env release.txt > SHA256SUMS)
touch "$target/COMPLETE"
printf '%s\n' "$target"
