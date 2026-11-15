#!/usr/bin/env bash
set -euo pipefail

dir=/data/grids
vars="${GRID_VARS:-t2m precip u10m v10m soilwet qv2m rh2m}"
log=/tmp/grids.log

if [ "$(id -u)" = 0 ] && [ "$(stat -c %u "$dir")" != 0 ]; then
  exec setpriv --reuid "$(stat -c %u "$dir")" --regid "$(stat -c %g "$dir")" --clear-groups "$0" "$@"
fi
export HOME=/tmp

complete() {
  local v
  for v in $vars; do
    [ -f "$dir/power-merra2/$v/meta.json" ] || return 1
  done
}

had_data=0
complete && had_data=1

ok=1
python -I /app/build_grids.py "$dir" $vars 2>&1 | tee "$log" || ok=0
! grep -q FAILED "$log" || ok=0

if [ "$ok" = 1 ] && complete; then
  echo "grids: up to date"
elif [ "$had_data" = 1 ]; then
  echo "grids: sync failed, keeping the existing data; run docker compose up again to retry" >&2
else
  echo "grids: download failed; run docker compose up again to resume" >&2
  exit 1
fi
