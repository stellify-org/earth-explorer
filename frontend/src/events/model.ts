import type { Quake } from "../api/types";

export type Cat = "wildfires" | "earthquakes" | "severeStorms" | "floods" | "landslides" | "volcanoes" | "other";
export const CATS: Cat[] = ["wildfires", "earthquakes", "severeStorms", "floods", "landslides", "volcanoes", "other"];

export const STYLE: Record<Cat, { label: string; one: string; color: string }> = {
  wildfires: { label: "Wildfires", one: "Wildfire", color: "#ef4444" },
  earthquakes: { label: "Earthquakes", one: "Earthquake", color: "#c084fc" },
  severeStorms: { label: "Storms", one: "Storm", color: "#38bdf8" },
  floods: { label: "Floods", one: "Flood", color: "#3b82f6" },
  landslides: { label: "Landslides", one: "Landslide", color: "#d97706" },
  volcanoes: { label: "Volcanoes", one: "Volcano", color: "#fb923c" },
  other: { label: "Other events", one: "Event", color: "#94a3b8" },
};

export const DEPTH_CLASSES = [
  { max: 70, label: "Shallow (0–70 km)", color: "#e9d5ff" },
  { max: 300, label: "Intermediate (70–300 km)", color: "#a855f7" },
  { max: Infinity, label: "Deep (> 300 km)", color: "#6b21a8" },
];
export const depthColor = (km: number) => DEPTH_CLASSES.find((c) => km <= c.max)!.color;

export interface Fix { lon: number; lat: number; t: number; mag?: number; unit?: string }
export interface Ev {
  id: string;
  catalog: "eonet" | "usgs";
  title: string;
  cat: Cat;

  categoryTitle: string;

  start: number;
  end: number;

  closed?: number;
  lon: number;
  lat: number;
  position: "reported_point" | "latest_reported_point" | "polygon_bbox_centre";
  geometry: "point" | "track" | "polygon";
  mag?: number;
  magMax?: number;
  magUnit?: string;
  depthKm?: number;
  track?: Fix[];
  polygonCount?: number;
  polygonVertices?: number;
  bbox?: [number, number, number, number];

  polygons?: number[][][][];
  sources: { id: string; url: string }[];
  link: string;
}

export interface EonetEvent {
  id: string; title: string; category: string; category_title: string; categories?: string[]; closed?: string; start: string; end: string;
  lon: number; lat: number; position: Ev["position"]; geometry: Ev["geometry"];
  mag?: number; mag_max?: number; mag_unit?: string;
  track?: { lon: number; lat: number; date: string; mag?: number; unit?: string }[];
  polygon_count?: number; polygon_vertices?: number; bbox?: [number, number, number, number]; polygons?: number[][][][];
  sources: { id: string; url: string }[]; link: string;
}
export interface EonetList {
  events: EonetEvent[]; count: number; days: number; categories: { id: string; title: string; count: number }[];
  request_url: string; retrieved_at: string; stale: boolean; source: string; notes: string[];
}
export interface EonetDetail { event: EonetEvent; request_url: string; retrieved_at: string; stale: boolean; source: string; notes: string[] }

const KNOWN = new Set<string>(CATS);

export function fromEonet(e: EonetEvent, prefer?: Cat): Ev {
  const first = KNOWN.has(e.category) && e.category !== "other" ? e.category as Cat : "other";
  return {
    id: e.id, catalog: "eonet", title: e.title, cat: prefer && e.categories?.includes(prefer) ? prefer : first, categoryTitle: e.category_title,
    start: Date.parse(e.start), end: Date.parse(e.end), closed: e.closed ? Date.parse(e.closed) : undefined,
    lon: e.lon, lat: e.lat, position: e.position, geometry: e.geometry, mag: e.mag, magMax: e.mag_max, magUnit: e.mag_unit,
    track: e.track?.map((f) => ({ lon: f.lon, lat: f.lat, t: Date.parse(f.date), mag: f.mag, unit: f.unit })),
    polygonCount: e.polygon_count, polygonVertices: e.polygon_vertices, bbox: e.bbox, polygons: e.polygons, sources: e.sources, link: e.link,
  };
}
export function fromQuake(q: Quake): Ev {
  const t = Date.parse(q.time);
  return {
    id: q.id, catalog: "usgs", title: q.mag === null ? q.place : `M ${q.mag.toFixed(1)} – ${q.place}`, cat: "earthquakes", categoryTitle: "Earthquakes",
    start: t, end: t, lon: q.lon, lat: q.lat, position: "reported_point", geometry: "point",
    mag: q.mag ?? undefined, magUnit: q.mag_type, depthKm: q.depth_km, sources: [{ id: "USGS", url: q.url }], link: q.url,
  };
}

