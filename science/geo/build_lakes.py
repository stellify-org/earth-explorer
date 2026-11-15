"""Build the offline terrain packs of the Scenario Lab locations other than Nurek.

    science/.venv/bin/python -I science/geo/build_lakes.py [kayrakkum] [sarez]     (default: all)
    add --refresh to download the OpenStreetMap extract and NASA POWER again

For every location it writes into frontend/public/scenario/:
  <id>.bin       elevations, int16 little-endian metres, rows north -> south (same layout as nurek.bin)
  <id>_mask.bin  one byte per cell: bit 0 = inside the lake outline of OpenStreetMap, bit 1 = dam body (barrier)
  <id>.json      grid, water surface found in the elevation data, sources, labels, NASA POWER precipitation,
                 and the block PUBLISHED[<id>] below (figures transcribed by hand, with their sources)

Sources
- Elevation: Terrain Tiles (Mapzen/Tilezen, AWS Open Data), zoom 10 (about 117 m at 40°N). In these regions the
  tiles are SRTM (NASA/USGS, public domain), flown in February 2000: the flat water surface in the data is the
  lake level of that moment.
- Lake outline, dam outline, place names: OpenStreetMap through the Overpass API (ODbL 1.0, © OpenStreetMap
  contributors). The outline shows the shore at the (unknown) time it was mapped; it is drawn as a line and is
  NOT used in any calculation.
- Precipitation: NASA POWER climatology API, PRECTOTCORR (MERRA-2 based), one grid cell over the lake.

Two documented adjustments are made to the elevation grid, and counted in <id>.json:
- SRTM water surfaces are noisy by a metre or two. Cells connected to the lake whose elevation is within
  `noise_m` of the modal water level are set to that level ("flattened"), so the lake is one surface.
- Nothing else is changed. The dam body is NOT edited in the grid; it is a separate barrier mask, because
  100 m cells smooth a dam crest and a flood fill would otherwise leak through it.
"""
from __future__ import annotations

import hashlib
import io
import json
import math
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import shapely
from PIL import Image
from scipy import ndimage
from shapely.ops import polygonize, unary_union

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend" / "public" / "scenario"
TILES = ROOT / "data" / "cache" / "lake-tiles"
OSM = ROOT / "data" / "cache" / "lake-osm"
TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
OVERPASS = "https://overpass-api.de/api/interpreter"
sys.path.insert(0, str(Path(__file__).resolve().parent))
from lake_published import PUBLISHED, QUAKES  # noqa: E402  (hand-transcribed figures with their sources)

LOCATIONS = {
    "kayrakkum": {
        "name": "Bahri Tojik (Kayrakkum Reservoir), Tajikistan",
        "bbox": (69.72, 70.62, 40.13, 40.52), "zoom": 10,
        "water_range": (330, 360), "noise_m": 0,
        "lake_relation": 12608068, "dam_relation": 15520863, "dam_name": "Kayrakkum Dam", "dam_buffer_cells": 1.5, "dam_barrier_all": True,
        "power_point": {"lat": 40.30, "lon": 70.10},
        "label_places": ("city", "town"),
    },
    "sarez": {
        "name": "Lake Sarez, Pamir, Tajikistan",
        "bbox": (72.50, 73.37, 38.05, 38.45), "zoom": 10,
        "water_range": (3200, 3300), "noise_m": 2,
        "lake_relation": 1164875, "dam_relation": 17406694, "dam_name": "Usoi Dam (natural landslide dam, 1911)", "dam_buffer_cells": 0.5,
        "power_point": {"lat": 38.22, "lon": 72.85},
        "label_places": (),
    },
}


