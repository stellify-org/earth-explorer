export const EARTH_RADIUS_KM = 6371;

export interface PlanetLayer {
  id: "crust" | "upper_mantle" | "lower_mantle" | "outer_core" | "inner_core";
  name: string; color: string;

  top: number; bottom: number;
  description: string;
}

export const PLANET_LAYERS: PlanetLayer[] = [
  { id: "crust", name: "Crust", color: "#b08968", top: 0, bottom: 24.4,
    description: "Solid rock. 24.4 km is the global average crust of the reference model; the real crust is thinner under oceans and thicker under mountain belts (Crust Explorer shows the modelled value at a place)." },
  { id: "upper_mantle", name: "Upper mantle", color: "#c2562d", top: 24.4, bottom: 670,
    description: "Solid silicate rock that deforms slowly over geological time. The reference model places a seismic discontinuity at 670 km depth, which is used here as its lower boundary." },
  { id: "lower_mantle", name: "Lower mantle", color: "#e07a2f", top: 670, bottom: 2891,
    description: "Solid silicate rock under high pressure, from the 670 km discontinuity down to the core–mantle boundary at 2891 km depth." },
  { id: "outer_core", name: "Outer core", color: "#f2b632", top: 2891, bottom: 5149.5,
    description: "Liquid iron alloy. Shear (S) waves do not travel through it, which is how seismology shows that it is liquid." },
  { id: "inner_core", name: "Inner core", color: "#fff1a8", top: 5149.5, bottom: EARTH_RADIUS_KM,
    description: "Solid iron alloy from 5149.5 km depth to the centre of the Earth (radius 1221.5 km)." },
];

export const PREM_CITATION = "Dziewonski, A. M. & Anderson, D. L. (1981). Preliminary reference Earth model. Physics of the Earth and Planetary Interiors, 25, 297–356. doi:10.1016/0031-9201(81)90046-7";

export function drawnFraction(depthKm: number, crustExaggeration: number) {
  const moho = PLANET_LAYERS[0].bottom;
  if (depthKm <= moho) return 1 - (depthKm * crustExaggeration) / EARTH_RADIUS_KM;
  return 1 - Math.max(depthKm, moho * crustExaggeration) / EARTH_RADIUS_KM;
}

export const CRUST_LAYERS = [
  { id: "water", name: "Water", color: "#3b82f6" },
  { id: "ice", name: "Ice", color: "#e0f2fe" },
  { id: "sed_upper", name: "Upper sediments", color: "#fde68a" },
  { id: "sed_middle", name: "Middle sediments", color: "#f5c451" },
  { id: "sed_lower", name: "Lower sediments", color: "#d99a2b" },
  { id: "crust_upper", name: "Upper crystalline crust", color: "#c98f8f" },
  { id: "crust_middle", name: "Middle crystalline crust", color: "#a8646c" },
  { id: "crust_lower", name: "Lower crystalline crust", color: "#7d4352" },
] as const;
export const MANTLE_COLOR = "#c2562d";
export const CRUST_CITATION = "Laske, G., Masters, G., Ma, Z. and Pasyanos, M., Update on CRUST1.0 - A 1-degree Global Model of Earth's Crust, Geophys. Res. Abstracts, 15, Abstract EGU2013-2658, 2013.";
export const CRUST_URL = "/crust1/crust1.bin";
const CELLS = 64800;

export interface CrustLayer {
  index: number; id: string; name: string; color: string;

  top: number; bottom: number; thickness: number;

  vp: number; vs: number; rho: number;
}
export interface CrustCell {

  lat: number; lon: number;

  bounds: number[];

  layers: CrustLayer[];
  surface: number; moho: number;

  crustThickness: number;
  mantle: { vp: number; vs: number; rho: number };
}

