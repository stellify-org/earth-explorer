# Scientific 3D Data Visualization Engine

Date: 2026-11-05. Status: Surface heatmap, Atmospheric shell, Extruded cells and Flow — working and
browser-checked (Flow: direction verified numerically, see §10). The engine turns numeric NASA grids into globe visualisations; it never uses
pre-rendered NASA colour images as data.

## 1. Data source (verified)

| Item | Value | How verified |
|---|---|---|
| Store | `s3://nasa-power/merra2/spatial/power_merra2_monthly_spatial_utc.zarr` (NASA POWER Analysis-Ready Data, Registry of Open Data on AWS, us-west-2, anonymous) | Listed the bucket; opened with xarray/zarr |
| Upstream | MERRA-2 (GMAO) re-packaged by NASA POWER, data version 10 (`comment: "POWER data version 10.0.0 uses the source data resolution"`) | Zarr global attributes |
| Grid | 361 × 576, lat −90…90 step 0.5°, lon −180…179.375 step 0.625° (cell centres); the source grid, no regridding | Coordinate arrays |
| Time | monthly, 1981-01 onwards; months after the latest processed month are stored as NaN (e.g. 2027) | Loaded slices |
| Encoding | float32, `FixedScaleOffset(scale=100, offset=1000)` + Blosc/zstd, one chunk per month, `_FillValue = NaN` | Zarr encoding |
| Licence | CC BY 4.0 per the AWS registry listing; cite the POWER Project | Registry page |
| Variables used | `T2M` (°C), `PRECTOTCORR` (mm/day), `GWETROOT` (1), `QV2M` (g/kg), `RH2M` (%), `U10M`/`V10M` (m/s, eastward/northward) | Variable attributes |

**Independent check:** the T2M grid at the node nearest Dushanbe (38.5°N, 68.75°E) was compared with the
POWER point API response saved in `data/fixtures/` for all 540 months 1981–2025: maximum absolute
difference 0.12 °C, mean 0.034 °C. Close but not identical; why the point API differs slightly from the
node value was not verified (interpolation or processing version are possibilities). July 2024 at that
node is 27.37 °C in the Zarr, in our binary file (Go test) and under the cursor in the browser.

Direct MERRA-2 (GES DISC), GLDAS, IMERG, MODIS, AIRS and OMI need Earthdata Login; their adapters are not
implemented (§11). The format and engine accept any rectilinear grid with explicit cell edges.

## 2. Pipeline

```
NASA POWER Zarr (S3, anonymous)
  → science/vis/build_grids.py      validate axes (ascending), compute cell edges, keep NaN as no-data,
                                     quantise (lossless at 0.01), write data/grids/power-merra2/<var>/<YYYY-MM>.eeg.gz
  → Go internal/visgrid              decode, LRU cache, area-weighted coarsening, regional subsets,
                                     1991–2020 climatology and anomalies, re-encode
  → GET /api/v1/vis/grid             gzip'd eegrid/1 frames, ETag, Cache-Control 7 days
  → service worker + JS LRU          offline and instant replay
  → frontend src/vis/                decode → rasterise one pixel per (half-)cell → Cesium imagery / primitives
```

Run the ingest (resumable): `science/.venv/bin/python -I science/vis/build_grids.py data/grids t2m precip u10m v10m soilwet qv2m rh2m`
(~0.75 s per month per variable with batched downloads; ~290 kB per native month on disk).

## 3. Frame format `eegrid/1`

```
"EEG1" | uint32 N | N bytes JSON header (padded to 2 bytes) | uint16[nlat*nlon] row-major, row 0 = south
value = offset + q * scale ; q = 65535 → no data
```

Header: dataset, variable, POWER parameter, long name, units, month, kind (`value`/`anomaly`, baseline),
cell centres **and edges** for both axes, level of detail, aggregation method, source, quantisation,
statistics (min, max, valid cells), `wraps_longitude`.

Quantisation step = max(0.01, range/65534). The source stores 0.01 resolution, so native frames are
lossless relative to the source. Coarse means and anomalies are rounded to 0.01 for display.
**Trend Detective does not use these frames**; it keeps using full-precision POWER point series.

## 4. Levels of detail

| Level | When | Cells | Transfer (gzip) | Method |
|---|---|---|---|---|
| planet | always | 91 × 144 (2° × 2.5°) | ~24 kB (T2M) | area-weighted mean of 4 × 4 native cells (band area ∝ Δsin φ); a block with < 50% valid area is no-data. **No interpolation** |
| region | camera below 3,500 km | native 0.5° × 0.625°, view snapped to 5°, ≤ 60° × 60° | 2.7 kB for 20° × 15° | native cells, subset only |

Finer zoom never adds detail: tiles are cut from the cell raster with nearest-neighbour sampling, so a
0.5° cell stays one uniform block even at street level. The legend states the grid in use.

## 5. Coordinates and alignment

- Cell edges come from the source centres (midpoints; poles clipped to ±90°, so polar rows are half cells).
- MERRA-2 longitudes run −180…179.375, so cell edges span −180.3125…179.6875: the grid crosses the
  antimeridian. The rasteriser paints a −180…180 canvas, mapping each pixel centre to its cell with wrap.
  Regional subsets that cross 180° are returned with unwrapped, increasing longitudes (tested).
- Pixel size = the greatest common step of cell widths and the offset to −180/−90 (0.3125° × 0.25°),
  so every pixel lies inside exactly one cell.
- The surface layer is a Cesium imagery layer in the existing stack (above base Earth/satellite/NASA
  visualisations, below coastlines, rivers and borders), so it lines up with the local geography and
  drapes on terrain. There is no second globe and no z-fighting.

