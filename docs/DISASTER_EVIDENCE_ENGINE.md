# Disaster evidence engine ("Show Event Impact")

Written 2026-11-15 (second event day of NASA Space Apps 2026 — this feature is **event-day work**, like Event
Detective itself; the rest of the application is prior work).

## What it does

In Event Detective a selected event used to be a marker (plus a storm's line or a flood's outline). The engine
adds the **documented geographic evidence** of the event to the same globe: mapped perimeters, satellite
detections, numeric model grids, satellite product maps, best-track positions and wind radii — each with an
evidence class, source, date, resolution, units and uncertainty. It never creates geometry: a kind of evidence
that does not exist for an event is not drawn and the card says why.

User flow: select an event → **Show Event Impact** (guided cases open it themselves) → the camera frames the
evidence → a card on the globe shows a short title, 2–4 measurements, the layer switches this event supports, a
legend with the evidence class of every layer, what is unavailable, Before / After where the data allow it, and
**Investigate the Trend**. The time slider under the globe moves over the dated observations.

## Architecture (one engine, no per-disaster code paths in the renderer)

| Suggested name | Where | Role |
|---|---|---|
| EventEvidenceAdapter | `frontend/src/events/evidence/adapters.ts` | Where a bundle comes from. Three adapters, first match wins: `pack` (prebuilt verified cases), `shakemap` (any USGS earthquake, live through the API), `record` (only what the catalogue record holds + NASA product pictures of its dates). `registerAdapter` / `registerPack` add more (tsunami, snow, dust …) without touching anything else |
| DisasterVisualizationManager | `evidence/store.ts` (`useEvidence`) | Which event's evidence is open, which layers are on, camera tier. One bundle at a time; loaded only on request |
| EventLayerRenderer | `evidence/renderer.ts` | Draws layer kinds in the main Cesium viewer and disposes them |
| EventTimelineController | `EventTimeline` in `events/EventsPanel.tsx` + `Bundle.steps` | With the impact view open the slider steps over the evidence's own dates |
| EventImpactSummary + EventEvidenceLegend | `evidence/ImpactOverlay.tsx` | The card on the globe |
| data contract | `evidence/types.ts` (TS) = `backend/internal/evidence/evidence.go` (Go) = packs written by `science/events/build_evidence.py` | One `Bundle` format for all three sources |

Layer kinds (a category uses any combination):

| Kind | Drawn as | Used for |
|---|---|---|
| `raster` (numeric grid) | coloured in the browser with the source's palette → one imagery layer (draped on the 3D terrain by the globe) | ShakeMap intensity |
| `raster` (dated frames) | small paletted PNGs in the product's own colours → imagery layer per date | flood maps |
| `polygons` | canvas → imagery layer (draped) + the same vertices as a screen line while the globe is smooth | fire perimeter, reported outline, fault model |
| `gibs` | NASA GIBS tile imagery of the date at the slider, fetched only when switched on | IMERG rainfall, MODIS flood product for catalogue floods |
| `points` | one point collection per layer, built once; the slider only switches points on / off | heat detections, later earthquakes, stations, felt reports |
| `track` | segments between dated positions, coloured by reported wind | storms |
| `radii` | four-quadrant outline per wind threshold at the position of the slider time | storms |

Evidence classes (exactly these six; every layer and every summary number has one, written out in the legend):
Observed · Satellite-derived · Model estimate · Reported event boundary · Historical context · Hypothetical scenario.
No layer in this build is "hypothetical" (a unit test checks the packs).

Scale-aware display (`tierOf`): the evidence is drawn when the camera is within max(3 500 km, 4 × the size of
the evidence box) of it; farther away only the event marker remains and the card offers "Fly closer". Coming
back shows it again. Nothing is removed by zooming **in**.

Performance and bandwidth: nothing is rebuilt per frame; a time step touches only what changed; imagery layers
are destroyed with their textures on close (`tests/e2e/evidence.mjs` compares imagery-layer and primitive
counts before and after every case). Packs: hurricane 12.6 kB, flood 7.6 kB + six PNG of 3–6 kB, wildfire
380 kB (78 kB gzip). Satellite pictures are never downloaded automatically. Packs and the earthquake bundle
are kept by the service worker (`/evidence/*` and `/api/v1/evidence/*`: saved copy first, refreshed in the
background), so a viewed investigation replays offline.

