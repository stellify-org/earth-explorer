import { describe, expect, it } from "vitest";
import { cellIndex, decodeFrame, sampleFrame } from "./frame";
import { lut, robustRange } from "./palettes";

/** Build an eegrid/1 frame the same way the Go encoder does (test input, not a measurement). */
function encode(values: (number | null)[], h: Record<string, unknown>): ArrayBuffer {
  const v = values.filter((x): x is number => x !== null);
  const lo = Math.min(...v), scale = 0.01;
  const header = JSON.stringify({ ...h, offset: lo, scale, nodata: 65535 });
  const hb = new TextEncoder().encode(header);
  const pad = (8 + hb.length) % 2;
  const buf = new ArrayBuffer(8 + hb.length + pad + 2 * values.length);
  const u8 = new Uint8Array(buf);
  u8.set([69, 69, 71, 49]);
  new DataView(buf).setUint32(4, hb.length + pad, true);
  u8.set(hb, 8);
  const q = new DataView(buf, 8 + hb.length + pad);
  values.forEach((x, i) => q.setUint16(2 * i, x === null ? 65535 : Math.round((x - lo) / scale), true));
  return buf;
}

// 2 x 4 global grid shaped like MERRA-2: longitude edges start half a cell west of -180.
const H = { format: "eegrid/1", nlat: 2, nlon: 4, lat: [-45, 45], lon: [-180, -90, 0, 90],
  lat_edges: [-90, 0, 90], lon_edges: [-225, -135, -45, 45, 135], wraps_longitude: true, units: "C", time: "2024-07", variable: "t2m" };

describe("eegrid/1 frames", () => {
  it("decodes values and no-data", () => {
    const f = decodeFrame(encode([1, 2.5, null, 4, 5, 6, 7, -3.21], H));
    expect(f.values[1]).toBeCloseTo(2.5, 5);
    expect(Number.isNaN(f.values[2])).toBe(true);
    expect(f.values[7]).toBeCloseTo(-3.21, 5);
  });
  it("finds cells by edges", () => {
    expect(cellIndex([-90, 0, 90], -90)).toBe(0);
    expect(cellIndex([-90, 0, 90], 0)).toBe(1);
    expect(cellIndex([-90, 0, 90], 95)).toBe(-1);
  });
  it("samples across the antimeridian using longitude wrap", () => {
    const f = decodeFrame(encode([1, 2, 3, 4, 5, 6, 7, 8], H));
    // lon 179 and -179 both fall in the first column (centre -180, edges -225..-135 → 135..225 wrapped)
    expect(sampleFrame(f, 10, 179)!.v).toBeCloseTo(5, 5);
    expect(sampleFrame(f, 10, -179)!.v).toBeCloseTo(5, 5);
    expect(sampleFrame(f, -10, 100)!.v).toBeCloseTo(4, 5);
  });
  it("rejects other data", () => {
    expect(() => decodeFrame(new ArrayBuffer(16))).toThrow();
  });
});

describe("palettes", () => {
  it("builds 256-entry tables with the scheme's end colours", () => {
    const t = lut("temperature");
    expect(t.length).toBe(768);
    expect([t[0], t[1], t[2]]).toEqual([0x31, 0x36, 0x95]);
    expect([t[765], t[766], t[767]]).toEqual([0xa5, 0x00, 0x26]);
  });
  it("uses robust, optionally symmetric ranges", () => {
    const v = new Float32Array(1000).map((_, i) => i - 200);
    const [lo, hi] = robustRange(v, false);
    expect(lo).toBeGreaterThanOrEqual(-200);
    expect(hi).toBeLessThan(799);
    const [a, b] = robustRange(v, true);
    expect(a).toBe(-b);
  });
});

import { frameUrl, setDataVersion, type Frame } from "./frame";
import { gridParams, shaderCell } from "./gridMath";

/** MERRA-2-shaped grid (361 x 576, edges as written by build_grids.py), optionally coarsened like Go. */
function merraFrame(f = 1): Frame {
  const lat = Array.from({ length: 361 }, (_, i) => -90 + 0.5 * i);
  const lon = Array.from({ length: 576 }, (_, j) => -180 + 0.625 * j);
  const latE = [-90, ...lat.slice(1).map((x) => x - 0.25), 90];
  const lonE = [...lon.map((x) => x - 0.3125), 179.6875];
  const pick = (e: number[], n: number) => Array.from({ length: Math.ceil(n / f) + 1 }, (_, k) => e[Math.min(k * f, n)]);
  const le = pick(latE, 361), oe = pick(lonE, 576);
  const mid = (e: number[]) => e.slice(1).map((x, k) => (x + e[k]) / 2);
  const h = { nlat: le.length - 1, nlon: oe.length - 1, lat_edges: le, lon_edges: oe, lat: mid(le), lon: mid(oe), wraps_longitude: true } as unknown as Frame["h"];
  return { h, values: new Float32Array(h.nlat * h.nlon).map((_, k) => k), q: new Uint16Array(0), bytes: 0 };
}

