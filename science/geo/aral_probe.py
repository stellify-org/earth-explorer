"""Probe: JRC Global Surface Water v1.4 yearly classification over the Aral Sea, via HTTP range requests only.

    python -I probe.py 2000

Tiles are 10x10 degree, 40000x40000 px (0.00025 deg), one IFD, 256x256 internal tiles, LZW (no predictor),
no overviews. Internal tiles are NOT in row-major order (written in 3x3 groups), so the needed byte ranges
are sorted by offset and merged when the gap is small. LZW is decoded by libtiff through PIL (each tile wrapped in a tiny TIFF).
Output: aral_<year>.npy  (uint8 [3, H, W]: per 32x32-px block counts/1024*255 are NOT used; raw uint16 counts
of class 3, class 2, class 0), aral_<year>.png preview, and printed areas.
"""
import io, math, struct, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from PIL import Image

BASE = "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GSWE/YearlyClassification/LATEST/tiles"
WEST, EAST, SOUTH, NORTH = 57.5, 62.5, 43.0, 47.5
RES = 0.00025; BLOCK = 32; GAP = 32768
NB = [0, 0]

def url(year, lat_top, lon_left):
    sep = "_" if year == 2021 else "-"
    row = round((80 - lat_top) / RES); col = round((lon_left + 180) / RES)
    return f"{BASE}/yearlyClassification{year}/yearlyClassification{year}{sep}{row:010d}-{col:010d}.tif"

def get(u, a, b):
    r = urllib.request.Request(u, headers={"Range": f"bytes={a}-{b - 1}", "User-Agent": "earth-explorer-build"})
    d = urllib.request.urlopen(r, timeout=180).read(); NB[0] += len(d); NB[1] += 1
    return d

def ifds(url):
    head=get(url,0,65536); bo="<" if head[:2]==b"II" else ">"
    magic=struct.unpack(bo+"H",head[2:4])[0]; big=magic==43
    off=struct.unpack(bo+"Q",head[8:16])[0] if big else struct.unpack(bo+"I",head[4:8])[0]
    T={1:"B",2:"c",3:"H",4:"I",5:"II",16:"Q",12:"d",11:"f",7:"B"}
    out=[]
    def rd(o,n):
        return head[o:o+n] if o+n<=len(head) else get(url,o,o+n)
    while off:
        esz=20 if big else 12
        n=struct.unpack(bo+"Q",rd(off,8))[0] if big else struct.unpack(bo+"H",rd(off,2))[0]
        pos=off+(8 if big else 2); blk=rd(pos,n*esz+(8 if big else 4)); tags={}
        for k in range(n):
            e=blk[k*esz:(k+1)*esz]; tag,typ=struct.unpack(bo+"HH",e[:4])
            cnt=struct.unpack(bo+"Q",e[4:12])[0] if big else struct.unpack(bo+"I",e[4:8])[0]
            f=T.get(typ)
            if f is None: continue
            size=struct.calcsize(bo+f)*cnt; inline=e[12:20] if big else e[8:12]
            if size<=len(inline): raw=inline[:size]
            else:
                o=struct.unpack(bo+("Q" if big else "I"),inline)[0]; raw=rd(o,size)
            tags[tag]=raw if typ==2 else struct.unpack(bo+f*cnt,raw)
        out.append(tags)
        nx=blk[n*esz:]; off=struct.unpack(bo+("Q" if big else "I"),nx)[0]
    return big,bo,out

def wrap(raw, tw, th):
    """Minimal single-strip LZW TIFF around one compressed tile, so PIL/libtiff decodes it."""
    ents = [(256, 4, tw), (257, 4, th), (258, 3, 8), (259, 3, 5), (262, 3, 1), (273, 4, 8 + 2 + 9 * 12 + 4),
            (277, 3, 1), (278, 4, th), (279, 4, len(raw))]
    b = b"II*\x00" + struct.pack("<I", 8) + struct.pack("<H", len(ents))
    for tag, typ, v in ents:
        b += struct.pack("<HHI", tag, typ, 1) + (struct.pack("<HH", v, 0) if typ == 3 else struct.pack("<I", v))
    return b + struct.pack("<I", 0) + raw

