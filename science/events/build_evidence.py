#!/usr/bin/env python3
"""Build small "evidence packs" for Event Detective (frontend/public/evidence/<event id>.json).

A pack holds the documented geographic evidence of ONE catalogue event, taken from open sources and
reduced to what a slow connection can carry. Nothing is modelled or invented here: every layer is a
copy (clipped, simplified or re-encoded) of a published dataset, and carries its source, date,
resolution and an evidence class (observed / satellite / model / reported / context).

  science/.venv/bin/python -I science/events/build_evidence.py wildfire     # Park Fire 2024 (EONET_9035)
  science/.venv/bin/python -I science/events/build_evidence.py hurricane    # Milton 2024 (EONET_11536)
  science/.venv/bin/python -I science/events/build_evidence.py flood-scan   # which recent EONET floods have mapped floodwater
  science/.venv/bin/python -I science/events/build_evidence.py flood EONET_xxxxx 2026-11-01 2026-11-09 ...

Downloads are cached in data/cache/evidence/ (git-ignored). Needs numpy, Pillow, shapely (science/requirements.txt).
"""
from __future__ import annotations

import datetime as dt
import gzip
import io
import json
import math
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image
from shapely import prepared
from shapely.geometry import Point, mapping, shape

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import mvt  # noqa: E402  (minimal vector-tile reader next to this file)

ROOT = HERE.parent.parent
OUT = ROOT / "frontend" / "public" / "evidence"
CACHE = ROOT / "data" / "cache" / "evidence"
UA = "earth-explorer-evidence-builder"
TODAY = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")
GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best"
IMERG_LEGEND = "https://gibs.earthdata.nasa.gov/legends/GPM_Precipitation_Rate_H.svg"
R_EARTH = 6371.0088


def fetch(url: str, name: str, optional: bool = False) -> bytes | None:
    """Download once; later runs read the cached copy. `optional`: a 4xx answer is remembered as "no data"."""
    p = CACHE / name
    miss = p.with_suffix(p.suffix + ".missing")
    if p.exists():
        return p.read_bytes()
    if miss.exists():
        return None
    p.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=90) as r:
                b = r.read()
            p.write_bytes(b)
            return b
        except urllib.error.HTTPError as e:
            if optional and 400 <= e.code < 500:
                miss.write_text(str(e.code))
                return None
            if attempt == 3:
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt == 3:
                raise
        time.sleep(2 + 3 * attempt)
    return None


def write_pack(event_id: str, pack: dict) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    p = OUT / f"{event_id}.json"
    p.write_text(json.dumps(pack, separators=(",", ":"), ensure_ascii=False))
    print(f"wrote {p.relative_to(ROOT)}  {p.stat().st_size / 1e3:.1f} kB  gzip {len(gzip.compress(p.read_bytes())) / 1e3:.1f} kB")


def ms(t: dt.datetime) -> int:
    return int(t.replace(tzinfo=dt.timezone.utc).timestamp() * 1000)


def sphere_area_km2(geom) -> float:
    """Area of a lon/lat polygon on the sphere (cylindrical equal-area projection is exact for this)."""
    def ring(coords):
        a = np.asarray(coords, float)
        x = np.radians(a[:, 0]) * R_EARTH
        y = np.sin(np.radians(a[:, 1])) * R_EARTH
        return abs(float(np.sum(x[:-1] * y[1:] - x[1:] * y[:-1])) / 2)
    polys = geom.geoms if geom.geom_type == "MultiPolygon" else [geom]
    return sum(ring(p.exterior.coords) - sum(ring(i.coords) for i in p.interiors) for p in polys)


def rings_of(geom, nd=4) -> list:
    """[polygon][ring][vertex][lon, lat]"""
    polys = geom.geoms if geom.geom_type == "MultiPolygon" else [geom]
    return [[[[round(x, nd), round(y, nd)] for x, y in r.coords] for r in [p.exterior, *p.interiors]] for p in polys]


PARK = {
    "event": "EONET_9035",
    "fire_id": "2024-CABTU-013761",
    "first": dt.date(2024, 7, 24),
    "last": dt.date(2024, 8, 31),
}
WFIGS = "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters/FeatureServer/0/query"
THERMAL = [("N20", "VIIRS_NOAA20_Thermal_Anomalies_375m_All", "NOAA-20"), ("N21", "VIIRS_NOAA21_Thermal_Anomalies_375m_All", "NOAA-21"),
           ("SNPP", "VIIRS_SNPP_Thermal_Anomalies_375m_All", "Suomi NPP")]
