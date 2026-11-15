export const HM3 = 1e6;
export const KM3 = 1e9;
export const KM2 = 1e6;
export const SECONDS_PER_DAY = 86_400;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export interface StorageLaw { a: number; b: number; z0_masl: number; valid_from_masl: number; valid_to_masl: number }

export interface StorageTable { levels_masl: number[]; volumes_hm3: number[]; areas_km2?: number[]; where: string; note: string }

export interface NurekMeta {
  id?: string;
  name: string;
  grid: { zoom: number; x0: number; y0: number; width: number; height: number; approx_cell_m: number; sha256: string; bytes: number };
  dem_water: { level_m: number; seed: [number, number]; note: string; area_km2?: number; noise_m?: number; flattened_cells?: number };

  dam: { lat: number; lon: number; name?: string; barrier_radius_m?: number; barrier_min_elev_m?: number; note: string };

  masks?: { file: string; bytes: number; sha256: string; osm_lake_area_km2: number; barrier_cells: number };

  labels?: { text: string; lat: number; lon: number; kind: string }[];
  sources: { elevation: { name: string; url: string; licence: string }; outline?: { name: string; url: string; licence: string; attribution: string; note: string }; precipitation: { name: string; url: string; retrieved_at: string; period: string; note: string; point: { lat: number; lon: number } } };
  precipitation_mm_per_day: number[];

  published: {
    citation?: string; url?: string; transcribed?: string;
    full_supply_level_masl?: { value: number; where: string };
    minimum_operating_level_masl?: { value: number; where: string };
    storage_law?: StorageLaw & { where: string; note: string };
    storage_table?: StorageTable;
    evaporation_mm_per_month?: { values: number[]; year_total_mm: number; where: string; note?: string };
    mean_inflow_hm3_per_year?: { value: number; where: string };
    mean_inflow_m3s?: { value: number; where: string };

    notes?: string[];
    capacity_surveys_km3?: { where: string; years: number[]; total: number[]; live: number[]; dead: number[]; note: string };

    facts?: { label: string; value: string; where: string; kind?: "observed" | "derived" | "modeled" }[];

    references?: { citation: string; url: string }[];
  };

  earthquakes?: { source: string; url: string; retrieved_at: string; note: string; events: { id: string; time: string; mag: number; mag_type: string; place: string; lon: number; lat: number; depth_km: number }[] };

  land_cover?: { file: string; bytes: number; sha256: string; classes: Record<string, string>; name: string; url: string; licence: string; attribution: string; method: string; retrieved_at: string };
}

export const LAND_COVER_WATER = 80;

export const storageM3 = (law: StorageLaw, z: number) => law.a * Math.pow(z - law.z0_masl, law.b) * HM3;

export const levelFromStorage = (law: StorageLaw, v: number) => law.z0_masl + Math.pow(v / HM3 / law.a, 1 / law.b);

export const areaM2 = (law: StorageLaw, z: number) => law.a * law.b * Math.pow(z - law.z0_masl, law.b - 1) * HM3;
export const inRange = (law: StorageLaw, z: number) => z >= law.valid_from_masl && z <= law.valid_to_masl;
export const clampLevel = (law: StorageLaw, z: number) => Math.min(law.valid_to_masl, Math.max(law.valid_from_masl, z));

export interface Storage { kind: "law" | "table"; min: number; max: number; where: string; note: string; volume(z: number): number; level(v: number): number; area(z: number): number }
export function storageFromLaw(law: StorageLaw & { where?: string; note?: string }): Storage {
  return { kind: "law", min: law.valid_from_masl, max: law.valid_to_masl, where: law.where ?? "", note: law.note ?? "",
    volume: (z) => storageM3(law, z), level: (v) => levelFromStorage(law, v), area: (z) => areaM2(law, z) };
}
export function storageFromTable(tb: StorageTable): Storage {
  const Z = tb.levels_masl, V = tb.volumes_hm3.map((v) => v * HM3), n = Z.length;
  if (n < 2 || V.length !== n) throw new Error("a storage table needs at least two rows of level and volume");
  for (let k = 1; k < n; k++) if (!(Z[k] > Z[k - 1]) || !(V[k] > V[k - 1])) throw new Error("storage table rows must increase in level and volume");
  const seg = (x: number, xs: number[]) => { let k = 0; while (k < n - 2 && x > xs[k + 1]) k++; return k; };
  return { kind: "table", min: Z[0], max: Z[n - 1], where: tb.where, note: tb.note,
    volume: (z) => { const k = seg(z, Z); return V[k] + ((V[k + 1] - V[k]) * (z - Z[k])) / (Z[k + 1] - Z[k]); },
    level: (v) => { const k = seg(v, V); return Z[k] + ((Z[k + 1] - Z[k]) * (v - V[k])) / (V[k + 1] - V[k]); },

    area: (z) => { const k = seg(z, Z); return tb.areas_km2 ? (tb.areas_km2[k] + ((tb.areas_km2[k + 1] - tb.areas_km2[k]) * (z - Z[k])) / (Z[k + 1] - Z[k])) * KM2 : (V[k + 1] - V[k]) / (Z[k + 1] - Z[k]); } };
}

