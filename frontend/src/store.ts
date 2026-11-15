import { create } from "zustand";
import type { Layer, Variable } from "./api/types";
import type { QuakeQuery } from "./api/url";

export type Mode = "explore" | "time" | "xray" | "events" | "compare" | "lab";
export type InsideTab = "cutaway" | "crust" | "section" | "quakes";
export type GuideId = "warming" | "past" | "inside" | "quakes";

export interface Place { lat: number; lon: number; label?: string }

export type VisMode = "surface" | "shell" | "extrude" | "flow";
export interface VisSettings {
  variable?: string;
  mode: VisMode;
  kind: "value" | "anomaly";
  opacity: number;
  palette?: string;
  range: "fixed" | "auto" | "manual";
  manualMin?: number;
  manualMax?: number;
  exaggeration: number;
  density: number;
  temporal: "monthly" | "annual";

  detail: boolean;
}

interface State {
  savedQuakeQuery?: QuakeQuery;
  openQuakeSnapshot: (q: QuakeQuery) => void;
  mode: Mode;
  setMode: (m: Mode) => void;

  welcome: boolean;
  setWelcome: (w: boolean) => void;

  advanced: boolean;
  setAdvanced: (a: boolean) => void;

  analyze: boolean;
  setAnalyze: (a: boolean) => void;

  insideTab: InsideTab;
  insideToken: number;
  openInside: (tab: InsideTab) => void;

  investigate: boolean;
  setInvestigate: (i: boolean) => void;
  startInvestigation: () => void;

  eventReturn?: { id: string; title: string };
  setEventReturn: (e?: { id: string; title: string }) => void;

  stash?: { variable?: string; satelliteId?: string; vizId?: string };

  guide?: GuideId;
  startGuide: (g?: GuideId) => void;

  variables: Variable[];
  layers: Layer[];
  catalogError?: string;
  setCatalog: (v: Variable[], l: Layer[]) => void;
  setCatalogError: (e: string) => void;

  variableId: string;
  setVariable: (id: string) => void;
  startYear: number;
  endYear: number;
  setPeriod: (a: number, b: number) => void;

  place?: Place;
  setPlace: (p?: Place) => void;

  flyToken: number;
  flyHeight: number;

  flyTo: (p: Place, height?: number) => void;

  baseStyle: "vector" | "relief";
  setBaseStyle: (b: "vector" | "relief") => void;
  showBorders: boolean;
  showCoastlines: boolean;
  showRivers: boolean;
  showLabels: boolean;
  terrain: boolean;

  reliefShading: boolean;
  toggle: (k: "showBorders" | "showCoastlines" | "showRivers" | "showLabels" | "terrain" | "reliefShading") => void;

  satelliteId?: string;
  setSatellite: (id?: string) => void;

  vizId?: string;
  vizOpacity: number;
  setViz: (id?: string) => void;
  setVizOpacity: (o: number) => void;

  gridVariable?: string;
  gridOpacity: number;
  setGridVariable: (id?: string) => void;
  setGridOpacity: (o: number) => void;
  gridAnnual: boolean;
  setGridAnnual: (b: boolean) => void;

  vis: VisSettings;
  setVis: (p: Partial<VisSettings>) => void;

  lowBandwidthChoice: boolean | null;
  lowBandwidthDetected: boolean;
  setLowBandwidthChoice: (v: boolean | null) => void;
  setLowBandwidthDetected: (v: boolean) => void;

  date: string;
  setDate: (d: string) => void;
}

