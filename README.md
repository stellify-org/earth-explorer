# Earth Explorer

**Explore the past. Understand the present. Experiment with possible futures.**

Earth Explorer is a research prototype by team **Stellify**: a CesiumJS 3D globe with
real NASA imagery, a time machine over dated satellite and reanalysis layers, and
**Trend Detective**, which retrieves real monthly NASA data for any point on Earth
and tests for trends with autocorrelation-aware statistics.

## What works today

| Area | Status | What it does |
|---|---|---|
| 3D globe | **Complete** | CesiumJS without Cesium ion. **Local base Earth** rasterised in the browser from Natural Earth vectors (1:110m → 1:50m → 1:10m by zoom), works offline. Borders, coasts, lakes, rivers, country labels, country under cursor. Optional DEM terrain. Rotate/zoom/touch, click to select, fly to a low oblique viewpoint |
| Offline-first | **Complete** | ~0.9 MB cold start (Brotli), globe from local data, no NASA request before the globe. Service worker + IndexedDB; downloadable **offline data packs** (checksummed, resumable); **Low Bandwidth Mode** (auto/manual); backend stale-if-error. See [docs/OFFLINE_PERFORMANCE.md](docs/OFFLINE_PERFORMANCE.md) |
| Scientific visualization engine | **Complete (surface, shell, extrude); Flow see status** | Global monthly NASA POWER (MERRA-2-based) grids from the AWS Open Data Zarr, ingested to a compact binary format (~24 kB per planet frame). Surface heatmap, atmospheric shell, extruded cells, flow from real U/V components; absolute or anomaly vs 1991–2020; native 0.5° × 0.625° cells when zoomed in; driven by the timeline; cached offline. See [docs/SCIENTIFIC_VISUALIZATION_ENGINE.md](docs/SCIENTIFIC_VISUALIZATION_ENGINE.md) |
| Time travel | **Complete** | Date picker, slider, prev/next **available** observation, playback. Each layer's real date coverage is parsed from GIBS GetCapabilities; the shown date is confirmed with GIBS's `layer-time-actual` header |
| Environmental data | **Complete (point)** | 6 NASA POWER variables (temperature, precipitation, RH, specific humidity, wind, surface solar) with units, resolution, data kind, citations |
| Trend Detective | **Complete (point)** | Monthly anomalies; OLS with AR(1) effective-sample-size adjustment; modified Mann-Kendall (Hamed-Rao) + Sen; Seasonal Kendall; annual-mean and endpoint-sensitivity checks; practical vs statistical significance; CSV/JSON export with provenance |
| Earth Compare | **Complete (v1)** | Two synchronised globes (same layer, two dates) + quantitative period comparison at a point |
| X-Ray Earth | **Complete (v1)** | Translucent globe, underground camera, USGS earthquakes at reported depths, filters by region/time/magnitude, click for event details |
| Event Detective | **Complete (v1)** | Natural events on the 3D globe from NASA EONET v3 and the USGS catalogue: markers by kind, fire clusters, storm tracks, flood outlines as published, time slider and playback, investigation card with sources, curated real cases, hand-off to Trend Detective. Geometry is never invented; a trend is never presented as the cause of an event |
| Scenario Lab ("What If?") | **One scenario (v1)** | Nurek Reservoir: 3D water-level change on SRTM terrain, flooded area, storage change from a published stage–storage law, exploratory water balance. Not a forecast; see `docs/SCENARIO_LAB_SCIENCE.md` |

Event evidence packs: [docs/DISASTER_EVIDENCE_ENGINE.md](docs/DISASTER_EVIDENCE_ENGINE.md).

## Quick start

### Numeric grids (once, ~7 min per variable, ~150 MB per variable on disk)

```bash
python3 -m venv science/.venv && science/.venv/bin/pip install -r science/requirements.txt
science/.venv/bin/python -I science/vis/build_grids.py data/grids t2m precip u10m v10m soilwet qv2m rh2m
```

Without this step the app works, but the Scientific visualization panel shows no variables.

### Docker (recommended)

```bash
make up          # or: docker compose up --build -d
# open http://localhost:8088   (Caddy serves precompressed Brotli and proxies /api)
```

Server deployment: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). All local commands: `make help`.

No credentials are needed. NASA POWER, NASA GIBS and USGS ComCat are open services.

### Development

Requirements: Go ≥ 1.26, Node ≥ 22, Python ≥ 3.12 (only for the scientific reference tests).

```bash
# 1. API on :8787
cd backend && go run ./cmd/server

# 2. Web app on :5173 (proxies /api to :8787)
cd frontend && npm ci && npm run dev
```

