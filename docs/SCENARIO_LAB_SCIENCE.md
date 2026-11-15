# Scenario Lab — science note (Nurek Reservoir, Tajikistan)

Written 2026-11-14, revised the same day (spill and shortfall accounting, optional snowmelt, land-cover
overlap). Code: `frontend/src/scenario/{model.ts,scene.ts,ScenarioPanel.tsx}`; data pack:
`frontend/public/scenario/{nurek.bin,nurek.json,nurek_landcover.bin}` built by `science/geo/build_nurek.py`; tests:
`frontend/src/scenario/model.test.ts`, `tests/e2e/scenario-lab.mjs`.

The Scenario Lab is an **exploratory "what if" tool**. It does not forecast the reservoir, the river, the
climate or ecosystems.

## 1. Three kinds of numbers

| Kind | What it is here | Examples |
|---|---|---|
| **Observed** | Taken from a documented source, unchanged | Elevation grid; water surface 864 m in that grid; published levels 857 / 910 m; evaporation table; NASA POWER precipitation climatology; long-term mean inflow; the 2021 land-cover map |
| **Modeled** | Calculated from the observed data with the equations below | Storage change; flooded land; water-surface area; water-balance result incl. spill and shortfall; land-cover classes of the flooded cells |
| **Hypothetical** | Chosen by the user | The water level; inflow, outflow, rain and evaporation factors, duration, start month; all three snowmelt numbers |

The interface tags every value with one of the three. A hypothetical level is never called a future state.

## 2. Data

| Data | Source | Notes |
|---|---|---|
| Elevation, 700 × 670 cells of about 60 m, 69.245–69.725°E, 38.245–38.605°N | Terrain Tiles (Mapzen/Tilezen, AWS Open Data), zoom 11. In this region the tiles are SRTM (NASA/USGS, public domain) | Whole metres. SRTM was flown in February 2000, so the flat water surface in the grid — **864 m** — is the reservoir level of that moment (a low winter level), not a normal or present level. Vertical datum EGM96 |
| Full supply level 910 m, minimum operating level 857 m | TEAS reservoir operation study, p. 17 | Reference below |
| Storage law V = a·(Z − Z₀)^b, a = 2.41, b = 1.64, Z₀ = 762.7 m, V in hm³ | Same study, p. 19 | Fitted by its authors to inflow, outflow and level records of 1991–2011; stated as valid between 857 and 910 m |
| Evaporation, mm per month: 43, 0, 20, 25, 39, 73, 105, 138, 128, 89, 91, 54 (805 mm/yr) | Same study, Table 2.6, p. 18 | One table is given for Rogun and Nurek, from the designer's report |
| Mean inflow 21 000 hm³/yr (= 666 m³/s) | Same study, p. 15 | Used only as the default of the inflow input |
| Precipitation, mm/day per month: 1.23, 1.85, 1.79, 1.84, 1.12, 0.39, 0.10, 0.04, 0.05, 0.36, 1.18, 1.21 | NASA POWER climatology API v2.10.1, `PRECTOTCORR` (MERRA-2), point 38.37°N 69.45°E, January 2001 – December 2025, retrieved 2026-11-14 | One 0.5° × 0.625° cell; request URL stored in `nurek.json` |
| Total / live / dead capacity from surveys (km³): 1972 10.50 / 4.50 / 6.00; 1989 8.66 / 3.40 / 5.26; 1994 7.96 / 3.06 / 4.90; 2001 8.63 / 4.27 / 4.36 | Same study, Table 2.8, p. 18 | Shown only as context. The study itself calls the differences between surveys doubtful and the present volume "not well known" |
| Land-cover class per elevation cell (700 × 670, one byte) | ESA WorldCover 10 m 2021 v200, tile N36E069 (© ESA WorldCover project 2021 / contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium; CC BY 4.0), read with HTTP range requests on 2026-11-14 | **Not a NASA/USGS product.** Each ~60 m cell takes the most frequent class of the 10 m pixels whose centres fall inside it (median 54 pixels per cell). Classes present: tree cover, shrubland, grassland, cropland, built-up, bare / sparse vegetation, permanent water. URL, sha256 and cell counts are in `nurek.json` → `land_cover` |

