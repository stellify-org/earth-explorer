"""Build the offline data pack for the Scenario Lab (Nurek Reservoir, Tajikistan).

    science/.venv/bin/python -I science/geo/build_nurek.py

Writes frontend/public/scenario/nurek.bin (elevations, int16 little-endian metres, rows north -> south)
and frontend/public/scenario/nurek.json (grid description, sources, published reservoir figures,
NASA POWER precipitation climatology). Needs the network once; the app then needs none.

Sources
- Elevation: Terrain Tiles (Mapzen/Tilezen, AWS Open Data), zoom 11 (about 60 m here). In this region the
  tiles are SRTM (NASA/USGS, public domain), acquired in February 2000, so the flat water surface in the
  data is the reservoir level of that moment, not a normal or current level.
- Precipitation: NASA POWER climatology API, parameter PRECTOTCORR (MERRA-2 based), one grid cell.
- Reservoir figures are NOT downloaded: they are transcribed by hand in PUBLISHED below from the
  report named there (page numbers given), and checked against the rendered pages on 2026-11-14.
"""
from __future__ import annotations

import hashlib
import io
import json
import math
import struct
import sys
import urllib.request
import zlib
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend" / "public" / "scenario"
CACHE = ROOT / "data" / "cache" / "nurek-tiles"
Z = 11
TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
WEST, EAST, SOUTH, NORTH = 69.245, 69.725, 38.245, 38.605
DAM = {"lat": 38.3717, "lon": 69.3481}
POWER_POINT = {"lat": 38.37, "lon": 69.45}
POWER_URL = ("https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=PRECTOTCORR&community=AG"
             f"&longitude={POWER_POINT['lon']}&latitude={POWER_POINT['lat']}&format=JSON")

TEAS = ("OSHPC Barki Tojik / Coyne et Bellier, ELC Electroconsult, IPA (2014). Techno-Economic Assessment Study for "
        "Rogun Hydroelectric Construction Project, Phase II, Vol. 3, Chapter 5: Reservoir Operation Study "
        "(report P.002378 RP 40), published by the World Bank.")
TEAS_URL = "https://www.worldbank.org/content/dam/Worldbank/document/eca/central-asia/TEAS_Reservoir%20operation%20study_Final_eng.pdf"
PUBLISHED = {
    "citation": TEAS, "url": TEAS_URL, "transcribed": "2026-11-14",
    "full_supply_level_masl": {"value": 910, "where": "p. 17"},
    "minimum_operating_level_masl": {"value": 857, "where": "p. 17"},
    "storage_law": {"a": 2.41, "b": 1.64, "z0_masl": 762.7, "units": "hm3", "valid_from_masl": 857, "valid_to_masl": 910,
                    "where": "p. 19", "note": "Fitted to 1991–2011 operation records; an average law for that period. "
                    "The report states an active storage of 4.2 km3; the law with these rounded parameters gives 4.50 km3 between 857 and 910 m."},
    "evaporation_mm_per_month": {"values": [43, 0, 20, 25, 39, 73, 105, 138, 128, 89, 91, 54], "year_total_mm": 805,
                                 "where": "Table 2.6, p. 18 (from the designer's report; one table is given for Rogun and Nurek)"},
    "mean_inflow_hm3_per_year": {"value": 21000, "where": "p. 15 (\"21 000 hm3 of yearly inflows\")"},
    "capacity_surveys_km3": {"where": "Table 2.8, p. 18", "years": [1972, 1989, 1994, 2001], "total": [10.50, 8.66, 7.96, 8.63],
                             "live": [4.50, 3.40, 3.06, 4.27], "dead": [6.00, 5.26, 4.90, 4.36],
                             "note": "The report calls the differences between surveys doubtful and the present volume not well known."},
}


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "earth-explorer-build"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read()


def tile(x: int, y: int) -> np.ndarray:
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / f"{Z}_{x}_{y}.png"
    if not f.exists():
        f.write_bytes(fetch(TILE_URL.format(z=Z, x=x, y=y)))
    a = np.asarray(Image.open(io.BytesIO(f.read_bytes())).convert("RGB")).astype(np.float64)
    return a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768


WORLDCOVER_URL = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N36E069_Map.tif"
WORLDCOVER_CLASSES = {10: "Tree cover", 20: "Shrubland", 30: "Grassland", 40: "Cropland", 50: "Built-up", 60: "Bare / sparse vegetation",
                      70: "Snow and ice", 80: "Permanent water bodies", 90: "Herbaceous wetland", 95: "Mangroves", 100: "Moss and lichen"}

def get(url, a, b):
    r = urllib.request.Request(url, headers={"Range": f"bytes={a}-{b - 1}", "User-Agent": "earth-explorer-build"})
    return urllib.request.urlopen(r, timeout=120).read()