export const startedBy = (e: Ev, t: number) => e.start <= t;

export const endedBy = (e: Ev, t: number) => e.closed !== undefined && e.closed < t;

export function fixesBy(e: Ev, t: number): Fix[] {
  if (!e.track) return [];
  let n = 0;
  while (n < e.track.length && e.track[n].t <= t) n++;
  return e.track.slice(0, n);
}

export function markerAt(e: Ev, t: number): { lon: number; lat: number; mag?: number; unit?: string } {
  const f = fixesBy(e, t);
  return f.length ? f[f.length - 1] : e;
}

export interface Filter { cats: Record<Cat, boolean>; from: number; cursor: number }
export function visible(events: Ev[], f: Filter): Ev[] {
  return events.filter((e) => f.cats[e.cat] && e.end >= f.from && startedBy(e, f.cursor));
}
export function countByCat(events: Ev[]): Record<Cat, number> {
  const n = Object.fromEntries(CATS.map((c) => [c, 0])) as Record<Cat, number>;
  for (const e of events) n[e.cat]++;
  return n;
}

export function markerSize(e: Ev): number {
  if (e.cat === "earthquakes") return 4 + Math.max(0, (e.mag ?? 4.5) - 4) * 3.4;
  if (e.cat === "severeStorms") return 11;
  if (e.cat === "wildfires") return 6;
  return 9;
}

export function clusterCell(cameraHeightM: number): number {
  if (cameraHeightM > 9e6) return 6;
  if (cameraHeightM > 4.5e6) return 3;
  if (cameraHeightM > 2e6) return 1.5;
  return 0;
}
export interface Cluster { lon: number; lat: number; members: Ev[] }

export function cluster(events: Ev[], cellDeg: number): Cluster[] {
  if (cellDeg <= 0) return events.map((e) => ({ lon: e.lon, lat: e.lat, members: [e] }));
  const cells = new Map<number, Ev[]>();
  const cols = Math.ceil(360 / cellDeg);
  for (const e of events) {
    const cx = Math.min(cols - 1, Math.floor((e.lon + 180) / cellDeg)), cy = Math.floor((e.lat + 90) / cellDeg);
    const k = cy * cols + cx;
    const m = cells.get(k);
    if (m) m.push(e); else cells.set(k, [e]);
  }
  const out: Cluster[] = [];
  for (const members of cells.values()) {
    if (members.length === 1) { out.push({ lon: members[0].lon, lat: members[0].lat, members }); continue; }
    let x = 0, y = 0, z = 0;
    for (const e of members) {
      const la = e.lat * Math.PI / 180, lo = e.lon * Math.PI / 180;
      x += Math.cos(la) * Math.cos(lo); y += Math.cos(la) * Math.sin(lo); z += Math.sin(la);
    }
    out.push({ lon: Math.atan2(y, x) * 180 / Math.PI, lat: Math.atan2(z, Math.hypot(x, y)) * 180 / Math.PI, members });
  }
  return out;
}

export const clusterSize = (n: number) => n <= 1 ? 6 : Math.min(34, 9 + 5.5 * Math.log2(n));

export const DAY = 86_400_000;

export function daySteps(from: number, to: number): number[] {
  const out: number[] = [];
  for (let t = Math.ceil(from / DAY) * DAY; t < to; t += DAY) out.push(t);
  out.push(to);
  return out;
}
export const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
export const isoMinute = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC";

export const beforeAfter = (e: Ev) => ({ before: isoDay(e.start - DAY), after: isoDay(Math.min(e.end + DAY, Date.now() - DAY)) });