Reference: OSHPC Barki Tojik / Coyne et Bellier, ELC Electroconsult, IPA (2014). *Techno-Economic Assessment
Study for Rogun Hydroelectric Construction Project, Phase II, Vol. 3, Chapter 5: Reservoir Operation Study*
(P.002378 RP 40), published by the World Bank:
<https://www.worldbank.org/content/dam/Worldbank/document/eca/central-asia/TEAS_Reservoir%20operation%20study_Final_eng.pdf>.
The figures were transcribed by hand on 2026-11-14 from the rendered pages (the formula is an image in the PDF).

Not used: HydroLAKES (the download is a global archive of several hundred MB; the DEM water surface was used
instead), Global Dam Watch, Copernicus DEM (no GeoTIFF reader in the project's Python environment; SRTM via
Terrain Tiles was already an attributed source of the app). The 2015 bathymetric survey mentioned in the
literature was not found as open data.

## 3. Calculations

**Stage–storage.** V(Z) = 2.41·(Z − 762.7)^1.64 hm³; inverse Z(V) = 762.7 + (V / 2.41)^(1/1.64); implied
surface area A(Z) = dV/dZ. The lab reports only **changes** V(Z) − V(864 m). It never shows a current stored
volume. With the rounded published parameters the law gives 4.50 km³ between 857 and 910 m, while the study's
text says 4.2 km³; both are within the spread of the surveyed live storage (3.06–4.50 km³).

**Inundation.** Water is spread from a cell inside the reservoir through 8-connected neighbours whose elevation
is at or below the scenario level. A low cell that water cannot reach stays dry. Cells of the dam body cannot
be flooded or crossed (see §5). Flooded area = sum of cell areas, each (40 075 016.686 m / 2¹⁹)² · cos²(latitude).

**Independent volume check.** For a level above 864 m: Σ over baseline water cells of (Z − 864)·a plus
Σ over newly flooded cells of (Z − z_cell)·a. This uses only the elevation grid, so it is independent of the
storage law.

**Lowering.** Below 864 m the lake bed is not in the elevation data. No shoreline or flooded/exposed area is
computed; the scene shows the water surface lower inside the old outline and a grey wall for the unknown bed.
The storage change still comes from the storage law (valid down to 857 m).

**Water balance.** dV/dt = Q_in + Q_melt − Q_out + (P − E)·A − spill, integrated in one-day steps (explicit Euler):

V(next day) = V + (Q_in + Q_melt − Q_out)·86 400 s + (P − E)·A(Z(V))

with Q in m³/s, P = monthly climatology (mm/day ÷ 1000 → m/day) × user factor, E = monthly table
(mm/month ÷ days of the month ÷ 1000 → m/day) × user factor, A from the storage law in m². Months have their
non-leap lengths. **The whole requested duration is simulated**, and storage is kept inside the range where the
law holds (857–910 m) without dropping any water:

- if the day would end above 910 m, storage is set to V(910 m) and the excess is counted as **spill** (water
  leaving through the spillways; how it leaves is not modelled);
- if the day would end below 857 m, the release is cut to what is available and the rest is reported as
  **outflow shortfall**; if even a zero release is not enough (evaporation larger than everything else), the
  remainder is reported as "loss not taken" rather than hidden.

Every run reports the closure
storage change − (inflow + snowmelt − delivered outflow + rain − evaporation − spill + loss not taken),
which is 0 up to floating-point rounding (tested: < 1 m³). Example used in the tests and the interface: 5000 m³/s
in, 666 m³/s out, 90 days, rain and evaporation off → 33.70 km³ arrive net; 3.98 km³ fit between 864 and 910 m;
29.72 km³ are spill; the level ends at 910 m. (The first version stopped the run at about day 10 and showed only
the 3.98 km³; that was an accounting gap, not a physical result.)
The end level is passed to the same 3D scene. No runoff model: rain is applied to the lake surface only (the
rain factor does not change the inflow); water from the catchment is part of the inflow that the user sets.