## Data per category

### Earthquakes — live for every USGS event (`GET /api/v1/evidence/earthquake/{id}`)
- **Shaking intensity** — USGS ShakeMap `coverage_mmi_low_res.covjson` (numeric MMI grid; 184 × 146 cells of
  1/15° for the verified case), coloured with the palette inside the file. Class: **Model estimate**.
  Intensity below II is transparent. The card states it is not a map of damage.
- **Fault rupture used by ShakeMap** — `rupture.json`, outline of the surface projection; depth range shown in
  the depth gauge. Class: Model estimate.
- **Stations / felt reports** — `stationlist.json`, only points inside the map. Class: Observed. For the
  verified case the file's coordinates are broken in the source (longitude 0, real longitude in the latitude
  field), so all 12 felt reports are dropped rather than drawn in the wrong place (unit test).
- **Later earthquakes nearby** — USGS catalogue, M ≥ 2.5 within 100 km and 30 days after the main shock, sized
  by magnitude, dated (playback by day). Class: Observed. The window is a fixed choice of this application, not
  a declustering method; the text never calls them proven aftershocks (the layer switch is named "Aftershocks"
  for brevity — the legend and the method text carry the caveat).
- **No ShakeMap** → the bundle has no shaking layer and says "USGS has not published a ShakeMap…"; nothing is
  derived from the magnitude. No circle is ever drawn.
- Verified case: `us100044k6`, M 7.2, 104 km W of Murghob, Tajikistan, 2015-12-07: ShakeMap Atlas version 1
  (processed 2020-06-03), strongest estimated shaking VII (7.4 in the full grid; 7.2 in the low-resolution grid
  that is drawn), 38 later earthquakes, largest M 5.4 (retrieved 2026-11-15).

### Wildfires — pack `EONET_9035` (Park Fire, California, 2024)
- **Burned area (mapped perimeter)** — NIFC / WFIGS Interagency Fire Perimeters, record `2024-CABTU-013761`:
  429 603 GIS acres, 44 363 vertices simplified to 1 157 (area change −0.06 %). Class: Observed. The text says a
  perimeter is an upper bound of what burned.
- **Thermal detections** — NASA FIRMS VIIRS 375 m active fire (NOAA-20 9 447, Suomi NPP 3 379, NOAA-21 13),
  read from NASA GIBS vector tiles (no key needed), 2024-07-24 … 2024-08-17, 12 839 detections with time and
  fire radiative power. Class: Satellite-derived. Only detections inside the perimeter + ≈1 km are attributed
  to the fire; 117 in the surrounding box were left out. A detection is drawn as a dot (pixel centre), never
  as burned area.
- Association with the catalogue record: the EONET point and the WFIGS point of origin are identical
  (39.818579° N, 121.802601° W); the builder asserts < 200 m.
- **Not available**: MODIS MCD64A1 burned-area cells (needs an Earthdata login) and the overlap with tree cover
  (ESA WorldCover) — both stated; the tree-cover overlap is not implemented.

### Hurricanes — pack `EONET_11536` (Milton, 2024)
- **Track** — NOAA NHC best track (HURDAT2, file `hurdat2-1851-2025-092326.txt`), storm `AL142024`: 34 positions
  with wind (kt), pressure (mb), status and the landfall record; peak 155 kt, minimum 895 mb. Class: Observed
  (post-storm analysis).
- **Wind radii** — the same file: 34 / 50 / 64 kt radii in four quadrants (n mi), drawn exactly as defined
  (an arc per quadrant, radial steps between quadrants). Class: Reported event boundary, with the sentence
  that winds are not that strong everywhere inside and that it is not a damage zone.
- **Rainfall** — GPM IMERG precipitation rate, GIBS picture of the UTC day (off until switched on).
  Class: Satellite-derived; a picture, not a gauge total.
- The EONET record's own 22 advisory positions differ from best-track positions of the same hour by up to
  145 km; the pack states it. With the impact view open the catalogue line is not drawn a second time and the
  marker sits on the best-track position.
- Storms without a pack (catalogue): the reported positions as a track coloured by reported wind, IMERG
  picture on request, and "wind radii not in the record — width unknown, not drawn".

