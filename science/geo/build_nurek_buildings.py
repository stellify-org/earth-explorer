"""Build the building-footprint pack for the Scenario Lab (Nurek Reservoir, Tajikistan).

    science/.venv/bin/python -I science/geo/build_nurek_buildings.py            # uses cached downloads if present
    science/.venv/bin/python -I science/geo/build_nurek_buildings.py --refresh  # download again

Writes frontend/public/scenario/nurek_buildings.bin (footprints) and nurek_buildings.json (sources, licences,
counts). Needs the network once (about 0.25 MB from Overpass, and row groups of the Overture GeoParquet files
read with range requests); the app then needs none. Requires nurek.json (run build_nurek.py first).

Sources
- OpenStreetMap building footprints inside the elevation grid, through the Overpass API. (c) OpenStreetMap
  contributors, ODbL 1.0. On 2026-11-14 OSM had 402 buildings in this area, nearly all in the town of Nurek:
  the villages around the reservoir are not mapped.
- Overture Maps Foundation, buildings theme: used ONLY for buildings that OSM does not have. In this area all
  of those come from "Microsoft ML Buildings" (footprints detected automatically in satellite imagery by a
  machine-learning model, ODbL 1.0). They were not surveyed on the ground: some are not buildings and some
  buildings are missing. An Overture footprint that overlaps an OSM footprint is dropped.

No height is invented: `height` and `building:levels` are copied when present, otherwise the record says "none".

Binary record in nurek_buildings.bin, little-endian, one per building (see `parseBuildings` in
frontend/src/scenario/buildings.ts):
  u8 flags (bits 0-1 source index, bits 2-3 id kind: 1 OSM way, 2 OSM relation, 3 UUID; bits 4-5 height kind:
  0 none, 1 height tag, 2 levels tag), u16 height in decimetres, u16 levels x 10, u8 kind index, u8 ring count,
  then per ring: u16 vertex count, first vertex as int32 lon*1e6, int32 lat*1e6, every further vertex as
  int16 differences from the previous one in the same unit (1e-6 degree, about 0.1 m).
  First ring = outer outline, others = holes; rings are not closed.
nurek_buildings_ids.bin: 16 bytes per building in the same order (OSM id as int64 + zeros, or the Overture UUID).
"""
from __future__ import annotations

import hashlib
import json
import math
import struct
import sys
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import shapely

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend" / "public" / "scenario"
OSM_CACHE = ROOT / "data" / "cache" / "nurek-osm" / "buildings.json"
OVERTURE_RELEASE = "2026-10-21.0"
OVERTURE_CACHE = ROOT / "data" / "cache" / "nurek-overture" / f"buildings_{OVERTURE_RELEASE}.parquet"
OVERPASS = "https://overpass-api.de/api/interpreter"


def grid_bounds() -> tuple[float, float, float, float]:
    """West, east, south, north of the elevation grid, from the pack that the app uses."""
    g = json.loads((OUT / "nurek.json").read_text(encoding="utf-8"))["grid"]
    n = 2 ** g["zoom"] * 256
    lon = lambda x: x / n * 360 - 180                                                   # noqa: E731
    lat = lambda y: math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))       # noqa: E731
    return lon(g["x0"]), lon(g["x0"] + g["width"]), lat(g["y0"] + g["height"]), lat(g["y0"])


def fetch_osm(w: float, e: float, s: float, n: float, refresh: bool) -> dict:
    if refresh or not OSM_CACHE.exists():
        q = f'[out:json][timeout:120];(way["building"]({s},{w},{n},{e});relation["building"]({s},{w},{n},{e}););out body geom;'
        req = urllib.request.Request(OVERPASS, data=urllib.parse.urlencode({"data": q}).encode(), headers={"User-Agent": "earth-explorer-build"})
        OSM_CACHE.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(req, timeout=180) as r:
            OSM_CACHE.write_bytes(r.read())
    return json.loads(OSM_CACHE.read_text(encoding="utf-8"))


