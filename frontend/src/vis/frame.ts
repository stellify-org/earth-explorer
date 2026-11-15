import { boxContains, boxIntersects, packRegions, storedFrame, type BBox } from "../offline/idb";

export interface FrameHeader {
  format: string; dataset: string; variable: string; parameter: string; long_name: string; units: string;
  time: string; kind?: "value" | "anomaly"; baseline?: string;
  nlat: number; nlon: number; lat: number[]; lon: number[]; lat_edges: number[]; lon_edges: number[];
  lod: string; aggregation: string; source: Record<string, string>;
  offset: number; scale: number; nodata: number;
  stats: { min: number; max: number; valid: number; cells: number };
  wraps_longitude: boolean;
}

export interface Frame {
  h: FrameHeader;

  source?: "pack" | "cache" | "network";

  values: Float32Array;

  q: Uint16Array;
  bytes: number;
}

export function decodeFrame(buf: ArrayBuffer): Frame {
  const u8 = new Uint8Array(buf);
  if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== "EEG1") throw new Error("not an eegrid/1 frame");
  const n = new DataView(buf).getUint32(4, true);
  const json = new TextDecoder().decode(u8.subarray(8, 8 + n)).replace(/\0+$/, "");
  const h = JSON.parse(json) as FrameHeader;
  const count = h.nlat * h.nlon;
  const q = new Uint16Array(buf.slice(8 + n, 8 + n + 2 * count));
  if (q.length !== count) throw new Error(`expected ${count} values, got ${q.length}`);
  const values = new Float32Array(count);
  for (let i = 0; i < count; i++) values[i] = q[i] === h.nodata ? NaN : h.offset + q[i] * h.scale;
  return { h, values, q, bytes: buf.byteLength };
}

export interface FrameRequest {
  variable: string; month: string; kind: "value" | "anomaly"; lod: "planet" | "region";

  bbox?: [number, number, number, number];
}

export function frameKey(r: FrameRequest) {
  return [r.variable, r.month, r.kind, r.lod, r.bbox?.join(",") ?? ""].join("|");
}

let dataVersion = "";
export function setDataVersion(v: string) { dataVersion = v; }

export function frameUrl(r: FrameRequest) {
  let u = `/api/v1/vis/grid?var=${encodeURIComponent(r.variable)}&month=${r.month}&kind=${r.kind}&lod=${r.lod}`;
  if (r.bbox) u += `&bbox=${r.bbox.map((x) => x.toFixed(2)).join(",")}`;
  return dataVersion ? `${u}&v=${dataVersion}` : u;
}

export const netStats: { bytes: number; ms: number }[] = [];

const cache = new Map<string, Promise<Frame>>();
const MAX_FRAMES = 32;

export function loadFrame(r: FrameRequest, signal?: AbortSignal): Promise<Frame> {
  const key = frameKey(r);
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
  const url = frameUrl(r);
  const p = (async () => {

    const stored = await storedFrame(url);
    if (stored) return { ...decodeFrame(stored), source: "pack" as const };

    const fromPack = async (ok: (pack: BBox, view: BBox) => boolean) => {
      if (r.lod !== "region" || !r.bbox) return undefined;
      for (const b of await packRegions()) {
        if (!ok(b, r.bbox)) continue;
        const buf = await storedFrame(frameUrl({ ...r, bbox: b }));
        if (buf) return { ...decodeFrame(buf), source: "pack" as const };
      }
      return undefined;
    };
    const covering = await fromPack(boxContains);
    if (covering) return covering;

    const t0 = performance.now();
    let resp: Response;
    try { resp = await fetch(url, { signal }); } catch (e) {

      const partial = (e as Error).name === "AbortError" ? undefined : await fromPack(boxIntersects);
      if (partial) return partial;
      throw e;
    }
    if (resp.status >= 500) {
      const partial = await fromPack(boxIntersects);
      if (partial) return partial;
    }
    if (!resp.ok) {
      const body = await resp.json().catch(() => null);
      throw new Error(body?.error?.message ?? `HTTP ${resp.status}`);
    }
    const buf = await resp.arrayBuffer();
    if (!resp.headers.get("x-ee-sw-cache")) {
      netStats.push({ bytes: Number(resp.headers.get("content-length")) || buf.byteLength, ms: performance.now() - t0 });
      if (netStats.length > 8) netStats.shift();
    }
    return { ...decodeFrame(buf), source: resp.headers.get("x-ee-sw-cache") ? "cache" as const : "network" as const };
  })();
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  while (cache.size > MAX_FRAMES) cache.delete(cache.keys().next().value!);
  return p;
}

export function cellIndex(edges: number[], x: number): number {
  let lo = 0, hi = edges.length - 2;
  if (x < edges[0] || x > edges[edges.length - 1]) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (edges[mid] <= x) lo = mid; else hi = mid - 1;
  }
  return lo;
}

export function sampleFrame(f: Frame, lat: number, lon: number): { v: number; i: number; j: number } | null {
  const h = f.h;
  const i = cellIndex(h.lat_edges, lat);
  if (i < 0) return null;
  const e0 = h.lon_edges[0];
  let x = lon;
  while (x < e0) x += 360;
  while (x > e0 + 360) x -= 360;
  const j = cellIndex(h.lon_edges, x);
  if (j < 0) return null;
  return { v: f.values[i * h.nlon + j], i, j };
}
