export type EvidenceClass = "observed" | "satellite" | "model" | "reported" | "context" | "hypothetical";
export const EVIDENCE: Record<EvidenceClass, { label: string; color: string; hint: string }> = {
  observed: { label: "Observed", color: "#34d399", hint: "Measured or located directly: instruments, catalogues, mapped on the ground or by aircraft." },
  satellite: { label: "Satellite-derived", color: "#38bdf8", hint: "Detected by an algorithm in satellite data. Clouds, smoke and pixel size limit what is seen." },
  model: { label: "Model estimate", color: "#f59e0b", hint: "Computed by a scientific model from the observations. An estimate, not a measurement at every place." },
  reported: { label: "Reported event boundary", color: "#a78bfa", hint: "An area or extent as an agency reported it. It is not a measured footprint." },
  context: { label: "Historical context", color: "#94a3b8", hint: "Background information from before or outside the event." },
  hypothetical: { label: "Hypothetical scenario", color: "#f472b6", hint: "A what-if illustration. Not something that happened." },
};

export interface Src { name: string; url: string; retrieved: string; licence?: string }
export interface LegendItem { color: string; label: string }
export interface Measure { label: string; value: string; unit: string; also?: string; evidence: EvidenceClass; note: string }
export interface Step { t: number; label: string }
export interface Missing { label: string; reason: string }

export interface RasterGrid { bbox: [number, number, number, number]; nx: number; ny: number; scale: number; values: number[]; ramp: { v: number; color: string }[]; min_shown: number; unit: string }

export interface RasterFrame { t: number; label: string; url: string; bytes?: number; areas_km2?: Record<string, number> }
export interface RasterFrames { bbox: [number, number, number, number]; frames: RasterFrame[]; pixelated?: boolean }

export interface PointTable { t0?: number; t_min?: number[]; lon: number[]; lat: number[]; v?: number[]; v_label?: string; v_unit?: string; size_by?: string; text?: string[] }
export interface TrackFix { t: number; lon: number; lat: number; wind?: number | null; pres?: number | null; status?: string; id?: string }

export interface RadiiRow { t: number; lon: number; lat: number; r34: (number | null)[]; r50: (number | null)[]; r64: (number | null)[] }
export interface GibsRef { layer: string; dates: string[];  matrix?: string; max_level?: number }

export type LayerKind = "points" | "track" | "polygons" | "raster" | "gibs" | "radii";
export interface Layer {
  id: string;
  label: string;

  short: string;
  icon: string;
  kind: LayerKind;
  evidence: EvidenceClass;

  on: boolean;

  time?: "cumulative" | "current";
  color?: string;
  recent_color?: string;
  recent_ms?: number;
  size?: number;
  fill?: boolean;
  raster?: RasterGrid | RasterFrames;
  points?: PointTable;
  polygons?: number[][][][];
  fixes?: TrackFix[];
  status_names?: Record<string, string>;
  wind_unit?: string;
  pres_unit?: string;
  rows?: RadiiRow[];
  unit?: string;
  gibs?: GibsRef;
  legend: LegendItem[];

  legend_image?: string;
  source: Src;
  date: string;
  resolution: string;
  units: string;
  uncertainty: string;
  note: string;
}

export interface Bundle {
  schema: number;
  event_id: string;
  category: string;
  built_at: string;
  builder: string;
  title: string;
  subtitle: string;

  association: string;
  view?: { bbox: [number, number, number, number] };
  summary: Measure[];
  steps: Step[];
  steps_label?: string;
  layers: Layer[];
  unavailable: Missing[];
  depth?: { km: number; rupture_top_km?: number; rupture_base_km?: number };

  compare?: { layer: string; before: string; after: string };
  stale?: boolean;
  notes?: string[];
}

export const isFrames = (r: RasterGrid | RasterFrames): r is RasterFrames => "frames" in r;

export const WIND_CLASSES = [
  { max: 34, color: "#7dd3fc" },
  { max: 64, color: "#facc15" },
  { max: 96, color: "#fb923c" },
  { max: Infinity, color: "#ef4444" },
];
export const windColor = (kt: number | null | undefined) => kt == null ? "#cbd5e1" : WIND_CLASSES.find((c) => kt < c.max)!.color;

export function stepIndex(steps: { t: number }[], t: number): number {
  let i = 0;
  for (let k = 0; k < steps.length; k++) if (steps[k].t <= t) i = k;
  return i;
}

