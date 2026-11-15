#!/usr/bin/env bash
# Live smoke test against a running Earth Explorer API (real upstream services).
#   tests/smoke.sh [base-url]      default: http://localhost:8787/api/v1
# Requires: curl, python3. Exits non-zero on the first failure.
set -euo pipefail
B="${1:-http://localhost:8787/api/v1}"
pass=0
check() { # name, url, python-assertion-on-json `d`
  local name="$1" url="$2" expr="$3" body
  body=$(curl -sS -m 90 "$url") || { echo "FAIL $name (request)"; exit 1; }
  if python3 -c "import json,sys; d=json.loads(sys.argv[1]); assert $expr, d" "$body" 2>/dev/null; then
    echo "ok   $name"; pass=$((pass+1))
  else
    echo "FAIL $name"; echo "$body" | head -c 400; echo; exit 1
  fi
}
check health          "$B/health"   "d['status']=='ok'"
check datasets        "$B/datasets" "any(v['id']=='t2m' for v in d['variables'])"
check layers          "$B/layers"   "len(d['layers'])>=5 and all(not l['quantitative'] for l in d['layers'])"
check availability    "$B/layers/MERRA2_2m_Air_Temperature_Monthly/availability?date=1985-07-15" "d['availability']['shown']=='1985-07-01'"
check trend-t2m       "$B/trends?variable=t2m&lat=38.56&lon=68.78&start=1981&end=2025" "d['result']['trend']['verdict']['code'] and d['result']['provenance']['provider']=='NASA POWER'"
check trend-short     "$B/trends?variable=t2m&lat=0&lon=0&start=2019&end=2025" "d['result']['trend']['verdict']['code']=='insufficient_data'"
check compare         "$B/compare?variable=precip&lat=-3&lon=-60&period_a=1981-1990&period_b=2016-2025" "d['difference']['b_minus_a'] is not None"
check quakes          "$B/earthquakes?minlat=33&maxlat=42&minlon=65&maxlon=77&start=2020-01-01&end=2024-12-31&minmag=5" "d['count']>0 and 'depth_km' in d['events'][0]"
check bad-lat         "$B/trends?variable=t2m&lat=99&lon=0" "d['error']['code']=='out_of_range'"
echo "$pass checks passed"
