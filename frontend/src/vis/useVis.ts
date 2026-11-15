import { useEffect, useMemo, useRef, useState } from "react";
import {
  type CesiumWidget, type Material, type Primitive,
} from "@cesium/engine";
import { Color, Math as CMath } from "@cesium/core";
import { api } from "../api/client";
import type { Availability, Layer, VisCatalog } from "../api/types";
import { useLowBandwidth, useStore } from "../store";
import { onMainViewer } from "../globe/registry";
import { geo } from "../geo";
import { loadFrame, sampleFrame, setDataVersion, type Frame, type FrameRequest } from "./frame";
import { lut, robustRange } from "./palettes";
import { PrimitiveModes } from "./modes";
import { applyFrames, geographyOverlay, lutCanvas, makeMaterial } from "./gpu";

const ANOM_FIXED: Record<string, number> = { t2m: 6, precip: 4, soilwet: 0.25, qv2m: 3, rh2m: 20 };

export const REGION_BELOW_M = 3_500_000;

let catalogP: Promise<VisCatalog> | null = null;
function catalogOnce() {
  catalogP ??= api.visCatalog().then((c) => { setDataVersion(c.version ?? ""); c.variables.forEach(expandMonths); return c; }).catch((e) => { catalogP = null; throw e; });
  return catalogP;
}

function expandMonths(v: VisCatalog["variables"][number]) {
  const miss = new Set(v.missing ?? []);
  const out: string[] = [];
  let [y, m] = v.first.split("-").map(Number);
  const [y2, m2] = v.last.split("-").map(Number);
  while (y * 12 + m <= y2 * 12 + m2) {
    const s = `${y}-${String(m).padStart(2, "0")}`;
    if (!miss.has(s)) out.push(s);
    if (++m > 12) { m = 1; y++; }
  }
  v.months = out;
  const n = new Map<string, number>();
  for (const s of out) n.set(s.slice(0, 4), (n.get(s.slice(0, 4)) ?? 0) + 1);
  v.years = [...n].filter(([, c]) => c === 12).map(([yy]) => yy).sort();
}

function regionFor(v: CesiumWidget): [number, number, number, number] | undefined {
  if (v.camera.positionCartographic.height > REGION_BELOW_M) return undefined;
  const r = v.camera.computeViewRectangle();
  const c = v.camera.positionCartographic;
  const clon = CMath.toDegrees(c.longitude), clat = CMath.toDegrees(c.latitude);
  let w = r ? CMath.toDegrees(r.west) : clon - 10, e = r ? CMath.toDegrees(r.east) : clon + 10;
  let s = r ? CMath.toDegrees(r.south) : clat - 10, n = r ? CMath.toDegrees(r.north) : clat + 10;
  let span = e - w; if (span < 0) span += 360;
  if (span > 55) { w = clon - 27.5; e = clon + 27.5; }
  if (n - s > 55) { s = clat - 27.5; n = clat + 27.5; }
  const snap = (x: number, f: (y: number) => number) => f(x / 5) * 5;
  w = snap(w, Math.floor); e = snap(e, Math.ceil); s = Math.max(-90, snap(s, Math.floor)); n = Math.min(90, snap(n, Math.ceil));
  const wrap = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180;
  return [wrap(w), s, wrap(e) === -180 && e > 0 ? 180 : wrap(e), n];
}

