import { apiURL } from "../../api/url";
import { DAY, isoDay, type Ev } from "../model";
import type { Bundle, Layer, Missing } from "./types";

export interface EventEvidenceAdapter {
  id: string;
  supports(ev: Ev): boolean;
  load(ev: Ev, signal?: AbortSignal): Promise<Bundle>;
}

export const PACKS: Record<string, string> = {
  EONET_9035: "/evidence/EONET_9035.json",
  EONET_11536: "/evidence/EONET_11536.json",
  EONET_26367: "/evidence/EONET_26367.json",
};
export const registerPack = (id: string, url: string) => { PACKS[id] = url; };

async function getJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  let r: Response;
  try { r = await fetch(url, { signal }); } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error("The evidence could not be loaded: no connection, and it was not saved on this device.");
  }
  if (!r.ok) {
    const body = await r.json().catch(() => undefined) as { error?: { message?: string } } | undefined;
    throw new Error(body?.error?.message ?? `The evidence could not be loaded (HTTP ${r.status}).`);
  }
  return await r.json() as T;
}

const packAdapter: EventEvidenceAdapter = {
  id: "pack",
  supports: (ev) => ev.id in PACKS,
  load: (ev, signal) => getJSON<Bundle>(PACKS[ev.id], signal),
};

const shakeMapAdapter: EventEvidenceAdapter = {
  id: "shakemap",
  supports: (ev) => ev.catalog === "usgs" && ev.cat === "earthquakes",
  load: (ev, signal) => getJSON<Bundle>(apiURL(`/evidence/earthquake/${encodeURIComponent(ev.id)}`), signal),
};

const IMERG_FIRST = Date.UTC(2000, 5, 1);
const MODIS_FLOOD_FIRST = Date.UTC(2021, 11, 23);
const days = (from: number, to: number, max = 45) => { const out: string[] = []; for (let t = Math.floor(from / DAY) * DAY; t <= to && out.length < max; t += DAY) out.push(isoDay(t)); return out; };

const WHY: Partial<Record<Ev["cat"], Missing[]>> = {
  wildfires: [{ label: "Burned area and fire perimeter", reason: "The catalogue gives one reported point for this fire. No mapped perimeter or burned-area data have been linked to it here, so no extent is drawn." }],
  volcanoes: [{ label: "Ash or gas plume", reason: "The catalogue lists the volcano as one point. No observed plume dataset is linked to this record, so none is drawn." }],
  landslides: [{ label: "Landslide boundary", reason: "The record holds a reported location only. Without a mapped inventory outline the shape and size of the slide are unknown and are not drawn." }],
  other: [{ label: "Extent", reason: "The catalogue gives a location only for this event." }],
};

