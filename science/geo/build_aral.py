"""Build the Aral Sea history pack of the Scenario Lab from JRC Global Surface Water yearly maps.

    cd data/cache/aral && for y in 1987 1992 1998 2000 2005 2010 2015 2021; do ../../../science/.venv/bin/python -I ../../../science/geo/aral_probe.py $y; done
    science/.venv/bin/python -I science/geo/build_aral.py

Input: data/cache/aral/aral_<year>.npy written by aral_probe.py — for every block of 32 × 32 pixels (0.008°) of the
JRC yearly water classification (30 m, 0.00025°) the number of pixels of class 3 (permanent water), 2 (seasonal
water) and 0 (no data) in that year. Box 57.5–62.5°E, 43–47.5°N.
Output: frontend/public/scenario/aral.bin, aral.json.

What is computed, and what is not
- "Sea region": blocks that are at least half water (permanent or seasonal) in ANY of the packed years, joined into
  the one connected patch that contains the middle of the sea. Delta lakes and reservoirs that never touch that
  patch are left out. The region is fixed, so the years can be compared.
- Per year, inside the region: area of permanent water, of seasonal water and of "no data", summed from the pixel
  counts with the true pixel area on the WGS84 ellipsoid at each block's latitude.
- North (Small) and South (Large) Aral Sea, per year: the blocks drawn as water are grouped into connected patches;
  the North Aral is the patch that holds a point in the Small Aral (widened by two blocks to catch its shore pixels),
  the South is everything else in the region. In a year in which that patch also holds the point in the western
  basin of the Large Aral, the sea is still one water body at this resolution and no split is reported.
- For the picture: a block is drawn as water in a year if at least half of its pixels are permanent water.
- No water level, depth, volume or future shoreline is derived: the maps contain none of them.

Source: Pekel, J.-F., Cottam, A., Gorelick, N., Belward, A.S. (2016). High-resolution mapping of global surface
water and its long-term changes. Nature 540, 418–422. doi:10.1038/nature20584. Data: EC JRC / Google, Global Surface
Water v1.4 (1984–2021), yearly classification tiles from the JRC open-data server. Not a NASA/USGS product; it is
derived from USGS/NASA Landsat imagery.
"""
from __future__ import annotations

import hashlib
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "data" / "cache" / "aral"
OUT = ROOT / "frontend" / "public" / "scenario"
YEARS = [1987, 1992, 1998, 2000, 2005, 2010, 2015, 2021]
WEST, NORTH, RES, BLOCK = 57.5, 47.5, 0.00025, 32
CELL = RES * BLOCK
SEED = (45.0, 58.6)
SEED_NORTH = (46.5, 60.7)