export function frameAt<T extends { t: number }>(frames: T[], t: number): T | undefined {
  return frames.length ? frames[stepIndex(frames, t)] : undefined;
}

export function pointsBy(p: PointTable, t: number): number {
  if (!p.t_min || p.t0 === undefined) return p.lon.length;
  const m = (t - p.t0) / 60000;
  let lo = 0, hi = p.t_min.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (p.t_min[mid] <= m) lo = mid + 1; else hi = mid; }
  return lo;
}

export function bundleBox(b: Bundle): [number, number, number, number] | undefined {
  if (b.view) return b.view.bbox;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const add = (lon: number, lat: number) => { w = Math.min(w, lon); e = Math.max(e, lon); s = Math.min(s, lat); n = Math.max(n, lat); };
  for (const l of b.layers) {
    for (const f of l.fixes ?? []) add(f.lon, f.lat);
    for (const poly of l.polygons ?? []) for (const [lon, lat] of poly[0] ?? []) add(lon, lat);
    if (l.raster) { add(l.raster.bbox[0], l.raster.bbox[1]); add(l.raster.bbox[2], l.raster.bbox[3]); }
    if (l.points) for (let i = 0; i < l.points.lon.length; i++) add(l.points.lon[i], l.points.lat[i]);
  }
  return w === Infinity ? undefined : [w, s, e, n];
}

const R = 6371.0088;

export function distanceKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const p = Math.PI / 180, a = Math.sin((lat2 - lat1) * p / 2) ** 2 + Math.cos(lat1 * p) * Math.cos(lat2 * p) * Math.sin((lon2 - lon1) * p / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function destination(lon: number, lat: number, km: number, bearing: number): [number, number] {
  const p = Math.PI / 180, d = km / R, b = bearing * p, la = lat * p;
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
  const lo2 = lon * p + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
  return [((lo2 / p + 540) % 360) - 180, la2 / p];
}
export const NMI_KM = 1.852;

export function quadrantOutline(lon: number, lat: number, radiiNmi: (number | null)[], stepDeg = 6): [number, number][] | undefined {
  if (!radiiNmi.some((r) => r)) return undefined;
  const out: [number, number][] = [];
  for (let q = 0; q < 4; q++) {
    const r = (radiiNmi[q] ?? 0) * NMI_KM;
    for (let a = q * 90; a <= (q + 1) * 90; a += stepDeg) out.push(r > 0 ? destination(lon, lat, r, a) : [lon, lat]);
  }
  out.push(out[0]);
  return out;
}

export type Tier = "global" | "regional" | "local";
export function tierOf(box: [number, number, number, number] | undefined, cameraDistanceKm: number): Tier {
  if (!box) return "regional";
  const diag = distanceKm(box[0], box[1], box[2], box[3]);
  if (cameraDistanceKm > Math.max(3500, diag * 4)) return "global";
  return cameraDistanceKm < Math.max(250, diag * 1.2) ? "local" : "regional";
}

export function readout(b: Bundle, on: Record<string, boolean>, t: number): string[] {
  const out: string[] = [];
  for (const l of b.layers) {
    if (!on[l.id]) continue;
    if (l.kind === "track" && l.fixes?.length) {
      const f = l.fixes[stepIndex(l.fixes, t)];
      const parts = [l.status_names?.[f.status ?? ""] ?? "", f.wind != null ? `${f.wind} ${l.wind_unit ?? ""}`.trim() : "", f.pres != null ? `${f.pres} ${l.pres_unit ?? ""}`.trim() : "", f.id === "L" ? "landfall" : ""];
      out.push(parts.filter(Boolean).join(" · "));
    } else if (l.kind === "raster" && l.raster && isFrames(l.raster)) {
      const f = frameAt(l.raster.frames, t), a = f?.areas_km2;
      if (a) out.push(`Flood ${Math.round(a.flood).toLocaleString("en-US")} km² · recurring ${Math.round(a.recurring).toLocaleString("en-US")} km² · not observed ${Math.round(100 * a.insufficient / a.box)}%`);
    } else if (l.kind === "points" && l.points?.t_min) {
      out.push(`${l.short}: ${pointsBy(l.points, t).toLocaleString("en-US")} / ${l.points.lon.length.toLocaleString("en-US")}`);
    }
  }
  return out;
}
