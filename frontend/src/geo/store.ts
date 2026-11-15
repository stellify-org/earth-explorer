export type LayerName = "land" | "lakes" | "coast" | "borders" | "rivers" | "ice" | "shelves" | "countries";

export interface Feature {

  bbox: [number, number, number, number];

  parts: Float32Array[][];

  rank?: number;

  disputed?: boolean;
  name?: string;
  a3?: string;
  continent?: string;
  label?: [number, number];
  labelRank?: number;
}

export interface GeoLayer { kind: "poly" | "line"; features: Feature[] }
export type GeoSet = Partial<Record<LayerName, GeoLayer>>;

interface RawFeature { b: number[]; g: unknown[]; r?: number; d?: number; n?: string; a3?: string; c?: string; lx?: number; ly?: number; lr?: number }
interface RawFile { v: number; q: number; layers: Record<string, { k: "poly" | "line"; f: RawFeature[] }> }

function decodePath(enc: number[], q: number): Float32Array {
  const out = new Float32Array(enc.length);
  let x = 0, y = 0;
  for (let i = 0; i < enc.length; i += 2) {
    x += enc[i]; y += enc[i + 1];
    out[i] = x / q; out[i + 1] = y / q;
  }
  return out;
}

export function decode(raw: RawFile): GeoSet {
  if (raw.v !== 1) throw new Error(`unsupported geo format v${raw.v}`);
  const q = raw.q;
  const set: GeoSet = {};
  for (const [name, l] of Object.entries(raw.layers)) {
    set[name as LayerName] = {
      kind: l.k,
      features: l.f.map((f) => ({
        bbox: [f.b[0] / q, f.b[1] / q, f.b[2] / q, f.b[3] / q],
        parts: l.k === "poly"
          ? (f.g as number[][][]).map((rings) => rings.map((r) => decodePath(r, q)))
          : (f.g as number[][]).map((p) => [decodePath(p, q)]),
        rank: f.r, disputed: f.d === 1, name: f.n, a3: f.a3, continent: f.c,
        label: f.lx !== undefined && f.ly !== undefined ? [f.lx, f.ly] : undefined, labelRank: f.lr,
      })),
    };
  }
  return set;
}

export interface Manifest {
  format: string; chunk_degrees: number; lod2_chunks: string[];
  source: { name: string; version: string; repository: string; commit: string; license: string; scales: Record<string, string> };
  bytes: Record<string, number>; total_bytes: number;
}

const BASE = "/geo";

export class GeoStore {
  manifest?: Manifest;
  lod0?: GeoSet;
  lod1?: GeoSet;
  countries?: GeoSet;
  private lod1P?: Promise<GeoSet>;
  private countriesP?: Promise<GeoSet>;
  private chunks = new Map<string, GeoSet>();
  private chunkP = new Map<string, Promise<GeoSet | undefined>>();
  private chunkSet = new Set<string>();

  onData?: () => void;
  readonly ready: Promise<void>;

  constructor(private fetcher: (url: string) => Promise<Response> = (u) => fetch(u)) {
    this.ready = (async () => {
      const [m, l0] = await Promise.all([this.json<Manifest>(`${BASE}/manifest.json`), this.json<RawFile>(`${BASE}/lod0.json`)]);
      this.manifest = m;
      this.chunkSet = new Set(m.lod2_chunks);
      this.lod0 = decode(l0);
    })();
  }

  private async json<T>(url: string): Promise<T> {
    const r = await this.fetcher(url);
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.json() as Promise<T>;
  }

  loadLod1(): Promise<GeoSet> {
    this.lod1P ??= this.json<RawFile>(`${BASE}/lod1.json`).then((raw) => { this.lod1 = decode(raw); this.onData?.(); return this.lod1; });
    return this.lod1P;
  }

  private labelsP?: Promise<[string, number, number, number][]>;

  loadLabels(): Promise<[string, number, number, number][]> {
    this.labelsP ??= this.json<[string, number, number, number][]>(`${BASE}/labels.json`);
    return this.labelsP;
  }

  loadCountries(): Promise<GeoSet> {
    this.countriesP ??= this.json<RawFile>(`${BASE}/countries.json`).then((raw) => (this.countries = decode(raw)));
    return this.countriesP;
  }

  chunksFor(w: number, s: number, e: number, n: number): string[] {
    const c = this.manifest?.chunk_degrees ?? 15;
    const out: string[] = [];
    const x0 = Math.max(0, Math.floor((w + 180) / c)), x1 = Math.min(360 / c - 1, Math.floor((e + 180 - 1e-9) / c));
    const y0 = Math.max(0, Math.floor((s + 90) / c)), y1 = Math.min(180 / c - 1, Math.floor((n + 90 - 1e-9) / c));
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const id = `${x}_${y}`;
      if (this.chunkSet.has(id)) out.push(id);
    }
    return out;
  }

  chunk(id: string): GeoSet | undefined {
    const c = this.chunks.get(id);
    if (c) { this.chunks.delete(id); this.chunks.set(id, c); }
    return c;
  }

  loadChunk(id: string): Promise<GeoSet | undefined> {
    const have = this.chunk(id);
    if (have) return Promise.resolve(have);
    let p = this.chunkP.get(id);
    if (!p) {
      p = this.json<RawFile>(`${BASE}/lod2/${id}.json`)
        .then((raw) => {
          const set = decode(raw);
          this.chunks.set(id, set);
          while (this.chunks.size > 48) this.chunks.delete(this.chunks.keys().next().value!);
          return set;
        })
        .catch(() => undefined)
        .finally(() => this.chunkP.delete(id));
      this.chunkP.set(id, p);
    }
    return p;
  }
}

function inRing(r: Float32Array, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function countryAt(set: GeoSet | undefined, lon: number, lat: number): Feature | undefined {
  for (const f of set?.countries?.features ?? []) {
    const [w, s, e, n] = f.bbox;
    if (lon < w || lon > e || lat < s || lat > n) continue;
    for (const rings of f.parts) {
      let inside = false;
      for (const r of rings) if (inRing(r, lon, lat)) inside = !inside;
      if (inside) return f;
    }
  }
  return undefined;
}