def main() -> int:
    assert len(YEARS) <= 8
    counts = {y: np.load(SRC / f"aral_{y}.npy").astype(np.float64) for y in YEARS}
    h, w = counts[YEARS[0]].shape[1:]
    lat = NORTH - (np.arange(h) + 0.5) * CELL
    phi = np.radians(lat)
    a_, e2 = 6378137.0, 0.00669437999014
    m_r = a_ * (1 - e2) / (1 - e2 * np.sin(phi) ** 2) ** 1.5
    n_r = a_ / np.sqrt(1 - e2 * np.sin(phi) ** 2)
    px_km2 = ((m_r * math.radians(RES)) * (n_r * np.cos(phi) * math.radians(RES)) / 1e6)[:, None]
    full = BLOCK * BLOCK

    ever = np.zeros((h, w), bool)
    for y in YEARS:
        ever |= (counts[y][0] + counts[y][1]) >= full / 2
    lab, _ = ndimage.label(ever, structure=np.ones((3, 3)))
    si, sj = int((NORTH - SEED[0]) / CELL), int((SEED[1] - WEST) / CELL)
    assert lab[si, sj] > 0, "the seed is not water"
    region = lab == lab[si, sj]
    ni, nj = int((NORTH - SEED_NORTH[0]) / CELL), int((SEED_NORTH[1] - WEST) / CELL)

    water = np.zeros((h, w), np.uint8)
    nodata = np.zeros((h, w), np.uint8)
    rows = []
    for k, y in enumerate(YEARS):
        c = counts[y]
        perm_block = (c[0] >= full / 2) & region
        water |= perm_block.astype(np.uint8) << k
        nodata |= (((c[2] >= full / 2) & region).astype(np.uint8)) << k
        def km2(arr, sel):  # noqa: E306
            return round(float((arr * px_km2)[sel].sum()), 1)
        row = {"year": y, "all": {"permanent_km2": km2(c[0], region), "seasonal_km2": km2(c[1], region), "no_data_km2": km2(c[2], region)}}
        row["drawn_km2"] = round(float((perm_block * px_km2 * full).sum()), 1)
        lab_y, _ = ndimage.label(perm_block, structure=np.ones((3, 3)))
        wi, wj = np.nonzero(perm_block)
        near = int(np.argmin((wi - ni) ** 2 + (wj - nj) ** 2))
        assert (wi[near] - ni) ** 2 + (wj[near] - nj) ** 2 <= 15 ** 2, f"{y}: no water near the point in the Small Aral"
        patch = lab_y == lab_y[wi[near], wj[near]]
        row["joined"] = bool(patch[int((NORTH - 45.4) / CELL):].any())
        if not row["joined"]:
            north = ndimage.binary_dilation(patch, structure=np.ones((3, 3)), iterations=2) & region
            for name, sel in (("north", north), ("south", region & ~north)):
                row[name] = {"permanent_km2": km2(c[0], sel), "seasonal_km2": km2(c[1], sel), "no_data_km2": km2(c[2], sel)}
        rows.append(row)
        print(y, row["all"], "joined" if row["joined"] else f"N {row['north']['permanent_km2']} S {row['south']['permanent_km2']}", "drawn", row["drawn_km2"])

    region_km2 = round(float((region * px_km2 * full).sum()), 1)
    raw = water.tobytes() + nodata.tobytes() + region.astype(np.uint8).tobytes()
    meta = {
        "id": "aral", "name": "Aral Sea, Kazakhstan and Uzbekistan", "version": 1,
        "grid": {"west": WEST, "north": NORTH, "cell_deg": CELL, "width": w, "height": h, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
                 "planes": ["water: bit k = at least half of the block is permanent water in years[k]", "no data: bit k = at least half of the block has no data in years[k]", "region: 1 = inside the sea region"]},
        "years": YEARS, "areas": rows,
        "region": {"area_km2": region_km2, "seed": {"lat": SEED[0], "lon": SEED[1]}, "seed_north": {"lat": SEED_NORTH[0], "lon": SEED_NORTH[1]},
                   "note": "Sea region: squares that are at least half water in any of these years and connected to the middle of the sea. "
                           "North Aral = the connected water that holds a point in the Small Aral, with its shore; South Aral = the rest of the region. "
                           "In a year when the two are still one connected water body at this resolution, no split is given."},
        "source": {
            "name": "JRC Global Surface Water v1.4, yearly water classification (1984–2021), 30 m, from Landsat 5, 7 and 8",
            "citation": "Pekel, J.-F., Cottam, A., Gorelick, N., Belward, A.S. (2016). High-resolution mapping of global surface water and its long-term changes. Nature 540, 418–422. doi:10.1038/nature20584",
            "url": "https://global-surface-water.appspot.com/download",
            "tiles": "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GSWE/YearlyClassification/LATEST/tiles/",
            "licence": "“All data here is produced under the Copernicus Programme and is provided free of charge, without restriction of use.” (download page)",
            "attribution": "Source: EC JRC/Google",
            "classes": {"0": "no data", "1": "not water", "2": "seasonal water", "3": "permanent water"},
            "built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "note": "Not a NASA/USGS product; derived from USGS/NASA Landsat imagery. The last year of this data set is 2021.",
        },
        "method": "Areas are sums of 30 m pixels (true pixel area on the WGS84 ellipsoid) inside the sea region. “Permanent” = water in every "
                  "month that had a valid observation in that year; “seasonal” = water in some of them. Where a year has “no data” the water "
                  "area of that year is a lower bound.",
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "aral.bin").write_bytes(raw)
    (OUT / "aral.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"grid {w}×{h}, {len(raw)} bytes, region {region_km2} km²")
    return 0


if __name__ == "__main__":
    sys.exit(main())