export function geometryNote(e: Ev): string {
  if (e.geometry === "track") return "The source reported a series of dated positions. The line joins them in time order; it is not a forecast and has no width.";
  if (e.geometry === "polygon") return "The source published an outline for this event and it is drawn as given. It marks the area the report refers to (it can follow administrative borders); it is not a measured water edge. The marker is the centre of the outline's bounding box.";
  if (e.cat === "earthquakes") return "One point: the epicentre reported by USGS. The affected area is not drawn.";
  return "The source reported one point for this event. No extent or perimeter is available, so none is drawn.";
}

export interface Story {
  id: string;
  catalog: "eonet" | "usgs";
  cat: Cat;
  title: string;

  text: string;

  height: number;

  quake?: { lat: number; lon: number; day: string };

  play?: boolean;

  impact?: boolean;

  card?: { where: string; when: string; line: string };
}

export const STORIES: Story[] = [
  { id: "EONET_11536", catalog: "eonet", cat: "severeStorms", title: "A hurricane's path, position by position", height: 4_500_000, play: true, impact: true,
    card: { where: "Gulf of Mexico and Florida, USA", when: "October 2024", line: "Follow a hurricane across the sea, one reported position at a time." },
    text: "Hurricane Milton, October 2024. The globe shows the documented path of the storm's centre from the U.S. National Hurricane Center's best track, coloured by the wind at each position, and how far tropical-storm and hurricane-force winds were analysed to reach. Press play to follow it." },
  { id: "EONET_9035", catalog: "eonet", cat: "wildfires", title: "How large was the Park Fire?", height: 600_000, play: true, impact: true,
    card: { where: "Northern California, USA", when: "July – August 2024", line: "See the mapped perimeter of a very large wildfire and the satellite heat detections that trace how it spread." },
    text: "The catalogue holds one point for this fire. The orange area is the final perimeter mapped by the fire agencies; every dot is a hot pixel seen by a NASA / NOAA VIIRS satellite. Press play to watch the detections day by day." },
  { id: "us100044k6", catalog: "usgs", cat: "earthquakes", title: "A strong earthquake in the Pamir", height: 900_000, quake: { lat: 38.21, lon: 72.78, day: "2015-12-07" }, play: true, impact: true,
    card: { where: "Pamir mountains, Tajikistan", when: "7 December 2015", line: "See where a magnitude 7.2 earthquake started, deep under the mountains." },
    text: "The marker is where the earthquake started. The colours are the USGS ShakeMap: an estimate of how strongly the ground shook, draped over the mountains. The white frame is the fault that slipped, and the dots are the earthquakes that followed nearby." },
  { id: "EONET_26367", catalog: "eonet", cat: "floods", title: "What did the satellites see of this flood?", height: 500_000, impact: true,
    card: { where: "Central Thailand", when: "November 2026", line: "Compare NASA's satellite flood maps before and during a reported flood, and see how much the clouds hid." },
    text: "A disaster agency reported this flood and published an outline (the pale blue line). The colours are NASA's MODIS flood product: red is water where there is normally land, yellow is land that floods regularly, grey could not be observed. Use Before / After or the time slider." },
  { id: "EONET_26330", catalog: "eonet", cat: "floods", title: "A flood with a published outline", height: 1_500_000,
    text: "For this flood the source (GDACS, through NASA EONET) published an outline, so it is drawn exactly as given. What the outline stands for is defined by the source; it is not a measured water edge." },
  { id: "EONET_3153", catalog: "eonet", cat: "landslides", title: "Landslides recorded as one point", height: 250_000,
    text: "The catalogue holds one point and a date for this event in August 2017. Press “Terrain (3D relief)” below and zoom in to see the slopes around the point. The size of the slide is not in the record." },
  { id: "EONET_20710", catalog: "eonet", cat: "volcanoes", title: "A volcano in the catalogue", height: 600_000,
    text: "Volcanic activity is listed by the Smithsonian Global Volcanism Program and passed on by NASA EONET as one point at the volcano. No ash cloud or lava extent is in the record." },
];