### Floods — pack `EONET_26367` (Thailand, reported 2026-11-05) and every catalogue flood
- **Mapped water** — NASA LANCE MODIS NRT Global Flood Product, 3-day composite, product pixels (0.0022°,
  ≈250 m, not resampled) read from GIBS tiles and classed by the exact colours of the GIBS colour map: surface
  water / recurring flood / flood / insufficient data. Six dates: 2026-02-15 (dry-season reference),
  10-20, 10-24, 11-03, 11-05, 11-11. Areas per class and date are computed per pixel on the sphere.
  Class: Satellite-derived.
- **Honest numbers:** flood class 0.1 km² on 2026-02-15, 24 km² on 10-20 (before the reported start),
  10.6 km² on 11-05 with **77 % of the box not observed**; about 49 % of the box is "insufficient data" on
  every date (steep terrain the product masks), the rest of the 77 % is cloud. The card shows the cloud share
  next to the area and calls the area a lower bound.
- **Reported event area** — the GDACS outline from the EONET record. Class: Reported event boundary;
  never filled, never called water.
- **Before / After** — two dated maps of the same product. **Water depth: not available** (stated).
- Catalogue floods without a pack: the outline (reported) + the same NASA product as GIBS picture tiles for the
  days around the report (available from 2021-12-23) + IMERG on request; areas are not computed there (stated).

### Volcanoes, landslides, other (P3 — generic path only)
One reported point stays one point; the card explains that no plume / boundary dataset is linked. Landslides
and floods offer the IMERG picture of the preceding days as context with the sentence that rain is not proof
of cause. Droughts, tsunamis, snow, dust, heat: no adapter yet.

## Rebuilding the packs

```
science/.venv/bin/python -I science/events/build_evidence.py hurricane
science/.venv/bin/python -I science/events/build_evidence.py wildfire          # ≈470 small downloads the first time
science/.venv/bin/python -I science/events/build_evidence.py flood EONET_26367 2026-02-15 2026-10-20 2026-10-24 2026-11-03 2026-11-05 2026-11-11
science/.venv/bin/python -I science/events/build_evidence.py flood-scan        # which recent EONET floods show mapped floodwater
```
Downloads are cached in `data/cache/evidence/` (git-ignored). `science/events/mvt.py` is a dependency-free
reader for the point layers of Mapbox vector tiles. A new pack must be added to `PACKS` in `adapters.ts`.

## Tests

- Go: `backend/internal/evidence` — real saved USGS answers (`data/fixtures/shakemap_us100044k6/`): grid size,
  box, row order (strongest cell lies on the fault), palette, rupture, depth range, broken felt reports dropped,
  later earthquakes, no ShakeMap → nothing drawn, unknown id, stale copy.
- Vitest: `frontend/src/events/evidence/evidence.test.ts` (16) — the six classes, provenance of every pack
  layer, detections inside the perimeter, radii ordering, flood frame files, quadrant geometry, tiers,
  record adapter never invents a footprint.
- Browser: `node tests/e2e/evidence.mjs http://localhost:8088/` — the four verified cases, layer switches
  (pixels checked in screenshots), dated steps against the pack contents, far / near, resources released,
  point-only fire, catalogue flood, catalogue earthquakes with and without ShakeMap, trend hand-over, offline.

## Limits (read before presenting)

- Nothing was looked at on a real GPU or a phone in this session; screenshots are headless software rendering.
- The flood example shows little water and much cloud. That is what the product contains for the EONET floods
  of the last 60 days (scan in the builder); a clearer, larger flood would need an event outside EONET's
  recent GDACS records.
- Lines (tracks, radii, crisp outlines) are drawn 450 m above the ellipsoid; with the 3D terrain on, outlines
  rely on the draped copy and tracks can pass under high ground.
- Points are drawn without a depth test so mountains do not hide them; they are taken off when the camera is far.
- IMERG / flood pictures are colour-mapped images: no numbers are read from them.
- "Later earthquakes" depend on catalogue completeness (≈ M 4+ outside dense networks).
- Best-track uncertainty and ShakeMap method descriptions in the texts are general statements, not numbers
  taken from a document read in this session.