THERMAL_LEVEL = 7
BUFFER_DEG = 0.01


def thermal_tiles(bbox, level=THERMAL_LEVEL):
    span = 288 / 2 ** level
    w, s, e, n = bbox
    for row in range(int((90 - n) // span), int((90 - s) // span) + 1):
        for col in range(int((w + 180) // span), int((e + 180) // span) + 1):
            yield row, col


def wildfire() -> None:
    q = urllib.parse.urlencode({"where": f"attr_UniqueFireIdentifier='{PARK['fire_id']}'", "outFields": "*", "outSR": 4326, "f": "geojson"})
    perim_url = f"{WFIGS}?{q}"
    fc = json.loads(fetch(perim_url, "park/wfigs_perimeter.geojson"))
    assert len(fc["features"]) == 1, len(fc["features"])
    f = fc["features"][0]
    a = f["properties"]
    geom = shape(f["geometry"])
    if not geom.is_valid:
        geom = geom.buffer(0)
    n_src = sum(len(r) for p in rings_of(geom) for r in p)
    simple = geom.simplify(0.0007, preserve_topology=True)
    n_out = sum(len(r) for p in rings_of(simple) for r in p)
    area_src = sphere_area_km2(geom)
    area_simple = sphere_area_km2(simple)
    print(f"perimeter: {a['attr_IncidentName']} {a['poly_GISAcres']:.0f} GIS acres; {n_src} -> {n_out} vertices; "
          f"area on the sphere {area_src:.1f} km2 (simplified {area_simple:.1f} km2, {100 * (area_simple / area_src - 1):+.2f}%)")

    eonet_url = f"https://eonet.gsfc.nasa.gov/api/v3/events/{PARK['event']}"
    ev = json.loads(fetch(eonet_url, "park/eonet.json"))
    elon, elat = ev["geometry"][0]["coordinates"]
    dist = math.hypot((elon - a["attr_InitialLongitude"]) * math.cos(math.radians(elat)), elat - a["attr_InitialLatitude"]) * 111.2
    assert dist < 0.2, f"EONET point is {dist:.2f} km from the WFIGS point of origin"
    print(f"association: EONET {PARK['event']} point is {dist * 1000:.0f} m from the WFIGS point of origin; title {ev['title']!r}")

    w, s, e, n = geom.bounds
    box = (w - 0.15, s - 0.15, e + 0.15, n + 0.15)
    keep = prepared.prep(geom.buffer(BUFFER_DEG))
    rows, seen = [], set()
    per_sat = {}
    near_outside = 0
    days_no_data = {k: 0 for k, _, _ in THERMAL}
    day = PARK["first"]
    while day <= PARK["last"]:
        for si, (code, layer, _) in enumerate(THERMAL):
            got_any = False
            for row, col in thermal_tiles(box):
                b = fetch(f"{GIBS}/{layer}/default/{day}/500m/{THERMAL_LEVEL}/{row}/{col}.mvt", f"park/thermal/{code}_{day}_{row}_{col}.mvt", optional=True)
                if b is None:
                    continue
                got_any = True
                if b[:2] == b"\x1f\x8b":
                    b = gzip.decompress(b)
                for lay in mvt.decode_points(b).values():
                    for ft in lay["features"]:
                        p = ft["props"]
                        lon, lat = float(p["LONGITUDE"]), float(p["LATITUDE"])
                        if not (box[0] <= lon <= box[2] and box[1] <= lat <= box[3]):
                            continue
                        key = (code, p["ACQ_DATE"], p["ACQ_TIME"], round(lon, 5), round(lat, 5))
                        if key in seen:
                            continue
                        seen.add(key)
                        if not keep.contains(Point(lon, lat)):
                            near_outside += 1
                            continue
                        hh, mm = str(p["ACQ_TIME"]).split(":")
                        t = dt.datetime.fromisoformat(str(p["ACQ_DATE"])) + dt.timedelta(hours=int(hh), minutes=int(mm))
                        rows.append((ms(t), lon, lat, float(p.get("FRP") or 0), si, str(p.get("CONFIDENCE", "")), str(p.get("VERSION", ""))))
                        per_sat[code] = per_sat.get(code, 0) + 1
            if not got_any:
                days_no_data[code] += 1
        day += dt.timedelta(days=1)
    rows.sort()
    assert rows, "no thermal detections found"
    versions = sorted({r[6] for r in rows})
    conf = {}
    for r in rows:
        conf[r[5]] = conf.get(r[5], 0) + 1
    t0 = rows[0][0]
    print(f"thermal detections inside the perimeter (+{BUFFER_DEG}°): {len(rows)} {per_sat}; excluded in the surrounding box: {near_outside}; "
          f"confidence {conf}; versions {versions}; days without a tile {days_no_data}")
    first_day, last_day = dt.datetime.fromtimestamp(rows[0][0] / 1000, dt.timezone.utc), dt.datetime.fromtimestamp(rows[-1][0] / 1000, dt.timezone.utc)

    days = sorted({r[0] // 86_400_000 for r in rows})
    steps = [{"t": (d + 1) * 86_400_000 - 1, "label": dt.datetime.fromtimestamp(d * 86400, dt.timezone.utc).strftime("%Y-%m-%d")} for d in days]

    acres = a["poly_GISAcres"]
    pack = {
        "schema": 1, "event_id": PARK["event"], "category": "wildfires", "built_at": TODAY, "builder": "science/events/build_evidence.py wildfire",
        "title": "Park Fire, California", "subtitle": "24 July – 26 September 2024",
        "association": (f"The NASA EONET record {PARK['event']} ({ev['title']}) and the interagency perimeter record {PARK['fire_id']} "
                        f"give the same point of origin ({a['attr_InitialLatitude']:.6f}°N, {abs(a['attr_InitialLongitude']):.6f}°W). "
                        f"Only satellite detections inside the mapped perimeter (plus about 1 km for pixel size and geolocation) are attributed to this fire; "
                        f"{near_outside} detections in the surrounding box were left out."),
        "view": {"bbox": [round(v, 3) for v in geom.bounds]},
        "summary": [
            {"label": "Mapped fire perimeter", "value": f"{acres:,.0f}", "unit": "acres", "also": f"≈ {acres * 0.00404686:,.0f} km²", "evidence": "observed",
             "note": "Area inside the final perimeter mapped by the fire agencies (GIS acres). Not every patch inside it burned."},
            {"label": "Satellite heat detections", "value": f"{len(rows):,}", "unit": "", "evidence": "satellite",
             "note": "VIIRS 375 m active-fire detections inside the perimeter. A detection is a hot pixel at one overpass, not an area burned."},
            {"label": "Detections observed", "value": f"{first_day:%d %b} – {last_day:%d %b %Y}", "unit": "", "evidence": "satellite",
             "note": f"Dates of the first and last detection in the period searched ({PARK['first']} to {PARK['last']})."},
        ],
        "steps": steps, "steps_label": "Heat detections up to this day",
        "layers": [
            {"id": "perimeter", "label": "Burned area (mapped perimeter)", "short": "Burned area", "icon": "area", "kind": "polygons", "evidence": "observed", "on": True,
             "color": "#f97316", "polygons": rings_of(simple),
             "legend": [{"color": "#f97316", "label": "Final fire perimeter mapped by the agencies"}],
             "source": {"name": "NIFC / WFIGS Interagency Fire Perimeters", "url": perim_url, "retrieved": TODAY, "licence": "Public domain (U.S. Government)"},
             "date": dt.datetime.fromtimestamp(a["poly_PolygonDateTime"] / 1000, dt.timezone.utc).strftime("%Y-%m-%d"),
             "resolution": f"Polygon, {n_src:,} vertices in the source, simplified to {n_out:,} (about 70 m tolerance; area change {100 * (area_simple / area_src - 1):+.2f}%)",
             "units": "acres (as published)", "uncertainty": f"Mapping method given by the source: {a.get('poly_MapMethod')}.",
             "note": "A perimeter is the outer line of the fire. Unburned islands inside it are common, so the mapped area is an upper bound of what burned."},
            {"id": "thermal", "label": "Thermal detections (VIIRS 375 m)", "short": "Thermal detections", "icon": "heat", "kind": "points", "evidence": "satellite", "on": True,
             "time": "cumulative", "color": "#fbbf24", "recent_color": "#ef4444", "recent_ms": 86_400_000, "size": 2.2,
             "points": {"t0": t0, "t_min": [round((r[0] - t0) / 60000) for r in rows], "lon": [round(r[1], 4) for r in rows], "lat": [round(r[2], 4) for r in rows],
                        "v": [round(r[3], 1) for r in rows], "v_label": "Fire radiative power", "v_unit": "MW"},
             "legend": [{"color": "#ef4444", "label": "Detected in the last 24 hours of the day shown"}, {"color": "#fbbf24", "label": "Detected earlier"}],
             "source": {"name": "NASA FIRMS VIIRS 375 m active fire (" + ", ".join(n for c, _, n in THERMAL if per_sat.get(c)) + "), read from NASA GIBS vector tiles",
                        "url": "https://firms.modaps.eosdis.nasa.gov/", "retrieved": TODAY, "licence": "NASA open data"},
             "date": f"{first_day:%Y-%m-%d} to {last_day:%Y-%m-%d}", "resolution": "375 m pixels at nadir (larger at the swath edge); a few overpasses per day",
             "units": "MW (fire radiative power)", "uncertainty": "Clouds and thick smoke can hide fires, and false detections are possible. Product versions: " + ", ".join(versions) + ".",
             "note": "Each dot is the centre of one hot pixel at one satellite overpass. It is not a burned area and not a perimeter."},
        ],
        "unavailable": [
            {"label": "Burned-area cells (MODIS MCD64A1)", "reason": "This product needs a NASA Earthdata login to download; it is not included in this build."},
        ],
    }
    write_pack(PARK["event"], pack)


HURDAT2 = "https://www.nhc.noaa.gov/data/hurdat/hurdat2-1851-2025-092326.txt"
STATUS = {"TD": "Tropical depression", "TS": "Tropical storm", "HU": "Hurricane", "EX": "Extratropical cyclone", "SD": "Subtropical depression",
          "SS": "Subtropical storm", "LO": "Low", "WV": "Tropical wave", "DB": "Disturbance"}


def hurricane(event_id: str = "EONET_11536", storm: str = "AL142024") -> None:
    text = fetch(HURDAT2, "hurdat2.txt").decode("ascii", "replace").splitlines()
    i = next(k for k, line in enumerate(text) if line.startswith(storm))
    name = text[i].split(",")[1].strip()
    n = int(text[i].split(",")[2])
    fixes = []
    for line in text[i + 1:i + 1 + n]:
        c = [x.strip() for x in line.split(",")]
        t = dt.datetime.strptime(c[0] + c[1], "%Y%m%d%H%M")
        lat = float(c[4][:-1]) * (1 if c[4][-1] == "N" else -1)
        lon = float(c[5][:-1]) * (-1 if c[5][-1] == "W" else 1)
        num = lambda v: None if int(v) in (-999, -99) else int(v)  # noqa: E731
        fixes.append({"t": ms(t), "lon": lon, "lat": lat, "id": c[2], "status": c[3], "wind": num(c[6]), "pres": num(c[7]),
                      "r34": [num(v) for v in c[8:12]], "r50": [num(v) for v in c[12:16]], "r64": [num(v) for v in c[16:20]], "rmw": num(c[20]) if len(c) > 20 and c[20] else None})
    peak = max(fixes, key=lambda f: f["wind"] or 0)
    low = min((f for f in fixes if f["pres"]), key=lambda f: f["pres"])
    landfalls = [f for f in fixes if f["id"] == "L"]
    with_radii = sum(1 for f in fixes if any(v for v in f["r34"] if v))
    print(f"{storm} {name}: {len(fixes)} best-track positions, peak {peak['wind']} kt, min {low['pres']} mb, landfalls {len(landfalls)}, positions with 34-kt radii {with_radii}")

    ev = json.loads(fetch(f"https://eonet.gsfc.nasa.gov/api/v3/events/{event_id}", f"{event_id}.json"))
    assert name.lower() in ev["title"].lower(), ev["title"]
    worst = 0.0
    for g in ev["geometry"]:
        gt = ms(dt.datetime.strptime(g["date"][:19], "%Y-%m-%dT%H:%M:%S"))
        f = min(fixes, key=lambda f: abs(f["t"] - gt))
        if abs(f["t"] - gt) <= 3600_000:
            worst = max(worst, math.hypot((f["lon"] - g["coordinates"][0]) * math.cos(math.radians(f["lat"])), f["lat"] - g["coordinates"][1]) * 111.2)
    print(f"association: EONET {event_id} {ev['title']!r}; largest distance between an EONET position and the best-track position of the same hour: {worst:.0f} km")

    w, e = min(f["lon"] for f in fixes), max(f["lon"] for f in fixes)
    s, n_ = min(f["lat"] for f in fixes), max(f["lat"] for f in fixes)
    fmt = lambda f: dt.datetime.fromtimestamp(f["t"] / 1000, dt.timezone.utc).strftime("%d %b %H:%M UTC")  # noqa: E731
    src = {"name": "NOAA National Hurricane Center, Atlantic best track (HURDAT2)", "url": HURDAT2, "retrieved": TODAY, "licence": "Public domain (U.S. Government)"}
    days = sorted({dt.datetime.fromtimestamp(f["t"] / 1000, dt.timezone.utc).strftime("%Y-%m-%d") for f in fixes})
    pack = {
        "schema": 1, "event_id": event_id, "category": "severeStorms", "built_at": TODAY, "builder": "science/events/build_evidence.py hurricane",
        "title": f"Hurricane {name.title()}", "subtitle": f"{fmt(fixes[0])[:6]} – {fmt(fixes[-1])[:6]} {days[0][:4]}",
        "association": (f"NASA EONET record {event_id} ({ev['title']}) and NHC best track {storm} describe the same storm: positions of the same hour differ by at most {worst:.0f} km "
                        "(EONET holds operational advisories, the best track is the post-storm analysis)."),
        "view": {"bbox": [w, s, e, n_]},
        "summary": [
            {"label": "Highest sustained wind", "value": str(peak["wind"]), "unit": "kt", "also": f"≈ {peak['wind'] * 1.852:.0f} km/h · {fmt(peak)}", "evidence": "observed",
             "note": "Maximum 1-minute sustained surface wind in the NHC best track (post-storm analysis of aircraft, satellite and surface observations)."},
            {"label": "Lowest central pressure", "value": str(low["pres"]), "unit": "mb", "also": fmt(low), "evidence": "observed", "note": "Minimum sea-level pressure in the best track."},
            {"label": "Documented positions", "value": str(len(fixes)), "unit": "", "also": f"{fmt(fixes[0])[:6]} – {fmt(fixes[-1])[:6]}" + (f" · landfall {fmt(landfalls[0])}" if landfalls else ""), "evidence": "observed",
             "note": "Best-track positions every 6 hours, plus landfall and peak-intensity times."},
        ],
        "steps": [{"t": f["t"], "label": fmt(f)} for f in fixes], "steps_label": "Best-track position",
        "layers": [
            {"id": "track", "label": "Track (NHC best track)", "short": "Track", "icon": "track", "kind": "track", "evidence": "observed", "on": True, "time": "cumulative",
             "fixes": [{k: f[k] for k in ("t", "lon", "lat", "wind", "pres", "status", "id")} for f in fixes],
             "status_names": STATUS, "wind_unit": "kt", "pres_unit": "mb",
             "legend": [{"color": "#7dd3fc", "label": "Below 34 kt (depression, low)"}, {"color": "#facc15", "label": "34–63 kt (tropical storm)"},
                        {"color": "#fb923c", "label": "64–95 kt (hurricane, cat. 1–2)"}, {"color": "#ef4444", "label": "96 kt and more (major hurricane)"}],
             "source": src, "date": f"{days[0]} to {days[-1]}", "resolution": "One position every 6 hours (plus landfall); positions to 0.1°, winds to 5 kt",
             "units": "kt (1-minute sustained wind), mb", "uncertainty": "Best-track values are post-storm estimates by NHC analysts; they are less certain for weak systems and when no aircraft observed the storm.",
             "note": "The line joins the documented centre positions in time order. It is the path of the storm's centre, not the area the storm affected."},
            {"id": "radii", "label": "Wind radii (34 / 50 / 64 kt)", "short": "Wind observations", "icon": "wind", "kind": "radii", "evidence": "reported", "on": True, "time": "current",
             "unit": "n mi", "rows": [{"t": f["t"], "lon": f["lon"], "lat": f["lat"], "r34": f["r34"], "r50": f["r50"], "r64": f["r64"]} for f in fixes],
             "legend": [{"color": "#facc15", "label": "34 kt (tropical-storm force) reaches at most this far"}, {"color": "#fb923c", "label": "50 kt"}, {"color": "#ef4444", "label": "64 kt (hurricane force)"}],
             "source": src, "date": f"{days[0]} to {days[-1]}", "resolution": "Four quadrants (NE, SE, SW, NW) per position, to 5–10 n mi",
             "units": "nautical miles (1 n mi = 1.852 km)", "uncertainty": "Analyst estimates with large uncertainty, especially where no aircraft or satellite wind data were available.",
             "note": "Each quadrant shows the farthest distance from the centre at which that wind speed was analysed anywhere in the quadrant. Winds are not that strong everywhere inside the shape, and it is not a damage zone."},
            {"id": "rain", "label": "Rainfall (GPM IMERG picture of the day)", "short": "Rainfall", "icon": "rain", "kind": "gibs", "evidence": "satellite", "on": False, "time": "current",
             "gibs": {"layer": "IMERG_Precipitation_Rate", "dates": days}, "legend": [], "legend_image": IMERG_LEGEND,
             "source": {"name": "NASA GPM IMERG precipitation rate, image from NASA GIBS", "url": "https://gpm.nasa.gov/data/imerg", "retrieved": "on demand", "licence": "NASA open data"},
             "date": f"{days[0]} to {days[-1]} (one image per UTC day)", "resolution": "0.1° (about 10 km)", "units": "mm/hr (colour scale of the GIBS image)",
             "uncertainty": "Satellite estimate of rain rate; it is not a rain-gauge total.",
             "note": "A picture of the IMERG product for the day of the position shown. Downloaded only when switched on."},
        ],
        "unavailable": [],
    }
    write_pack(event_id, pack)


FLOOD_LAYER = "MODIS_Combined_Flood_3-Day"
FLOOD_CLASSES = [(1, (50, 210, 245), "Surface water (matches the reference water map)"), (2, (255, 255, 0), "Recurring flood"),
                 (3, (250, 30, 36), "Flood (water where the reference map has land)"), (255, (175, 175, 175), "Insufficient data: cloud, shadow or masked steep terrain (drawn faint)")]


def flood_tiles(bbox, level):
    span = 288 / 2 ** level
    w, s, e, n = bbox
    r0, r1 = int((90 - n) // span), int((90 - s - 1e-9) // span)
    c0, c1 = int((w + 180) // span), int((e + 180 - 1e-9) // span)
    return span, r0, r1, c0, c1


def flood_grid(bbox, day: str, level: int):
    """Class grid (0 none, 1 water, 2 recurring, 3 flood, 255 insufficient) of the product pixels covering bbox. None when the day has no tiles."""
    span, r0, r1, c0, c1 = flood_tiles(bbox, level)
    px = span / 512
    mosaic = np.zeros(((r1 - r0 + 1) * 512, (c1 - c0 + 1) * 512), np.uint8)
    got = False
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            b = fetch(f"{GIBS}/{FLOOD_LAYER}/default/{day}/250m/{level}/{r}/{c}.png", f"flood/{day}_{level}_{r}_{c}.png", optional=True)
            if b is None:
                continue
            got = True
            im = np.asarray(Image.open(io.BytesIO(b)).convert("RGBA"))
            cls = np.zeros(im.shape[:2], np.uint8)
            for v, rgb, _ in FLOOD_CLASSES:
                cls[(im[..., 0] == rgb[0]) & (im[..., 1] == rgb[1]) & (im[..., 2] == rgb[2]) & (im[..., 3] > 0)] = v
            mosaic[(r - r0) * 512:(r - r0 + 1) * 512, (c - c0) * 512:(c - c0 + 1) * 512] = cls
    if not got:
        return None
    west, north = -180 + c0 * span, 90 - r0 * span
    x0, x1 = int(round((bbox[0] - west) / px)), int(round((bbox[2] - west) / px))
    y0, y1 = int(round((north - bbox[3]) / px)), int(round((north - bbox[1]) / px))
    grid = mosaic[y0:y1, x0:x1]
    exact = [west + x0 * px, north - y1 * px, west + x1 * px, north - y0 * px]
    return grid, exact, px


def class_areas(grid, exact, px) -> dict:
    """km² per class: each pixel counted with its own area on the sphere."""
    lat = exact[3] - (np.arange(grid.shape[0]) + 0.5) * px
    cell = (math.radians(px) * R_EARTH) ** 2 * np.cos(np.radians(lat))
    return {v: float(((grid == v) * cell[:, None]).sum()) for v, _, _ in FLOOD_CLASSES} | {"all": float(cell.sum() * grid.shape[1])}


def flood_scan(days: int = 60) -> None:
    api = json.loads(fetch(f"http://localhost:8088/api/v1/events?days={days}&category=floods", f"flood/eonet_floods_{days}_{TODAY}.json"))
    out = []
    for e in api["events"]:
        if not e.get("bbox"):
            continue
        w, s, east, n = e["bbox"]
        if east - w > 8 or n - s > 8:
            continue
        day = e["end"][:10]
        g = flood_grid((w, s, east, n), day, 6)
        if g is None:
            continue
        a = class_areas(*g)
        if a["all"] <= 0:
            continue
        out.append((a[3], a[2], a[255] / a["all"], e["id"], e["title"], day, e["bbox"]))
    out.sort(reverse=True)
    for r in out[:15]:
        print(f"{r[3]} {r[5]} flood {r[0]:8.0f} km2  recurring {r[1]:7.0f} km2  insufficient {100 * r[2]:3.0f}%  {r[4][:60]}  bbox {r[6]}")


def flood(event_id: str, dates: list[str], clip: list[float] | None = None) -> None:
    ev_url = f"https://eonet.gsfc.nasa.gov/api/v3/events/{event_id}"
    ev = json.loads(fetch(ev_url, f"{event_id}.json"))
    polys = [shape(g) for g in ev["geometry"] if g["type"] in ("Polygon", "MultiPolygon")]
    assert polys, "the record has no polygon"
    region = polys[0]
    bbox = list(clip or region.bounds)
    level = 8
    frames, areas = [], {}
    exact = None
    for day in dates:
        g = flood_grid(bbox, day, level)
        if g is None:
            print(f"{day}: no tiles")
            continue
        grid, exact, px = g
        a = class_areas(grid, exact, px)
        areas[day] = a
        im = Image.fromarray(grid, "P")
        pal = [0, 0, 0] * 256
        for v, rgb, _ in FLOOD_CLASSES:
            pal[v * 3:v * 3 + 3] = rgb
        im.putpalette(pal)
        alpha = bytearray([255] * 256)
        alpha[0] = 0
        alpha[255] = 105
        name = f"{event_id}_flood_{day}.png"
        OUT.mkdir(parents=True, exist_ok=True)
        im.save(OUT / name, optimize=True, transparency=bytes(alpha))
        size = (OUT / name).stat().st_size
        frames.append({"t": ms(dt.datetime.fromisoformat(day)) + 86_399_000, "label": day, "url": f"/evidence/{name}", "bytes": size,
                       "areas_km2": {"water": round(a[1], 1), "recurring": round(a[2], 1), "flood": round(a[3], 1), "insufficient": round(a[255], 1), "box": round(a["all"], 1)}})
        print(f"{day}: {grid.shape[1]}x{grid.shape[0]} px, flood {a[3]:.0f} km2, recurring {a[2]:.0f}, surface water {a[1]:.0f}, insufficient {100 * a[255] / a['all']:.0f}%  ({size / 1e3:.0f} kB)")
    assert frames and exact
    started = ev["geometry"][0]["date"][:10]
    during = [f for f in frames if f["label"] >= started] or frames
    best = max(during, key=lambda f: f["areas_km2"]["flood"])
    first = frames[0]
    gdacs = next((s for s in ev["sources"]), {"id": "", "url": ""})
    pack = {
        "schema": 1, "event_id": event_id, "category": "floods", "built_at": TODAY, "builder": f"science/events/build_evidence.py flood {event_id} {' '.join(dates)}",
        "title": " ".join(w for w in ev["title"].split() if not w.isdigit()), "subtitle": f"reported {started}",
        "association": (f"The satellite flood maps are cut to the box around the outline that NASA EONET record {event_id} publishes for this event (source: {gdacs['id']}). "
                        "The product maps water wherever it is seen; water inside the box is not proof that it belongs to this event, and the reported outline is not a water edge. "
                        f"The reported start of the event is {started}; maps of earlier dates are shown for comparison."),
        "view": {"bbox": [round(v, 3) for v in exact]},
        "summary": [
            {"label": "Mapped floodwater", "value": f"{best['areas_km2']['flood']:,.0f}", "unit": "km²", "also": f"3 days to {best['label']} · {first['areas_km2']['flood']:,.0f} km² on {first['label']}", "evidence": "satellite",
             "note": "Pixels the NASA MODIS flood product classes as flood (water where its reference map has land) inside the box shown, on the map date named below (the largest value since the reported start). Clouds hide water, so this is a lower bound; the product can also mistake cloud or terrain shadow for water."},
            {"label": "Not observed", "value": f"{100 * best['areas_km2']['insufficient'] / best['areas_km2']['box']:.0f}", "unit": "% of the box", "also": best["label"], "evidence": "satellite",
             "note": "Share of the box the product marks as insufficient data on that date: cloud, cloud or terrain shadow, and steep terrain that the product always masks."},
            {"label": "Spatial resolution", "value": "250", "unit": "m", "also": f"{len(frames)} map dates", "evidence": "satellite", "note": "One map per day, each made from 3 days of MODIS observations (Terra and Aqua), on the 250 m product grid."},
        ],
        "steps": [{"t": f["t"], "label": f["label"]} for f in frames], "steps_label": "Flood map of the 3 days ending",
        "layers": [
            {"id": "water", "label": "Mapped water (NASA MODIS flood product)", "short": "Mapped water", "icon": "water", "kind": "raster", "evidence": "satellite", "on": True, "time": "current",
             "raster": {"bbox": exact, "frames": frames, "pixelated": True},
             "legend": [{"color": "rgb(%d,%d,%d)" % rgb, "label": label} for _, rgb, label in FLOOD_CLASSES[::-1][1:][::-1]] + [{"color": "rgb(175,175,175)", "label": FLOOD_CLASSES[3][2]}],
             "source": {"name": "NASA LANCE MODIS Near Real-Time Global Flood Product (MCDWD), 3-day composite, via NASA GIBS", "url": "https://lance.modaps.eosdis.nasa.gov/flood/",
                        "retrieved": TODAY, "licence": "NASA open data"},
             "date": f"{frames[0]['label']} to {frames[-1]['label']}", "resolution": "250 m (0.0022° pixels, product grid, not resampled)", "units": "class per pixel; areas in km²",
             "uncertainty": "Cloud and terrain shadow can be mistaken for water or hide it; near-real-time product without field validation.",
             "note": "Red = water where the product's reference water map has land. Yellow = places that flood regularly. Blue = normal water. Grey = not observed. No water depth is known."},
            {"id": "outline", "label": "Reported event area (GDACS outline)", "short": "Reported area", "icon": "area", "kind": "polygons", "evidence": "reported", "on": True, "fill": False,
             "color": "#93c5fd", "polygons": rings_of(region.simplify(0.01, preserve_topology=True), 3),
             "legend": [{"color": "#93c5fd", "label": "Outline published for the event (not a water edge)"}],
             "source": {"name": f"NASA EONET v3 ({gdacs['id']})", "url": ev_url, "retrieved": TODAY, "licence": "Open data"},
             "date": ev["geometry"][0]["date"][:10], "resolution": "Polygon simplified to about 1 km for drawing", "units": "",
             "uncertainty": "Defined by the reporting agency; it can follow administrative borders.",
             "note": "The area the report refers to. It is not measured water."},
            {"id": "rain", "label": "Rainfall (GPM IMERG picture of the day)", "short": "Rainfall", "icon": "rain", "kind": "gibs", "evidence": "satellite", "on": False, "time": "current",
             "gibs": {"layer": "IMERG_Precipitation_Rate", "dates": dates}, "legend": [], "legend_image": IMERG_LEGEND,
             "source": {"name": "NASA GPM IMERG precipitation rate, image from NASA GIBS", "url": "https://gpm.nasa.gov/data/imerg", "retrieved": "on demand", "licence": "NASA open data"},
             "date": f"{dates[0]} to {dates[-1]}", "resolution": "0.1° (about 10 km)", "units": "mm/hr (colour scale of the GIBS image)",
             "uncertainty": "Satellite estimate of rain rate; not a rain-gauge total.", "note": "Rain seen by satellite on the date shown. Heavy rain nearby does not by itself prove what caused the flooding."},
        ],
        "compare": {"layer": "water", "before": first["label"], "after": best["label"]},
        "unavailable": [{"label": "Water depth", "reason": "No validated depth model exists for this event; the satellite product maps only where water is seen."}],
    }
    write_pack(event_id, pack)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "wildfire":
        wildfire()
    elif cmd == "hurricane":
        hurricane()
    elif cmd == "flood-scan":
        flood_scan(int(sys.argv[2]) if len(sys.argv) > 2 else 60)
    elif cmd == "flood":
        args = sys.argv[2:]
        clip = None
        if "--clip" in args:
            k = args.index("--clip")
            clip = [float(v) for v in args[k + 1].split(",")]
            args = args[:k] + args[k + 2:]
        flood(args[0], args[1:], clip)
    else:
        sys.exit(__doc__)
