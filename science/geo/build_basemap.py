"""Build Earth Explorer's local basemap assets from Natural Earth vector data.

Run (after downloading the Natural Earth GeoJSON files listed in SOURCES into SRC):
    science/.venv/bin/python -I science/geo/build_basemap.py <SRC_DIR> frontend/public/geo

Output format "eegeo/1" (compact JSON, integers only, compresses well):
    {"v":1, "q":Q, "layers": {name: {"k":"poly"|"line", "f":[feature, ...]}}}
    feature = {"b":[minx,miny,maxx,maxy], "g":[part, ...], ...attributes}
      coordinates are integers = round(degrees * Q)
      poly part = [ring, ...]; ring/line = [x0, y0, dx1, dy1, dx2, dy2, ...] (delta encoded)

Levels of detail:
    lod0.json            Natural Earth 1:110m  (planet view)
    lod1.json            Natural Earth 1:50m   (continent view)
    lod2/<cx>_<cy>.json  Natural Earth 1:10m clipped to 15°x15° chunks (regional view, on demand)
    countries.json       1:50m countries (names, label points) for picking and labels
    manifest.json        provenance, sizes, list of existing lod2 chunks

Natural Earth is in the public domain: https://www.naturalearthdata.com/about/terms-of-use/
"""
from __future__ import annotations

import json
import math
import pathlib
import sys

from shapely.geometry import mapping, shape
from shapely.ops import clip_by_rect

CHUNK = 15

SOURCES = {
    0: {"land": "ne_110m_land", "lakes": "ne_110m_lakes", "coast": "ne_110m_coastline",
        "borders": "ne_110m_admin_0_boundary_lines_land"},
    1: {"land": "ne_50m_land", "lakes": "ne_50m_lakes", "coast": "ne_50m_coastline",
        "borders": "ne_50m_admin_0_boundary_lines_land", "rivers": "ne_50m_rivers_lake_centerlines",
        "ice": "ne_50m_glaciated_areas", "shelves": "ne_50m_antarctic_ice_shelves_polys"},
    2: {"land": "ne_10m_land", "lakes": "ne_10m_lakes", "coast": "ne_10m_coastline",
        "borders": "ne_10m_admin_0_boundary_lines_land", "rivers": "ne_10m_rivers_lake_centerlines",
        "ice": "ne_10m_glaciated_areas", "shelves": "ne_10m_antarctic_ice_shelves_polys"},
}
QUANT = {0: 100, 1: 100, 2: 1000}
POLY_LAYERS = {"land", "lakes", "ice", "shelves"}


def enc_line(coords, q):
    out, px, py = [], None, None
    for x, y in coords:
        ix, iy = round(x * q), round(y * q)
        if px is None:
            out += [ix, iy]
        elif ix != px or iy != py:
            out += [ix - px, iy - py]
        else:
            continue
        px, py = ix, iy
    return out if len(out) >= 4 else None


def enc_geom(geom, kind, q):
    parts = []
    if geom.is_empty:
        return parts
    gt = geom.geom_type
    if gt == "GeometryCollection":
        for g in geom.geoms:
            parts += enc_geom(g, kind, q)
        return parts
    if kind == "poly":
        polys = [geom] if gt == "Polygon" else (list(geom.geoms) if gt == "MultiPolygon" else [])
        for p in polys:
            rings = [enc_line(p.exterior.coords, q)] + [enc_line(r.coords, q) for r in p.interiors]
            rings = [r for r in rings if r and len(r) >= 6]
            if rings:
                parts.append(rings)
    else:
        lines = [geom] if gt == "LineString" else (list(geom.geoms) if gt == "MultiLineString" else [])
        if gt in ("Polygon", "MultiPolygon"):
            return parts
        for ln in lines:
            e = enc_line(ln.coords, q)
            if e:
                parts.append(e)
    return parts


def attrs(layer, props):
    a = {}
    if layer in ("rivers", "lakes"):
        sr = props.get("scalerank")
        if sr is not None:
            a["r"] = int(sr)
    if layer == "borders":
        cla = (props.get("featurecla") or props.get("FEATURECLA") or "").lower()
        if any(w in cla for w in ("disputed", "indefinite", "line of control", "breakaway")):
            a["d"] = 1
    return a


def feature(layer, kind, geom, props, q):
    g = enc_geom(geom, kind, q)
    if not g:
        return None
    minx, miny, maxx, maxy = geom.bounds
    return {"b": [math.floor(minx * q), math.floor(miny * q), math.ceil(maxx * q), math.ceil(maxy * q)], "g": g, **attrs(layer, props)}