describe("GPU cell indexing (shader arithmetic) matches edge lookup", () => {
  for (const f of [1, 4]) {
    it(`agrees with sampleFrame on ${f === 1 ? "the native" : "the 4x4 coarse"} MERRA-2 grid`, () => {
      const fr = merraFrame(f);
      const p = gridParams(fr);
      let checked = 0;
      for (let k = 0; k < 20000; k++) {
        const lat = -90 + Math.random() * 180, lon = -180 + Math.random() * 360;
        const s = sampleFrame(fr, lat, lon);
        const c = shaderCell(p.grid, p.dims, lon, lat);
        // Skip points within 1e-6° of a cell edge (floating-point ties).
        if (!s || !c) continue;
        const nearEdge = fr.h.lat_edges.some((e) => Math.abs(e - lat) < 1e-6) || fr.h.lon_edges.some((e) => Math.abs(((e - lon + 540) % 360) - 180) < 1e-6);
        if (nearEdge) continue;
        expect([c[0], c[1]]).toEqual([s.i, s.j]);
        checked++;
      }
      expect(checked).toBeGreaterThan(19000);
      // Poles and the antimeridian.
      expect(shaderCell(p.grid, p.dims, 179.9, 90)).toEqual([fr.h.nlat - 1, 0]);
      expect(shaderCell(p.grid, p.dims, -180, -90)).toEqual([0, 0]);
    });
  }
  it("handles an unwrapped regional subset crossing 180°", () => {
    const h = { nlat: 4, nlon: 3, lat_edges: [9.75, 10.25, 10.75, 11.25, 11.75], lon_edges: [178.4375, 179.0625, 179.6875, 180.3125], wraps_longitude: false } as unknown as Frame["h"];
    const p = gridParams({ h } as Frame);
    expect(shaderCell(p.grid, p.dims, -179.8, 10.5)).toEqual([1, 2]); // -179.8 → 180.2, third column
    expect(shaderCell(p.grid, p.dims, 170, 10.5)).toBeNull();
  });
});

describe("canonical frame URLs", () => {
  it("match the Go FrameURL format (shared by packs and live requests)", () => {
    setDataVersion("power-v10");
    expect(frameUrl({ variable: "t2m", month: "2024-07", kind: "value", lod: "region", bbox: [45, 30, 90, 60] }))
      .toBe("/api/v1/vis/grid?var=t2m&month=2024-07&kind=value&lod=region&bbox=45.00,30.00,90.00,60.00&v=power-v10");
    setDataVersion("");
  });
});

import { boxContains, boxIntersects, type BBox } from "../offline/idb";

describe("regional pack lookup", () => {
  const tj: BBox = [67, 36, 76, 42], ca: BBox = [45, 30, 90, 60];
  it("uses a pack without network only when it covers the whole view", () => {
    expect(boxContains(ca, [65, 35, 80, 45])).toBe(true);
    expect(boxContains(tj, [65, 35, 80, 45])).toBe(false);
    expect(boxContains(tj, [70, 40, 75, 40])).toBe(true);
  });
  it("falls back to a partly covering pack, never to an unrelated one", () => {
    expect(boxIntersects(tj, [65, 35, 80, 45])).toBe(true);
    expect(boxIntersects(tj, [0, 40, 20, 55])).toBe(false);
    expect(boxIntersects(tj, [76, 36, 80, 42])).toBe(false); // touching edges only
    expect(boxIntersects(ca, [170, 30, -170, 50])).toBe(false); // antimeridian views are not matched
  });
});

import { tileRange, tileUrls } from "../globe/tileUrls";

describe("tile pack coverage (Tajikistan rectangle)", () => {
  const tj: [number, number, number, number] = [67, 36, 76, 42];
  it("covers the rectangle with the expected Web-Mercator tiles", () => {
    expect(tileRange(tj, 0)).toEqual({ x0: 0, x1: 0, y0: 0, y1: 0 });
    const r = tileRange(tj, 10);
    expect((r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1)).toBe(621);
    // Dushanbe (38.56 N, 68.78 E) is tile 10/707/392.
    expect(r.x0 <= 707 && 707 <= r.x1 && r.y0 <= 392 && 392 <= r.y1).toBe(true);
  });
  it("lists zoom 0…max once each", () => {
    const u = tileUrls("t/{z}/{x}/{y}", tj, 10);
    expect(u.length).toBe(879);
    expect(new Set(u.map((t) => t.url)).size).toBe(879);
    expect(u[0].url).toBe("t/0/0/0");
  });
});
