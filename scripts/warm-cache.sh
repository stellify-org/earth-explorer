#!/usr/bin/env bash
# Fill the API cache after a deploy, so the first visitor does not wait for NASA/USGS.
#   scripts/warm-cache.sh [base-url]      default: http://localhost:$WEB_PORT/api/v1
# WARM_POINTS="lat,lon lat,lon ..." and WARM_VARS="t2m precip ..." override the defaults.
# A failed request is reported and skipped; the exit code is non-zero if any request failed.
set -uo pipefail

B="${1:-http://localhost:${WEB_PORT:-8080}/api/v1}"
POINTS="${WARM_POINTS:-38.56,68.78 40.28,69.62 37.84,68.78 37.49,71.55 41.31,69.24 43.24,76.89 42.87,74.59}"
VARS="${WARM_VARS:-t2m precip}"
END="${WARM_END:-$(( $(date +%Y) - 1 ))}"

ok=0; fail=0
hit() { # name, url
  local t
  if t=$(curl -fsS -m 180 -o /dev/null -w '%{time_total}' "$2"); then
    printf 'ok   %6.1fs  %s\n' "$t" "$1"; ok=$((ok+1))
  else
    printf 'FAIL          %s\n' "$1"; fail=$((fail+1))
  fi
}

hit health   "$B/health"
hit datasets "$B/datasets"
hit layers   "$B/layers"
hit events   "$B/events"
hit packs    "$B/packs"

for p in $POINTS; do
  lat="${p%,*}"; lon="${p#*,}"
  for v in $VARS; do
    hit "trends $v $p" "$B/trends?variable=$v&lat=$lat&lon=$lon&start=1981&end=$END"
  done
done

echo "$ok ok, $fail failed"
[ "$fail" -eq 0 ]