export function storageOf(pub: NurekMeta["published"]): Storage | undefined {
  return pub.storage_law ? storageFromLaw(pub.storage_law) : pub.storage_table ? storageFromTable(pub.storage_table) : undefined;
}

const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
export class Terrain {
  readonly w: number; readonly h: number;

  readonly rowArea: Float64Array;
  private n: number;
  constructor(readonly z: Int16Array, readonly grid: { zoom: number; x0: number; y0: number; width: number; height: number }) {
    this.w = grid.width; this.h = grid.height; this.n = 2 ** grid.zoom * 256;
    if (z.length !== this.w * this.h) throw new Error(`elevation grid has ${z.length} cells, expected ${this.w * this.h}`);
    this.rowArea = new Float64Array(this.h);
    for (let i = 0; i < this.h; i++) { const side = (EARTH_CIRCUMFERENCE_M / this.n) * Math.cos(this.lat(i + 0.5) * Math.PI / 180); this.rowArea[i] = side * side; }
  }

  lon(j: number) { return ((this.grid.x0 + j) / this.n) * 360 - 180; }
  lat(i: number) { return (Math.atan(Math.sinh(Math.PI * (1 - (2 * (this.grid.y0 + i)) / this.n))) * 180) / Math.PI; }
  col(lon: number) { return Math.floor(((lon + 180) / 360) * this.n - this.grid.x0); }
  row(lat: number) { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * this.n - this.grid.y0); }
}

export function damBarrier(t: Terrain, dam: { lat: number; lon: number; barrier_radius_m?: number; barrier_min_elev_m?: number }): Uint8Array {
  const out = new Uint8Array(t.w * t.h);
  if (dam.barrier_radius_m === undefined || dam.barrier_min_elev_m === undefined) return out;
  const mPerDegLat = 111_320, mPerDegLon = 111_320 * Math.cos(dam.lat * Math.PI / 180);
  for (let i = 0; i < t.h; i++) {
    const dy = (t.lat(i + 0.5) - dam.lat) * mPerDegLat;
    if (Math.abs(dy) > dam.barrier_radius_m) continue;
    for (let j = 0; j < t.w; j++) {
      const dx = (t.lon(j + 0.5) - dam.lon) * mPerDegLon;
      if (dx * dx + dy * dy < dam.barrier_radius_m ** 2 && t.z[i * t.w + j] >= dam.barrier_min_elev_m) out[i * t.w + j] = 1;
    }
  }
  return out;
}

export interface Flood {
  level: number;

  mask: Uint8Array;
  baselineAreaM2: number;
  newAreaM2: number;

  volumeAboveBaselineM3: number;

  belowData: boolean;

  touchesEdge: boolean;
}