export function bundleFromRecord(ev: Ev): Bundle {
  const layers: Layer[] = [], unavailable: Missing[] = [];
  const eonet = { name: `NASA EONET v3 (${ev.sources.map((s) => s.id).join(", ") || "source not named"})`, url: ev.link, retrieved: "with the catalogue", licence: "Open data" };
  const b: Bundle = {
    schema: 1, event_id: ev.id, category: ev.cat, built_at: isoDay(Date.now()), builder: "catalogue record", title: ev.title,
    subtitle: ev.start === ev.end ? isoDay(ev.start) : `${isoDay(ev.start)} – ${isoDay(ev.end)}`,
    association: "Only what the catalogue record of this event contains is drawn, plus satellite product pictures of the same dates. A satellite picture shows the whole region: what is seen in it is not automatically part of this event.",
    summary: [], steps: [], layers, unavailable,
  };
  if (ev.track?.length) {
    const kts = /^kts?$/i.test(ev.magUnit ?? ev.track.find((f) => f.unit)?.unit ?? "");
    layers.push({
      id: "track", label: "Reported positions", short: "Track", icon: "track", kind: "track", evidence: "observed", on: true, time: "cumulative",
      fixes: ev.track.map((f) => ({ t: f.t, lon: f.lon, lat: f.lat, wind: kts ? f.mag ?? null : null })), wind_unit: kts ? "kt" : undefined,
      legend: kts ? [{ color: "#7dd3fc", label: "Below 34 kt" }, { color: "#facc15", label: "34–63 kt" }, { color: "#fb923c", label: "64–95 kt" }, { color: "#ef4444", label: "96 kt and more" }] : [{ color: "#cbd5e1", label: "Reported positions joined in time order" }],
      source: eonet, date: `${isoDay(ev.start)} to ${isoDay(ev.end)}`, resolution: `${ev.track.length} dated positions`, units: kts ? "kt (as reported)" : ev.magUnit ?? "",
      uncertainty: "Operational advisory positions; a later best-track analysis can differ.",
      note: "The line joins the positions the agencies reported, in time order. It is the path of the centre, not the area affected, and it has no width.",
    });
    b.steps = ev.track.map((f) => ({ t: f.t, label: new Date(f.t).toISOString().slice(0, 16).replace("T", " ") + " UTC" }));
    b.steps_label = "Reported position";
    b.summary.push({ label: "Reported positions", value: String(ev.track.length), unit: "", also: `${isoDay(ev.start)} – ${isoDay(ev.end)}`, evidence: "observed", note: "Dated positions in the catalogue record." });
    if (ev.magMax !== undefined) b.summary.push({ label: "Largest value reported", value: String(ev.magMax), unit: ev.magUnit ?? "", evidence: "observed", note: "Largest magnitude value among the reported positions, in the unit the source uses." });
    if (ev.cat === "severeStorms") unavailable.push({ label: "Wind radii and storm size", reason: "The catalogue record has centre positions only. Without reported wind radii the width of the storm is unknown and is not drawn." });
  }
  if (ev.geometry === "polygon") {
    if (ev.polygons?.length) layers.push({
      id: "outline", label: "Reported event area", short: "Reported area", icon: "area", kind: "polygons", evidence: "reported", on: true, fill: false, color: "#93c5fd", polygons: ev.polygons,
      legend: [{ color: "#93c5fd", label: "Outline published for the event (not a measured edge)" }],
      source: eonet, date: isoDay(ev.start), resolution: `${ev.polygonVertices ?? "?"} vertices as published`, units: "",
      uncertainty: "Defined by the reporting agency; it can follow administrative borders.",
      note: "The area the report refers to. It is not a measured footprint of water, fire or damage.",
    });
    b.summary.push({ label: "Reported outline", value: String(ev.polygonVertices ?? ""), unit: "points", evidence: "reported", note: "Vertices of the outline in the catalogue record. The outline is a reported area, not a measurement." });
  }
  if (ev.cat === "floods") {
    if (ev.end >= MODIS_FLOOD_FIRST) layers.push({
      id: "water", label: "Mapped water (NASA MODIS flood product)", short: "Mapped water", icon: "water", kind: "gibs", evidence: "satellite", on: true, time: "current",
      gibs: { layer: "MODIS_Combined_Flood_3-Day", matrix: "GoogleMapsCompatible_Level9", max_level: 9, dates: days(Math.max(ev.start - 2 * DAY, MODIS_FLOOD_FIRST), Math.min(ev.end + 3 * DAY, Date.now() - DAY)) },
      legend: [{ color: "rgb(250,30,36)", label: "Flood (water where the reference map has land)" }, { color: "rgb(255,255,0)", label: "Recurring flood" }, { color: "rgb(50,210,245)", label: "Surface water (normal)" }, { color: "rgb(175,175,175)", label: "Insufficient data (cloud, shadow or masked terrain)" }],
      source: { name: "NASA LANCE MODIS Near Real-Time Global Flood Product, 3-day composite, image tiles from NASA GIBS", url: "https://lance.modaps.eosdis.nasa.gov/flood/", retrieved: "on demand", licence: "NASA open data" },
      date: "one map per day around the reported dates", resolution: "250 m", units: "class per pixel (picture of the product)",
      uncertainty: "Cloud and terrain shadow can hide water or be mistaken for it; near-real-time product.",
      note: "Water seen by satellite in the 3 days up to the date shown. It covers the whole region: water in the picture is not automatically part of this event. No water depth is known.",
    });
    else unavailable.push({ label: "Satellite-detected floodwater", reason: "The NASA MODIS flood product starts in December 2021; no flood map exists for this date." });
    unavailable.push({ label: "Mapped floodwater area in km²", reason: "Flood areas are computed only for prepared cases; for this event the product is shown as a picture." },
      { label: "Water depth", reason: "No validated depth model is available; depth is not shown." });
  }
  if ((ev.cat === "floods" || ev.cat === "severeStorms" || ev.cat === "landslides") && ev.start >= IMERG_FIRST) {
    const from = ev.cat === "landslides" ? ev.start - 3 * DAY : ev.start;
    layers.push({
      id: "rain", label: "Rainfall (GPM IMERG picture of the day)", short: "Rainfall", icon: "rain", kind: "gibs", evidence: "satellite", on: false, time: "current",
      gibs: { layer: "IMERG_Precipitation_Rate", dates: days(from, Math.min(ev.end, Date.now() - 2 * DAY)) },
      legend: [], legend_image: "https://gibs.earthdata.nasa.gov/legends/GPM_Precipitation_Rate_H.svg",
      source: { name: "NASA GPM IMERG precipitation rate, image from NASA GIBS", url: "https://gpm.nasa.gov/data/imerg", retrieved: "on demand", licence: "NASA open data" },
      date: "one image per UTC day", resolution: "0.1° (about 10 km)", units: "mm/hr (colour scale of the GIBS image)",
      uncertainty: "Satellite estimate of rain rate; not a rain-gauge total.",
      note: ev.cat === "landslides" ? "Rain seen by satellite on the days before the report. Heavy rain before a landslide is context; it does not prove what caused the slide." : "Rain seen by satellite on the date shown. Downloaded only when switched on.",
    });
  }
  if (!ev.track && ev.geometry !== "polygon") unavailable.push(...(WHY[ev.cat] ?? WHY.other!));

  if (!b.steps.length) {
    const dated = layers.find((l) => l.gibs && l.on) ?? layers.find((l) => l.gibs);
    if (dated?.gibs && dated.gibs.dates.length > 1) { b.steps = dated.gibs.dates.map((d) => ({ t: Date.parse(d) + DAY - 1000, label: d })); b.steps_label = "Satellite picture of"; }
  }
  return b;
}

const recordAdapter: EventEvidenceAdapter = { id: "record", supports: () => true, load: async (ev) => bundleFromRecord(ev) };

const adapters: EventEvidenceAdapter[] = [packAdapter, shakeMapAdapter, recordAdapter];

export const registerAdapter = (a: EventEvidenceAdapter) => { adapters.unshift(a); };
export const adapterFor = (ev: Ev): EventEvidenceAdapter => adapters.find((a) => a.supports(ev))!;