**Optional snowmelt (off by default).** Q_melt = DDF · max(T − 0 °C, 0) · A_snow, the degree-day
(temperature-index) form, with DDF in mm/°C/day, T in °C and A_snow in km²; e.g. 4 mm/°C/day × 5 °C × 1000 km²
= 20 mm/day over 10⁹ m² = 2·10⁷ m³/day. **All three numbers are user assumptions**: no snow-cover or mountain
temperature data are loaded, the snow area and temperature stay constant for the whole run and the melt reaches
the reservoir at once and in full. It is therefore an upper bound for the chosen numbers, not a snowmelt
forecast. The default DDF of 4 is only a starting value for the control; no literature range is quoted because
none was checked against a primary source in this work.

**Land-cover overlap.** For a level above 864 m the areas of the newly flooded cells are summed per class of
the 2021 land-cover map (§2). The result is an overlap of two maps and nothing more — see §4a.

## 4. How the two methods compare (values computed from the shipped pack)

| Level, m | Storage change, law (hm³) | Volume above 864 m, DEM (hm³) | Difference | Newly flooded land, DEM (km²) | Water area, DEM (km²) | Area implied by law (km²) |
|---|---|---|---|---|---|---|
| 857 | −520 | not available | – | not available | not available | 72.5 |
| 864 | 0 | 0 | – | 0 | 47.8 | 75.9 |
| 870 | +464 | 343 | −26% | 15.9 | 63.7 | 78.8 |
| 880 | +1 275 | 1 042 | −18% | 27.6 | 75.4 | 83.4 |
| 890 | +2 132 | 1 850 | −13% | 38.1 | 85.8 | 87.9 |
| 900 | +3 033 | 2 744 | −10% | 45.0 | 92.8 | 92.3 |
| 910 | +3 977 | 3 710 | −7% | 51.8 | 99.6 | 96.5 |

At full supply level the DEM area (99.6 km²) is close to the commonly quoted 98 km² (Wikipedia, uncited there).
Near the baseline the two methods disagree strongly (47.8 against 75.9 km²). We do not know the cause; candidates
are: the law is a power-function fit whose slope need not equal the true area at the low end; narrow canyon arms
are not resolved by 60 m cells; the reservoir bed changed between 1991–2011 (law) and February 2000 (DEM); a
datum offset between EGM96 and the national height system. The interface shows both areas and the percentage
difference rather than hiding it.

### 4a. Land cover of the newly flooded cells (WorldCover 2021)

| Level, m | Newly flooded, DEM (km²) | Permanent water in 2021 | Grassland | Cropland | Bare / sparse | Tree cover |
|---|---|---|---|---|---|---|
| 870 | 15.90 | 15.90 (100.0%) | 0.00 | – | – | – |
| 880 | 27.59 | 27.47 (99.6%) | 0.11 | – | 0.01 | – |
| 890 | 38.05 | 37.10 (97.5%) | 0.72 | 0.13 | 0.11 | – |
| 900 | 45.05 | 41.94 (93.1%) | 2.32 | 0.44 | 0.35 | – |
| 910 | 51.84 | 44.83 (86.5%) | 5.81 | 0.59 | 0.58 | 0.03 |

Computed on 2026-11-14 with an independent NumPy implementation of the flood fill; the 910 m row is asserted in
the TypeScript unit test. What this shows and what it does not:

- The land-cover map is from 2021, when the reservoir stood much higher than the 864 m recorded by SRTM in
  February 2000. So most cells that the scenario "floods" were simply **already water in 2021**. The interface
  names that row so and never calls the rest "vegetation loss".
