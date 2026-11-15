import { idb, invalidatePackRegions } from "./idb";
import { api } from "../api/client";
import { TERRAIN_URL, gibsTemplate, tileUrls } from "../globe/tileUrls";

export interface PackChunk { url: string; bytes: number; sha256: string }
export interface Pack {
  id: string; title: string; description: string; version: string; variable: string; units: string;
  temporal_resolution: string; from: string; to: string; spatial_resolution: string; bytes: number;
  chunks: PackChunk[]; source_url: string; upstream_doi: string; citation: string; required_app_version: string;
  kind?: "science" | "geography" | "tiles";

  chunk_count?: number;

  bbox?: string;
}
export interface PackRecord { id: string; version: string; done: number; total: number; bytes: number; complete: boolean; updated: string; bbox?: string }

export const APP_VERSION = "0.2.0";

async function geographyPacks(): Promise<Pack[]> {
  const r = await fetch("/geo/packs.json");
  if (!r.ok) return [];
  const g = (await r.json()) as Pack[];
  return g.map((p) => ({ ...p, kind: "geography" as const }));
}

const TILE_PACKS = "ee-tile-packs";
const TJ: [number, number, number, number] = [67, 36, 76, 42];

const TJ_TERRAIN_BYTES = [106274, 97258, 96963, 90044, 84828, 74413, 80937, 93413, 90104, 83288, 68284];
const TJ_BLUEMARBLE_BYTES = [14560, 14396, 18027, 15258, 17988, 17690, 16917, 16110, 13915];

async function tilePacks(): Promise<Pack[]> {
  const { layers } = await api.layers();
  const bm = layers.find((l) => l.id === "BlueMarble_NextGeneration");
  if (!bm) return [];
  const chunks: PackChunk[] = [
    ...tileUrls(TERRAIN_URL, TJ, 10).map((t) => ({ url: t.url, bytes: TJ_TERRAIN_BYTES[t.z], sha256: "" })),
    ...tileUrls(gibsTemplate(bm), TJ, Math.min(8, bm.max_level)).map((t) => ({ url: t.url, bytes: TJ_BLUEMARBLE_BYTES[t.z], sha256: "" })),
  ];
  return [{
    id: "tajikistan-3d", kind: "tiles", version: "tiles-1", variable: "terrain + imagery", units: "",
    title: "Tajikistan 3D — terrain to zoom 10 + Blue Marble imagery",
    description: "Elevation tiles (zoom 0–10, about 120 m per pixel at this latitude) and the cloud-free Blue Marble composite (zoom 0–8, about 500 m) for 67–76°E, 36–42°N. Closer than zoom 10 the relief is enlarged from zoom 10 when offline. Size is measured (2026-11-13); tiles come straight from the sources and carry no checksum.",
    temporal_resolution: "static", from: "", to: "", spatial_resolution: "terrain z0–10, imagery z0–8",
    bytes: chunks.reduce((s, c) => s + c.bytes, 0), chunks, chunk_count: chunks.length,
    source_url: "https://registry.opendata.aws/terrain-tiles/ ; https://gibs.earthdata.nasa.gov/",
    upstream_doi: "", required_app_version: APP_VERSION,
    citation: "Terrain Tiles (Mapzen/Tilezen, AWS Open Data: USGS SRTM/GMTED2010/3DEP, NOAA ETOPO1, national DEMs); NASA GIBS Blue Marble Next Generation (static composite, not a dated observation).",
  }];
}

type Store = { has: (url: string) => Promise<boolean>; put: (url: string, buf: ArrayBuffer, type: string) => Promise<unknown>; del: (url: string) => Promise<unknown> };

async function storeOf(p: Pack): Promise<Store> {
  if (p.kind === "geography" || p.kind === "tiles") {
    const cache = await caches.open(p.kind === "tiles" ? TILE_PACKS : "ee-geo-packs");
    return {

      has: async (u) => !!await cache.match(u, { ignoreVary: true }),
      put: (u, buf, type) => cache.put(u, new Response(buf, { headers: { "Content-Type": type } })),
      del: (u) => cache.delete(u),
    };
  }
  return { has: (u) => idb.has("frames", u).catch(() => false), put: (u, buf) => idb.put("frames", u, buf), del: (u) => idb.del("frames", u).catch(() => {}) };
}