def fetch_overture(w: float, e: float, s: float, n: float, refresh: bool):
    import pyarrow.parquet as pq
    if refresh or not OVERTURE_CACHE.exists():
        import pyarrow.compute as pc
        import pyarrow.dataset as ds
        import pyarrow.fs as fs
        s3 = fs.S3FileSystem(anonymous=True, region="us-west-2")
        d = ds.dataset(f"overturemaps-us-west-2/release/{OVERTURE_RELEASE}/theme=buildings/type=building/", filesystem=s3, format="parquet")
        f = (pc.field("bbox", "xmin") < e) & (pc.field("bbox", "xmax") > w) & (pc.field("bbox", "ymin") < n) & (pc.field("bbox", "ymax") > s)
        tb = d.to_table(filter=f, columns=["id", "geometry", "bbox", "sources", "height", "num_floors", "class", "subtype", "names", "is_underground"])
        OVERTURE_CACHE.parent.mkdir(parents=True, exist_ok=True)
        pq.write_table(tb, OVERTURE_CACHE)
    return pq.read_table(OVERTURE_CACHE).to_pylist()


def number(text: str | None) -> float | None:
    """A tag value like '12', '12.5' or '12 m' as metres / levels; anything else is treated as not mapped."""
    if text is None:
        return None
    try:
        v = float(str(text).replace(",", ".").replace("m", "").strip())
    except ValueError:
        return None
    return v if math.isfinite(v) and v > 0 else None


def ring(coords) -> list[tuple[float, float]]:
    pts = [(float(x), float(y)) for x, y in coords]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts.pop()
    return pts