- It is a useful independent check of the inundation: all 47.79 km² of the DEM's baseline water are permanent
  water in the 2021 map, and 86–100% of the cells flooded by the model up to 910 m are too. The map has 98.89 km²
  of permanent water in the whole grid, but that figure includes the river above and below the reservoir
  (6.28 km² of it lie outside the model's 910 m extent), so it is not a lake area.
- The grassland, cropland and bare cells near 900–910 m are land the 2021 map saw dry and the model floods at
  that level. That can mean the 2021 water line was lower than that level, or errors of either map (60 m cells,
  majority class, DEM noise); the two cannot be separated here.

A consistency check on the evaporation table: the study gives 52.3 hm³/yr of evaporation; 805 mm over the
law's areas (72–97 km²) gives 58–78 hm³/yr, the same order.

## 5. The dam in the grid

The 60 m cells smooth the 300 m-high dam: its crest appears at 899–909 m instead of above 910 m, and a plain
flood fill leaks through it at 899 m (area jumps to more than 200 km² down the valley). Cells within 900 m of
the dam coordinate (38.3717°N, 69.3481°E, from the Wikipedia article) with elevation ≥ 895 m are therefore
treated as an impermeable barrier. A unit test shows the leak without the barrier and its absence with it.

## 6. Limitations

- The storage law is an average for 1991–2011; sedimentation continues, so storage for a given level is probably
  smaller today. No current storage or level is claimed.
- The baseline is one past moment (February 2000).
- Elevations are whole metres on ~60 m cells; flooded areas are approximate, especially for small level changes.
- Published levels and the DEM use different height systems (possible offset of the order of a metre; not measured here).
- The evaporation table is shared with Rogun in the source; the precipitation is one reanalysis grid cell.
- Explicit daily Euler steps; area taken at the start of each day (the change of area within a day is negligible
  at these rates).
- Spill is only an accounting term (water that does not fit); spillway capacity, dam operation rules, river
  routing, waves, sediment, groundwater, ice and any ecological or climate response are not modelled.
- Snowmelt is a user-set degree-day term without any snow or temperature data (see §3).
- The land-cover table is an overlap of a 2021 map with a February 2000 terrain model; it says nothing about
  what would happen to vegetation, and no NDVI or vegetation-condition data are used.
- Heights in the scene are drawn ×2 (stated in the panel).

## 7. Verification

`npx vitest run src/scenario` (21 tests): the law against the hand formula and its exact inverse; A = dV/dZ;
m³/s → m³/day; mm → m³ over the lake; monthly evaporation per day; zero change for balanced fluxes; sign of the
change; closure of the balance to < 1 m³; the 5000 / 666 / 90 case (33.70 = 3.98 stored + 29.72 spill, km³);
release cut and shortfall at 857 m; level inside 857–910 m on every reported day; rejection of negative inputs;
snowmelt units and threshold; connectivity on a synthetic grid (a hollow behind a ridge stays dry; barrier
respected; nothing new flooded below the recorded surface); per-class sums on a synthetic grid; the real pack
(size, water level, area at 910 m, agreement with the law within 15% at 910 m, leak without the barrier; every
baseline water cell is water in the land-cover map; class areas add up to the flooded area and match the
independent NumPy values at 910 m).

`node tests/e2e/scenario-lab.mjs` reads the water level back from the geometry in the scene and compares it
with the slider, the published law and the water-balance result.

## 8. Buildings against the modeled water (added 2026-11-14)

Code: `frontend/src/scenario/{buildings.ts,buildingsScene.ts,BuildingsSection.tsx}`; data:
`frontend/public/scenario/nurek_buildings.{bin,json}` and `nurek_buildings_ids.bin`, built by
`science/geo/build_nurek_buildings.py`; tests: `frontend/src/scenario/buildings.test.ts`,
`tests/e2e/scenario-buildings.mjs`. Switched on with **Show Buildings** in the lab panel (off by default; the
pack is downloaded only then).

**What it is.** An overlap of mapped building outlines with the cells that the inundation model of §3 marks as
water. **It is not an estimate of damage, casualties or financial loss**, and nothing downstream of the dam is
modeled: the model is a reservoir-level model and floods only what is connected to the lake behind the dam.

### Data (neither source is NASA/USGS)

| Source | Buildings | Licence / attribution | What it is |
|---|---|---|---|
| OpenStreetMap, Overpass API, data as of 2026-11-14 08:46 UTC | 402 (401 ways, 1 multipolygon relation) | ODbL 1.0, © OpenStreetMap contributors | Outlines drawn by volunteers. Nearly all are in the town of Nurek; the villages around the reservoir are not mapped |
| Overture Maps Foundation, buildings theme, release 2026-10-21.0; here every row is from *Microsoft ML Buildings* | 33 151 | ODbL 1.0, © Overture Maps Foundation; Microsoft | Used only where OSM has no outline. Outlines detected automatically in satellite imagery by a machine-learning model; **not checked on the ground**: some are not buildings, some buildings are missing |

OSM coverage was judged insufficient (402 outlines for an area of about 42 × 40 km with a town and many
villages), so Overture was investigated as the task asked. The Overture extract for the same rectangle has
33 553 rows: the same 402 OSM buildings plus 33 151 Microsoft outlines. The pack takes the OSM buildings from
OSM itself (with their ids and tags) and the others from Overture; an Overture outline that overlaps an OSM one
would be dropped (none did). Total **33 553**. Kept: outlines whose bounding-box centre is inside the elevation
grid. Coordinates are stored to 10⁻⁶ degree (about 0.1 m).

**Heights.** No building in the area has a `height` tag; **2** have `building:levels` (shown as levels × 3 m,
labelled approximate); **33 551** have no height information at all. Those are drawn 3 m high — a placeholder
for the picture, stated in the panel and never reported as a height. Building heights are drawn ×2 like the terrain.

### Method

- Each outline is projected to local metres around the building (equirectangular; error far below a cell over a
  few hundred metres) and compared with the rectangles of the elevation cells, using exact segment geometry
  (`polygonRectDistance`). Holes (courtyards) are outside the footprint.
- **Red — overlaps:** the outline overlaps or touches at least one cell with flood mask 1 or 2 (water in the
  elevation data, or land flooded at the scenario level). **Yellow — near:** no overlap, but such a cell lies
  within **100 m** of the outline (distance between the outline and the cell rectangle). **Grey:** neither.
- The mask is the one the water mesh is built from, so the picture and the counts cannot disagree. The cells
  under and around every building are found once; a change of level is a lookup.
- Below the 864 m baseline the model keeps the baseline outline (§3, lowering), so the classes equal those at 864 m.
- **Water depth** for a red building = scenario level − lowest elevation among the *flooded-land* cells under its
  outline. It is not given where the only wet cells under the outline are water in the elevation data itself
  (ground unknown). Cells are about 60 m wide with whole-metre heights, so this is a rough figure for the cell,
  not for the building.
- In the scene a building stands on the terrain mesh as drawn (bilinear on the 120 m mesh triangles; a unit
  test drops vertical rays on the same triangles in 3D: difference < 0.05 m). A building covered by the modeled
  water is also marked by its outline on the water surface and a dot, otherwise it could not be seen.

### Counts from the shipped pack (unit test output, 2026-11-14)

| Level, m | Overlap (red) | Within 100 m (yellow) | Outside | Largest depth among red, m |
|---|---|---|---|---|
| 864 (baseline) | 0 | 4 | 33 549 | – |
| 870 | 1 | 20 | 33 532 | 5 |
| 880 | 4 | 21 | 33 528 | 15 |
| 890 | 5 | 23 | 33 525 | 25 |
| 900 | 7 | 28 | 33 518 | 35 |
| 910 | 12 | 27 | 33 514 | 45 |

Of the 12 outlines that overlap the water at 910 m, 9 are from OSM (3 of them tagged `houseboat`) and 3 are
machine-detected. 5 of the 33 553 outlines reach past the edge of the elevation grid and are classified from
the part inside it.

### What these numbers do and do not mean

- 910 m is the reservoir's ordinary full level. An outline that the model puts under water below that level is
  therefore most likely a floating or shoreline structure (the houseboats), a detection error, or an effect of
  the 60 m cells and of positional errors of the outlines (a few metres to tens of metres). The three cannot be
  told apart here. The numbers are small for that reason, and that is the honest result: **the reservoir-level
  model does not reach the town of Nurek, which lies downstream of the dam.**
- Missing outlines are not evidence of no buildings; machine-detected outlines are not evidence of a building.
- No structural, human or economic consequence follows from an overlap of outlines.

### Verification

`npx vitest run src/scenario/buildings.test.ts` (13 tests): outline–cell distance on hand-made cases (overlap,
touch, containment both ways, crossing without contained vertices, gap, courtyard); classes, the 100 m buffer,
ground elevation and depth on a synthetic grid at three levels; the real pack (declared counts, licences, ids,
height bookkeeping); for 864 / 890 / 910 m every red and yellow building and every 50th grey one is re-checked
with a second method (dense point sampling of the outline against the flood mask); classes never go down when
the water rises; depths only on flooded land and never above level − 864 m; placement on the drawn terrain.
`node tests/e2e/scenario-buildings.mjs`.

## 9. Several places from one engine (added 2026-11-14)

The lab now opens on a selection screen (`frontend/src/scenario/LabHome.tsx`). A place is one entry of
`frontend/src/scenario/locations.ts` (what the card shows, camera, height exaggeration, which panel parts its data
support) plus a data pack `/scenario/<id>.json|.bin|_mask.bin` written by `science/geo/build_lakes.py`
(Nurek keeps its own `build_nurek.py`; its files are unchanged). The same code runs every place:
`model.ts` (flood fill, water balance; the level–storage relation is now an interface `Storage` with two
implementations — the published power law, and a published table interpolated linearly), `scene.ts`,
`ScenarioPanel.tsx`. A place without a storage relation gets no water-balance tab and no lowering.

Value classes in the panel: **Observed** (from a source, unchanged), **Derived** (added up from observed data
without a model assumption, e.g. the water layer over the terrain cells), **Modeled**, **Hypothetical** (user input).

Common to the new packs: elevation = Terrain Tiles zoom 10 (about 117–120 m cells; SRTM, February 2000);
lake and dam outlines and place names = OpenStreetMap (ODbL, © OpenStreetMap contributors; **not NASA/USGS**; the
outline is drawn as a line and used in no calculation); rain = NASA POWER climatology for one cell. The dam body
is a barrier mask from the OSM dam outline, because 120 m cells smooth a dam and a flood fill leaks through it
(unit test: Kayrakkum leaks to the grid edge without the barrier).

### 9.1 Bahri Tojik (Kayrakkum Reservoir), Syr Darya

| Quantity | Value | Source |
|---|---|---|
| Water surface in the elevation data | **345 m**, 418.3 km² | SRTM via Terrain Tiles; February 2000 |
| Lake outline in OpenStreetMap | 422.3 km² on the same grid (within 1% of the DEM water; 90%+ of the cells coincide) | OSM relation 12608068, mapping date unknown |
| Full supply level / minimum operation level | 347.5 m / 340.6 m | *Qairokkum HPP Climate Resilience Upgrade — Environmental and Social Appraisal and Action Plan*, Table 1 (copy in the EIB register, <https://www.eib.org/attachments/registers/159697604.pdf>, PDF p. 4–5). The EBRD URL given in the task returned HTTP 404 on 2026-11-14; that this is the same document was not verified |
| Active storage between those two levels | 2300 million m³ "acc. to 2009 survey" (2700 "originally") | same table |
| Total volume at full level | 4160 (CAWater-Info card), 4200 (GIBB dam safety report 2000), 4000 "originally" and **3000 "acc. to 2009 survey"** (appraisal) million m³ | shown side by side in the panel, never mixed |
| Area at full level; length, width, depth | 513 km²; 55 km, 20 km, 25 m | CAWater-Info card <https://www.cawater-info.net/bk/1-1-1-1-3-tj_e.htm> |
| Long-term mean flow at the dam | 520 m³/s (570 m³/s in 2002–2005) | GIBB / IFAS-GEF, *Kayrakkum Dam Safety Assessment Report* (2000), p. 12; appraisal Table 1 |
| Sedimentation | about 25% of the original volume lost by 2009; about 10 million m³ per year now | GCF funding proposal FP040, p. 50 |
| Evaporation from the lake | **not found** | — |

**Storage.** No level–volume or level–area curve of this reservoir was found. The lab therefore shows only an
**approximate storage change**: a straight line between the two levels of one document and its own 2009 storage
figure, ΔV = 2300 million m³ × ΔZ / 6.9 m (333 million m³ per metre). It is marked "≈" and "Approximate"
everywhere, is never shown as a stored volume, and is known to be too small near the full level and too large
near the lowest level (the lake widens upwards). Independent check from the elevation grid for 345 → 347.5 m:
1091 million m³ against 833 from the line (+31%), with 43.6 km² of newly flooded land (461.9 km² in total; the
published 513 km² at 347.5 m is not reached — height systems are not stated in any source and heights are whole
metres). Not used: the formula V = 0.01473·L² − 9.73·L + 1606.1 in Crétaux et al. (2015, ERL 10 015002, Fig. 9
caption): the paper calls the reservoir "Karakul", gives no units next to it and rounds the coefficients so that
absolute volumes are uncertain by ±0.6 km³; the dead-storage level 342.5 m of the 2000 report (a different lower
level than 340.6 m); and the sentence of that report about 0.8 km³ between 347.5 and 348.2 m, which contradicts
the published area.

**Water balance.** Same equation and bounds as §3 (spill above 347.5 m, outflow shortfall at 340.6 m, closure
shown). Inflow default 520 m³/s; outflow default equal to it (our assumption). Rain: NASA POWER on the lake.
**Evaporation is a user input in mm per year, 0 by default**, spread evenly over the year, because no published
figure was found. The lake area used for rain and evaporation is the line's 333 km² at every level.

**Exposure.** Raising above 345 m floods land that is in the elevation data. **Lowering below 345 m — the
drought case — cannot show the land that falls dry**: that ground was under water when SRTM flew. The panel says
so and draws the grey "unknown bed" wall; only the level and the approximate storage change are reported.
No land-cover overlap was built for this place.

### 9.2 Lake Sarez and the Usoi Dam, Pamir

An exploration scene, not a reservoir model. Terrain, the lake as recorded by SRTM (3264 m; radar noise of ±2 m
on the water surface was flattened to that level — 1936 cells changed, counted in `sarez.json`; 68.9 km²), the
OpenStreetMap lake outline (89.8 km² on the grid, relation 1164875; larger than the DEM water, the difference is
not explained here), the Usoi natural dam (OSM relation 17406694), and the two magnitude ≥ 7 earthquakes of the
USGS catalog inside the scene, at their catalog epicentres: 1911-02-18 Mw 7.2 (`iscgem16958134`, 38.289°N
72.596°E — 3 km from the dam) and 2015-12-07 Mww 7.2 (`us100044k6`). The panel lists the six strongest of the 48
catalog events with M ≥ 5.5 since 1900 within 37.3–39.3°N, 71.3–74.3°E (query URL and retrieval time in the pack).

History text and figures (all "Observed", each with its source in the panel): Schuster & Alford (2004, abstract,
<https://www.usgs.gov/node/112371>) — 2 km³ rock slide, 600 m high dam, lake 60 km long, 550 m deep, about 17 km³,
freeboard about 50 m, rise 18.5 cm/yr; Alford & Schuster (eds.) (2000), UN ISDR — surface 3265 m (1999), yearly
fluctuation ±6 m, seepage 45 m³/s since 1943; World Bank ICR0000363 (2007) — villages of Usoi and Sarez, level
3260–3265 m, monitoring and early-warning system since December 2004; NASA Earth Observatory (2002). The 17 km³
and 550 m are **historical reference estimates**, labelled so, and enter no calculation.

Interaction: the level can only be **raised, by at most 20 m** (the dam's lowest point is about 50 m above the
lake). Reported: newly flooded land and the water layer between 3264 m and the chosen level, both "Derived"
from the elevation cells (at +10 m: 10.8 km² and 760 million m³). No lowering, no stored volume, no water
balance: there is no open bathymetry or level–storage curve. **No dam failure, flood wave or downstream hazard
is simulated**, and the panel says why.

### 9.4 Aral Sea — observed history, no model

Code: `frontend/src/scenario/AralPanel.tsx` (panel, globe layer, loader); data `frontend/public/scenario/aral.{bin,json}`
(1.05 MB raw, **15 kB Brotli**) built by `science/geo/aral_probe.py` (download) and `science/geo/build_aral.py`.

**Data.** JRC Global Surface Water v1.4, yearly water classification (Pekel et al. 2016, *Nature* 540, 418–422,
doi:10.1038/nature20584; "Source: EC JRC/Google"; download page: "All data here is produced under the Copernicus
Programme and is provided free of charge, without restriction of use."). 30 m, from Landsat 5/7/8; classes
0 no data, 1 not water, 2 seasonal water, 3 permanent water; **1984–2021 — the last year is 2021 and nothing later
is shown**. Not a NASA/USGS product (it is derived from USGS/NASA Landsat). The per-year tiles were read from the
JRC open-data server with HTTP range requests (about 8 MB per year for the box 57.5–62.5°E, 43–47.5°N); no Earth
Engine account is needed. Packed years: 1987, 1992, 1998, 2000, 2005, 2010, 2015, 2021.

**Method.** For every 32 × 32-pixel block (0.008°, about 0.9 × 0.6 km) the builder keeps the number of permanent,
seasonal and no-data pixels. *Sea region* = blocks at least half water in any packed year, connected to the middle
of the sea (44,509 km²); delta lakes that never touch it are left out. *Areas* = pixel counts × the
true pixel area on the WGS84 ellipsoid at the block's latitude, inside the region ("Derived"). *North / South*:
per year the drawn water blocks are grouped into connected patches; the North (Small) Aral is the patch holding
a point in it (46.5°N 60.7°E), widened by two blocks; the South (Large) Aral is the rest. If that patch reached
south of 45.4°N the year would be reported as one sea (it does not in any packed year at this resolution).
The two lakes are counted separately and **no common water level is assumed**. *Picture*: a block is blue when at
least half of it is permanent water in the year; sand colour = water in the comparison year but not in the year
shown; green = the reverse; grey = no data.

| Year | Permanent water, km² | North Aral | South Aral | Seasonal water, km² | No data in region, km² |
|---|---|---|---|---|---|
| 1987 | 39 426 | 2 984 | 36 442 | 3 819 | 268 |
| 1992 | 36 395 | 3 024 | 33 371 | 1 311 | 302 |
| 1998 | 30 239 | 3 250 | 26 989 | 1 089 | 277 |
| 2000 | 26 440 | 2 899 | 23 542 | 2 788 | 262 |
| 2005 | 19 629 | 2 965 | 16 664 | 2 873 | 261 |
| 2010 | 13 672 | 3 305 | 10 367 | 3 528 | 284 |
| 2015 | 9 210 | 3 288 | 5 922 | 5 972 | 245 |
| 2021 | 5 866 | 3 182 | 2 683 | 1 233 | 241 |

1987 → 2021: −33,561 km² (−85%) of permanent water; the South Aral lost 93% of its 1987 area, the North
Aral is within ±10% of 3 000 km² throughout (the Kok-Aral dam was finished in 2005). The blocks drawn as water add
up to the 30 m sums within 2% in every year (unit test). No-data is below 1% of the region in every packed year.

**History text** follows NASA Earth Observatory, *World of Change: Aral Sea*
(<https://science.nasa.gov/earth/earth-observatory/world-of-change/aral-sea/>): diversion of the Syr Darya and
Amu Darya for irrigation from the 1960s, "once the fourth largest" lake, separation of the North and South Aral,
split of the South Aral into two lobes, Kok-Aral dike and dam "finished in 2005", eastern lobe gone in 2014.

**Not done, on purpose.** No water level, depth, volume, bathymetry or future shoreline: the maps hold none. **The
hypothetical inflow / evaporation experiment asked for in the task is not implemented**: without a level–area–
volume relation per basin a water balance cannot be turned into an area or a shoreline, and inventing one was
ruled out. The panel says this under "What this place cannot show".

### 9.3 Verification

`npx vitest run src/scenario/locations.test.ts` (9 tests): registry ↔ pack consistency; the storage table
(interpolation, exact inverse, area, rejection of bad tables); Kayrakkum (levels and the 2300 million m³ of one
document, no leak with the barrier and a leak without it, agreement of DEM water and OSM outline, conservation
with spill and shortfall, the user-set evaporation depth); Sarez (no storage relation, monotone flooding within
+20 m, never the dam or the grid edge, layer volume between its bounds, the two catalog earthquakes).
`node tests/e2e/scenario-places.mjs`, `node tests/e2e/scenario-aral.mjs`.
Aral unit tests (4, same file): plane sizes and last year 2021; drawn blocks vs reported areas; monotone shrinking,
north + south = whole, no-data < 1%; picture categories.