export class Crust1 {
  private bnds: Int16Array; private vp: Uint16Array; private vs: Uint16Array; private rho: Uint16Array;
  constructor(buf: ArrayBuffer) {
    if (buf.byteLength !== CELLS * 9 * 2 * 4) throw new Error(`CRUST1.0 file has ${buf.byteLength} bytes, expected ${CELLS * 72}`);
    const n = CELLS * 9;
    this.bnds = new Int16Array(buf, 0, n);
    this.vp = new Uint16Array(buf, n * 2, n); this.vs = new Uint16Array(buf, n * 4, n); this.rho = new Uint16Array(buf, n * 6, n);
  }

  cell(lat: number, lon: number): CrustCell {
    const row = Math.min(179, Math.max(0, Math.floor(90 - lat)));
    const col = ((Math.floor(lon + 180) % 360) + 360) % 360;
    const o = (row * 360 + col) * 9;
    const bounds = Array.from(this.bnds.subarray(o, o + 9), (v) => v / 100);
    const layers: CrustLayer[] = [];
    for (let i = 0; i < 8; i++) {
      const thickness = Math.round((bounds[i] - bounds[i + 1]) * 100) / 100;
      if (thickness > 0) layers.push({ index: i, ...CRUST_LAYERS[i], top: bounds[i], bottom: bounds[i + 1], thickness, vp: this.vp[o + i] / 100, vs: this.vs[o + i] / 100, rho: this.rho[o + i] / 100 });
    }
    return { lat: 89.5 - row, lon: -179.5 + col, bounds, layers, surface: bounds[0], moho: bounds[8],
      crustThickness: Math.round((bounds[2] - bounds[8]) * 100) / 100,
      mantle: { vp: this.vp[o + 8] / 100, vs: this.vs[o + 8] / 100, rho: this.rho[o + 8] / 100 } };
  }
}

let loading: Promise<Crust1> | null = null;

export function loadCrust1(): Promise<Crust1> {
  loading ??= (async () => {
    let cache: Cache | undefined;
    try { cache = await caches.open("ee-geo-packs"); } catch {  }
    let resp = await cache?.match(CRUST_URL).catch(() => undefined);
    if (!resp) {
      resp = await fetch(CRUST_URL);
      if (!resp.ok || (resp.headers.get("content-type") ?? "").includes("text/html")) throw new Error("CRUST1.0 is not installed on this server (run science/geo/build_crust1.py)");
      await cache?.put(CRUST_URL, resp.clone()).catch(() => undefined);
    }
    return new Crust1(await resp.arrayBuffer());
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

const rad = Math.PI / 180;
export interface PathSample { lat: number; lon: number; km: number; cell: CrustCell }

export function samplePath(model: Crust1, a: { lat: number; lon: number }, b: { lat: number; lon: number }, stepKm = 25): { samples: PathSample[]; lengthKm: number } {
  const v = (p: { lat: number; lon: number }) => [Math.cos(p.lat * rad) * Math.cos(p.lon * rad), Math.cos(p.lat * rad) * Math.sin(p.lon * rad), Math.sin(p.lat * rad)];
  const A = v(a), B = v(b);
  const angle = Math.acos(Math.min(1, Math.max(-1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2])));
  const lengthKm = angle * EARTH_RADIUS_KM;
  const n = Math.min(800, Math.max(2, Math.ceil(lengthKm / stepKm) + 1));
  const samples: PathSample[] = [];
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const s = Math.sin(angle) || 1, wa = angle ? Math.sin((1 - f) * angle) / s : 1 - f, wb = angle ? Math.sin(f * angle) / s : f;
    const x = wa * A[0] + wb * B[0], y = wa * A[1] + wb * B[1], z = wa * A[2] + wb * B[2];
    const lat = Math.atan2(z, Math.hypot(x, y)) / rad, lon = Math.atan2(y, x) / rad;
    samples.push({ lat, lon, km: f * lengthKm, cell: model.cell(lat, lon) });
  }
  return { samples, lengthKm };
}