export function flood(t: Terrain, seed: [number, number], baselineLevel: number, level: number, barrier?: Uint8Array, baselineMask?: Uint8Array): Flood {
  const { w, h, z } = t, mask = new Uint8Array(w * h), fillTo = Math.max(level, baselineLevel);
  const stack = new Int32Array(w * h); let top = 0;
  const start = seed[0] * w + seed[1];
  if (z[start] > baselineLevel) throw new Error("the seed cell is not water in the elevation data");
  let baselineAreaM2 = 0, newAreaM2 = 0, volume = 0, touchesEdge = false;
  mask[start] = 3; stack[top++] = start;
  while (top > 0) {
    const c = stack[--top], i = (c / w) | 0, j = c - i * w, a = t.rowArea[i];
    const wasWater = baselineMask ? baselineMask[c] === 1 : z[c] <= baselineLevel;
    if (wasWater) { mask[c] = 1; baselineAreaM2 += a; volume += Math.max(0, level - baselineLevel) * a; }
    else if (level >= baselineLevel) { mask[c] = 2; newAreaM2 += a; volume += (level - z[c]) * a; }
    else { mask[c] = 0; continue; }
    if (i === 0 || j === 0 || i === h - 1 || j === w - 1) touchesEdge = true;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= h || nj >= w) continue;
      const nc = ni * w + nj;
      if (mask[nc] || z[nc] > fillTo || (barrier && barrier[nc])) continue;
      mask[nc] = 3; stack[top++] = nc;
    }
  }
  return { level, mask, baselineAreaM2, newAreaM2, volumeAboveBaselineM3: volume, belowData: level < baselineLevel, touchesEdge };
}

export function floodedByClass(t: Terrain, mask: Uint8Array, landCover: Uint8Array): { code: number; areaM2: number }[] {
  if (landCover.length !== mask.length) throw new Error("land-cover grid and elevation grid differ in size");
  const sum = new Float64Array(256);
  for (let i = 0, c = 0; i < t.h; i++) { const a = t.rowArea[i]; for (let j = 0; j < t.w; j++, c++) if (mask[c] === 2) sum[landCover[c]] += a; }
  const out: { code: number; areaM2: number }[] = [];
  for (let code = 0; code < 256; code++) if (sum[code] > 0) out.push({ code, areaM2: sum[code] });
  return out.sort((x, y) => y.areaM2 - x.areaM2);
}

export interface BalanceInput {
  startLevel: number;
  inflowM3s: number;
  outflowM3s: number;

  precipitationMmPerDay: number[];

  evaporationMmPerMonth: number[];
  precipitationFactor: number;
  evaporationFactor: number;
  days: number;
  startMonth: number;

  snowmelt?: { areaKm2: number; degreeDayFactorMmPerCDay: number; temperatureC: number; thresholdC?: number };
}
export interface BalanceResult {
  startStorageM3: number; endStorageM3: number; endLevel: number; days: number;

  inflowM3: number;
  snowmeltM3: number;
  outflowRequestedM3: number;
  outflowDeliveredM3: number;
  precipitationM3: number; evaporationM3: number;

  spillM3: number;

  outflowShortfallM3: number;

  unplacedLossM3: number;
  daysAtFull: number; daysAtMinimum: number;

  closureM3: number;
  series: { day: number; level: number }[];
}
export const mmToM = (mm: number) => mm / 1000;

export const degreeDayMeltMm = (ddf: number, temperatureC: number, thresholdC = 0) => ddf * Math.max(0, temperatureC - thresholdC);