export async function listPacks(): Promise<Pack[]> {
  const [geo, tiles, sci] = await Promise.all([
    geographyPacks().catch(() => []),
    tilePacks().catch(() => []),
    fetch("/api/v1/packs").then((r) => (r.ok ? r.json() : { packs: [] })).then((d: { packs: Pack[] }) => d.packs.map((p) => ({ ...p, kind: "science" as const }))).catch(() => []),
  ]);
  return [...geo, ...tiles, ...sci];
}

export const chunkCount = (p: Pack) => p.chunk_count ?? p.chunks.length;

export async function packWithChunks(p: Pack): Promise<Pack> {
  if (p.chunks.length >= chunkCount(p)) return p;
  const r = await fetch(`/api/v1/packs?id=${encodeURIComponent(p.id)}`);
  if (!r.ok) throw new Error(`pack manifest: HTTP ${r.status}`);
  return { ...((await r.json()) as { pack: Pack }).pack, kind: p.kind };
}

export async function packRecord(id: string) { return idb.get<PackRecord>("packs", id).catch(() => undefined); }

async function sha256(buf: ArrayBuffer) {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function downloadPack(p: Pack, opts: { concurrency: number; signal: AbortSignal; onProgress: (done: number, total: number, bytes: number) => void }) {
  p = await packWithChunks(p);
  const total = p.chunks.length;
  let done = 0, bytes = 0;
  const pending: PackChunk[] = [];
  const store = await storeOf(p);
  for (const c of p.chunks) {
    const have = await store.has(c.url);
    if (have) { done++; bytes += c.bytes; } else pending.push(c);
  }
  opts.onProgress(done, total, bytes);
  const save = () => idb.put("packs", p.id, { id: p.id, version: p.version, done, total, bytes, complete: done === total, updated: new Date().toISOString(), bbox: p.bbox } satisfies PackRecord).then(invalidatePackRegions).catch(() => {});
  await save();
  const worker = async () => {
    while (pending.length) {
      if (opts.signal.aborted) throw new DOMException("aborted", "AbortError");
      const c = pending.shift()!;
      for (let attempt = 0; ; attempt++) {
        try {

          let r = await caches.match(c.url, { ignoreVary: true }).catch(() => undefined);
          if (r && c.sha256 && await sha256(await r.clone().arrayBuffer()) !== c.sha256) r = undefined;

          r ??= await fetch(`${c.url}#pack`, { signal: opts.signal, cache: "no-store" });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const buf = await r.arrayBuffer();
          const type = r.headers.get("content-type") ?? "application/json";
          if (p.kind === "tiles") {
            if (!type.startsWith("image/") || buf.byteLength === 0) throw new Error(`not an image: ${c.url}`);
          } else if ((await sha256(buf)) !== c.sha256) throw new Error(`checksum mismatch for ${c.url}`);
          await store.put(c.url, buf, p.kind === "tiles" ? type : "application/json");
          done++; bytes += p.kind === "tiles" ? buf.byteLength : c.bytes;
          opts.onProgress(done, total, bytes);
          await save();
          break;
        } catch (e) {
          if ((e as Error).name === "AbortError" || opts.signal.aborted) throw e;
          if (attempt >= 5) throw e;
          await sleep(Math.min(30000, 1000 * 2 ** attempt));
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }, worker));
  await save();
}

export async function deletePack(p: Pack) {
  p = await packWithChunks(p);
  const store = await storeOf(p);
  for (const c of p.chunks) await store.del(c.url);
  await idb.del("packs", p.id).catch(() => {});
  invalidatePackRegions();
}

export async function storageInfo() {
  const e = await navigator.storage?.estimate?.().catch(() => undefined);
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  return { usage: e?.usage ?? 0, quota: e?.quota ?? 0, persisted: !!persisted };
}

export async function requestPersistence() {
  return (await navigator.storage?.persist?.().catch(() => false)) ?? false;
}
