/// <reference lib="webworker" />

import { TERRAIN_URL, fillTile } from "./tileUrls";

const T = 256;

const MAX_TILES = 192;
const RETRY_MS = 20_000;
const MAX_FALLBACK = 4;

type Dem = Float32Array | null;
const cache = new Map<string, Promise<Dem>>();
const failedAt = new Map<string, number>();
let canvas: OffscreenCanvas | null = null;

function upsample(parent: Float32Array, qx: number, qy: number): Float32Array {
  const out = new Float32Array(T * T), H = T / 2;
  for (let r = 0; r < T; r++) {
    const py = Math.min(T - 1, Math.max(0, qy * H + (r + 0.5) / 2 - 0.5)), y0 = Math.floor(py), y1 = Math.min(T - 1, y0 + 1), fy = py - y0;
    for (let c = 0; c < T; c++) {
      const px = Math.min(T - 1, Math.max(0, qx * H + (c + 0.5) / 2 - 0.5)), x0 = Math.floor(px), x1 = Math.min(T - 1, x0 + 1), fx = px - x0;
      out[r * T + c] = (parent[y0 * T + x0] * (1 - fx) + parent[y0 * T + x1] * fx) * (1 - fy) + (parent[y1 * T + x0] * (1 - fx) + parent[y1 * T + x1] * fx) * fy;
    }
  }
  return out;
}

function tile(z: number, x: number, y: number, depth = 0): Promise<Dem> {
  const n = 2 ** z;
  x = ((x % n) + n) % n;
  if (y < 0 || y >= n) return Promise.resolve(null);
  const key = `${z}/${x}/${y}`;
  const hit = cache.get(key);
  const f = failedAt.get(key);
  const retry = !!f && Date.now() - f >= RETRY_MS;
  if (hit && !retry) { cache.delete(key); cache.set(key, hit); return hit; }
  if (!hit && f && !retry) return Promise.resolve(null);
  const p: Promise<Dem> = fetch(fillTile(TERRAIN_URL, z, x, y))
    .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((b) => createImageBitmap(b))
    .then((bmp) => {
      canvas ??= new OffscreenCanvas(T, T);
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.clearRect(0, 0, T, T);
      ctx.drawImage(bmp, 0, 0, T, T);
      bmp.close();
      const d = ctx.getImageData(0, 0, T, T).data;
      const h = new Float32Array(T * T);
      for (let i = 0, o = 0; i < h.length; i++, o += 4) h[i] = d[o] * 256 + d[o + 1] + d[o + 2] / 256 - 32768;
      failedAt.delete(key);
      return h;
    })
    .catch(async () => {
      failedAt.set(key, Date.now());

      const up = z > 0 && depth < MAX_FALLBACK ? await tile(z - 1, x >> 1, y >> 1, depth + 1) : null;
      if (up) return upsample(up, x & 1, y & 1);
      if (cache.get(key) === p) cache.delete(key);
      return null;
    });
  cache.set(key, p);
  while (cache.size > MAX_TILES) cache.delete(cache.keys().next().value!);
  return p;
}

const MERC_LAT = 85.0511;
const mercY = (lat: number) => {
  const r = (Math.max(-MERC_LAT, Math.min(MERC_LAT, lat)) * Math.PI) / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
};

