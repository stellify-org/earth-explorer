# Offline-first performance

Date: 2026-11-06/08. Target users: links of 0.5–2 Mbit/s with high latency and interruptions.
All numbers below were measured with `tests/perf/measure.mjs` (Playwright + Chrome DevTools Protocol
network emulation: given throughput down, half of it up, 150 ms RTT) against the Docker build.
Raw JSON: `tests/perf/results/v3-before-*.json`, `v3-after-*.json`.

**Measurement caveats.** Headless Chromium renders WebGL in software (SwiftShader): FPS (1–5) and
render times are far below a laptop GPU and are CPU-bound. During the "after" runs the machine was busy
(load average 4–8 from other applications), so CPU-dependent times (first complete globe, render of a
layer) varied by up to 2× between repeats of the same build. Network-bound numbers (bytes, requests,
load event under throttling) are stable and are the reliable comparison. GPU memory was not measurable.

## 1. What loads at startup (cold, nothing cached)

| Resource | Transfer (Brotli) | Why |
|---|---|---|
| `cesium-*.js` | 789 kB | CesiumJS engine (`@cesium/engine` + `@cesium/core`), stable chunk cached for a year |
| `react-*.js`, `index-*.js`, CSS | 59 + 24 + 7 kB | UI |
| Cesium workers + `approximateTerrainHeights.json` + `IAU2006_XYS_18.json` | ~270 kB | required by the engine after start |
| `/geo/manifest.json`, `/geo/lod0.json`, `/geo/labels.json` | 2 + 29 + 3 kB | local 1:110m Earth and country labels |
| `/api/v1/datasets`, `/api/v1/vis/catalog`, `/api/v1/health` | ~4 kB | variable lists, connectivity |

**Not** loaded at startup: NASA imagery (satellite and visualisation layers are off), the GIBS layer list
(loads when an imagery menu or Compare is opened), 1:50m/1:10m geography (loads when zooming needs it),
country polygons (on first hover; never in Low Bandwidth Mode), charts (when a point is selected),
Compare / X-Ray / Scenario Lab code, star field / sun / moon textures (removed, ~0.9 MB), any
scientific frame (only when a variable is chosen).

## 2. Before / after

| Metric | before | after |
|---|---|---|
| Initial requests | 25 | 21 |
| Initial transfer (cold) | 1.61–1.72 MB | **1.00–1.03 MB** |
| Initial JavaScript | 1,320 kB (gzip) | **874 kB** (Brotli) |
| Load event at 2 Mbit/s | 5.9 s | 4.1 s |
| Load event at 1 Mbit/s | 11.3 s | **7.6 s** |
| Load event at 0.5 Mbit/s | 21.9 s | **14.7 s** |
| First complete globe, unthrottled | 3.4 s | 3.0 s (5.2–6.4 s in noisy repeats) |
| First complete globe at 1 Mbit/s | 13.4 s | 14.2–14.3 s |
| First complete globe at 0.5 Mbit/s | 24.8 s | 23.1–23.8 s |
| Requests to NASA during start | 0 | 0 |
| Reload with the network off (after one visit) | globe 3.0–5.7 s | globe 2.5–7.1 s (noisy) |
| Trend Detective offline (cached) | 0.3521965439 °C/decade | **0.3521965439 °C/decade** (identical) |
| Numeric layer, cached month revisit | 23–29 ms | **1–11 ms** (one noisy repeat: 788 ms) |
| Numeric layer, next uncached month at 1 Mbit/s | 1.1 s | 0.9 s |
| Numeric layer, next uncached month at 0.5 Mbit/s | 0.9 s | 0.7 s |
| Planet frame size (T2M) | 24 kB | 24.8 kB |
| 24-month playback, repeat pass | 0 network bytes | 0 network bytes, 0 requests |
| JS heap after 48 month changes | 22.5–24.2 MB | 19 → 23.3 → 24.0 MB (no growth) |

Honest reading:
- The cold start transfer dropped by ~40% and the load event is 3.7–7.2 s faster on slow links.
- The **first complete globe on slow links did not improve**: after the 789 kB engine arrives, CesiumJS
  still fetches ~270 kB of workers/tables and spends CPU time initialising; that dominates and was not
  reduced further. Making CesiumJS smaller would need a custom engine build.
- An intermediate build regressed "next month at 1 Mbit/s" to 3.4 s because enabling the GPU surface
  pulled the 1:50m geography (430 kB) for its line overlay; fixed (the overlay uses data already in memory).