def load(src: pathlib.Path, name: str):
    d = json.loads((src / f"{name}.geojson").read_text())
    for f in d["features"]:
        if f.get("geometry"):
            try:
                g = shape(f["geometry"])
            except Exception:
                continue
            if not g.is_valid and g.geom_type in ("Polygon", "MultiPolygon"):
                g = g.buffer(0)
            yield g, f.get("properties") or {}


def dump(path: pathlib.Path, obj) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    s = json.dumps(obj, separators=(",", ":"))
    path.write_text(s)
    return len(s)


def main(src: pathlib.Path, out: pathlib.Path) -> None:
    sizes = {}
    for lod in (0, 1):
        q = QUANT[lod]
        layers = {}
        for layer, name in SOURCES[lod].items():
            kind = "poly" if layer in POLY_LAYERS else "line"
            feats = [f for g, p in load(src, name) if (f := feature(layer, kind, g, p, q))]
            layers[layer] = {"k": kind, "f": feats}
        sizes[f"lod{lod}.json"] = dump(out / f"lod{lod}.json", {"v": 1, "q": q, "lod": lod, "layers": layers})

    q = QUANT[2]
    src_layers = {layer: list(load(src, name)) for layer, name in SOURCES[2].items()}
    chunks = []
    for cx in range(360 // CHUNK):
        for cy in range(180 // CHUNK):
            x0, y0 = -180 + cx * CHUNK, -90 + cy * CHUNK
            x1, y1 = x0 + CHUNK, y0 + CHUNK
            layers = {}
            for layer, items in src_layers.items():
                kind = "poly" if layer in POLY_LAYERS else "line"
                feats = []
                for g, p in items:
                    bx0, by0, bx1, by1 = g.bounds
                    if bx1 < x0 or bx0 > x1 or by1 < y0 or by0 > y1:
                        continue
                    try:
                        c = clip_by_rect(g, x0, y0, x1, y1)
                    except Exception:
                        continue
                    if c.is_empty:
                        continue
                    f = feature(layer, kind, c, p, q)
                    if f:
                        feats.append(f)
                if feats:
                    layers[layer] = {"k": kind, "f": feats}
            if layers:
                name = f"{cx}_{cy}"
                sizes[f"lod2/{name}.json"] = dump(out / "lod2" / f"{name}.json", {"v": 1, "q": q, "lod": 2, "chunk": [x0, y0, x1, y1], "layers": layers})
                chunks.append(name)

    cq = 100
    countries = []
    for g, p in load(src, "ne_50m_admin_0_countries"):
        f = feature("countries", "poly", g, p, cq)
        if not f:
            continue
        f.update({"n": p.get("NAME") or p.get("ADMIN"), "a3": p.get("ADM0_A3"), "c": p.get("CONTINENT"),
                  "lx": p.get("LABEL_X"), "ly": p.get("LABEL_Y"), "lr": p.get("LABELRANK")})
        countries.append(f)
    sizes["countries.json"] = dump(out / "countries.json", {"v": 1, "q": cq, "layers": {"countries": {"k": "poly", "f": countries}}})

    version = (src / "VERSION").read_text().strip() if (src / "VERSION").exists() else "unknown"
    commit = (src / "COMMIT").read_text().strip() if (src / "COMMIT").exists() else "unknown"
    manifest = {
        "format": "eegeo/1", "chunk_degrees": CHUNK, "lod2_chunks": sorted(chunks),
        "source": {"name": "Natural Earth vector", "version": version, "repository": "https://github.com/nvkelso/natural-earth-vector",
                   "commit": commit, "license": "Public domain (https://www.naturalearthdata.com/about/terms-of-use/)",
                   "scales": {"lod0": "1:110m", "lod1": "1:50m", "lod2": "1:10m"}},
        "bytes": sizes,
        "total_bytes": sum(sizes.values()),
    }
    dump(out / "manifest.json", manifest)
    print(f"lod0 {sizes['lod0.json']/1e3:.0f} kB, lod1 {sizes['lod1.json']/1e3:.0f} kB, countries {sizes['countries.json']/1e3:.0f} kB, "
          f"lod2 {len(chunks)} chunks {sum(v for k,v in sizes.items() if k.startswith('lod2'))/1e6:.1f} MB, total {manifest['total_bytes']/1e6:.1f} MB")


if __name__ == "__main__":
    main(pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]))
