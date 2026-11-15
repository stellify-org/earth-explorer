"""Convert CRUST1.0 (Laske, Masters, Ma & Pasyanos 2013) into one compact local file.

    science/.venv/bin/python -I science/geo/build_crust1.py [crust1.0.tar.gz] [out_dir]

Without a tarball path the archive is downloaded from the authors' site. The output
(frontend/public/crust1/) is NOT committed: the model is published for download with a citation
request but without an explicit redistribution licence, so every installation fetches it from
the source. Values are copied, never interpolated or derived.

crust1.bin, little endian, 4 blocks of 64800 cells x 9 values, cell order as in the model
(latitude 89.5N -> 89.5S, inner loop longitude 179.5W -> 179.5E):
  int16  boundary elevation, 0.01 km (top of water, bottom of water, ice, sediments 1-3,
         crystalline crust 1-3 = Moho); negative = below sea level
  uint16 Vp, 0.01 km/s     uint16 Vs, 0.01 km/s     uint16 density, 0.01 g/cm3
  (layers: water, ice, upper/middle/lower sediments, upper/middle/lower crust, mantle below Moho)
"""
import hashlib, io, json, sys, tarfile, urllib.request
from array import array
from datetime import datetime, timezone
from pathlib import Path

URL = "http://igppweb.ucsd.edu/~gabi/crust1/crust1.0.tar.gz"
SHA256 = "0b41b46fc3e1a76debbbcb66ab407febaeee4dc3033db7a0a24d2bb7c7adfe3e"
CELLS = 64800


def main() -> None:
    args = sys.argv[1:]
    out = Path(args[1] if len(args) > 1 else Path(__file__).resolve().parents[2] / "frontend/public/crust1")
    raw = Path(args[0]).read_bytes() if args else urllib.request.urlopen(URL, timeout=120).read()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != SHA256:
        raise SystemExit(f"unexpected archive checksum {digest}; check the source before using it")
    tar = tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz")
    blocks = []
    for name, code in (("crust1.bnds", "h"), ("crust1.vp", "H"), ("crust1.vs", "H"), ("crust1.rho", "H")):
        text = tar.extractfile(next(m for m in tar.getmembers() if m.name.split("/")[-1] == name)).read().decode()
        values = [float(x) for x in text.split()]
        if len(values) != CELLS * 9:
            raise SystemExit(f"{name}: {len(values)} values, expected {CELLS * 9}")
        q = array(code, (round(v * 100) for v in values))
        if max(abs(a / 100 - b) for a, b in zip(q, values)) > 1e-9:
            raise SystemExit(f"{name}: values do not survive 0.01 quantisation")
        if sys.byteorder != "little":
            q.byteswap()
        blocks.append(q.tobytes())
    data = b"".join(blocks)
    out.mkdir(parents=True, exist_ok=True)
    (out / "crust1.bin").write_bytes(data)
    (out / "meta.json").write_text(json.dumps({
        "model": "CRUST1.0", "resolution": "1 degree x 1 degree cells (values are cell averages)",
        "citation": "Laske, G., Masters, G., Ma, Z. and Pasyanos, M., Update on CRUST1.0 - A 1-degree Global Model of Earth's Crust, Geophys. Res. Abstracts, 15, Abstract EGU2013-2658, 2013.",
        "source_url": URL, "source_page": "https://igppweb.ucsd.edu/~gabi/crust1.html", "source_sha256": digest,
        "converted_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
        "note": "Values copied from the model files at their printed precision (0.01). No interpolation.",
    }, indent=1))
    print(f"{out / 'crust1.bin'}: {len(data)} bytes")


if __name__ == "__main__":
    main()