function stored(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

const owns = (m: Mode) => m === "xray" || m === "lab";

function ownGlobe(st: State, next: Mode, vis: VisSettings): Partial<State> {
  if (owns(next) && !owns(st.mode)) {
    return { stash: { variable: vis.variable, satelliteId: st.satelliteId, vizId: st.vizId }, vis: { ...vis, variable: undefined }, satelliteId: undefined, vizId: undefined };
  }
  if (!owns(next) && owns(st.mode) && st.stash) {
    const keep = next === "time" || st.advanced;
    return { stash: undefined, vis: { ...vis, variable: vis.variable ?? (keep ? st.stash.variable : undefined) }, satelliteId: st.satelliteId ?? st.stash.satelliteId, vizId: st.vizId ?? st.stash.vizId };
  }
  return {};
}

export const useStore = create<State>((set) => ({
  openQuakeSnapshot: (savedQuakeQuery) => set((st) => ({ savedQuakeQuery, mode: "xray", welcome: false, ...ownGlobe(st, "xray", st.vis) })),
  mode: "explore",

  setMode: (mode) => set((st) => {
    const out: Partial<State> = { mode, welcome: false, investigate: false };
    if (mode !== "explore" && mode !== "time") out.analyze = false;
    if (mode === "time" && !st.vis.variable) out.vis = { ...st.vis, variable: "t2m", mode: "surface" };
    if (st.mode === "time" && (mode === "explore" || mode === "xray" || mode === "lab" || mode === "events") && !st.advanced && st.vis.variable) out.vis = { ...st.vis, variable: undefined };
    if (mode !== st.mode) out.guide = undefined;
    return { ...out, ...ownGlobe(st, mode, out.vis ?? st.vis) };
  }),
  welcome: true,
  setWelcome: (welcome) => set({ welcome }),
  advanced: stored("ee.advanced") === "1",
  setAdvanced: (advanced) => { try { localStorage.setItem("ee.advanced", advanced ? "1" : "0"); } catch {  } set({ advanced }); },
  analyze: false,
  setAnalyze: (analyze) => set({ analyze }),
  insideTab: "cutaway",
  insideToken: 0,
  openInside: (insideTab) => set((st) => ({ insideTab, insideToken: st.insideToken + 1, mode: "xray", welcome: false, investigate: false, analyze: false, ...ownGlobe(st, "xray", st.vis) })),
  investigate: false,
  setInvestigate: (investigate) => set({ investigate }),
  startInvestigation: () => set((st) => ({
    mode: "explore", welcome: false, investigate: true, analyze: false, guide: undefined, eventReturn: undefined,
    ...(st.mode === "time" && !st.advanced && st.vis.variable ? { vis: { ...st.vis, variable: undefined } } : {}),
  })),
  eventReturn: undefined,
  setEventReturn: (eventReturn) => set({ eventReturn }),
  guide: undefined,
  startGuide: (guide) => set({ guide }),

  variables: [],
  layers: [],
  setCatalog: (variables, layers) => set({ variables, layers, catalogError: undefined }),
  setCatalogError: (catalogError) => set({ catalogError }),

  variableId: "t2m",

  setVariable: (variableId) => set((st) => {
    const first = st.variables.find((v) => v.id === variableId)?.coverage_start_year;
    if (first === undefined || st.startYear >= first) return { variableId };
    return { variableId, startYear: first, endYear: Math.max(st.endYear, first) };
  }),
  startYear: 1981,
  endYear: new Date().getUTCFullYear() - 1,
  setPeriod: (startYear, endYear) => set({ startYear, endYear }),

  place: undefined,

  setPlace: (place) => set((st) => ({ place, eventReturn: undefined, welcome: place ? false : st.welcome, analyze: place ? st.analyze || (st.advanced && !st.investigate) : false })),
  flyToken: 0,
  flyHeight: 600_000,
  flyTo: (place, height = 600_000) => set((s) => ({ place, eventReturn: undefined, flyHeight: height, flyToken: s.flyToken + 1, welcome: false, analyze: s.analyze || (s.advanced && !s.investigate) })),

  baseStyle: "vector",
  setBaseStyle: (baseStyle) => set({ baseStyle }),
  showBorders: true,
  showCoastlines: true,
  showRivers: false,
  showLabels: true,
  terrain: false,
  reliefShading: true,
  toggle: (k) => set((st) => ({ [k]: !st[k] }) as Partial<State>),
  satelliteId: undefined,
  setSatellite: (satelliteId) => set({ satelliteId }),
  vizId: undefined,
  vizOpacity: 0.75,
  setViz: (vizId) => set({ vizId }),
  setVizOpacity: (vizOpacity) => set({ vizOpacity }),
  gridVariable: undefined,
  gridOpacity: 0.8,
  setGridVariable: (gridVariable) => set({ gridVariable }),
  setGridOpacity: (gridOpacity) => set({ gridOpacity }),
  gridAnnual: false,
  setGridAnnual: (gridAnnual) => set({ gridAnnual }),

  vis: { mode: "surface", kind: "value", opacity: 0.8, range: "fixed", exaggeration: 1, density: 5000, temporal: "monthly", detail: false },
  setVis: (p) => set((st) => ({ vis: { ...st.vis, ...p } })),

  lowBandwidthChoice: (() => { const v = localStorage.getItem("ee.lowBandwidth"); return v === null ? null : v === "1"; })(),
  lowBandwidthDetected: false,
  setLowBandwidthChoice: (v) => { if (v === null) localStorage.removeItem("ee.lowBandwidth"); else localStorage.setItem("ee.lowBandwidth", v ? "1" : "0"); set({ lowBandwidthChoice: v }); },
  setLowBandwidthDetected: (lowBandwidthDetected) => set({ lowBandwidthDetected }),

  date: yesterday,
  setDate: (date) => set({ date }),
}));

export const useLowBandwidth = () => useStore((s) => s.lowBandwidthChoice ?? s.lowBandwidthDetected);

let layersP: Promise<void> | null = null;
export function ensureLayers(): Promise<void> {
  layersP ??= import("./api/client").then(({ api }) => api.layers()).then((l) => {
    useStore.setState({ layers: l.layers });
  }).catch((e) => { layersP = null; throw e; });
  return layersP;
}

export async function surfaceView() {
  const st = useStore.getState();
  if (!st.place) return;
  const low = st.lowBandwidthChoice ?? st.lowBandwidthDetected;
  if (low && !window.confirm("Low Bandwidth Mode is on.\n\nSurface view turns on terrain (DEM tiles, about 13 MB for one low view) and satellite imagery (about 1 MB). Continue?")) return;
  if (!st.satelliteId) {
    await ensureLayers().catch(() => {});
    useStore.setState({ satelliteId: "BlueMarble_NextGeneration" });
  }
  if (!st.terrain) useStore.setState({ terrain: true });
  st.flyTo(st.place, 30_000);
}
