import type { Flood, Terrain } from "./model";

export const NEAR_BUFFER_M = 100;

export const PLACEHOLDER_HEIGHT_M = 3;

export const METRES_PER_LEVEL = 3;

export type HeightSource = "height" | "levels" | "none";
export type BuildingClass = 0 | 1 | 2;
export const OUTSIDE: BuildingClass = 0, NEAR: BuildingClass = 1, INTERSECTS: BuildingClass = 2;

export interface BuildingsMeta {
  version: 1;
  count: number;
  bytes: number;
  sha256: string;
  ids: { file: string; bytes: number; sha256: string };

  coordinate_unit_deg: number;
  bbox: { west: number; east: number; south: number; north: number };
  retrieved_at: string;

  sources: { key: string; name: string; url: string; licence: string; attribution: string; count: number; note?: string }[];

  kinds: string[];

  names: Record<string, string>;
  height_tags: { height: number; levels: number; none: number };
  coverage_note: string;
}

export interface Building {
  index: number;

  idKind: number;
  source: number;
  kind: number;
  heightSource: HeightSource;

  heightM?: number;
  levels?: number;

  rings: [number, number][][];
  lon: number; lat: number;
}

export function parseBuildings(buf: ArrayBuffer, meta: BuildingsMeta): Building[] {
  if (buf.byteLength !== meta.bytes) throw new Error("The buildings file has the wrong size");
  const v = new DataView(buf), out: Building[] = [], unit = meta.coordinate_unit_deg;
  let o = 0;
  while (o < buf.byteLength) {
    const flags = v.getUint8(o), heightDm = v.getUint16(o + 1, true), levels10 = v.getUint16(o + 3, true), kind = v.getUint8(o + 5), nRings = v.getUint8(o + 6); o += 7;
    const heightKind = (flags >> 4) & 3;
    const rings: [number, number][][] = [];
    let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
    for (let r = 0; r < nRings; r++) {
      const cnt = v.getUint16(o, true); o += 2;
      const ring: [number, number][] = [];
      let x = v.getInt32(o, true), y = v.getInt32(o + 4, true); o += 8;
      for (let k = 0; k < cnt; k++) {
        if (k > 0) { x += v.getInt16(o, true); y += v.getInt16(o + 2, true); o += 4; }
        const lon = x * unit, lat = y * unit;
        ring.push([lon, lat]);
        if (r === 0) { if (lon < w) w = lon; if (lon > e) e = lon; if (lat < s) s = lat; if (lat > n) n = lat; }
      }
      rings.push(ring);
    }
    const levels = levels10 ? levels10 / 10 : undefined;
    const heightSource: HeightSource = heightKind === 1 ? "height" : heightKind === 2 ? "levels" : "none";
    out.push({ index: out.length, idKind: (flags >> 2) & 3, source: flags & 3, kind, heightSource, levels, rings, lon: (w + e) / 2, lat: (s + n) / 2,
      heightM: heightSource === "height" ? heightDm / 10 : heightSource === "levels" && levels ? levels * METRES_PER_LEVEL : undefined });
  }
  if (out.length !== meta.count) throw new Error(`The buildings file holds ${out.length} footprints, expected ${meta.count}`);
  return out;
}

