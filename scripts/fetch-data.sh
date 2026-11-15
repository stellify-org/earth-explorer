#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

WEB_PORT="${WEB_PORT:-8080}"
GRID_VARS="${GRID_VARS:-t2m precip u10m v10m soilwet qv2m rh2m}"
PACKS_EXPECTED="${PACKS_EXPECTED:-15}"
PY_IMAGE="${PY_IMAGE:-python:3.12-slim}"
BASE="http://localhost:${WEB_PORT}"
CRUST_DIR=frontend/public/crust1
CRUST_BYTES=4665600
GRIDS_DIR=data/grids
GRIDS_LOG=data/fetch-grids.log

fail() { echo "fetch-data: $*" >&2; exit 1; }

if command -v python3 >/dev/null && python3 -c 'import sys, ensurepip; sys.exit(sys.version_info < (3, 12))' 2>/dev/null; then
  VENV=science/.venv
  run() { "$@"; }
else
  command -v docker >/dev/null || fail "python 3.12+ with venv or docker is required"
  VENV=science/.venv-docker
  run() { docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD:$PWD" -w "$PWD" "$PY_IMAGE" "$@"; }
fi

crust_ready() {
  [ -f "$CRUST_DIR/meta.json" ] && [ -f "$CRUST_DIR/crust1.bin" ] \
    && [ "$(wc -c < "$CRUST_DIR/crust1.bin")" -eq "$CRUST_BYTES" ]
}

crust_served() {
  curl -fsSI "$BASE/crust1/crust1.bin" 2>/dev/null | tr -d '\r' | grep -qix "content-length: $CRUST_BYTES"
}

service_running() {
  [ -n "$(docker compose ps --status running -q "$1" 2>/dev/null)" ]
}

wait_health() {
  for _ in $(seq 1 60); do
    curl -fsS "$BASE/api/v1/health" >/dev/null 2>&1 && return 0
    sleep 2
  done
  fail "health check failed: $BASE/api/v1/health"
}

packs_count() {
  curl -fsS -m 120 "$BASE/api/v1/packs" | { grep -o '"chunk_count"' || true; } | wc -l
}

grid_files() {
  find "$GRIDS_DIR" -name '*.eeg.gz' 2>/dev/null | wc -l
}

fetch_crust() {
  if crust_ready; then
    echo "crust1: up to date"
    return
  fi
  echo "crust1: downloading"
  run python3 -I science/geo/build_crust1.py
  crust_ready || fail "crust1.bin is missing or has an unexpected size"
}

fetch_grids() {
  local before v
  mkdir -p "$GRIDS_DIR"
  if ! run "$VENV/bin/python" -I -c 'import xarray, zarr, s3fs' 2>/dev/null; then
    echo "grids: preparing $VENV"
    run python3 -m venv "$VENV"
    run "$VENV/bin/pip" install -q -r science/requirements.txt
  fi
  before=$(grid_files)
  echo "grids: syncing $GRID_VARS (log: $GRIDS_LOG)"
  run "$VENV/bin/python" -I science/vis/build_grids.py "$GRIDS_DIR" $GRID_VARS 2>&1 | tee "$GRIDS_LOG"
  ! grep -q 'FAILED' "$GRIDS_LOG" || fail "some grid batches failed, see $GRIDS_LOG; run again to resume"
  for v in $GRID_VARS; do
    [ -f "$GRIDS_DIR/power-merra2/$v/meta.json" ] || fail "no meta.json for $v"
    [ -n "$(find "$GRIDS_DIR/power-merra2/$v" -name '*.eeg.gz' -print -quit)" ] || fail "no grid files for $v"
  done
  echo "grids: $(grid_files) files ($(( $(grid_files) - before )) new)"
}

publish() {
  if service_running web && ! crust_served; then
    echo "web: rebuilding to include crust1"
    docker compose up -d --build web
    wait_health
  fi
  if service_running api && [ "$(packs_count 2>/dev/null || true)" != "$PACKS_EXPECTED" ]; then
    echo "api: restarting to pick up grids"
    docker compose restart api
    wait_health
  fi
}

verify() {
  local health packs
  health=$(curl -fsS "$BASE/api/v1/health") || fail "no answer from $BASE/api/v1/health; start the stack with scripts/deploy.sh"
  grep -q '"status":"ok"' <<<"$health" || fail "health status is not ok"
  packs=$(packs_count) || fail "request to /api/v1/packs failed"
  [ "$packs" -eq "$PACKS_EXPECTED" ] || fail "/api/v1/packs lists $packs packs, expected $PACKS_EXPECTED"
  crust_served || fail "/crust1/crust1.bin is not served with Content-Length $CRUST_BYTES"
  echo "verify: health ok, $packs packs, crust1.bin $CRUST_BYTES bytes"
}

case "${1:-all}" in
  crust) fetch_crust ;;
  grids) fetch_grids ;;
  verify) verify ;;
  all) fetch_crust; fetch_grids; publish; verify ;;
  *) fail "usage: scripts/fetch-data.sh [all|crust|grids|verify]" ;;
esac
