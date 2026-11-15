#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

WEB_PORT="${WEB_PORT:-8080}"
export WEB_PORT
export GRIDS_REFRESH="${GRIDS_REFRESH:-$(date +%F)}"

command -v docker >/dev/null || { echo "docker is not installed" >&2; exit 1; }
docker compose version >/dev/null || { echo "docker compose plugin is not installed" >&2; exit 1; }

docker compose build --pull
docker compose up -d --remove-orphans

url="http://localhost:${WEB_PORT}/api/v1/health"
for _ in $(seq 1 60); do
  if curl -fsS "$url" >/dev/null 2>&1; then
    echo "Earth Explorer is up: http://localhost:${WEB_PORT}"
    scripts/fetch-data.sh verify
    docker compose ps
    exit 0
  fi
  sleep 2
done

echo "health check failed: $url" >&2
docker compose ps >&2
docker compose logs --tail=50 >&2
exit 1