> On a machine with tight memory, do not run the Vite dev server, Docker builds and
> an IDE indexer at the same time. Vite with Cesium uses about 1.2 GB.

## Tests

```bash
cd backend && go vet ./... && go test ./...          # stats, analysis, GIBS dates, API integration
cd frontend && npm run typecheck && npm test         # TS contracts + unit tests
python3 -m venv science/.venv && science/.venv/bin/pip install -r science/requirements.txt
science/.venv/bin/python -I -m pytest science/tests -q   # reference reproducibility
tests/smoke.sh                                        # live check against a running API
node tests/e2e/mode-switch.mjs http://localhost:8088/   # regression: mode/visualisation switching (Playwright)
node tests/perf/measure.mjs http://localhost:8088/ --throttle --offline-check --flaky   # perf + offline (needs Playwright)
```

What the tests prove:

- **Go statistics match independent implementations** (statsmodels, scipy, pymannkendall)
  to ~1e-6 on real NASA POWER series saved in `data/fixtures/` and on seeded synthetic series.
- **Calibration:** with zero true trend and AR(1) noise (φ = 0.6), the naive OLS test rejects
  32% of the time; the adjusted OLS test 5.5%; the verdict rule (both tests) 5.5%; the 95%
  CI covers the true slope 94.5% of the time.
- **API integration tests** replay real saved upstream responses, check validation, caching,
  retries and outage reporting.

## Architecture

Modular monolith: one Go API, one React SPA, one offline Python toolkit. No database
(nothing needs persistence yet). See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

```
frontend/   React 19 + TypeScript + Vite + CesiumJS + Tailwind + Recharts + Zustand
            public/geo: Natural Earth assets (eegeo/1, built by science/geo/build_basemap.py); public/sw.js: service worker
backend/    Go: cmd/server, internal/{stats, analysis, power, gibs, quakes, catalog, api, httpx, fetch, cache}
science/    Python reference generator + tests (numpy, scipy, statsmodels, pymannkendall)
data/       fixtures/ (real API responses, documented), cache/ (git-ignored runtime cache)
docs/       architecture, methods, data sources, API, deployment
tests/      smoke, end-to-end and performance scripts
scripts/    deploy.sh
```

API reference: [docs/API.md](docs/API.md).

## Scientific honesty rules (enforced in code)

- Imagery tiles are **never** turned into numbers. All numbers come from a data API.
- Every number carries units, source, API version, request URL, retrieval time and method.
- Point values are **grid-cell** values (MERRA-2 ~50 km), not station data. The UI says so.
- "Statistically significant" requires two independent tests to agree; otherwise the verdict is
  "methods disagree", "suggestive" or "not detected". Short or gappy records get no verdict.
- Trends describe change, not cause. Correlation is never presented as causation.
- POWER is derived from MERRA-2, so POWER-vs-MERRA-2 agreement is not independent validation.

Full methods and limitations: [docs/SCIENTIFIC_METHODS.md](docs/SCIENTIFIC_METHODS.md).

## Data sources and credits

- **NASA POWER** (Prediction Of Worldwide Energy Resources), NASA Langley Research Center, funded through the NASA Earth Science Division. Meteorology from **MERRA-2** (GMAO; Gelaro et al. 2017, doi:10.1175/JCLI-D-16-0758.1).
- **NASA GIBS** imagery, part of NASA's Earth Science Data and Information System (ESDIS).
- **Natural Earth** vector data, public domain (naturalearthdata.com), commit `ca96624` of nvkelso/natural-earth-vector.
- Optional terrain: **Terrain Tiles** (Mapzen/Tilezen, AWS Open Data): SRTM/GMTED2010/3DEP courtesy of USGS, ETOPO1 courtesy of NOAA, national DEMs per the Tilezen attribution list.
- **USGS** ANSS Comprehensive Earthquake Catalog (ComCat).
- **CRUST1.0** crustal model: Laske, G., Masters, G., Ma, Z. and Pasyanos, M., Update on CRUST1.0 - A 1-degree Global Model of Earth's Crust, Geophys. Res. Abstracts, 15, Abstract EGU2013-2658, 2013 (https://igppweb.ucsd.edu/~gabi/crust1.html). Not stored in this repository: `science/geo/build_crust1.py` downloads and converts it.
- **PREM** layer boundaries: Dziewonski, A. M. & Anderson, D. L. (1981), Preliminary reference Earth model, Phys. Earth Planet. Inter. 25, 297–356, doi:10.1016/0031-9201(81)90046-7.
- Software: CesiumJS (Apache-2.0), React, Recharts, Zustand, Tailwind CSS, Vite (MIT); gonum (BSD-3-Clause); numpy, scipy, pandas, statsmodels (BSD); pymannkendall (MIT).
