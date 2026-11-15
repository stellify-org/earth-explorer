# API reference (v1)

Base path `/api/v1`. All responses are JSON. Errors have the form
`{"error": {"code": "...", "message": "...", "field": "..."}}` with HTTP 400 (validation),
404 (unknown route/layer), 422 (not enough data), 502 (upstream error), 504 (upstream timeout).
NaN values are encoded as `null`.

| Route | Purpose | Parameters |
|---|---|---|
| `GET /health` | Liveness, GIBS capabilities state, cache stats | — |
| `GET /datasets` | Analysable variables with units, resolution, data kind, citations, limitations | — |
| `GET /layers` | Curated NASA GIBS layers: URL template, tile matrix set, max level, legend, **time intervals** | — |
| `GET /layers/{id}/availability` | Snap a date to what GIBS serves; previous/next available | `date=YYYY-MM-DD`, `verify=1` (adds GIBS `layer-time-actual`) |
| `GET /timeseries` | Monthly series + climatology + anomalies + annual means | `variable`, `lat` [-90,90], `lon` [-180,180], `start`, `end` (years) |
| `GET /trends` | `/timeseries` + full trend analysis, verdict, warnings, method | same + `alpha` ∈ {0.01, 0.05, 0.10} |
| `GET /compare` | Difference of annual means between two periods at a point (Welch) | `variable`, `lat`, `lon`, `period_a=YYYY-YYYY`, `period_b=YYYY-YYYY` (≥ 5 years each) |
| `GET /grid` | One year of monthly NASA POWER values on the native grid for a ≤ 10° × 10° box around a point (numeric map layer) | `variable`, `lat`, `lon`, `year` (default: last complete year) |
| `GET /events` | Natural events of the last N days from NASA EONET v3 (open and closed): id, title, category, dates, marker position and what it is (`reported_point`, `latest_reported_point`, `polygon_bbox_centre`), source magnitude and unit, every dated position of a track, polygon count / vertex count / bounding box (rings are **not** in the list), source links. Newest first; `categories` gives counts; `stale: true` when EONET failed and a stored copy is served | `days` 1–366 (default 30), `category` (optional comma-separated EONET ids, e.g. `severeStorms,volcanoes`) |
| `GET /events/{id}` | One EONET event with the full geometry as published (`polygons`: `[polygon][ring][vertex][lon, lat]`, unchanged) | `id` like `EONET_26330` |
| `GET /evidence/earthquake/{id}` | Evidence bundle of one USGS earthquake, built live from USGS and cached for a day: ShakeMap intensity grid (`coverage_mmi_low_res.covjson` → `raster`, MMI × 10, north row first, with the file's palette; class `model`), the fault model ShakeMap used (`polygons`, class `model`), stations and felt reports inside the map (`points`, class `observed`), catalogue earthquakes within 100 km and 30 days after the main shock (`points` with minutes after the main shock, class `observed`), summary numbers, playback steps, depth. An earthquake without a ShakeMap still answers 200: `layers` then has no shaking layer and `unavailable` explains it. `stale: true` when USGS failed and a stored copy is served. Format: `backend/internal/evidence/evidence.go` = `frontend/src/events/evidence/types.ts` | `id` = USGS event id, e.g. `us100044k6`; 404 `unknown_event` |
| `GET /earthquakes` | USGS ComCat events with depth, ordered by magnitude | `minlat`, `maxlat`, `minlon`, `maxlon`, `start`, `end` (dates), `minmag` (default 4.5), `limit` ≤ 20000 (default 2000) |
| `GET /packs` | Offline data packs (sets of `/vis/grid` frames): title, variables, period, `bbox` of regional packs, total `bytes`, `chunk_count`. `chunks` (`url`, gzip `bytes`, `sha256` of the uncompressed body) are listed inline only for packs with ≤ 200 chunks | — |
| `GET /vis/grid` | One numeric frame (`eegrid/1`, gzip) of a POWER MERRA-2 grid. Other `/vis/*` routes are not documented here yet | `var`, `month` (`YYYY-MM`, or `YYYY` for an annual mean of 12 complete months), `kind` = `value` \| `anomaly` (minus the 1991–2020 mean) \| `climatology` (`month=1991-MM` is the key of calendar month MM of the 1991–2020 baseline), `lod` = `planet` \| `region`, `bbox=w,s,e,n` (region, ≤ 60° × 60°), `v` (data version) |
| `GET /packs?id=<id>` | One pack with its full chunk list, as `{"version", "pack"}`; 404 `not_found` for an unknown id | `id` |

Variables (`/datasets`): `t2m`, `precip`, `rh2m`, `qv2m`, `ws2m`, `sw_down`.

Year bounds: from the variable's first year (1981; 1984 for `sw_down`) to the last complete year.

Packs: 503 `vis_unavailable` when the server has no grids (`GRIDS_DIR`). After a start the first `/packs` call
waits until all manifests are computed (tens of seconds). The Tajikistan 3D tile pack is not served by this API:
the browser builds its tile list itself (Terrain Tiles on AWS Open Data + NASA GIBS).

Caching: POWER responses 7 days (memory + disk, `CACHE_DIR`), GIBS capabilities 6 h, USGS 10 min.
USGS snapshots persist in `CACHE_DIR/quakes`. When USGS fails, an expired snapshot is served with
`stale: true`, the original `retrieved_at` and an explanatory note; fresh responses have `stale: false`.
When POWER fails, an expired disk copy is served (`provenance.stale = true`). `/health` reports per-upstream
`reachable`, `last_ok`, `last_error`.
Concurrent identical requests are de-duplicated. Upstream calls use per-attempt timeouts and up
to two jittered retries on HTTP 429/5xx.

The routes `/observations` and `/metadata` suggested in the brief were not created: no working
feature needs them yet (`/timeseries` and `/datasets` cover those needs).

Example:

```bash
curl 'http://localhost:8787/api/v1/trends?variable=t2m&lat=38.56&lon=68.78&start=1981&end=2025'
```
