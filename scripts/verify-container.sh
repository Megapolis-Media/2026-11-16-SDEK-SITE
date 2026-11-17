#!/usr/bin/env bash
set -euo pipefail
image=${1:?Pass the image to verify}
name="cdek-verify-$$"
cleanup() {
  status=$?
  if (( status != 0 )); then docker logs "$name" >&2 || true; fi
  docker rm -f "$name" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

docker run --detach --name "$name" --read-only \
  --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 256 \
  --memory 1536m --cpus 2 \
  --tmpfs /tmp:size=128m,mode=1777 \
  --tmpfs /data:size=32m,uid=1000,gid=1000,mode=0700 \
  --publish 127.0.0.1::3000 \
  --env VINEXT_TRUST_PROXY=1 --env VINEXT_TRUSTED_HOSTS=cdek-fm.test \
  "$image" sh -c 'node scripts/server.mjs migrate && exec node server.js' >/dev/null

address=$(docker port "$name" 3000/tcp)
ready=0
for ((attempt=0; attempt<60; attempt++)); do
  if curl --fail --silent --max-time 2 "http://$address/api/health" >/dev/null; then ready=1; break; fi
  sleep 1
done
(( ready == 1 )) || { echo 'Container did not become healthy' >&2; exit 1; }
curl --fail --silent --max-time 10 "http://$address/" >/dev/null
curl --fail --silent --max-time 10 "http://$address/visual/cdek-fm.svg" >/dev/null

body='{"id":"00000000-0000-4000-8000-000000000001","client":"00000000-0000-4000-8000-000000000002","body":"Isolated container verification"}'
post() {
  curl --silent --show-error --max-time 10 --output /dev/null --write-out '%{http_code}' \
    --header 'Host: cdek-fm.test' --header 'X-Forwarded-Host: cdek-fm.test' \
    --header 'X-Forwarded-Proto: https' --header 'Origin: https://cdek-fm.test' \
    --header 'Content-Type: application/json' --data "$body" "http://$address/api/chat"
}
[[ $(post) == 201 ]] || { echo 'Chat write failed in the hardened container' >&2; exit 1; }
[[ $(post) == 200 ]] || { echo 'Chat retry was not idempotent' >&2; exit 1; }
docker exec "$name" node -e 'const fs=require("node:fs"); for (const [p,m] of [["/data",0o700],["/data/cdek.sqlite",0o600]]) if ((fs.statSync(p).mode&0o777)!==m) throw Error("Unsafe mode: "+p); if (process.getuid()!==1000) throw Error("Unexpected runtime user");'
echo 'Hardened Linux container verified: isolated database, migrations, HTTP, proxy, idempotency, UID and private file permissions.'