async function heights(z: number, w: number, s: number, e: number, nLat: number, size: number) {
  const N = 2 ** z * T;
  const gxs = new Float64Array(size), gys = new Float64Array(size);
  for (let i = 0; i < size; i++) gxs[i] = ((w + ((e - w) * i) / (size - 1) + 180) / 360) * N - 0.5;
  for (let j = 0; j < size; j++) gys[j] = mercY(nLat - ((nLat - s) * j) / (size - 1)) * N - 0.5;
  const tx0 = Math.floor(Math.floor(gxs[0]) / T), tx1 = Math.floor((Math.floor(gxs[size - 1]) + 1) / T);
  const ty0 = Math.floor(Math.max(0, Math.floor(gys[0])) / T), ty1 = Math.floor(Math.min(N - 1, Math.floor(gys[size - 1]) + 1) / T);
  const tiles = new Map<string, Dem>();
  const jobs: Promise<void>[] = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    jobs.push(tile(z, tx, ty).then((d) => { tiles.set(`${tx}/${ty}`, d); }));
  }
  await Promise.all(jobs);
  let missing = 0;
  const px = (gx: number, gy: number) => {
    gy = Math.max(0, Math.min(N - 1, gy));
    const tx = Math.floor(gx / T), ty = Math.floor(gy / T);
    const d = tiles.get(`${tx}/${ty}`);
    if (!d) return NaN;
    return d[(gy - ty * T) * T + (gx - tx * T)];
  };
  const out = new Float32Array(size * size);
  for (let j = 0; j < size; j++) {
    const gy = gys[j], y0 = Math.floor(gy), fy = gy - y0;
    for (let i = 0; i < size; i++) {
      const gx = gxs[i], x0 = Math.floor(gx), fx = gx - x0;
      const a = px(x0, y0), b = px(x0 + 1, y0), c = px(x0, y0 + 1), d = px(x0 + 1, y0 + 1);
      let h = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
      if (Number.isNaN(h)) { h = [a, b, c, d].find((v) => !Number.isNaN(v)) ?? NaN; }
      if (Number.isNaN(h)) { missing++; h = 0; }
      out[j * size + i] = Math.max(0, h);
    }
  }
  return { out, missing: missing === size * size };
}

async function shade(z: number, x: number, y: number) {
  const d = await tile(z, x, y);
  if (!d) return null;
  const rgba = new Uint8ClampedArray(T * T * 4);
  const zf = Math.max(1, 2 ** ((11 - z) * 0.55));
  const az = (315 * Math.PI) / 180, alt = (45 * Math.PI) / 180;
  const lx = Math.sin(az) * Math.cos(alt), ly = Math.cos(az) * Math.cos(alt), lz = Math.sin(alt);
  const n = 2 ** z;
  for (let r = 0; r < T; r++) {
    const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + (r + 0.5) / T)) / n)));
    const cell = (40075016.686 * Math.cos(lat)) / (T * n);
    const rU = r > 0 ? r - 1 : r, rD = r < T - 1 ? r + 1 : r;
    for (let c = 0; c < T; c++) {
      const cL = c > 0 ? c - 1 : c, cR = c < T - 1 ? c + 1 : c;
      const h0 = d[r * T + c];

      if (h0 <= 0) continue;

      const dzdx = (d[r * T + cR] - d[r * T + cL]) / ((cR - cL) * cell);
      const dzdy = (d[rU * T + c] - d[rD * T + c]) / ((rD - rU) * cell);
      const nx = -dzdx * zf, ny = -dzdy * zf, nz = 1;
      const s = (nx * lx + ny * ly + nz * lz) / Math.hypot(nx, ny, nz);
      const o = (r * T + c) * 4;
      if (s < lz) {
        rgba[o] = 8; rgba[o + 1] = 10; rgba[o + 2] = 20;
        rgba[o + 3] = Math.min(220, ((lz - s) / lz) * 330);
      } else {
        rgba[o] = 255; rgba[o + 1] = 250; rgba[o + 2] = 235;
        rgba[o + 3] = Math.min(110, ((s - lz) / (1 - lz)) * 260);
      }
    }
  }
  return rgba;
}

type Req =
  | { id: number; op: "heights"; z: number; w: number; s: number; e: number; n: number; size: number }
  | { id: number; op: "shade"; z: number; x: number; y: number };

self.onmessage = async (ev: MessageEvent<Req>) => {
  const m = ev.data;
  try {
    if (m.op === "heights") {
      const { out, missing } = await heights(m.z, m.w, m.s, m.e, m.n, m.size);
      (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id: m.id, heights: out, missing }, [out.buffer]);
    } else {
      const rgba = await shade(m.z, m.x, m.y);
      (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id: m.id, rgba }, rgba ? [rgba.buffer] : []);
    }
  } catch (e) {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id: m.id, error: String(e) });
  }
};