export function buildingId(ids: ArrayBuffer, b: Building): string {
  const o = b.index * 16;
  if (b.idKind !== 3) return `${b.idKind === 2 ? "relation" : "way"}/${new DataView(ids).getBigInt64(o, true)}`;
  const h = Array.from(new Uint8Array(ids, o, 16), (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const drawnHeightM = (b: Building) => b.heightM ?? PLACEHOLDER_HEIGHT_M;

type P = [number, number];
function inRings(rings: P[][], x: number, y: number): boolean {
  let inside = false;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointSeg2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const u = l2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / l2));
  const qx = ax + u * dx - px, qy = ay + u * dy - py;
  return qx * qx + qy * qy;
}
const cross = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
function segsCross(a: P, b: P, c: P, d: P): boolean {
  const d1 = cross(c[0], c[1], d[0], d[1], a[0], a[1]), d2 = cross(c[0], c[1], d[0], d[1], b[0], b[1]);
  const d3 = cross(a[0], a[1], b[0], b[1], c[0], c[1]), d4 = cross(a[0], a[1], b[0], b[1], d[0], d[1]);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
function segSeg2(a: P, b: P, c: P, d: P): number {
  if (segsCross(a, b, c, d)) return 0;
  return Math.min(pointSeg2(a[0], a[1], c[0], c[1], d[0], d[1]), pointSeg2(b[0], b[1], c[0], c[1], d[0], d[1]),
    pointSeg2(c[0], c[1], a[0], a[1], b[0], b[1]), pointSeg2(d[0], d[1], a[0], a[1], b[0], b[1]));
}

export function polygonRectDistance(rings: P[][], x0: number, y0: number, x1: number, y1: number): number {
  const outer = rings[0];
  for (const [x, y] of outer) if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return 0;
  if (inRings(rings, (x0 + x1) / 2, (y0 + y1) / 2)) return 0;
  const rect: P[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  let best = Infinity;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    for (let k = 0, m = 3; k < 4; m = k++) { const d = segSeg2(ring[j], ring[i], rect[m], rect[k]); if (d === 0) return 0; if (d < best) best = d; }

  if (inRings(rings, x0, y0)) return 0;
  return Math.sqrt(best);
}

export interface BuildingCells {

  offsets: Uint32Array;

  cell: Int32Array;

  dist: Float32Array;

  groundMin: Float32Array;

  offGrid: number;
}

const M_PER_DEG_LAT = 111_320;

export function buildingCells(t: Terrain, buildings: Building[], bufferM = NEAR_BUFFER_M): BuildingCells {
  const offsets = new Uint32Array(buildings.length + 1), cells: number[] = [], dists: number[] = [];
  const groundMin = new Float32Array(buildings.length).fill(NaN);
  let offGrid = 0;
  for (const b of buildings) {
    const kx = M_PER_DEG_LAT * Math.cos((b.lat * Math.PI) / 180), ky = M_PER_DEG_LAT;
    const X = (lon: number) => (lon - b.lon) * kx, Y = (lat: number) => (lat - b.lat) * ky;
    const rings = b.rings.map((r) => r.map(([lon, lat]) => [X(lon), Y(lat)] as P));
    let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
    for (const [lon, lat] of b.rings[0]) { if (lon < w) w = lon; if (lon > e) e = lon; if (lat < s) s = lat; if (lat > n) n = lat; }
    const dLon = bufferM / kx, dLat = bufferM / ky;
    const j0 = t.col(w - dLon), j1 = t.col(e + dLon), i0 = t.row(n + dLat), i1 = t.row(s - dLat);
    if (t.col(w) < 0 || t.col(e) >= t.w || t.row(n) < 0 || t.row(s) >= t.h) offGrid++;
    const found: [number, number][] = [];
    for (let i = Math.max(0, i0); i <= Math.min(t.h - 1, i1); i++) for (let j = Math.max(0, j0); j <= Math.min(t.w - 1, j1); j++) {
      const d = polygonRectDistance(rings, X(t.lon(j)), Y(t.lat(i + 1)), X(t.lon(j + 1)), Y(t.lat(i)));
      if (d <= bufferM) found.push([i * t.w + j, d]);
    }
    found.sort((a, c) => a[1] - c[1] || a[0] - c[0]);
    let g = Infinity;
    for (const [c, d] of found) { cells.push(c); dists.push(d); if (d === 0 && t.z[c] < g) g = t.z[c]; }
    if (Number.isFinite(g)) groundMin[b.index] = g;
    offsets[b.index + 1] = cells.length;
  }
  return { offsets, cell: Int32Array.from(cells), dist: Float32Array.from(dists), groundMin, offGrid };
}

export interface Classification {
  level: number;
  cls: Uint8Array;
  outside: number; near: number; intersects: number;

  depthM: Float32Array;

  distanceM: Float32Array;
}

export function classify(t: Terrain, bc: BuildingCells, f: Flood): Classification {
  const n = bc.offsets.length - 1, cls = new Uint8Array(n), depthM = new Float32Array(n).fill(NaN), distanceM = new Float32Array(n).fill(NaN);
  let near = 0, intersects = 0;
  for (let b = 0; b < n; b++) {
    let c: BuildingClass = OUTSIDE, low = Infinity;
    for (let k = bc.offsets[b]; k < bc.offsets[b + 1]; k++) {
      const m = f.mask[bc.cell[k]];
      if (!m) continue;
      if (bc.dist[k] === 0) { c = INTERSECTS; if (m === 2 && t.z[bc.cell[k]] < low) low = t.z[bc.cell[k]]; }
      else { if (c === OUTSIDE) { c = NEAR; distanceM[b] = bc.dist[k]; } break; }
    }
    cls[b] = c;
    if (c === INTERSECTS) { intersects++; distanceM[b] = 0; if (Number.isFinite(low) && !f.belowData) depthM[b] = f.level - low; }
    else if (c === NEAR) near++;
  }
  return { level: f.level, cls, outside: n - near - intersects, near, intersects, depthM, distanceM };
}

export function drawnSurfaceZ(t: Terrain, step: number, lon: number, lat: number): number {
  const rows = Math.floor((t.h - 1) / step) + 1, cols = Math.floor((t.w - 1) / step) + 1;
  const n = 2 ** t.grid.zoom * 256;
  const fx = ((lon + 180) / 360) * n - t.grid.x0, fy = ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n - t.grid.y0;
  const gq = Math.min(cols - 1, Math.max(0, (fx - 0.5) / step)), gr = Math.min(rows - 1, Math.max(0, (fy - 0.5) / step));
  const q = Math.min(cols - 2, Math.floor(gq)), r = Math.min(rows - 2, Math.floor(gr)), u = gq - q, v = gr - r;
  const z = (rr: number, qq: number) => t.z[rr * step * t.w + qq * step];
  const a = z(r, q), b = z(r, q + 1), c = z(r + 1, q + 1), d = z(r + 1, q);
  return u >= v ? a + (b - a) * u + (c - b) * v : a + (d - a) * v + (c - d) * u;
}

export interface BuildingsPack { meta: BuildingsMeta; buildings: Building[];  ids: Promise<ArrayBuffer | undefined> }
let loading: Promise<BuildingsPack> | null = null;
async function pinned(url: string): Promise<Response> {
  let cache: Cache | undefined;
  try { cache = await caches.open("ee-geo-packs"); } catch {  }
  let resp = await cache?.match(url).catch(() => undefined);
  if (!resp) {
    resp = await fetch(url);
    if (!resp.ok || (resp.headers.get("content-type") ?? "").includes("text/html")) throw new Error("The buildings pack is not installed on this server (run science/geo/build_nurek_buildings.py)");
    await cache?.put(url, resp.clone()).catch(() => undefined);
  }
  return resp;
}

export function loadBuildings(): Promise<BuildingsPack> {
  loading ??= (async () => {
    const meta = (await (await pinned("/scenario/nurek_buildings.json")).json()) as BuildingsMeta;
    const buf = await (await pinned("/scenario/nurek_buildings.bin")).arrayBuffer();
    const buildings = parseBuildings(buf, meta);

    const ids = pinned(`/scenario/${meta.ids.file}`).then((r) => r.arrayBuffer()).then((b) => (b.byteLength === meta.ids.bytes ? b : undefined), () => undefined);
    return { meta, buildings, ids };
  })();
  loading.catch(() => { loading = null; });
  return loading;
}
