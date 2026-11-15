# Fixtures

Real API responses saved verbatim for reproducible tests. They are **real NASA data**,
retrieved on **2026-11-05** with `curl`, no credentials. Do not edit them by hand.

| File | Request |
|---|---|
| `power_monthly_T2M_PRECTOTCORR_38.56N_68.78E_1981-2025.json` | NASA POWER v2.10.0, `/api/temporal/monthly/point?parameters=T2M,PRECTOTCORR&community=AG&longitude=68.78&latitude=38.56&start=1981&end=2025&format=JSON` (Dushanbe area, Tajikistan) |
| `power_monthly_T2M_PRECTOTCORR_-3.0S_-60.0W_1981-2025.json` | same, `longitude=-60.0&latitude=-3.0` (central Amazon basin, near Manaus) |

Data reference (POWER template): "The data was obtained from the POWER Project's Monthly
2.10.0 version on 2026/11/05." POWER is funded through the NASA Earth Science Division
(NASA Langley Research Center). Upstream source declared in the response: MERRA-2.

Synthetic series used in `backend/internal/stats/testdata/stats_reference.json` are
generated with a fixed seed and are labelled `synthetic` — they are **not** measurements.
| `usgs_fdsn_tajikistan_2020-2024_M5.geojson` | USGS FDSN event service, `format=geojson&starttime=2020-01-01T00:00:00&endtime=2024-12-31T23:59:59&minlatitude=36.6&maxlatitude=41.1&minlongitude=67.3&maxlongitude=75.2&minmagnitude=5.0&orderby=magnitude&limit=2000` (retrieved 2026-11-05) |

`backend/internal/gibs/testdata/capabilities_subset.xml` is a 5-layer excerpt of the real
GIBS EPSG:3857 `best` GetCapabilities document retrieved on 2026-11-05.
| `power_regional_T2M_34-44N_64-74E_2024.json` | NASA POWER v2.10.0 `/api/temporal/monthly/regional?latitude-min=34&latitude-max=44&longitude-min=64&longitude-max=74&parameters=T2M&community=AG&start=2024&end=2024&format=JSON` (retrieved 2026-11-05; 336 MERRA-2 grid nodes) |

`eonet_v3_events_5-of-1730_2026-11-14.json` holds 5 of the 1730 event records of the real NASA EONET v3
response `https://eonet.gsfc.nasa.gov/api/v3/events?status=all&days=60` (retrieved 2026-11-14): one IRWIN
wildfire, one GDACS wildfire, the smallest GDACS flood polygon, Typhoon Dujuan (24 positions) and one
iceberg. The records are unchanged; only the other 1725 were left out to keep the file small (5.4 MB → 6 kB).

`shakemap_us100044k6/` holds real USGS answers for the M 7.2 earthquake of 2015-12-07 (104 km W of Murghob,
Tajikistan), retrieved 2026-11-15: `detail.geojson` is the event detail
(`https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=us100044k6&format=geojson`) reduced to the fields the
adapter reads and to the first ShakeMap product with five of its file entries (102 kB → 3 kB; values unchanged);
`coverage_mmi_low_res.covjson`, `rupture.json` and `stationlist.json` are the unchanged product files
(ShakeMap Atlas version 1, processed 2020-06-03). The station file has broken coordinates in the source
(longitude 0); the test checks that such points are dropped. The two "later earthquakes" in
`backend/internal/evidence/evidence_test.go` are **synthetic** and labelled so in the test.

