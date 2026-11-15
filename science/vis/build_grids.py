"""Ingest NASA POWER (MERRA-2-based) global monthly grids into Earth Explorer's
compact "eegrid/1" binary format.

Source: NASA POWER Analysis-Ready Data on the Registry of Open Data on AWS,
    s3://nasa-power/merra2/spatial/power_merra2_monthly_spatial_utc.zarr   (anonymous, us-west-2)
    POWER data version 10, MERRA-2 native grid 0.5° lat x 0.625° lon (361 x 576), monthly.

Run (resumable; months already written are skipped):
    science/.venv/bin/python -I science/vis/build_grids.py data/grids [VAR ...] [--from 1981-01] [--to 2026-12]

Output per variable: data/grids/power-merra2/<var>/<YYYY-MM>.eeg.gz and meta.json.

eegrid/1 layout (little endian):
    bytes 0-3   magic "EEG1"
    bytes 4-7   uint32 header length N
    bytes 8..   N bytes UTF-8 JSON header
    padding     to a 2-byte boundary
    data        uint16[nlat * nlon], row-major, row 0 = southernmost latitude
                value = offset + q * scale;  q = 65535 means "no data"
The header carries lat/lon cell centres AND edges, units, source and quantisation.
Quantisation step = max(0.01, (max - min) / 65534). The source itself is stored with
FixedScaleOffset(scale=100), i.e. 0.01 resolution, so this is lossless relative to the source.
"""
from __future__ import annotations

import gzip
import json
import pathlib
import struct
import sys
import time

import numpy as np
import xarray as xr

ZARR = "s3://nasa-power/merra2/spatial/power_merra2_monthly_spatial_utc.zarr"
DATASET = "power-merra2"
VARS = {
    "t2m": "T2M", "precip": "PRECTOTCORR", "u10m": "U10M", "v10m": "V10M",
    "qv2m": "QV2M", "rh2m": "RH2M", "soilwet": "GWETROOT",
}
NODATA = 65535


def edges(centers: np.ndarray, lo: float | None, hi: float | None) -> np.ndarray:
    mid = (centers[1:] + centers[:-1]) / 2
    e = np.concatenate([[centers[0] - (centers[1] - centers[0]) / 2], mid, [centers[-1] + (centers[-1] - centers[-2]) / 2]])
    if lo is not None:
        e = np.clip(e, lo, hi)
    return e


def encode(values: np.ndarray, header: dict) -> bytes:
    v = values.astype(np.float64)
    ok = np.isfinite(v)
    if ok.any():
        vmin, vmax = float(v[ok].min()), float(v[ok].max())
    else:
        vmin = vmax = 0.0
    scale = max(0.01, (vmax - vmin) / 65534) if vmax > vmin else 0.01
    q = np.full(v.shape, NODATA, dtype="<u2")
    q[ok] = np.clip(np.round((v[ok] - vmin) / scale), 0, 65534).astype("<u2")
    header = {**header, "offset": vmin, "scale": scale, "nodata": NODATA,
              "stats": {"min": vmin, "max": vmax, "valid": int(ok.sum()), "cells": int(v.size)}}
    h = json.dumps(header, separators=(",", ":")).encode()
    pad = b"\0" * ((8 + len(h)) % 2)
    return b"EEG1" + struct.pack("<I", len(h) + len(pad)) + h + pad + q.tobytes()


def main(out: pathlib.Path, names: list[str], start: str, end: str) -> None:
    ds = xr.open_zarr(ZARR, storage_options={"anon": True, "client_kwargs": {"region_name": "us-west-2"}}, consolidated=True)
    lat = ds["lat"].values.astype(float)
    lon = ds["lon"].values.astype(float)
    assert np.all(np.diff(lat) > 0) and np.all(np.diff(lon) > 0), "expected ascending lat/lon"
    lat_e = edges(lat, -90.0, 90.0)
    lon_e = edges(lon, None, None)
    for name in names:
        param = VARS[name]
        da = ds[param]
        attrs = da.attrs
        d = out / DATASET / name
        d.mkdir(parents=True, exist_ok=True)
        times = [str(t)[:7] for t in da["time"].values]
        written = []
        todo = [i for i, ym in enumerate(times) if start <= ym <= end and not (d / f"{ym}.eeg.gz").exists()]
        written += [ym for ym in times if start <= ym <= end and (d / f"{ym}.eeg.gz").exists()]
        for b0 in range(0, len(todo), 24):
            idx = todo[b0:b0 + 24]
            for attempt in range(4):
                try:
                    block = da.isel(time=idx).values
                    break
                except Exception as e:
                    print(f"{name} batch {times[idx[0]]}: {e}; retry", flush=True)
                    time.sleep(5 * (attempt + 1))
            else:
                print(f"{name} batch {times[idx[0]]}: FAILED", flush=True)
                continue
            for k, i in enumerate(idx):
                ym, arr = times[i], block[k]
                if not np.isfinite(arr).any():
                    continue
                header = {
                    "format": "eegrid/1", "dataset": DATASET, "variable": name, "parameter": param,
                    "long_name": attrs.get("long_name"), "units": attrs.get("units"), "time": ym,
                    "nlat": len(lat), "nlon": len(lon),
                    "lat": lat.tolist(), "lon": lon.tolist(), "lat_edges": lat_e.tolist(), "lon_edges": lon_e.tolist(),
                    "lod": "native", "aggregation": "none (source grid)",
                    "source": {"name": "NASA POWER Analysis-Ready Data (MERRA-2 based), monthly, UTC", "uri": ZARR,
                               "power_version": "10", "license": "CC BY 4.0 (Registry of Open Data on AWS listing)",
                               "retrieved": time.strftime("%Y-%m-%d")},
                }
                f = d / f"{ym}.eeg.gz"
                tmp = f.with_suffix(".tmp")
                tmp.write_bytes(gzip.compress(encode(arr, header), compresslevel=6))
                tmp.rename(f)
                written.append(ym)
            print(f"{name}: {len(written)} months (last {times[idx[-1]]})", flush=True)
        meta = {"dataset": DATASET, "variable": name, "parameter": param, "long_name": attrs.get("long_name"),
                "definition": attrs.get("definition"), "units": attrs.get("units"),
                "valid_min": attrs.get("valid_min"), "valid_max": attrs.get("valid_max"),
                "months": sorted(set(written)), "grid": {"nlat": len(lat), "nlon": len(lon), "dlat": 0.5, "dlon": 0.625},
                "source": ZARR}
        (d / "meta.json").write_text(json.dumps(meta, indent=1))
        print(f"{name}: done, {len(written)} months", flush=True)


if __name__ == "__main__":
    args = sys.argv[1:]
    out = pathlib.Path(args[0])
    opts = {"--from": "1981-01", "--to": "2099-12"}
    rest = []
    i = 1
    while i < len(args):
        if args[i] in opts:
            opts[args[i]] = args[i + 1]
            i += 2
        else:
            rest.append(args[i])
            i += 1
    main(out, rest or list(VARS), opts["--from"], opts["--to"])