def window(u, x0, y0, x1, y1):
    _, _, L = ifds(u); t = L[0]
    W, H, tw, th = t[256][0], t[257][0], t[322][0], t[323][0]
    assert t[259][0] == 5 and t[258][0] == 8 and t.get(317, (1,))[0] == 1 and len(L) == 1
    assert abs(t[33550][0] - RES) < 1e-12, t[33550]
    offs, cnts = t[324], t[325]; across = -(-W // tw)
    tx0, tx1, ty0, ty1 = x0 // tw, (x1 - 1) // tw, y0 // th, (y1 - 1) // th
    out = np.zeros((y1 - y0, x1 - x0), np.uint8)
    need = sorted((offs[ty * across + tx], cnts[ty * across + tx], tx, ty) for ty in range(ty0, ty1 + 1) for tx in range(tx0, tx1 + 1))
    runs = []
    for it in need:
        if runs and it[0] - (runs[-1][-1][0] + runs[-1][-1][1]) <= GAP: runs[-1].append(it)
        else: runs.append([it])
    def run(items):
        a = items[0][0]; blob = get(u, a, items[-1][0] + items[-1][1])
        for o, c, tx, ty in items:
            arr = np.asarray(Image.open(io.BytesIO(wrap(blob[o - a:o - a + c], tw, th))))
            sx0, sy0 = max(x0, tx * tw), max(y0, ty * th); sx1, sy1 = min(x1, (tx + 1) * tw), min(y1, (ty + 1) * th)
            out[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = arr[sy0 - ty * th:sy1 - ty * th, sx0 - tx * tw:sx1 - tx * tw]
    with ThreadPoolExecutor(4) as ex: list(ex.map(run, runs))
    return out, t[33922]

def main(year):
    t0 = time.time(); parts = []
    for lon_left in (50, 60):
        x0 = max(0, round((WEST - lon_left) / RES)); x1 = min(40000, round((EAST - lon_left) / RES))
        y0 = round((50 - NORTH) / RES); y1 = round((50 - SOUTH) / RES)
        u = url(year, 50, lon_left); a, tp = window(u, x0, y0, x1, y1)
        assert abs(tp[3] - lon_left) < 1e-9 and abs(tp[4] - 50) < 1e-9, tp
        parts.append(a); print(u, a.shape)
    m = np.hstack(parts); del parts
    h, w = m.shape
    lat = NORTH - (np.arange(h) + 0.5) * RES; phi = np.radians(lat)
    a_, e2 = 6378137.0, 0.00669437999014
    Mr = a_ * (1 - e2) / (1 - e2 * np.sin(phi) ** 2) ** 1.5; Nr = a_ / np.sqrt(1 - e2 * np.sin(phi) ** 2)
    px_km2 = (Mr * math.radians(RES)) * (Nr * np.cos(phi) * math.radians(RES)) / 1e6
    res = {}
    for c, name in ((3, "permanent"), (2, "seasonal"), (1, "not_water"), (0, "no_data")):
        res[name] = float(((m == c).sum(axis=1) * px_km2).sum())
    other = int((m > 3).sum())
    hb, wb = h // BLOCK, w // BLOCK
    blocks = np.stack([(m[:hb * BLOCK, :wb * BLOCK] == c).reshape(hb, BLOCK, wb, BLOCK).sum(axis=(1, 3), dtype=np.uint16) for c in (3, 2, 0)])
    np.save(f"aral_{year}.npy", blocks)
    rgb = np.zeros((hb, wb, 3), np.uint8); f = blocks.astype(np.float32) / (BLOCK * BLOCK)
    rgb[..., 2] = (f[0] * 255); rgb[..., 1] = (f[1] * 200); rgb[..., 0] = (f[2] * 255)
    Image.fromarray(rgb).save(f"aral_{year}.png")
    print(f"year {year}: permanent {res['permanent']:.0f} km2, seasonal {res['seasonal']:.0f} km2, "
          f"permanent+seasonal {res['permanent'] + res['seasonal']:.0f} km2, not water {res['not_water']:.0f} km2, "
          f"NO DATA {res['no_data']:.0f} km2, other-valued px {other}")
    print(f"coarse grid {wb}x{hb}; downloaded {NB[0]} bytes in {NB[1]} requests; {time.time() - t0:.1f} s")

if __name__ == "__main__":
    main(int(sys.argv[1]))