export function simulate(lawOrStorage: StorageLaw | Storage, inp: BalanceInput): BalanceResult {
  const S = "volume" in lawOrStorage ? lawOrStorage : storageFromLaw(lawOrStorage);
  const vMin = S.volume(S.min), vMax = S.volume(S.max);
  if (!(inp.startLevel >= S.min && inp.startLevel <= S.max)) throw new Error("start level is outside the range of the storage law");
  const sm = inp.snowmelt;
  if (inp.inflowM3s < 0 || inp.outflowM3s < 0 || inp.precipitationFactor < 0 || inp.evaporationFactor < 0 || inp.days < 0 || (sm && (sm.areaKm2 < 0 || sm.degreeDayFactorMmPerCDay < 0))) throw new Error("fluxes, factors, areas and duration cannot be negative");
  const v0 = S.volume(inp.startLevel), n = Math.floor(inp.days);
  let v = v0, month = ((inp.startMonth % 12) + 12) % 12, dayInMonth = 0;
  const r: BalanceResult = { startStorageM3: v0, endStorageM3: v0, endLevel: inp.startLevel, days: n, inflowM3: 0, snowmeltM3: 0, outflowRequestedM3: 0, outflowDeliveredM3: 0,
    precipitationM3: 0, evaporationM3: 0, spillM3: 0, outflowShortfallM3: 0, unplacedLossM3: 0, daysAtFull: 0, daysAtMinimum: 0, closureM3: 0, series: [{ day: 0, level: inp.startLevel }] };
  const melt = sm ? mmToM(degreeDayMeltMm(sm.degreeDayFactorMmPerCDay, sm.temperatureC, sm.thresholdC)) * sm.areaKm2 * KM2 : 0;
  for (let day = 1; day <= n; day++) {
    const area = S.area(S.level(v));
    const qin = inp.inflowM3s * SECONDS_PER_DAY, qout = inp.outflowM3s * SECONDS_PER_DAY;
    const p = mmToM(inp.precipitationMmPerDay[month] * inp.precipitationFactor) * area;
    const e = mmToM((inp.evaporationMmPerMonth[month] / DAYS_IN_MONTH[month]) * inp.evaporationFactor) * area;
    let delivered = qout, spill = 0, unplaced = 0;
    let next = v + qin + melt - qout + p - e;
    if (next > vMax) { spill = next - vMax; next = vMax; r.daysAtFull++; }
    else if (next < vMin) {
      const lack = vMin - next;
      delivered = Math.max(0, qout - lack);
      unplaced = lack - (qout - delivered);
      next = vMin; r.daysAtMinimum++;
    }
    v = next;
    r.inflowM3 += qin; r.snowmeltM3 += melt; r.outflowRequestedM3 += qout; r.outflowDeliveredM3 += delivered;
    r.precipitationM3 += p; r.evaporationM3 += e; r.spillM3 += spill; r.outflowShortfallM3 += qout - delivered; r.unplacedLossM3 += unplaced;
    if (day % 5 === 0 || day === n) r.series.push({ day, level: S.level(v) });
    if (++dayInMonth >= DAYS_IN_MONTH[month]) { dayInMonth = 0; month = (month + 1) % 12; }
  }
  r.endStorageM3 = v; r.endLevel = n === 0 ? inp.startLevel : Math.min(S.max, Math.max(S.min, S.level(v)));
  r.closureM3 = (v - v0) - (r.inflowM3 + r.snowmeltM3 - r.outflowDeliveredM3 + r.precipitationM3 - r.evaporationM3 - r.spillM3 + r.unplacedLossM3);
  return r;
}

const BASE = "/scenario";
export interface NurekPack { meta: NurekMeta; terrain: Terrain;  landCover?: Uint8Array;
   barrier?: Uint8Array;  outline?: Uint8Array }
const loading = new Map<string, Promise<NurekPack>>();

export async function pinned(url: string): Promise<Response> {
  let cache: Cache | undefined;
  try { cache = await caches.open("ee-geo-packs"); } catch {  }
  let resp = await cache?.match(url).catch(() => undefined);
  if (!resp) {
    resp = await fetch(url);
    if (!resp.ok || (resp.headers.get("content-type") ?? "").includes("text/html")) throw new Error("The data pack of this place is not installed on this server (run the build scripts in science/geo)");
    await cache?.put(url, resp.clone()).catch(() => undefined);
  }
  return resp;
}

export function loadPack(id: string): Promise<NurekPack> {
  let p = loading.get(id);
  if (!p) {
    p = (async () => {
      const meta = (await (await pinned(`${BASE}/${id}.json`)).json()) as NurekMeta;
      const buf = await (await pinned(`${BASE}/${id}.bin`)).arrayBuffer();
      if (buf.byteLength !== meta.grid.bytes) throw new Error("The elevation file of this place has the wrong size");
      const cells = meta.grid.width * meta.grid.height;
      let landCover: Uint8Array | undefined, barrier: Uint8Array | undefined, outline: Uint8Array | undefined;
      if (meta.land_cover) try {
        const lc = new Uint8Array(await (await pinned(`${BASE}/${meta.land_cover.file}`)).arrayBuffer());
        if (lc.length === cells) landCover = lc;
      } catch {  }
      if (meta.masks) {
        const m = new Uint8Array(await (await pinned(`${BASE}/${meta.masks.file}`)).arrayBuffer());
        if (m.length !== cells) throw new Error("The mask file of this place has the wrong size");
        barrier = new Uint8Array(cells); outline = new Uint8Array(cells);
        for (let c = 0; c < cells; c++) { outline[c] = m[c] & 1; barrier[c] = (m[c] >> 1) & 1; }
      }
      return { meta, terrain: new Terrain(new Int16Array(buf), meta.grid), landCover, barrier, outline };
    })();
    loading.set(id, p);
    p.catch(() => { loading.delete(id); });
  }
  return p;
}
export const loadNurek = () => loadPack("nurek");
