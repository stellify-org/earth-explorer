# Data Sources — Feasibility Research

Research date: 2026-11-05. Labels: **[VERIFIED]** = checked against the cited documentation or a live API call on this date. **[ASSUMPTION]** / **[UNVERIFIED]** = not confirmed.

Live checks were made with `curl` from Ubuntu with no credentials. Collection metadata comes from **NASA CMR**, the authoritative EOSDIS metadata catalog (`https://cmr.earthdata.nasa.gov/search/collections.json?short_name=…`). DOIs were resolved through doi.org.

---

## 0. Data kinds — read before using any number

| Kind | What it is | Can it be used for trends? | Examples |
|---|---|---|---|
| **Imagery / visualization** | Pre-rendered, colour-mapped tiles (PNG/JPEG) | **No.** Pixel colours are not measurements. Use for context and visual comparison only | GIBS, Worldview, Landsat true colour |
| **Observation (retrieval)** | A geophysical value derived from a satellite instrument via a retrieval algorithm | Yes, with care: sensor drift, gaps, clouds, version changes | MODIS NDVI/LST/snow, AIRS, OMI, GPM IMERG (merged satellite + gauge) |
| **Reanalysis** | A weather model constrained by assimilated observations, giving a gap-free gridded field | Yes, with care: trends can be affected by changes in the observing system ([Gelaro et al. 2017](https://doi.org/10.1175/JCLI-D-16-0758.1)) | MERRA-2 |
| **Land-surface model output** | A model forced by observations; variables are not measured directly (soil moisture, runoff, ET) | Yes, but as **modelled** estimates. Label them as such | GLDAS Noah |
| **Derived / ARD service** | A re-packaged subset of the above | Inherits the source's properties | NASA POWER (MERRA-2 / CERES / IMERG-based) |
| **Geophysical model** | An interpretive model of the subsurface | Visualization and education. **Not a time series** | CRUST1.0 |
| **Event catalog** | Discrete detected events | Counts and rates only, with care: catalog completeness changes over time | USGS ComCat |

**Rule for the product:** every number shown in Trend Detective must come from an observation, reanalysis or model product with a DOI. GIBS tiles are only ever the backdrop.

---

## 1. Summary matrix

| Source | Kind | Coverage | Native resolution | Time span (verified) | Auth | Quantitative? |
|---|---|---|---|---|---|---|
| NASA GIBS | Imagery | Global (4326/3857/polar) | 250 m – 2 km per layer | Per layer | None | **No** |
| NASA Worldview | Imagery app (uses GIBS) | Global | as GIBS | as GIBS | None | No |
| NASA POWER | Derived ARD | Global | 0.5°×0.625° (met), 1°×1° (solar) | 1981→ (met); 1984→ (solar) | None | **Yes** (point/regional) |
| MERRA-2 M2TMNXSLV / M2TMNXFLX | Reanalysis | Global | 0.625°×0.5° | 1980-01 → present (latest granule 2026-09) | Earthdata Login | **Yes** |
| GLDAS Noah 2.1 monthly | LSM output | Global land | 0.25° | 2000-01 → present (latest 2026-07) | EDL | **Yes** (modelled) |
| GPM IMERG Final V07 monthly | Observation (merged) | Global | 0.1° | 1998-01 → 2025-09 | EDL | **Yes** |
| MODIS MOD13C2 (NDVI/EVI) | Observation | Global land | 0.05° CMG | 2000-02 → present | EDL | **Yes** |
| MODIS MOD11C3 (LST) | Observation | Global land | 0.05° | 2000-02 → present | EDL | **Yes** |
| MODIS MOD10CM (snow cover) | Observation | Global land | 0.05° | 2000-03 → present | EDL | **Yes** |
| MODIS MCD12C1 (land cover) | Classification | Global land | 0.05° | 2001 → present (yearly) | EDL | Categorical (change analysis, not linear trends) |
| AIRS AIRS3STM V7 | Observation | Global | 1° | 2002-09 → present | EDL | **Yes** |
| OMI OMTO3d V004 | Observation | Global | 1° daily | 2004-10 → present | EDL | **Yes** (ozone, aerosol index) |
| GRACE/GRACE-FO JPL mascon RL06.3 v4 | Observation | Global | ~3° mascons on a 0.5° grid [ASSUMPTION about grid] | 2002-04 → present (with a 2017–2018 mission gap [ASSUMPTION]) | EDL | **Yes** (TWS anomalies) |
| Landsat Collection 2 | Observation | Global land | 30 m [not stated on the fetched page] | L1: 1972→; L2: 1982→ | USGS account / open cloud | Yes, but heavy; a later phase |
| NASA Giovanni | Analysis web tool | Global | per dataset | per dataset | EDL | Yes (a cross-check tool) |
| NASA AppEEARS | Subsetting service | Global | per product | per product | EDL (bearer token) | Yes |
| NASA Harmony | Subsetting / regridding service | Global | per product | per product | EDL | Yes |
| NOAA ETOPO 2022 | Topography + bathymetry | Global | 15″ / 30″ / 60″ | Static (2022) | None | Static elevation |
| USGS ComCat (FDSN) | Event catalog | Global | Point events | ~1900s → now (completeness varies) | None | Event statistics |
| CRUST1.0 | Geophysical model | Global | 1°×1°, 8 layers | Static | None | Model / education |
| GEM Global Active Faults | Fault map | Most deforming continental regions | Polyline | Static | None | Map / context |
| NEX-GDDP-CMIP6 (via POWER) | Downscaled climate projections | Global | ~0.25° | 2015 → 2100 | None (via POWER) | Scenario Lab only. **Projections, not observations** |

---

## 2. Per-source details

Each entry answers the ten questions from the mission brief: (1) what it measures, (2) coverage, (3) resolution, (4) time span and update frequency, (5) API and authentication, (6) response format, (7) download and storage size, (8) license and attribution, (9) global exploration, (10) quantitative use or visualization only.

### 2.1 NASA GIBS (Global Imagery Browse Services)

1. **What it is:** pre-rendered visualization tiles of more than 1,000 layers. The live EPSG:4326 `best` GetCapabilities on 2026-11-05 listed **1,332 layers** [VERIFIED]. Layers cover true colour, NDVI, LST, IMERG precipitation rate, MERRA-2 and GLDAS fields, ASTER GDEM shaded relief, and more.
2. **Coverage:** global, in EPSG:4326, **EPSG:3857** (matches the CesiumJS Web Mercator imagery providers), EPSG:3413 and EPSG:3031. Most 4326 layers are also offered in 3857. Source: https://nasa-gibs.github.io/gibs-api-docs/access-basics/ [VERIFIED]
3. **Resolution:** per layer. From the capabilities: `MODIS_Terra_CorrectedReflectance_TrueColor` 250 m; `MODIS_Terra_Land_Surface_Temp_Day` 1 km; `IMERG_Precipitation_Rate` and `MERRA2_*` 2 km tiles. **The tile resolution is not the data resolution**: a MERRA-2 layer is ~50 km data resampled into 2 km tiles. [VERIFIED tile matrix sets]
4. **Time span:** per layer, with a `TIME` dimension. Examples from the capabilities:
   - `MERRA2_2m_Air_Temperature_Assimilated_Monthly` from 1980-01-01, monthly
   - `GLDAS_Near_Surface_Air_Temperature_Monthly` from 2000-01-01
   - `IMERG_Precipitation_Rate` from 2000-06-01, daily
   - true colour: daily from 2000-02-24

   Capabilities list only the latest 100 periods. Use **DescribeDomains** for the full list. [VERIFIED docs]
5. **API:** WMTS (REST and KVP), WMS 1.1.1/1.3.0, TWMS, and XYZ through the WMTS REST path:
   `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{Layer}/default/{Time}/{TileMatrixSet}/{z}/{y}/{x}.{ext}`
   **No authentication** is required for public services. No rate limits are documented. [VERIFIED]
6. **Format:** JPEG or PNG tiles. Colormap and legend metadata are offered per layer. [ASSUMPTION — colormap XML location not re-checked]
7. **Size:** streamed. Nothing to store. A browser tile cache is enough.
8. **License:** NASA data policy, CC0 unless otherwise marked. Acknowledge NASA. See https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance [VERIFIED]. Suggested credit: "Imagery from NASA GIBS, part of NASA's ESDIS."
9. **Global:** yes.
10. **Use:** **visualization only.** Never derive trend numbers from tile colours.

### 2.2 NASA Worldview

A web client built on GIBS (https://worldview.earthdata.nasa.gov). It is useful to discover layer IDs and to check dates visually. It has no separate data API. [UNVERIFIED — the page was not fetched in this session.] License and credit are the same as GIBS.

### 2.3 NASA POWER (Prediction Of Worldwide Energy Resources)

1. **What it measures:** analysis-ready meteorology and solar parameters (T2M, precipitation, humidity, wind, radiation, and others). Source datasets: **MERRA-2** and GEOS-IT for meteorology; **CERES SYN1deg**, FLASHFlux and GEWEX SRB for radiation; **IMERG** and **SMAP L4** as high-resolution sources; **NEX-GDDP-CMIP6** for projections. See https://power.larc.nasa.gov/docs/methodology/ [VERIFIED]
2. **Coverage:** global.
3. **Resolution:** meteorology ½°×⅝° (the MERRA-2 grid); radiation 1°×1°; IMERG 0.1°; SMAP L4 ~9 km; CMIP6 ~0.25°. [VERIFIED]
4. **Time span:** meteorology from 1981 "through the previous year" in the monthly API; solar from 1984. Monthly values are returned per month, plus a **"13" key = annual mean**. A live response for `T2M` at 38.56°N 68.78°E (Dushanbe area) declared `"sources":["MERRA2"]` and API v2.10.0. [VERIFIED live call]
5. **API:** no authentication.
   - Point: `https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=T2M,PRECTOTCORR&community=AG&longitude=..&latitude=..&start=YYYY&end=YYYY&format=JSON`
   - Regional: `/api/temporal/monthly/regional?latitude-min=..&latitude-max=..&longitude-min=..&longitude-max=..&parameters=T2M&community=..&start=..&end=..&format=CSV`
   - Limits: max **20 parameters per point request**; **1 parameter per regional request**. HTTP 429 exists, but no thresholds are published. Daily, hourly and climatology endpoints also exist. See https://power.larc.nasa.gov/docs/services/api/temporal/monthly/ [VERIFIED]
   - The maximum regional bounding-box size was not stated. [UNVERIFIED]
6. **Format:** JSON (GeoJSON Feature), CSV, ASCII, NetCDF. Fill value −999. [VERIFIED]
7. **Size:** a point request for 24 years × 2 parameters was **9.4 KB** in **1.3 s** [VERIFIED live]. Negligible.
8. **License:** NASA data, CC0-style. Cite POWER and its upstream sources. [ASSUMPTION — the POWER-specific citation text was not fetched]
9. **Global:** yes, any lat/lon.
10. **Use:** **quantitative.** It is the fastest path to a valid demo for arbitrary points. Limitations: it is a re-packaging of MERRA-2 and others at coarse resolution, and point values are grid-cell values, not station measurements.

### 2.4 MERRA-2 (Modern-Era Retrospective analysis for Research and Applications, v2)

1. **What it measures:** atmospheric reanalysis. `M2TMNXSLV` has single-level diagnostics: T2M, T10M, SLP, QV2M, winds, TS, and more. `M2TMNXFLX` has surface fluxes, including precipitation (PRECTOT). [VERIFIED collection titles via CMR]
2. **Coverage:** global, `-90 -180 90 180`.
3. **Resolution:** **0.625° lon × 0.5° lat** (576×361 grid).
4. **Time span:** monthly, **1980-01 → present**. The latest granule in CMR was **2026-09**, so latency is about 1–2 months. [VERIFIED CMR]
5. **API:** Earthdata Login is required.
   - Direct HTTPS: `https://data.gesdisc.earthdata.nasa.gov/data/MERRA2_MONTHLY/M2TMNXSLV.5.12.4/YYYY/MERRA2_400.tavgM_2d_slv_Nx.YYYYMM.nc4`
   - **Cloud OPeNDAP** for variable and spatial subsetting: `https://opendap.earthdata.nasa.gov/collections/C1276812859-GES_DISC/granules/…`
   - Also Harmony and S3 (us-west-2 only). [VERIFIED links in the CMR granule record]
6. **Format:** NetCDF-4 (`.nc4`).
7. **Size:** **75.2 MB per monthly granule** (all variables) [VERIFIED CMR]. Full SLV collection 1980–2026 ≈ 550 granules × 75 MB ≈ **41 GB** — **do not download whole granules.** One float32 variable globally ≈ 0.83 MB/month, so the full record is ≈ **0.45 GB per variable** uncompressed [computed]. Use OPeNDAP or Harmony variable subsets.
8. **License:** NASA, CC0-style. Cite: GMAO (2015), MERRA-2 tavgM_2d_slv_Nx V5.12.4, **doi:10.5067/AP1B0BA5PD2K**; flux collection **doi:10.5067/0JRLVL8YV2Y4**; reference paper Gelaro et al. 2017, **doi:10.1175/JCLI-D-16-0758.1**. [VERIFIED DOIs]
9. **Global:** yes. It also has pressure levels (the `M2IMNPASM`-type collections) for the "levels of the atmosphere" angle. [ASSUMPTION — exact pressure-level collection not checked]
10. **Use:** **quantitative**, a primary trend source. Caveat: reanalysis trends can include artefacts from changes in the assimilated observing system.

### 2.5 GLDAS Noah Land Surface Model L4 monthly 0.25° v2.1

1. **What it measures:** modelled land states and fluxes — soil moisture (several layers), evapotranspiration, runoff, snow water equivalent, land-surface temperature, forcing precipitation. This covers the challenge's "evaporation or streamflow"-type variables.
2. **Coverage:** global land (60°S–90°N [ASSUMPTION]).
3. **Resolution:** **0.25°**. [VERIFIED CMR title]
4. **Time span:** **2000-01 → present**. The latest granule was 2026-07. [VERIFIED CMR] (GLDAS-2.0 extends back to 1948 at 0.25°/1° [ASSUMPTION, not checked].)
5. **API:** EDL. HTTPS: `https://data.gesdisc.earthdata.nasa.gov/data/GLDAS/GLDAS_NOAH025_M.2.1/YYYY/GLDAS_NOAH025_M.AYYYYMM.021.nc4`, plus OPeNDAP and Harmony. [VERIFIED]
6. **Format:** NetCDF-4.
7. **Size:** **23.4 MB per granule** [VERIFIED] × ~320 months ≈ 7.5 GB for all variables. One variable ≈ 3.5 MB/month, so ≈ **1.1 GB per variable** globally [computed].
8. **License:** NASA. Cite Beaudoing, Rodell & HSL (2020), **doi:10.5067/SXAVCZFAQLNO**. [VERIFIED]
9. **Global:** yes (land only).
10. **Use:** **quantitative, but modelled.** The UI must say "model estimate".

### 2.6 GPM IMERG Final Precipitation L3 monthly 0.1° V07

1. **What it measures:** precipitation rate, merging multi-satellite microwave and IR data with gauge calibration.
2. **Coverage:** global. [ASSUMPTION — V07 covers more of the high latitudes than V06, with quality caveats there]
3. **Resolution:** **0.1°**.
4. **Time span:** **1998-01 → 2025-09** (Final run latency is several months). [VERIFIED CMR] The GIBS daily layer starts 2000-06.
5. **API:** EDL. HTTPS: `https://data.gesdisc.earthdata.nasa.gov/data/GPM_L3/GPM_3IMERGM.07/YYYY/3B-MO.MS.MRG.3IMERG.YYYYMM01-S000000-E235959.MM.V07B.HDF5`, plus OPeNDAP. [VERIFIED]
6. **Format:** HDF5.
7. **Size:** **18.3 MB per granule** [VERIFIED] × ~333 ≈ 6 GB. One float32 variable at 3600×1800 ≈ 26 MB/month, so ≈ **8.6 GB** for the full record globally at native resolution [computed]. **Regrid to 0.25°–0.5° for global maps**, and keep 0.1° only for the demo region.
8. **License:** NASA. **doi:10.5067/GPM/IMERG/3B-MONTH/07**. [VERIFIED via CMR]
9. **Global:** yes.
10. **Use:** **quantitative.** Caveats: input satellite constellation changes over time; mountain and snowfall retrievals are weaker, which matters for the Pamirs.

### 2.7 MODIS (Terra) monthly CMG products, Collection 6.1

| Product | Variable | Res | Span [VERIFIED CMR] | Granule size | DOI [VERIFIED] |
|---|---|---|---|---|---|
| MOD13C2 | NDVI, EVI | 0.05° | 2000-02 → | **100.6 MB** | 10.5067/MODIS/MOD13C2.061 |
| MOD11C3 | Land-surface temperature (day/night) | 0.05° | 2000-02 → | **73.6 MB** | 10.5067/MODIS/MOD11C3.061 |
| MOD10CM | Snow cover fraction | 0.05° | 2000-03 → | n/a | 10.5067/MODIS/MOD10CM.061 (NSIDC) |
| MCD12C1 | Land-cover type (yearly) | 0.05° | 2001 → | n/a | 10.5067/MODIS/MCD12C1.061 |
| MOD13A3 | NDVI 1 km (sinusoidal tiles) | 1 km | 2000-02 → | n/a | — |

- **Access:** EDL. HDF4 files on LP DAAC Cloud (`data.lpdaac.earthdatacloud.nasa.gov/lp-prod-protected/…`) and NSIDC. CMR reports `has_spatial_subsetting: false` for these collections, so use **AppEEARS** (§2.12) for regional subsets, or download the global CMG granules. [VERIFIED CMR flag]
- **Storage:** NDVI CMG as int16 ≈ 52 MB per month per band, ≈ 16 GB for 26 years globally [computed]. **Coarsen to 0.25° for global maps** (≈ 0.66 GB per variable). Keep 0.05° only for regional demos.
- **Use:** quantitative. Caveats: the Terra orbit is drifting toward the end of the mission (the overpass time is changing), so late-record LST/NDVI trends need caution [ASSUMPTION — the size of the effect for C6.1 CMG products was not checked]. Cloud contamination; quality-assurance layers must be applied.
- **Credit:** cite each DOI; LP DAAC / NSIDC.

### 2.8 AIRS (Aqua) L3 monthly V7.0, 1°

- **What it measures:** surface and profile air temperature, humidity, and more (the challenge's "levels of the atmosphere").
- **Coverage and resolution:** global, 1°.
- **Time span:** 2002-09 → present. [VERIFIED CMR]
- **Access:** EDL, HDF/NetCDF, OPeNDAP-capable (`has_spatial_subsetting: true`).
- **DOI:** **10.5067/UBENJB9D3T2H**. [VERIFIED]
- **Use:** quantitative, as an independent satellite cross-check of MERRA-2 temperature.

### 2.9 OMI (Aura) OMTO3d V004, 1° daily

- **What it measures:** total column ozone, UV aerosol index, cloud radiance fraction. Global, 1°, **2004-10 → present**. [VERIFIED CMR]
- **DOI:** **10.5067/Aura/OMI/DATA3401**. [VERIFIED]
- **Caveat:** the OMI "row anomaly" has reduced the usable swath since 2007–2008 [ASSUMPTION — well-known, but not re-checked here]. Aggregate daily data to monthly with coverage thresholds.
- **Note:** the GIBS layer `OMI_Aerosol_Index` showed a short listed range (2004-10 → 2006-02) in the first `Value` element of the capabilities. Other ranges may be listed. Use DescribeDomains. [VERIFIED partial]

### 2.10 GRACE / GRACE-FO JPL Mascon RL06.3 v4 (CRI)

- **What it measures:** terrestrial water storage (equivalent water height) anomalies. This is highly relevant to Central Asian water (Amu Darya / Syr Darya, Aral Sea).
- **Time span:** 2002-04 → present. [VERIFIED CMR] Expect monthly gaps and the 2017-07 → 2018-06 gap between missions [ASSUMPTION].
- **Access:** PO.DAAC, EDL. **DOI:** 10.5067/TEMSC-3JC634. [VERIFIED]
- **Resolution:** effective ~300 km mascons, so it is **only meaningful for large basins**, not for valleys. The UI must say so.
- **Use:** quantitative at basin scale.

### 2.11 Landsat Collection 2 (USGS)

- **Time span:** Level-1 from 1972; Level-2 surface reflectance and temperature from 1982. Cloud-Optimized GeoTIFF. USGS open data policy since 2008. Cite Crawford et al. 2023, **doi:10.1016/j.srs.2023.100103**. Source: https://www.usgs.gov/landsat-missions/landsat-collection-2 [VERIFIED]
- **Resolution:** 30 m (OLI/TM multispectral) — not stated on the fetched page. [ASSUMPTION, standard]
- **Access:** USGS EarthExplorer / M2M API (USGS account), plus commercial-cloud mirrors. Details not verified this session. NASA **HLS** (Harmonized Landsat-Sentinel, 30 m, from 2013) is available on GIBS (`HLS_L30_Nadir_BRDF_Adjusted_Reflectance`) and LP DAAC.
- **Use:** quantitative at local scale, but data-heavy and cloud-affected. **Not in the MVP.** Use it later for Time Travel at the local scale (for example, reservoir shorelines).

### 2.12 NASA AppEEARS

- **What it does:** point or area subsets of MODIS, VIIRS, SMAP, Landsat-derived and other products, with quality layers.
- **API base:** `https://appeears.earthdatacloud.nasa.gov/api/`
  - `POST /login` with EDL Basic auth returns a **Bearer token valid ~48 h**.
  - `POST /task` for point or area tasks (GeoJSON or bbox).
  - `GET /status/{id}`; `GET /bundle/{id}` (S3 links valid 48 h).
  - Area outputs: **GeoTIFF or NetCDF4**. HTTP 429 when throttled; numeric limits are not published.
  - Source: https://appeears.earthdatacloud.nasa.gov/api/ [VERIFIED]
- **Use:** quantitative. **Asynchronous** — a task can take minutes to hours [ASSUMPTION], so **pre-fetch demo regions**. Do not call it live during a demo.

### 2.13 NASA Harmony

- **What it does:** subsetting by variable, bbox, polygon or time; reformatting (NetCDF, CSV, GeoTIFF, PNG); reprojection, regridding, and time/area averaging. Jobs are asynchronous.
- **API:** OGC Coverages pattern `https://harmony.earthdata.nasa.gov/{collectionId}/ogc-api-coverages/1.0.0/{variable}/coverage/rangeset`. EDL `.netrc` or Bearer token. `harmony-py` client. Check `/capabilities` per collection. Jobs over 300 granules auto-pause unless `skipPreview=true`.
- **Source:** https://harmony.earthdata.nasa.gov/docs [VERIFIED]
- **Use:** quantitative. A strong candidate for the ETL step (one job per variable and region instead of hundreds of granule downloads). [ASSUMPTION — which services Harmony actually chains for each of our collections must be checked via `/capabilities`]

### 2.14 NASA Giovanni

- **What it is:** a web-based analysis tool from GES DISC (maps, area-averaged time series, Hovmöller diagrams, and more). Version **4.40** was shown on https://giovanni.gsfc.nasa.gov/giovanni/ [VERIFIED].
- It was operating in 2026: an outage notice for 2026-04-08 and new Cloud Giovanni hydrology products from 2026-04-02 appeared in Earthdata alerts [VERIFIED via search snippets]. No retirement announcement was found.
- **EDL:** required for data download [ASSUMPTION]. A scriptable API was **not verified**.
- **Use:** an **independent cross-check** — reproduce one of our area-averaged series in Giovanni and show the agreement in the demo. That is a strong credibility signal. Not a runtime dependency.

### 2.15 NOAA ETOPO 2022

- **What it is:** global relief model merging topography, bathymetry and shorelines. **15″, 30″, 60″**. **Ice-surface** and **bedrock** versions, plus a geoid layer. GeoTIFF and netCDF. Grid Extract tool, direct download and THREDDS.
- **DOI:** **10.25921/fd45-gt74**.
- **Source:** https://www.ncei.noaa.gov/products/etopo-global-relief-model [VERIFIED]
- **License:** not stated on the page. NOAA data are generally public domain [ASSUMPTION]. Cite the DOI.
- **Size:** not stated. [UNVERIFIED — the 15″ global tiles are known to be multi-GB; 60″ is a few hundred MB [ASSUMPTION]]
- **Use:** quantitative static elevation. Use it for seafloor and X-Ray Earth, and as an open terrain fallback (60″ ≈ 1.8 km, enough at globe scale). Note: bathymetry in many ocean areas is interpolated or predicted, not surveyed (sourceID layer at 15″).

### 2.16 USGS Earthquake Catalog (ComCat, FDSN Event Web Service)

- **Endpoint:** `https://earthquake.usgs.gov/fdsnws/event/1/query`, with parameters `starttime`, `endtime`, bounding box or radius, `minmagnitude`, `mindepth`/`maxdepth`, `format=geojson|csv|quakeml|kml|text`. **Max 20,000 events per request** (HTTP 400 above that); a `count` endpoint exists. **No authentication.** Source: https://earthquake.usgs.gov/fdsnws/event/1/ [VERIFIED]
- **Live check:** `count` for bbox 36.6–41.1°N, 67.3–75.2°E (Tajikistan plus neighbouring Hindu Kush, Fergana and Pamir areas), M≥4, since 2000-01-01 → **3,693 events** [VERIFIED].
- **Size:** GeoJSON ≈ 1–2 KB per event [ASSUMPTION], so a regional catalog is a few MB.
- **License:** USGS public domain [ASSUMPTION — standard USGS policy, not re-checked]. Credit: "USGS ComCat".
- **Use:** event visualization (3D hypocentres) and descriptive statistics. **Catalog completeness changes over time and by region**, so raw counts over time are **not** a valid trend in seismicity.

### 2.17 CRUST1.0

- **What it is:** a 1°×1° global crustal model. 8 layers: water, ice, three sediment layers, upper/middle/lower crust, plus the mantle below the Moho. Each layer has Vp, Vs, density and boundary depths; Moho depth and crustal thickness are given as XYZ files. Elastic parameters are assigned from fewer than 40 crustal types.
- **Citation:** Laske, G., Masters, G., Ma, Z., Pasyanos, M. (2013), *Update on CRUST1.0 – A 1-degree Global Model of Earth's Crust*, Geophys. Res. Abstracts 15, EGU2013-2658.
- **Source:** https://igppweb.ucsd.edu/~gabi/crust1.html [VERIFIED]
- **License:** **not stated.** The page asks for citation. [Risk: under the Space Apps "freely available" rule this is probably fine, but get it confirmed.] Size: small (tens of MB) [ASSUMPTION].
- **Use:** **model**, for visualization and education only. The UI must label it as interpolated by crustal type, and it is not a cross-section of any real borehole.

### 2.18 GEM Global Active Faults Database

- **What it is:** fault traces with kinematics and slip-rate attributes. Covers most deforming continental regions, with gaps (Malay Archipelago, Madagascar, Canada). **GeoJSON** is the version of record. **License CC BY-SA 4.0.** Cite Styron & Pagani (2020), Earthquake Spectra 36(1S), **doi:10.1177/8755293020944182**. Source: https://github.com/GEMScienceTools/gem-global-active-faults [VERIFIED]
- **Use:** context layer for X-Ray Earth. Note: the share-alike licence applies to derived fault data.

### 2.19 EarthScope

The mission brief lists "EarthScope CRUST1.0", but CRUST1.0 is hosted by UCSD/IGPP (§2.17). EarthScope Consortium (formerly IRIS/UNAVCO) hosts seismic and geodetic data services and the EMC Earth model collection [ASSUMPTION — not checked this session]. Possible later source for 3D velocity models. Not needed for the MVP.

### 2.20 Basemap, terrain and 3D buildings options

| Option | License / terms | Fits the Space Apps open-materials rule? |
|---|---|---|
| **CesiumJS** library | **Apache-2.0** [VERIFIED, GitHub LICENSE.md] | Yes |
| **Cesium ion** (World Terrain, OSM Buildings, Bing/Google imagery, Google Photorealistic 3D Tiles) | Free *Community* tier: "personal and non-commercial use"; also unfunded educational activities. 10 GB storage, **15 GB/month streaming**, Google 3D Tiles **1,000 root tiles/month**, Global Imagery 1,000 sessions/month. Source: https://cesium.com/pricing/ [VERIFIED] | **Risky.** These are proprietary services, not "freely available without restriction". Optional only, with a toggle and attribution |
| **GIBS** imagery | NASA | Yes |
| **ETOPO 2022** (self-made quantized-mesh or heightmap terrain) | NOAA | Yes [ASSUMPTION about the license] |
| **OpenStreetMap** buildings (self-served) | ODbL (open database licence; not an OSI software licence) [ASSUMPTION] | Probably yes as data. Confirm |

**Street level:** there is **no open, global street-level 3D dataset**. Photorealistic city meshes are proprietary (Google). The product must say "street-level detail where available" and show open coverage honestly.

---

## 3. Access infrastructure

- **Earthdata Login (EDL):** free account at https://urs.earthdata.nasa.gov/. Required for GES DISC (MERRA-2, GLDAS, IMERG, AIRS, OMI), LP DAAC (MODIS), PO.DAAC (GRACE), AppEEARS and Harmony.
  - **Never ship EDL credentials to the browser.** The backend or ETL holds one service token.
- **CMR** (`cmr.earthdata.nasa.gov/search`): public, unauthenticated metadata search for collections, granules and variables. It was used for this research. [VERIFIED]
- **Python tooling** (checked on PyPI 2026-11-05):

  | Package | Version | License |
  |---|---|---|
  | `earthaccess` | 0.19.0 | MIT |
  | `xarray` | 2026.9.0 | license not shown on PyPI |
  | `pydap` | 3.5.11 | MIT |
  | `zarr` | 3.4.2 | MIT |
  | `rioxarray` | 0.24.0 | Apache-2.0 |
  | `statsmodels` | 0.15.0 | BSD-3 |
  | `pymannkendall` | 1.4.3 | MIT (paper doi:10.21105/joss.01556) |

  [VERIFIED versions and licenses]
- **Go:** `gonum` is BSD-3-Clause [VERIFIED].

---

## 4. Storage budget (computed estimates)

Working machine: 38 GB free disk, 15 GB RAM. Aim for **≤ 10 GB** locally.

| Dataset slice | Grid | Months | Approx. size (float32, uncompressed) |
|---|---|---|---|
| MERRA-2 T2M + PRECTOT, global | 576×361 | ~550 | 0.9 GB |
| GLDAS 4 variables (SoilMoi, Evap, Qs runoff, SWE), global | 1440×600 | ~320 | 4.4 GB → **coarsen to 0.5°: ~1.1 GB** |
| IMERG precip, global at 0.5° + demo region at 0.1° | 720×360 + small | ~333 | ~0.35 GB + <0.1 GB |
| MODIS NDVI, LST, snow at 0.25° global + 0.05° demo region | 1440×720 | ~320 | ~4 GB → as int16/compressed **~1.5 GB** |
| AIRS, OMI, GRACE | ≤1° | ~250 | < 0.3 GB |
| USGS events (region), CRUST1.0, GEM faults, ETOPO 60″ | — | — | < 1 GB |
| **Total** | | | **≈ 5–6 GB** (compressed Zarr/NetCDF; compression would likely cut 2–4×) |

Download volume roughly equals stored volume **if** OPeNDAP, Harmony or AppEEARS subsetting is used. Without subsetting it is 10–50× larger.

**Important time constraint [ASSUMPTION]:** pulling ~550 monthly OPeNDAP subsets per variable can take hours. During the hackathon, start the ETL in the background on day 1, morning. Write to files so the result survives a crash (this machine has a history of OOM kills).