def header(url):
    head = get(url, 0, 262144)
    bo = "<" if head[:2] == b"II" else ">"
    magic = struct.unpack(bo + "H", head[2:4])[0]
    big = magic == 43
    off = struct.unpack(bo + "Q", head[8:16])[0] if big else struct.unpack(bo + "I", head[4:8])[0]
    n = struct.unpack(bo + "Q", head[off:off + 8])[0] if big else struct.unpack(bo + "H", head[off:off + 2])[0]
    pos = off + (8 if big else 2); esz = 20 if big else 12
    TYPES = {1: "B", 2: "c", 3: "H", 4: "I", 5: "II", 16: "Q", 12: "d", 11: "f"}
    tags = {}
    for k in range(n):
        e = head[pos + k * esz: pos + (k + 1) * esz]
        tag, typ = struct.unpack(bo + "HH", e[:4])
        cnt = struct.unpack(bo + "Q", e[4:12])[0] if big else struct.unpack(bo + "I", e[4:8])[0]
        f = TYPES.get(typ)
        if f is None: continue
        size = struct.calcsize(bo + f) * cnt
        inline = e[12:20] if big else e[8:12]
        if size <= len(inline): raw = inline[:size]
        else:
            o = struct.unpack(bo + ("Q" if big else "I"), inline[:8 if big else 4])[0]
            raw = head[o:o + size] if o + size <= len(head) else get(url, o, o + size)
        tags[tag] = raw if typ == 2 else struct.unpack(bo + f * cnt, raw)
    return tags

def read_window(url, x0, y0, x1, y1):
    t = header(url)
    W, H, tw, th = t[256][0], t[257][0], t[322][0], t[323][0]
    comp, pred, bits = t[259][0], t.get(317, (1,))[0], t[258][0]
    assert comp in (8, 32946) and bits == 8, (comp, bits)
    offs, cnts = t[324], t[325]; across = -(-W // tw)
    out = np.zeros((y1 - y0, x1 - x0), np.uint8); nbytes = 0
    for ty in range(y0 // th, (y1 - 1) // th + 1):
        for tx in range(x0 // tw, (x1 - 1) // tw + 1):
            i = ty * across + tx
            raw = get(url, offs[i], offs[i] + cnts[i]); nbytes += len(raw)
            a = np.frombuffer(zlib.decompress(raw), np.uint8).reshape(th, tw)
            if pred == 2: a = np.cumsum(a, axis=1, dtype=np.uint8)
            sx0, sy0 = max(x0, tx * tw), max(y0, ty * th); sx1, sy1 = min(x1, (tx + 1) * tw), min(y1, (ty + 1) * th)
            out[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = a[sy0 - ty * th:sy1 - ty * th, sx0 - tx * tw:sx1 - tx * tw]
    return out, {"width": W, "height": H, "tile": [tw, th], "compression": comp, "predictor": pred, "bytes": nbytes, "pixel_scale": t.get(33550), "tiepoint": t.get(33922)}


def land_cover(x0: int, y0: int, w: int, h: int, n_px: int) -> tuple[np.ndarray, dict]:
    """Majority WorldCover class of the 10 m pixels inside every cell of the elevation grid."""
    lon = lambda x: x / n_px * 360 - 180                                                    # noqa: E731
    lat = lambda y: math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n_px))))        # noqa: E731
    west, east, north, south = lon(x0), lon(x0 + w), lat(y0), lat(y0 + h)
    res = 1 / 12000
    px0, px1 = int((west - 69) / res), int(math.ceil((east - 69) / res))
    py0, py1 = int((39 - north) / res), int(math.ceil((39 - south) / res))
    win, info = read_window(WORLDCOVER_URL, px0, py0, px1, py1)
    assert abs(info["tiepoint"][3] - 69.0) < 1e-9 and abs(info["tiepoint"][4] - 39.0) < 1e-9 and abs(info["pixel_scale"][0] - res) < 1e-12, info
    lons = 69 + (px0 + np.arange(win.shape[1]) + 0.5) * res
    lats = 39 - (py0 + np.arange(win.shape[0]) + 0.5) * res
    col = np.floor((lons + 180) / 360 * n_px - x0).astype(np.int64)
    row = np.floor((1 - np.arcsinh(np.tan(np.radians(lats))) / math.pi) / 2 * n_px - y0).astype(np.int64)
    ok_c, ok_r = (col >= 0) & (col < w), (row >= 0) & (row < h)
    codes = sorted(WORLDCOVER_CLASSES)
    lut = np.full(256, len(codes), np.int64)
    for k, c in enumerate(codes):
        lut[c] = k
    sub = lut[win[np.ix_(ok_r, ok_c)]]
    cell = (row[ok_r][:, None] * w + col[ok_c][None, :])
    counts = np.bincount((cell * (len(codes) + 1) + sub).ravel(), minlength=w * h * (len(codes) + 1)).reshape(w * h, len(codes) + 1)
    best = counts[:, :len(codes)].argmax(axis=1)
    out = np.where(counts[:, :len(codes)].sum(axis=1) > 0, np.array(codes, np.uint8)[best], 0).astype(np.uint8).reshape(h, w)
    return out, {"downloaded_bytes": info["bytes"], "window_px": [px0, py0, px1, py1], "samples_per_cell_median": int(np.median(counts.sum(axis=1)))}


