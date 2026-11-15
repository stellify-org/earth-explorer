#!/usr/bin/env bash
set -euo pipefail

store="${1:-/data/grids}"
out="${2:-}"
vars="${GRID_VARS:-t2m precip u10m v10m soilwet qv2m rh2m}"
log=/tmp/grids.log

complete() {
  local v
  for v in $vars; do
    [ -f "$store/power-merra2/$v/meta.json" ] || return 1
  done
}

had_data=0
complete && had_data=1

ok=1
python -I "$(dirname "$0")/build_grids.py" "$store" $vars 2>&1 | tee "$log" || ok=0
! grep -q FAILED "$log" || ok=0

if [ "$ok" = 1 ] && complete; then
  echo "grids: up to date"
elif [ "$had_data" = 1 ]; then
  echo "grids: sync failed, keeping the data downloaded earlier" >&2
else
  echo "grids: download failed; run the build again to resume" >&2
  exit 1
fi

if [ -n "$out" ]; then
  mkdir -p "$out/power-merra2"
  for v in $vars; do
    cp -a "$store/power-merra2/$v" "$out/power-merra2/$v"
  done
fi