- The 24-month playback number of the earlier engine (1.15 s/month) measured only the label; the
  current harness waits for the frame to be on the globe (1.6 s/month median at 1 Mbit/s without any cache).

## 3. What is cached, where

| Store | Content | Strategy |
|---|---|---|
| HTTP cache | `/assets/*` (hashed): 1 year immutable; `/cesium/*`, `/geo/*`: 30 days; versioned frames `…&v=power-v10`: 1 year immutable | browser |
| Cache Storage `ee-static-<build>` | app shell, the files the first screen loaded (handed to the worker from the HTTP cache, no re-download), anything same-origin used later | cache-first, versioned per build |
| Cache Storage `ee-geo-<hash>`, `ee-geo-packs` | geography used so far; geography packs | cache-first |
| Cache Storage `ee-api` | visualisation frames | versioned frames: cache-first; capped at 1,500 entries with batched trimming |
| Cache Storage `ee-metadata` | catalogs, pack manifests, layers, datasets | network-first; cached fallback on network failure / HTTP 5xx / after 3 s waiting; independent of frame eviction |
| Cache Storage `ee-results` | analyses, point grids, comparisons, series, earthquake queries | results: stale-while-revalidate; earthquakes: network-first with fallback; capped at 1,500 entries with batched trimming |
| Cache Storage `ee-tiles` | GIBS and DEM tiles you actually viewed | cache-first, capped at 2,500 tiles; only on request |
| IndexedDB `earth-explorer` | offline data pack frames (binary) and pack status | read before any network request |
| Server disk | POWER responses (7 days), USGS snapshots (10 min), GIBS metadata, native grids (`data/grids`) | cached responses survive restarts; stale-if-error with original retrieval times |

Measured storage after a typical session: 10.5–12 MB (was 14.6–14.8 MB; the old worker precached 9.7 MB).

## 4. Offline data packs

Open **Offline data → Data packs**. Sizes and the time at 1 Mbit/s are shown before downloading.
Nothing downloads automatically.

| Pack | Chunks | Transfer |
|---|---|---|
| Geography 1:50m + country names | 2 | 510 kB |
| Regional geography 1:10m — Central Asia | 6 | 166 kB |
| World geography 1:10m | 237 | 3.0 MB |
| Global temperature — annual means 1981–2025 | 45 | 1.1 MB |
| Global precipitation — annual means 1981–2025 | 45 | 0.84 MB |
| Global temperature — monthly 2021–2025 | 60 | 1.47 MB |
| Global precipitation — monthly 2021–2025 | 60 | 1.14 MB |
| Global 10 m wind vectors — monthly 2024 | 24 | 0.53 MB |
| Tajikistan — all variables, native grid, monthly 1981-01…2026-09 | 2745 | 2.74 MB |
| Central Asia — all variables, native grid, monthly 1981-01…2026-09 | 2745 | 20.2 MB |

**Regional packs (2026-11-13).** "All variables" = the five scalar variables (t2m, precip, soilwet, qv2m, rh2m) ×
549 months, absolute values on the native 0.5° × 0.625° cells; rectangles 67–76°E/36–42°N and 45–90°E/30–60°N.
Sizes are the sums of the gzip frame sizes reported by the manifest. Not included: wind components (Flow only uses
the planet grid), anomalies and annual means (separate frames), terrain, imagery, Trend Detective series.
The earlier "Central Asia temperature 2016–2025" pack (1.07 MB) is replaced by the full Central Asia pack.

How they are used: the UI asks for native cells by the camera's view rectangle (snapped to 5°), which almost never
equals a pack rectangle. So `loadFrame` (1) looks for the exact URL in IndexedDB, (2) uses a downloaded regional pack
that **covers the whole view** without touching the network, (3) otherwise asks the network, and (4) when the
network fails (offline, HTTP ≥ 500) uses a pack that covers **part** of the view. If the planet-scale frame of that
month is not available offline either, the regional frame is drawn alone and the panel says so (everything outside
the pack is transparent). In Low Bandwidth Mode native detail still has to be requested with the button.