def fetch(url: str, data: bytes | None = None) -> bytes:
    req = urllib.request.Request(url, data=data, headers={"User-Agent": "earth-explorer-build"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()


def tile(z: int, x: int, y: int) -> np.ndarray:
    TILES.mkdir(parents=True, exist_ok=True)
    f = TILES / f"{z}_{x}_{y}.png"
    if not f.exists():
        f.write_bytes(fetch(TILE_URL.format(z=z, x=x, y=y)))
    a = np.asarray(Image.open(io.BytesIO(f.read_bytes())).convert("RGB")).astype(np.float64)
    return a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768


def osm(loc_id: str, bbox, refresh: bool) -> dict:
    f = OSM / f"{loc_id}.json"
    if refresh or not f.exists():
        w, e, s, n = bbox
        bb = f"{s},{w},{n},{e}"
        q = ("[out:json][timeout:120];(" + "".join(f'{kind}{sel}({bb});' for kind, sel in [
            ("way", '["natural"="water"]'), ("relation", '["natural"="water"]'), ("way", '["waterway"="dam"]'), ("relation", '["waterway"="dam"]'),
            ("way", '["waterway"="river"]'), ("node", '["place"~"city|town|village"]')]) + ");out body geom;")
        OSM.mkdir(parents=True, exist_ok=True)
        f.write_bytes(fetch(OVERPASS, urllib.parse.urlencode({"data": q}).encode()))
    return json.loads(f.read_text(encoding="utf-8"))


def relation_shape(data: dict, rel_id: int):
    """Polygon(s) of a multipolygon relation: outer ways are stitched into rings, inner rings are cut out."""
    rel = next(e for e in data["elements"] if e["type"] == "relation" and e["id"] == rel_id)
    lines = {"outer": [], "inner": []}
    for m in rel["members"]:
        if m["type"] == "way" and m.get("geometry"):
            lines["inner" if m.get("role") == "inner" else "outer"].append(shapely.LineString([(p["lon"], p["lat"]) for p in m["geometry"]]))
    outer = unary_union(list(polygonize(unary_union(lines["outer"]))))
    inner = unary_union(list(polygonize(unary_union(lines["inner"])))) if lines["inner"] else None
    shape = outer.difference(inner) if inner is not None and not inner.is_empty else outer
    if shape.is_empty:
        shape = unary_union(lines["outer"])
    return shape, rel.get("tags", {})


def build(loc_id: str, refresh: bool) -> None:
    L = LOCATIONS[loc_id]
    z, (west, east, south, north) = L["zoom"], L["bbox"]
    n = 2 ** z * 256
    px = lambda lon: (lon + 180) / 360 * n                                                    # noqa: E731
    py = lambda lat: (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n           # noqa: E731
    x0, x1, y0, y1 = int(px(west)), int(math.ceil(px(east))), int(py(north)), int(math.ceil(py(south)))
    tx0, tx1, ty0, ty1 = x0 // 256, (x1 - 1) // 256, y0 // 256, (y1 - 1) // 256
    mosaic = np.vstack([np.hstack([tile(z, x, y) for x in range(tx0, tx1 + 1)]) for y in range(ty0, ty1 + 1)])
    dem = np.rint(mosaic[y0 - ty0 * 256:y1 - ty0 * 256, x0 - tx0 * 256:x1 - tx0 * 256]).astype(np.int16)
    h, w = dem.shape
    lon_c = (x0 + np.arange(w) + 0.5) / n * 360 - 180
    lat_c = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * (y0 + np.arange(h) + 0.5) / n))))
    cell_m = 40075016.686 / n * np.cos(np.radians(lat_c))
    area = (cell_m ** 2)[:, None] * np.ones((1, w))

    data = osm(loc_id, L["bbox"], refresh)
    lake, lake_tags = relation_shape(data, L["lake_relation"])
    dam, dam_tags = relation_shape(data, L["dam_relation"])
    gx, gy = np.meshgrid(lon_c, lat_c)
    in_lake = shapely.contains_xy(lake, gx, gy)
    deg_per_cell = 360 / n
    dam_zone = dam.buffer(L["dam_buffer_cells"] * deg_per_cell)
    in_dam = shapely.contains_xy(dam_zone, gx, gy)
    dam_c = dam.centroid

    lo, hi = L["water_range"]
    values, counts = np.unique(dem, return_counts=True)
    level = int(values[np.argmax(np.where((values > lo) & (values < hi), counts, 0))])
    flat = dem == level
    lab, _ = ndimage.label(flat, structure=np.ones((3, 3)))
    sizes = ndimage.sum(flat, lab, range(1, lab.max() + 1))
    main_id = int(np.argmax(sizes)) + 1
    rows, cols = np.where(lab == main_id)
    k = len(rows) // 2
    seed = [int(rows[k]), int(cols[k])]
    barrier = in_dam if L.get("dam_barrier_all") else in_dam & (dem > level + L["noise_m"])
    flattened = 0
    if L["noise_m"] > 0:
        lab2, _ = ndimage.label((dem <= level + L["noise_m"]) & ~barrier, structure=np.ones((3, 3)))
        lake_cells = lab2 == lab2[seed[0], seed[1]]
        change = lake_cells & (dem != level)
        flattened = int(change.sum())
        dem = np.where(lake_cells, level, dem).astype(np.int16)
    lab3, _ = ndimage.label((dem <= level) & ~barrier, structure=np.ones((3, 3)))
    water = lab3 == lab3[seed[0], seed[1]]
    touches = bool(water[0].any() or water[-1].any() or water[:, 0].any() or water[:, -1].any())

    pf = OSM / f"{loc_id}_power.json"
    pp = L["power_point"]
    power_url = ("https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=PRECTOTCORR&community=AG"
                 f"&longitude={pp['lon']}&latitude={pp['lat']}&format=JSON")
    if refresh or not pf.exists():
        pf.write_bytes(fetch(power_url))
    power = json.loads(pf.read_text(encoding="utf-8"))
    clim = power["properties"]["parameter"]["PRECTOTCORR"]
    months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]

    labels = [{"text": L["dam_name"], "lat": round(dam_c.y, 5), "lon": round(dam_c.x, 5), "kind": "dam"}]
    for e in data["elements"]:
        t = e.get("tags", {})
        if e["type"] == "node" and t.get("place") in L["label_places"] and (t.get("name:en") or t.get("name")):
            labels.append({"text": t.get("name:en") or t["name"], "lat": e["lat"], "lon": e["lon"], "kind": t["place"]})

    quakes = None
    if loc_id in QUAKES:
        qf = OSM / f"{loc_id}_quakes.json"
        if refresh or not qf.exists():
            qf.write_bytes(fetch(QUAKES[loc_id]))
        gj = json.loads(qf.read_text(encoding="utf-8"))
        events = [{"id": f["id"], "time": datetime.fromtimestamp(f["properties"]["time"] / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                   "mag": f["properties"]["mag"], "mag_type": f["properties"]["magType"], "place": f["properties"]["place"],
                   "lon": f["geometry"]["coordinates"][0], "lat": f["geometry"]["coordinates"][1], "depth_km": f["geometry"]["coordinates"][2]}
                  for f in gj["features"]]
        quakes = {"source": "USGS Earthquake Hazards Program, ANSS Comprehensive Catalog (ComCat)", "url": QUAKES[loc_id],
                  "retrieved_at": datetime.fromtimestamp(qf.stat().st_mtime, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "events": events,
                  "note": "Magnitudes are of mixed types (mw, ms, mb …) as given by the catalog; early events come from the ISC-GEM catalogue."}
        for ev in events:
            if ev["mag"] >= 7 and west < ev["lon"] < east and south < ev["lat"] < north:
                labels.append({"text": f"M {ev['mag']:.1f} earthquake, {ev['time'][:4]}", "lat": ev["lat"], "lon": ev["lon"], "kind": "quake"})

    raw = dem.astype("<i2").tobytes()
    mask = (in_lake.astype(np.uint8) | (barrier.astype(np.uint8) << 1)).tobytes()
    km2 = lambda m: round(float((m * area).sum() / 1e6), 2)                                   # noqa: E731
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    meta = {
        "id": loc_id, "name": L["name"],
        "grid": {"zoom": z, "x0": x0, "y0": y0, "width": w, "height": h, "units": "m", "dtype": "int16le",
                 "projection": "Web Mercator pixel grid (cell centres at x0+j+0.5, y0+i+0.5 global pixels)",
                 "approx_cell_m": round(float(cell_m[h // 2]), 1), "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)},
        "dem_water": {"level_m": level, "seed": seed, "flat_cells": int(sizes[main_id - 1]), "area_km2": km2(water), "touches_edge": touches,
                      "noise_m": L["noise_m"], "flattened_cells": flattened,
                      "note": "Flat water surface recorded in the elevation data (SRTM, February 2000). Vertical datum EGM96; published levels "
                              "use the national (Baltic) height system, so offsets of the order of a metre are possible."},
        "masks": {"file": f"{loc_id}_mask.bin", "bytes": len(mask), "sha256": hashlib.sha256(mask).hexdigest(),
                  "bits": {"1": "inside the lake outline of OpenStreetMap", "2": "dam body: cannot be flooded or crossed"},
                  "osm_lake_area_km2": km2(in_lake), "barrier_cells": int(barrier.sum())},
        "dam": {"lat": round(dam_c.y, 5), "lon": round(dam_c.x, 5), "name": L["dam_name"],
                "note": "Cells of the dam body (OpenStreetMap outline, widened by "
                        f"{L['dam_buffer_cells']} cells, above the water) cannot be flooded or crossed."},
        "labels": labels,
        "sources": {
            "elevation": {"name": f"Terrain Tiles (Mapzen/Tilezen) on AWS Open Data, zoom {z}; SRTM (NASA/USGS) in this region",
                          "url": "https://registry.opendata.aws/terrain-tiles/", "licence": "SRTM: public domain; attribution per Tilezen",
                          "tiles": f"{z}/{tx0}-{tx1}/{ty0}-{ty1}"},
            "outline": {"name": "OpenStreetMap (lake and dam outlines, place names)", "url": "https://www.openstreetmap.org/copyright",
                        "licence": "ODbL 1.0", "attribution": "© OpenStreetMap contributors",
                        "lake": f"relation/{L['lake_relation']} ({lake_tags.get('name:en') or lake_tags.get('name')})",
                        "dam": f"relation/{L['dam_relation']} ({dam_tags.get('name:en') or dam_tags.get('name')})",
                        "osm_base": data.get("osm3s", {}).get("timestamp_osm_base"),
                        "note": "The outline shows the shore when it was mapped (date not recorded). It is drawn for orientation and not used in calculations."},
            "precipitation": {"name": "NASA POWER climatology, PRECTOTCORR (MERRA-2 based)", "url": power_url, "retrieved_at": now,
                              "api_version": power.get("header", {}).get("api", {}).get("version"), "period": power.get("header", {}).get("range"),
                              "point": pp, "units": "mm/day", "note": "One 0.5° × 0.625° grid cell over the lake; rain on the lake only, not the catchment."},
        },
        "precipitation_mm_per_day": [clim[m] for m in months],
        "precipitation_annual_mm_per_day": clim.get("ANN"),
        "published": PUBLISHED.get(loc_id, {}),
    }
    if quakes:
        meta["earthquakes"] = quakes
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{loc_id}.bin").write_bytes(raw)
    (OUT / f"{loc_id}_mask.bin").write_bytes(mask)
    (OUT / f"{loc_id}.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{loc_id}: grid {w}×{h} ({meta['grid']['approx_cell_m']} m), {len(raw)} bytes; DEM water {level} m, {meta['dem_water']['area_km2']} km² "
          f"(touches edge: {touches}; flattened {flattened} cells); OSM lake {meta['masks']['osm_lake_area_km2']} km²; barrier {int(barrier.sum())} cells; "
          f"dam at {dam_c.y:.4f}N {dam_c.x:.4f}E; {len(labels)} labels")
    for dz in (1, 2, 3, 5, 10, 20, 40):
        lab4, _ = ndimage.label((dem <= level + dz) & ~barrier, structure=np.ones((3, 3)))
        m = lab4 == lab4[seed[0], seed[1]]
        edge = bool(m[0].any() or m[-1].any() or m[:, 0].any() or m[:, -1].any())
        print(f"   +{dz} m ({level + dz}): {km2(m)} km²{' — reaches the edge of the grid' if edge else ''}")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    for loc in args or list(LOCATIONS):
        build(loc, "--refresh" in sys.argv)
