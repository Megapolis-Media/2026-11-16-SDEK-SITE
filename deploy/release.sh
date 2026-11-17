#!/usr/bin/env bash
# Installed root-owned at /usr/local/sbin/cdek-fm-deploy.
set -euo pipefail
sha=${1:-}
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'Expected a full commit SHA' >&2; exit 2; }
cd /srv/cdek-fm
exec 9>/run/lock/cdek-fm-deploy.lock
flock -w 600 9
image="cdek-fm:$sha"
gzip -dc | docker load
docker image inspect "$image" >/dev/null
previous=$(cat .release 2>/dev/null || true)
export CDEK_IMAGE="$image"
rollback() {
  echo 'Release failed; attempting to restart the previous image. Database backup is retained.' >&2
  if [[ -n "$previous" ]]; then
    CDEK_IMAGE="$previous" docker compose up -d --wait --wait-timeout 90 web || true
  else
    docker compose stop web || true
  fi
}
trap rollback ERR
if [[ -n "$previous" ]]; then
  CDEK_IMAGE="$previous" docker compose stop web
fi
backup="backups/$(date -u +%Y%m%dT%H%M%SZ)-$sha.tar.gz"
tar -czf "$backup" data
docker compose run --rm --no-deps web node scripts/server.mjs migrate
docker compose up -d --wait --wait-timeout 90 web
curl --fail --silent http://127.0.0.1:3101/api/health
printf '%s\n' "$image" > .release.new
mv .release.new .release
trap - ERR
echo "Released $sha"