## 6. Visualisation modes

| Mode | Implementation | Encoding | Honesty notes shown in the UI |
|---|---|---|---|
| **Surface heatmap** | **GPU** (since 2026-11-06): globe material; the uint16 grid is an RGBA8 texture (R/G = high/low byte, A = valid), the fragment shader computes the geodetic lon/lat of each surface point, the containing cell (integer index, longitude wrap, polar rows) and decodes the value; colour from a 256×1 LUT texture. Planet and native-region textures are both bound; region wins inside its box. Coastlines/borders are redrawn above as polylines (the globe material is blended over all imagery) | colour = value (or anomaly) | Nearest cell, no interpolation; zoom never invents detail |
| **Atmospheric shell** | One `RectangleGeometry` primitive at 60 km with the same GPU material (cell from the rectangle's st coordinates); **new months only upload a texture; palette/range/opacity are uniforms** | colour = value; for humidity/precipitation opacity also grows with value | 60 km is a visual offset to avoid z-fighting; a 2 m field is not a vertical profile |
| **Extruded cells** | One batched `Primitive` of extruded `RectangleGeometry` instances with per-instance colour (async, web workers); region frame if ≤ 6,000 cells, else planet | height = (v − scale min)/range × 400 km × exaggeration; anomalies: height ∝ \|anomaly\|, colour = sign | Heights are a visual encoding, not altitudes |
| **Flow** | `PointPrimitiveCollection`; particles move with the eastward/northward components of the cell they are in | colour = speed of the monthly-mean vector | see §10 |

Mode availability is declared per variable by the server catalog (`/api/v1/vis/catalog`). Flow is
disabled for scalar variables.

## 7. Colour scales

ColorBrewer (RdYlBu reversed for temperature, YlGnBu precipitation, BrBG soil wetness, GnBu humidity,
RdBu / BrBG diverging for anomalies centred on 0) and viridis for speed, as 256-entry tables.
Ranges: **Fixed** (default, comparable across dates: T2M −40…40 °C, anomalies ±6 °C, …), **Auto**
(2nd–98th percentile of the displayed month), **Manual**. Absolute values and anomalies use different
palettes and the legend says "vs 1991–2020".

## 8. Time travel, caching, offline

- The timeline drives the month (latest available month on or before the date; shown vs requested is
  displayed). When the numeric layer is on, its months drive prev/next/play. Imagery layers keep their own dates.
- Each month change fetches one ~24 kB frame; the next two months are prefetched; decoded frames live in a
  32-entry LRU; bytes are cached by the service worker (stale-while-revalidate) and by HTTP caching (ETag).
- Server: decoded native frames in a 48-frame LRU, encoded responses in a 300-entry cache,
  climatologies computed once per calendar month.
- The camera position is untouched by month changes.

## 9. Measurements (headless Chromium, software WebGL; `tests/perf/results/vis-*.json`)

| Metric | Result |
|---|---|
| Planet frame transfer (T2M, gzip) | 23.9 kB average over 27 requests (24 months + prefetch), 646 kB total |
| Regional native frame 20° × 15° | 2.7 kB |
| Server time per frame | 2 ms cached, 24 ms first decode, 290 ms first anomaly (climatology build) |
| Month update in the browser, median of 24 | 1.15 s at unthrottled **and** at 1 Mbit/s: dominated by software rendering, not by the network |
| Replaying the same 24 months | 0 network bytes (JS LRU + service worker) |
| JS heap after 48 month changes | 22.5–24.2 MB (no growth → no leak observed) |
| First globe with the engine code included | 5.9 s unthrottled, 15.9 s at 1 Mbit/s (base globe unchanged) |
| Offline after a session | cached frame served (HTTP 200, `EEG1`), globe 5.2 s, Trend Detective identical (0.3521965439 °C/decade) |

Not measured: FPS and GPU memory on real hardware (software GL here), CPU usage.

## 10. Flow

Uses `U10M`/`V10M` monthly means. Each frame advects particles by 30 min of the monthly-mean vector of the
grid cell they are in (no interpolation); lifetime 60–180 frames, respawn uniformly on the sphere.
A monthly-mean vector is not an instantaneous wind and its magnitude is not the monthly-mean wind speed
(that would be `WS10M`); the UI says so and makes no transport claims.

**Verification (January 2024):** the decoded frames give u = −6.1, v = −3.0 m/s in the North Atlantic trades
(14.75°N, 39.06°W), u = +8.6 m/s in the Southern Ocean westerlies (49.25°S, 60.94°E), and zonal-mean
u = −4.4 m/s at 15°N and +6.7 m/s at 50°S. In the browser, particles in the 8–22°N band moved on average
−0.46° lon / −0.26° lat in 3 s and particles in the 42–58°S band +1.07° lon: the signs match the data.

## 11. Not implemented / limitations

- Other datasets (MERRA-2 direct, GLDAS, IMERG, MODIS, AIRS, OMI): need Earthdata Login and per-dataset
  adapters (QA flags, fill values, grids differ). The format/engine are dataset-agnostic.
- No vertical profiles: the shell never implies atmospheric structure.
- Compare mode and X-Ray do not show the numeric layer (main globe only).
- Surface and shell update by texture upload only (Cesium reuses the GPU texture when the size is unchanged);
  extruded columns are rebuilt per month (their geometry depends on the values).
- GPU alignment check (2026-11-06): at opacity 1, 56 of 58 sampled native cell centres over Africa rendered the
  exact LUT colour of their value; the 2 others were covered by border lines drawn on top.
- Very large instance counts (extrude at planet scale, ~13k columns) are heavy on weak GPUs.