export function useVis() {
  const { vis, date, setVis } = useStore();
  const low = useLowBandwidth();
  const [catalog, setCatalog] = useState<VisCatalog>();
  const [catErr, setCatErr] = useState<string>();
  const [viewer, setViewer] = useState<CesiumWidget | null>(null);
  const [viewBox, setViewBox] = useState<[number, number, number, number]>();
  const [frames, setFrames] = useState<{ planet?: Frame; region?: Frame; u?: Frame; v?: Frame; loading: boolean; error?: string; ms?: number }>({ loading: false });
  const engine = useRef<PrimitiveModes | null>(null);
  const gpu = useRef<{ globe?: Material; shell?: Material; overlay?: Primitive; overlayLod?: number; lastG: object; lastS: object }>({ lastG: {}, lastS: {} });

  useEffect(() => { catalogOnce().then(setCatalog).catch((e) => setCatErr(String(e.message ?? e))); }, []);
  useEffect(() => onMainViewer((v) => {
    engine.current?.destroy();
    engine.current = v ? new PrimitiveModes(v) : null;
    gpu.current = { lastG: {}, lastS: {} };
    setViewer(v);
  }), []);
  useEffect(() => () => { engine.current?.destroy(); }, []);

  const variable = catalog?.variables.find((x) => x.id === vis.variable);
  const mode = variable ? (variable.modes.includes(vis.mode) ? vis.mode : variable.modes[0]) : undefined;
  const kind: "value" | "anomaly" = variable?.anomaly && mode !== "flow" ? vis.kind : "value";
  const annual = vis.temporal === "annual" && mode !== "flow";

  const periods = (annual ? variable?.years : variable?.months) ?? [];
  const req = annual ? date.slice(0, 4) : date.slice(0, 7);
  let idx = -1;
  for (let i = periods.length - 1; i >= 0; i--) if (periods[i] <= req) { idx = i; break; }
  if (idx < 0 && periods.length) idx = 0;
  const month = periods[idx];
  const toDate = (p: string) => (p.length === 4 ? `${p}-01-01` : `${p}-01`);
  const availability: Availability | undefined = month ? {
    requested: date, shown: toDate(month), exact: req === month,
    delta_days: Math.round((Date.parse(toDate(month)) - Date.parse(toDate(req))) / 86_400_000),
    previous: idx > 0 ? toDate(periods[idx - 1]) : undefined, next: idx < periods.length - 1 ? toDate(periods[idx + 1]) : undefined,
    first: toDate(periods[0]), last: toDate(periods[periods.length - 1]),
  } : undefined;
  const driver: Layer | undefined = variable && month ? {
    id: `vis-${variable.id}`, group: "science", short_name: `${variable.name} (numeric, ${annual ? "annual means" : "monthly"})`, measures: variable.name,
    data_resolution_note: "", quantitative: true, title: variable.name, format: "", tile_matrix_set: "", max_level: 0,
    url_template: "", time_enabled: true, intervals: [{ start: toDate(periods[0]), end: toDate(periods[periods.length - 1]), period: annual ? "P1Y" : "P1M" }],
    attribution: "",
  } : undefined;

  useEffect(() => {
    if (!viewer || !variable || mode === "flow" || mode === "shell") { setViewBox(undefined); return; }
    let t: ReturnType<typeof setTimeout> | undefined;
    const update = () => { clearTimeout(t); t = setTimeout(() => {
      if (viewer.isDestroyed()) return;
      const b = regionFor(viewer);
      setViewBox((old) => (old?.join() === b?.join() ? old : b));
    }, 400); };
    update();
    const off = viewer.camera.changed.addEventListener(update);
    viewer.camera.percentageChanged = 0.05;
    return () => { clearTimeout(t); off(); };
  }, [viewer, variable?.id, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const bbox = low && !vis.detail ? undefined : viewBox;
  useEffect(() => { if (vis.detail && !viewBox) setVis({ detail: false }); }, [viewBox]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!variable || !month) { setFrames({ loading: false }); return; }
    const ctl = new AbortController();
    const t0 = performance.now();
    setFrames((f) => ({ ...f, loading: true, error: undefined }));
    const base = { month, kind, lod: "planet" as const };
    const jobs: Promise<Partial<typeof frames>> = mode === "flow" && variable.vector
      ? Promise.all([loadFrame({ ...base, variable: variable.vector[0] }, ctl.signal), loadFrame({ ...base, variable: variable.vector[1] }, ctl.signal)]).then(([u, v]) => ({ u, v }))
      : Promise.all([
          loadFrame({ ...base, variable: variable.id }, ctl.signal).catch((e: Error) => e),
          bbox ? loadFrame({ ...base, variable: variable.id, lod: "region", bbox }, ctl.signal).catch(() => undefined) : Promise.resolve(undefined),
        ]).then(([planet, region]) => {

          if (planet instanceof Error) { if (!region) throw planet; return { planet: undefined, region }; }
          return { planet, region };
        });
    jobs.then((r) => { if (!ctl.signal.aborted) setFrames({ ...r, loading: false, ms: Math.round(performance.now() - t0) }); })
      .catch((e: Error) => { if (e.name !== "AbortError") setFrames((f) => ({ ...f, loading: false, error: e.message })); });

    if (!low) {
      const t = setTimeout(() => {
        for (const m of periods.slice(idx + 1, idx + 3)) {
          const ids = mode === "flow" && variable.vector ? variable.vector : [variable.id];
          for (const id of ids) loadFrame({ variable: id, month: m, kind, lod: "planet" } as FrameRequest).catch(() => {});
        }
      }, 1500);
      return () => { clearTimeout(t); ctl.abort(); };
    }
    return () => ctl.abort();
  }, [variable?.id, month, kind, mode, bbox?.join(), low]); // eslint-disable-line react-hooks/exhaustive-deps

  const palette = vis.palette ?? (kind === "anomaly" ? variable?.anom_palette ?? "anomaly" : variable?.palette ?? "temperature");
  const table = useMemo(() => lut(palette), [palette]);
  const lutTex = useMemo(() => lutCanvas(table), [table]);
  const range: [number, number] = useMemo(() => {
    if (!variable) return [0, 1];
    if (vis.range === "manual" && vis.manualMin !== undefined && vis.manualMax !== undefined && vis.manualMax > vis.manualMin) return [vis.manualMin, vis.manualMax];
    if (vis.range === "auto" || vis.range === "manual") {
      const f = mode === "flow" ? undefined : frames.planet ?? frames.region;
      if (f) return robustRange(f.values, kind === "anomaly");
    }
    if (mode === "flow") return [0, 12];
    if (kind === "anomaly") { const a = ANOM_FIXED[variable.id] ?? 1; return [-a, a]; }
    return [variable.fixed_min ?? 0, variable.fixed_max ?? 1];
  }, [variable, vis.range, vis.manualMin, vis.manualMax, frames.planet, frames.region, kind, mode]);

  const colorOf = useMemo(() => (val: number) => {
    const t = Math.min(1, Math.max(0, (val - range[0]) / (range[1] - range[0] || 1)));
    const k = Math.round(t * 255) * 3;
    return Color.fromBytes(table[k], table[k + 1], table[k + 2], 255);
  }, [table, range]);

  useEffect(() => {
    const v = viewer, e = engine.current, g = gpu.current;
    if (!v || v.isDestroyed() || !e) return;
    const surfaceOn = !!variable && mode === "surface" && !!(frames.planet ?? frames.region);
    const shellOn = !!variable && mode === "shell" && !!frames.planet;
    if (surfaceOn) {
      g.globe ??= makeMaterial(false);
      applyFrames(g.globe, frames.planet, frames.region, { lut: lutTex, range, opacity: vis.opacity, alphaByValue: false }, g.lastG);
      if (v.scene.globe.material !== g.globe) v.scene.globe.material = g.globe;

      const best = geo.lod1 ? 1 : geo.lod0 ? 0 : -1;
      if (best >= 0 && (!g.overlay || (g.overlayLod ?? -1) < best)) {
        if (g.overlay) v.scene.primitives.remove(g.overlay);
        g.overlay = geographyOverlay((best === 1 ? geo.lod1 : geo.lod0)!);
        g.overlayLod = best;
        v.scene.primitives.add(g.overlay);
      }
      if (g.overlay) g.overlay.show = true;
    } else {
      if (v.scene.globe.material) v.scene.globe.material = undefined as unknown as Material;
      if (g.overlay) g.overlay.show = false;
    }
    if (shellOn) {
      g.shell ??= makeMaterial(true);
      applyFrames(g.shell, frames.planet, undefined, { lut: lutTex, range, opacity: vis.opacity, alphaByValue: variable!.shell_alpha === "value" && kind === "value" }, g.lastS);
      e.setShell(g.shell);
    } else e.setShell(null);
    if (variable && mode === "extrude") {
      const f = frames.region && frames.region.h.nlat * frames.region.h.nlon <= 6000 ? frames.region : frames.planet;
      e.setExtrude(f ?? null, colorOf, range, kind === "anomaly", vis.exaggeration);
    } else e.setExtrude(null, colorOf, range, false, 1);
    v.scene.requestRender();

    const off = v.scene.postRender.addEventListener(() => { off(); if (!v.isDestroyed()) v.scene.requestRender(); });
  }, [viewer, variable, mode, frames, lutTex, range, kind, vis.opacity, vis.exaggeration, colorOf]);

  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    if (variable && mode === "flow" && frames.u && frames.v) e.setFlow(frames.u, frames.v, vis.density, colorOf);
    else e.setFlow(null, null, 0, colorOf);
  }, [viewer, variable, mode, frames.u, frames.v, vis.density, colorOf]);

  const probe = (lat: number, lon: number) => {
    const f = (frames.region && sampleFrame(frames.region, lat, lon) && frames.region) || frames.planet;
    if (!f) return undefined;
    const s = sampleFrame(f, lat, lon);
    if (!s) return undefined;
    const h = f.h;
    return { v: s.v, lat: h.lat[s.i], lon: h.lon[s.j], cell: `${(h.lat_edges[s.i + 1] - h.lat_edges[s.i]).toFixed(2)}° × ${(h.lon_edges[s.j + 1] - h.lon_edges[s.j]).toFixed(3)}°`, lod: h.lod };
  };

  useEffect(() => { (window as unknown as { __ee?: Record<string, unknown> }).__ee = { ...((window as unknown as { __ee?: Record<string, unknown> }).__ee ?? {}), vis: { frames, range, table } }; }, [frames, range, table]);

  const linesOnTop = !!variable && mode === "surface" && !!(frames.planet ?? frames.region);
  return { catalog, catErr, variable, mode, kind, annual, month, availability, driver, palette, range, frames, probe, bbox, viewBox, low, linesOnTop };
}

export type VisState = ReturnType<typeof useVis>;