def main() -> int:
    refresh = "--refresh" in sys.argv
    w, e, s, n = grid_bounds()
    inside = lambda x, y: w < x < e and s < y < n                                       # noqa: E731

    records: list[dict] = []
    osm = fetch_osm(w, e, s, n, refresh)
    osm_polys = []
    for el in osm["elements"]:
        tags = el.get("tags", {})
        if el["type"] == "way":
            rings = [ring((p["lon"], p["lat"]) for p in el["geometry"])]
        else:
            outers = [ring((p["lon"], p["lat"]) for p in m["geometry"]) for m in el["members"] if m["type"] == "way" and m.get("role") != "inner" and m.get("geometry")]
            inners = [ring((p["lon"], p["lat"]) for p in m["geometry"]) for m in el["members"] if m["type"] == "way" and m.get("role") == "inner" and m.get("geometry")]
            if len(outers) != 1:
                print(f"skipped relation {el['id']}: {len(outers)} outer rings (not handled)")
                continue
            rings = outers + [r for r in inners if len(r) >= 3]
        if len(rings[0]) < 3:
            continue
        poly = shapely.Polygon(rings[0], rings[1:])
        if not poly.is_valid or poly.area == 0:
            print(f"skipped OSM {el['type']} {el['id']}: invalid outline")
            continue
        c = poly.envelope.centroid
        if not inside(c.x, c.y):
            continue
        h, lv = number(tags.get("height")), number(tags.get("building:levels"))
        kind = tags.get("building", "yes")
        records.append({"source": 0, "id_kind": 1 if el["type"] == "way" else 2, "id": struct.pack("<q", el["id"]) + b"\0" * 8,
                        "height": h, "levels": lv, "kind": "" if kind == "yes" else kind, "name": tags.get("name"), "rings": rings, "c": (c.x, c.y)})
        osm_polys.append(poly)
    n_osm = len(records)

    tree = shapely.STRtree(osm_polys)
    datasets: dict[str, int] = {}
    dropped_overlap = skipped_osm = 0
    for r in fetch_overture(w, e, s, n, refresh):
        names = {x["dataset"] for x in (r["sources"] or [])}
        if "OpenStreetMap" in names:
            skipped_osm += 1
            continue
        if r.get("is_underground"):
            continue
        g = shapely.from_wkb(r["geometry"])
        if g.geom_type != "Polygon" or not g.is_valid or g.area == 0:
            print(f"skipped Overture {r['id']}: {g.geom_type}, valid={g.is_valid}")
            continue
        c = g.envelope.centroid
        if not inside(c.x, c.y):
            continue
        if len(tree.query(g, predicate="intersects")):
            dropped_overlap += 1
            continue
        licences = {x["license"] for x in r["sources"]}
        assert licences == {"ODbL-1.0"}, (r["id"], licences)
        for d in names:
            datasets[d] = datasets.get(d, 0) + 1
        rings = [ring(g.exterior.coords)] + [ring(i.coords) for i in g.interiors]
        records.append({"source": 1, "id_kind": 3, "id": uuid.UUID(r["id"]).bytes, "height": r["height"], "levels": r["num_floors"],
                        "kind": r["class"] or "", "name": (r["names"] or {}).get("primary"), "rings": rings, "c": (c.x, c.y)})

    records.sort(key=lambda b: (int((n - b["c"][1]) / 0.02), int((b["c"][0] - w) / 0.02), b["c"][0]))
    kinds = [""] + sorted({b["kind"] for b in records} - {""})
    assert len(kinds) < 256
    out, ids = bytearray(), bytearray()
    names: dict[str, str] = {}
    tags = {"height": 0, "levels": 0, "none": 0}
    for k, b in enumerate(records):
        hk = 1 if b["height"] else 2 if b["levels"] else 0
        tags[["none", "height", "levels"][hk]] += 1
        if b["name"]:
            names[str(k)] = b["name"]
        rings = [r for r in b["rings"] if len(r) >= 3]
        assert len(rings) < 256 and all(len(r) < 65536 for r in rings)
        ids += b["id"]
        out += struct.pack("<BHHBB", b["source"] | b["id_kind"] << 2 | hk << 4, min(65535, round((b["height"] or 0) * 10)),
                           min(65535, round((b["levels"] or 0) * 10)), kinds.index(b["kind"]), len(rings))
        for r in rings:
            q = np.rint(np.array(r) * 1e6).astype(np.int64)
            d = np.diff(q, axis=0)
            assert np.abs(d).max() < 32768, "an outline edge longer than 0.0327 degrees"
            out += struct.pack("<H", len(r)) + q[0].astype("<i4").tobytes() + d.astype("<i2").tobytes()
    assert len(ids) == 16 * len(records)

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    meta = {
        "version": 1, "count": len(records), "bytes": len(out), "sha256": hashlib.sha256(bytes(out)).hexdigest(),
        "ids": {"file": "nurek_buildings_ids.bin", "bytes": len(ids), "sha256": hashlib.sha256(bytes(ids)).hexdigest()},
        "coordinate_unit_deg": 1e-6, "bbox": {"west": w, "east": e, "south": s, "north": n}, "retrieved_at": now,
        "sources": [
            {"key": "osm", "name": "OpenStreetMap", "url": "https://www.openstreetmap.org/copyright", "licence": "ODbL 1.0",
             "attribution": "© OpenStreetMap contributors", "count": n_osm,
             "note": f"Overpass API, OSM data as of {osm.get('osm3s', {}).get('timestamp_osm_base', 'unknown')}. Footprints drawn by volunteers."},
            {"key": "overture", "name": f"Overture Maps buildings, release {OVERTURE_RELEASE} ({', '.join(sorted(datasets)) or 'none'})",
             "url": "https://docs.overturemaps.org/attribution/", "licence": "ODbL 1.0",
             "attribution": "© Overture Maps Foundation; Microsoft ML Buildings (Microsoft)", "count": len(records) - n_osm,
             "note": "Used only where OpenStreetMap has no footprint. Outlines detected automatically in satellite imagery by a machine-learning model; "
                     "not checked on the ground, so some are not buildings and some buildings are missing."},
        ],
        "kinds": kinds, "names": names, "height_tags": tags,
        "coverage_note": "OpenStreetMap maps only part of the town of Nurek here; the villages around the reservoir come from automatic detection. "
                         "A place without footprints is not proof that nothing is built there.",
        "dropped": {"overture_overlapping_osm": dropped_overlap, "overture_rows_that_are_osm": skipped_osm},
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "nurek_buildings.bin").write_bytes(bytes(out))
    (OUT / "nurek_buildings_ids.bin").write_bytes(bytes(ids))
    (OUT / "nurek_buildings.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{len(records)} buildings ({n_osm} OSM, {len(records) - n_osm} Overture: {datasets}), {len(out)} bytes; height tags {tags}; "
          f"dropped {dropped_overlap} Overture footprints overlapping OSM; {skipped_osm} Overture rows were OSM")
    return 0


if __name__ == "__main__":
    sys.exit(main())