**Tajikistan 3D tile pack (2026-11-13).** 969 tiles, **65.8 MB** (measured by downloading every tile once): Terrain
Tiles zoom 0–10 for 67–76°E/36–42°N (879 tiles, 64.4 MB; zoom 10 ≈ 120 m per pixel there) and Blue Marble Next
Generation zoom 0–8 (90 tiles, 1.4 MB). The list is built in the browser (`src/offline/packs.ts`, `src/globe/tileUrls.ts`);
tiles come straight from AWS Open Data / NASA GIBS, so there is no checksum (only "HTTP 200 and an image"). They are
stored in Cache Storage `ee-tile-packs`, which the service worker reads (it searches every cache) and never trims.
Offline, a DEM tile that is not stored is cut out of a stored ancestor up to four zooms above and enlarged
(`dem.worker.ts`), so the relief stays visible closer than zoom 10, at zoom-10 detail. Sampled estimates for other
extents: Tajikistan to zoom 12 ≈ 630 MB; Central Asia to zoom 8 ≈ 78 MB, zoom 10 ≈ 0.8 GB; world Blue Marble ≈ 360 MB.
The service worker now keeps `ee-geo-packs` and `ee-tile-packs` across app updates (before, `activate` deleted
`ee-geo-packs`, so downloaded geography packs were lost on every update).

The pack list (`GET /api/v1/packs`) carries no chunk lists for packs with more than 200 chunks (it would be
~250 kB gzip with both regional manifests); `GET /api/v1/packs?id=<id>` returns one full manifest when a pack is
downloaded or deleted.

Each chunk is an ordinary versioned frame URL with a SHA-256 of its body in the manifest
(`GET /api/v1/packs`, computed once at server start). Downloads are chunk by chunk, verified, retried with
exponential backoff (up to 6 attempts), one at a time in Low Bandwidth Mode (three otherwise), and
resume where they stopped. Browser test: the annual temperature pack (45 chunks) downloaded and verified;
the 1995 annual frame was then served from IndexedDB ("offline pack"). Storage use is shown, and the
browser can be asked to keep the data (`navigator.storage.persist`).

Annual means are labelled as such ("annual mean of 12 monthly means") and the timeline switches to
yearly steps; monthly values are never replaced by annual ones silently.

## 5. Low Bandwidth Mode

Header button: **auto** (default) → **on** → **off**; the choice is stored. Auto turns it on when the
Network Information API reports `saveData`, `slow-2g`/`2g`/`3g` or downlink < 1.5 Mbit/s (Chromium only),
or when throughput measured from real downloads is below 1.5 Mbit/s.

When on: no prefetching of neighbouring months; native regional grids only after "Load native detail for
this view"; satellite imagery, NASA visualisation layers and terrain ask for confirmation with a size
estimate (from measured tile sizes); packs download one chunk at a time; country polygons are not
fetched on hover.

## 6. Rendering changes relevant to performance

- `@cesium/engine` + `CesiumWidget` instead of the `cesium` umbrella + `Viewer` (no widgets bundle).
- Code splitting: charts (118 kB gzip) load only after a point is selected; Compare, X-Ray, Scenario Lab,
  Offline data load when opened.
- Numeric surface on the **GPU** (globe material): a month change uploads one 576×361 (or 144×91) RGBA8
  texture into the existing GPU texture; palette/range/opacity are uniforms. No tile re-rasterisation.
  Alignment verified by reading back pixels (56/58 cell centres exact; the other 2 under border lines).
- Flow animation pauses while the tab is hidden; Cesium runs in request-render mode (no frames while idle).

## 7. Server (Go + Caddy)

- Caddy serves precompressed Brotli/gzip, ETags and Range requests (verified: `206` for a byte range),
  and compresses API JSON (vis catalog 39 kB → 1.4 kB, GIBS layer list 27 kB → 3.6 kB).
- Versioned frames are `immutable`; ETag / If-None-Match → 304.
- Identical concurrent frame requests are coalesced (one computation); upstream NASA calls are limited to
  4 concurrent per service, with timeouts, context cancellation and retries; stale-if-error disk cache.

## 8. Behaviour without a connection

| Situation | Result |
|---|---|
| Never visited, offline | Nothing can load (a first visit must download the app). |
| Visited once, then offline | App and 1:110m globe load from cache; header says "Offline: local data only"; analyses and frames seen before open; others show "Offline, and this result was never retrieved on this device". |
| Packs downloaded | Their frames/geography work fully offline. |
| NASA down, server up | Cached results served; POWER stale copies flagged; header says "Limited". |
| Intermittent network | Requests retry; obsolete requests are cancelled when the user moves on; globe interaction never waits for the network. |

## 9. Storage reliability audit (2026-11-13)

Pack downloads now bypass runtime caching
for science and geography as well as tiles; warm geography is verified and pinned in `ee-geo-packs`.
Cache maintenance scans once after worker startup, then every 64 writes; metadata and saved analyses
survive frame eviction. Existing metadata/analyses are migrated when the worker activates.