def main() -> int:
    n = 2 ** Z
    px = lambda lon: (lon + 180) / 360 * n * 256                                              # noqa: E731
    py = lambda lat: (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n * 256     # noqa: E731
    x0, x1, y0, y1 = int(px(WEST)), int(math.ceil(px(EAST))), int(py(NORTH)), int(math.ceil(py(SOUTH)))
    tx0, tx1, ty0, ty1 = x0 // 256, (x1 - 1) // 256, y0 // 256, (y1 - 1) // 256
    mosaic = np.vstack([np.hstack([tile(x, y) for x in range(tx0, tx1 + 1)]) for y in range(ty0, ty1 + 1)])
    dem = np.rint(mosaic[y0 - ty0 * 256:y1 - ty0 * 256, x0 - tx0 * 256:x1 - tx0 * 256]).astype(np.int16)
    h, w = dem.shape

    values, counts = np.unique(dem, return_counts=True)
    level = int(values[np.argmax(np.where((values > 800) & (values < 950), counts, 0))])
    flat = dem == level
    lab, _ = ndimage.label(flat, structure=np.ones((3, 3)))
    sizes = ndimage.sum(flat, lab, range(1, lab.max() + 1))
    main_id = int(np.argmax(sizes)) + 1
    rows, cols = np.where(lab == main_id)
    k = len(rows) // 2
    seed = [int(rows[k]), int(cols[k])]

    power = json.loads(fetch(POWER_URL))
    clim = power["properties"]["parameter"]["PRECTOTCORR"]
    months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
    raw = dem.astype("<i2").tobytes()
    meta = {
        "id": "nurek", "name": "Nurek Reservoir, Tajikistan",
        "grid": {"zoom": Z, "x0": x0, "y0": y0, "width": w, "height": h, "units": "m", "dtype": "int16le",
                 "projection": "Web Mercator pixel grid (cell centres at x0+j+0.5, y0+i+0.5 global pixels)",
                 "approx_cell_m": round(40075016.686 * math.cos(math.radians((SOUTH + NORTH) / 2)) / (n * 256), 1),
                 "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)},
        "dem_water": {"level_m": level, "seed": seed, "flat_cells": int(sizes[main_id - 1]),
                      "note": "Flat water surface recorded in the elevation data (SRTM, February 2000). Vertical datum EGM96; "
                              "the published levels use the national height system, so offsets of the order of a metre are possible."},
        "dam": {**DAM, "barrier_radius_m": 900, "barrier_min_elev_m": 895,
                "note": "Cells of the dam body (within the radius and at or above this elevation) cannot be flooded or crossed."},
        "sources": {
            "elevation": {"name": "Terrain Tiles (Mapzen/Tilezen) on AWS Open Data, zoom 11; SRTM (NASA/USGS) in this region",
                          "url": "https://registry.opendata.aws/terrain-tiles/", "licence": "SRTM: public domain; attribution per Tilezen",
                          "tiles": f"{Z}/{tx0}-{tx1}/{ty0}-{ty1}"},
            "precipitation": {"name": "NASA POWER climatology, PRECTOTCORR (MERRA-2 based)", "url": POWER_URL,
                              "retrieved_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                              "api_version": power.get("header", {}).get("api", {}).get("version"),
                              "period": power.get("header", {}).get("range"),
                              "point": POWER_POINT, "units": "mm/day",
                              "note": "One 0.5° × 0.625° grid cell over the reservoir; rain on the lake only, not the catchment."},
        },
        "precipitation_mm_per_day": [clim[m] for m in months],
        "precipitation_annual_mm_per_day": clim.get("ANN"),
        "published": PUBLISHED,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    try:
        lc, lc_info = land_cover(x0, y0, w, h, n * 256)
        lc_raw = lc.tobytes()
        (OUT / "nurek_landcover.bin").write_bytes(lc_raw)
        present = {int(c): int((lc == c).sum()) for c in np.unique(lc)}
        meta["land_cover"] = {
            "file": "nurek_landcover.bin", "dtype": "uint8", "bytes": len(lc_raw), "sha256": hashlib.sha256(lc_raw).hexdigest(),
            "classes": {str(c): name for c, name in WORLDCOVER_CLASSES.items()}, "cells_per_class": {str(c): k for c, k in present.items()},
            "name": "ESA WorldCover 10 m 2021 v200", "url": WORLDCOVER_URL, "licence": "CC BY 4.0",
            "attribution": "© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium",
            "method": "Each elevation cell (about 60 m) takes the most frequent class of the 10 m WorldCover pixels whose centres fall inside it.",
            "retrieved_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), **lc_info,
        }
        print("land cover cells per class:", present, lc_info)
    except Exception as e:  # noqa: BLE001
        print("land cover NOT built:", e)
    (OUT / "nurek.bin").write_bytes(raw)
    (OUT / "nurek.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"grid {w}×{h}, {len(raw)} bytes, DEM water level {level} m ({meta['dem_water']['flat_cells']} cells), seed {seed}")
    print("precipitation mm/day:", meta["precipitation_mm_per_day"], "annual", meta["precipitation_annual_mm_per_day"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
