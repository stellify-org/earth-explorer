import { t } from "../i18n";
import { useEffect, useMemo, useState } from "react";
import type { CesiumWidget, Primitive } from "@cesium/engine";
import { BoundingSphere, Cartesian3, HeadingPitchRange, Math as CMath } from "@cesium/core";
import { onMainViewer } from "../globe/registry";
import { Notice, Section, Spinner, selectCls } from "../components/ui";
import { pinned } from "./model";
import { Mesh } from "./scene";
import { useLabPlace, type ScenarioLocation } from "./locations";

interface Areas { permanent_km2: number; seasonal_km2: number; no_data_km2: number }
export interface AralMeta {
  name: string;
  grid: { west: number; north: number; cell_deg: number; width: number; height: number; bytes: number };
  years: number[];

  areas: { year: number; all: Areas; north?: Areas; south?: Areas; joined: boolean; drawn_km2: number }[];
  region: { area_km2: number; note: string };
  source: { name: string; citation: string; url: string; licence: string; attribution: string; note: string };
  method: string;
}
export interface AralPack { meta: AralMeta; water: Uint8Array; nodata: Uint8Array; region: Uint8Array }
let loading: Promise<AralPack> | null = null;
export function loadAral(): Promise<AralPack> {
  loading ??= (async () => {
    const meta = (await (await pinned("/scenario/aral.json")).json()) as AralMeta;
    const buf = new Uint8Array(await (await pinned("/scenario/aral.bin")).arrayBuffer());
    const n = meta.grid.width * meta.grid.height;
    if (buf.length !== meta.grid.bytes || buf.length !== 3 * n) throw new Error("The Aral Sea file has the wrong size");
    return { meta, water: buf.subarray(0, n), nodata: buf.subarray(n, 2 * n), region: buf.subarray(2 * n) };
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

export function categories(p: AralPack, k: number, ref: number): Uint8Array {
  const n = p.water.length, out = new Uint8Array(n), bk = 1 << k, br = 1 << ref;
  for (let c = 0; c < n; c++) {
    if (!p.region[c]) continue;
    const now = p.water[c] & bk, then = p.water[c] & br;
    out[c] = p.nodata[c] & bk && !now ? 3 : now ? (then || k === ref ? 1 : 4) : then ? 2 : 0;
  }
  return out;
}
export const COLOURS: Record<number, [number, number, number]> = { 1: [37, 99, 235], 2: [222, 184, 135], 3: [120, 124, 134], 4: [52, 211, 153] };
const HEIGHT = 400;

class AralScene {
  private prim?: Primitive;

  drawn: Record<number, number> = {};
  year = 0; ref = 0;
  constructor(private viewer: CesiumWidget, readonly pack: AralPack) {}
  show(k: number, ref: number) {
    const sc = this.viewer.scene, g = this.pack.meta.grid, cat = categories(this.pack, k, ref), m = new Mesh();
    if (this.prim) sc.primitives.remove(this.prim);
    this.drawn = { 1: 0, 2: 0, 3: 0, 4: 0 }; this.year = this.pack.meta.years[k]; this.ref = this.pack.meta.years[ref];
    const lon = (j: number) => g.west + j * g.cell_deg, lat = (i: number) => g.north - i * g.cell_deg;
    for (let i = 0; i < g.height; i++) for (let j = 0; j < g.width;) {
      const c = cat[i * g.width + j];
      let e = j + 1; while (e < g.width && cat[i * g.width + e] === c) e++;
      if (c) {
        const [r, gr, b] = COLOURS[c];
        const p = m.vertex(Cartesian3.fromDegrees(lon(j), lat(i), HEIGHT), r, gr, b), q = m.vertex(Cartesian3.fromDegrees(lon(e), lat(i), HEIGHT), r, gr, b);
        const s = m.vertex(Cartesian3.fromDegrees(lon(e), lat(i + 1), HEIGHT), r, gr, b), u = m.vertex(Cartesian3.fromDegrees(lon(j), lat(i + 1), HEIGHT), r, gr, b);
        m.idx.push(p, q, s, p, s, u); this.drawn[c] += e - j;
      }
      j = e;
    }
    const prim = m.primitive(false);
    this.prim = prim ? (sc.primitives.add(prim) as Primitive) : undefined;
    sc.requestRender();
  }
  view(retries = 5) {
    if (this.viewer.isDestroyed() || this.gone) return;
    const g = this.pack.meta.grid, centre = Cartesian3.fromDegrees(g.west + (g.width * g.cell_deg) / 2, g.north - (g.height * g.cell_deg) / 2, 0);
    this.viewer.camera.flyToBoundingSphere(new BoundingSphere(centre, 250_000), { offset: new HeadingPitchRange(0, CMath.toRadians(-89), 900_000), duration: 1.6,
      cancel: () => { if (retries > 0) setTimeout(() => this.view(retries - 1), 400); } });
  }
  private gone = false;
  destroy() { this.gone = true; if (!this.viewer.isDestroyed() && this.prim) { this.viewer.scene.primitives.remove(this.prim); this.viewer.scene.requestRender(); } this.prim = undefined; }
}

const km2 = (x: number) => Math.round(x).toLocaleString("en-US");
const sw = (c: [number, number, number]) => <span className="inline-block h-3 w-4 shrink-0 rounded-sm" style={{ background: `rgb(${c.join(",")})` }} />;

export default function AralPanel({ location }: { location: ScenarioLocation }) {
  const [viewer, setViewer] = useState<CesiumWidget | null>(null);
  const [data, setData] = useState<{ pack?: AralPack; error?: string }>({});
  const [k, setK] = useState(0);
  const [ref, setRef] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => onMainViewer(setViewer), []);
  useEffect(() => { let on = true; loadAral().then((pack) => on && setData({ pack }), (e) => on && setData({ error: String((e as Error).message ?? e) })); return () => { on = false; }; }, []);
  const scene = useMemo(() => (viewer && data.pack ? new AralScene(viewer, data.pack) : null), [viewer, data.pack]);
  useEffect(() => {
    if (!scene) return;
    scene.view();
    const w = window as unknown as { __ee?: Record<string, unknown> };
    w.__ee = { ...(w.__ee ?? {}), aral: scene };
    return () => { scene.destroy(); if (w.__ee) delete w.__ee.aral; };
  }, [scene]);
  useEffect(() => { scene?.show(k, ref); }, [scene, k, ref]);
  const years = data.pack?.meta.years ?? [];
  useEffect(() => {
    if (!playing || !years.length) return;
    const id = setInterval(() => setK((x) => { if (x + 1 >= years.length) { setPlaying(false); return x; } return x + 1; }), 1100);
    return () => clearInterval(id);
  }, [playing, years.length]);

  const back = <button className="mb-1 text-[12px] text-accent hover:underline" data-testid="lab-back" onClick={() => useLabPlace.getState().set(undefined)}>← {t("All places")}</button>;
  if (data.error) return <aside className="panel sheet sheet-md p-4">{back}<Notice tone="error">{t(data.error)}</Notice></aside>;
  if (!scene || !data.pack) return <aside className="panel sheet sheet-md p-4">{back}<Spinner label={t("Loading the data pack of this place…")} /></aside>;
  const meta = data.pack.meta, a = meta.areas[k], r = meta.areas[ref], change = a.all.permanent_km2 - r.all.permanent_km2;
  const row = (label: string, x: Areas | undefined, y: Areas | undefined, id: string) => (
    <tr><td className="py-1 font-sans text-slate-300">{t(label)}</td><td className="text-right">{y ? km2(y.permanent_km2) : "—"}</td><td className="text-right" data-testid={id}>{x ? km2(x.permanent_km2) : "—"}</td>
      <td className="text-right text-slate-400">{x && y && y.permanent_km2 > 0 ? `${x.permanent_km2 >= y.permanent_km2 ? "+" : "−"}${Math.abs(((x.permanent_km2 - y.permanent_km2) / y.permanent_km2) * 100).toFixed(0)}%` : "—"}</td></tr>
  );
  return (
    <aside className="panel sheet sheet-md scroll-thin flex flex-col" aria-label={t("Scenario Lab")} data-testid="aral-panel">
      <div className="border-b border-space-700/70 px-4 py-3">
        {back}
        <h2 className="text-sm font-semibold text-slate-100">{t("Scenario Lab — What If?")}</h2>
        <p className="text-[12px] text-slate-300">{t(meta.name)}</p>
        <p className="text-[11.5px] text-warm/90">{t(location.question)}</p>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="font-mono text-2xl text-warm" data-testid="aral-year">{meta.years[k]}</span>
          <span className="font-mono text-[13px] text-slate-300" data-testid="aral-area">{km2(a.all.permanent_km2)} km² {t("of water all year")}</span>
        </div>
        <p className="text-[11px] text-slate-400"><span className="badge border-emerald-400/60 text-emerald-200">{t("Observed")}</span> {t("satellite water map of that year")} · <span className="badge border-teal-300/60 text-teal-100">{t("Derived")}</span> {t("area added up from the map")}</p>
      </div>

      <Section title={t("Choose a year")}>
        <input type="range" className="w-full" min={0} max={years.length - 1} step={1} value={k} aria-label={t("Year")} onChange={(e) => { setPlaying(false); setK(Number(e.target.value)); }} />
        <div className="flex justify-between font-mono text-[10.5px] text-slate-400">{years.map((y) => <span key={y}>{y}</span>)}</div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <button className="btn-warm" data-testid="aral-play" onClick={() => { if (!playing && k >= years.length - 1) setK(0); setPlaying(!playing); }}>{t(playing ? "Pause" : "Play the years")}</button>
          <label className="flex items-center gap-1.5 text-[12px] text-slate-300">{t("Compare with")}
            <select className={selectCls} style={{ width: "auto" }} value={ref} onChange={(e) => setRef(Number(e.target.value))} aria-label={t("Compare with")} data-testid="aral-ref">{years.map((y, i) => <option key={y} value={i}>{y}</option>)}</select></label>
        </div>
        <div className="mt-2 space-y-0.5 text-[11.5px] text-slate-200" data-testid="aral-legend">
          <div className="flex items-center gap-2">{sw(COLOURS[1])}{t("Water in")} {meta.years[k]}</div>
          <div className="flex items-center gap-2">{sw(COLOURS[2])}{t("Water in")} {meta.years[ref]}, {t("not in")} {meta.years[k]}</div>
          <div className="flex items-center gap-2">{sw(COLOURS[4])}{t("Water in")} {meta.years[k]}, {t("not in")} {meta.years[ref]}</div>
          <div className="flex items-center gap-2">{sw(COLOURS[3])}{t("No satellite data in")} {meta.years[k]}</div>
        </div>
      </Section>

      <Section title={t("Water surface area")} right={<span className="badge border-teal-300/60 text-teal-100">{t("Derived")}</span>}>
        <table className="w-full text-[12px]" data-testid="aral-table">
          <thead><tr className="text-right text-slate-400"><th className="text-left font-normal">km²</th><th className="font-normal">{meta.years[ref]}</th><th className="font-normal">{meta.years[k]}</th><th className="font-normal">{t("change")}</th></tr></thead>
          <tbody className="font-mono text-slate-100">
            {row("Whole sea", a.all, r.all, "aral-all")}
            {row("North (Small) Aral Sea", a.north, r.north, "aral-north")}
            {row("South (Large) Aral Sea", a.south, r.south, "aral-south")}
          </tbody>
        </table>
        <p className="mt-1 text-[11.5px] leading-snug text-slate-300" data-testid="aral-change">{k === ref ? t("Choose another year to see the change.") : <>{meta.years[ref]} → {meta.years[k]}: <b className="text-slate-50">{change >= 0 ? "+" : "−"}{km2(Math.abs(change))} km²</b> {t("of water that stays all year.")}</>}</p>
        <p className="mt-1 text-[11px] leading-snug text-slate-400">{t("Water only part of the year (not counted above):")} {km2(a.all.seasonal_km2)} km² {t("in")} {meta.years[k]}.</p>
        {a.all.no_data_km2 > 0.01 * meta.region.area_km2 && <div className="mt-2"><Notice tone="warn">{km2(a.all.no_data_km2)} km² {t("of the sea region have no satellite data in")} {meta.years[k]}. {t("The water area of that year is a lower bound.")}</Notice></div>}
        <p className="mt-2 text-[11px] leading-snug text-slate-400">{t("The North and South Aral Sea are separate lakes with different water levels; they are counted separately and no common level is assumed.")}</p>
      </Section>

      <Section title={t(location.story!.title)}>
        <div className="space-y-1.5 text-[12.5px] leading-snug text-slate-200" data-testid="scenario-story">{location.story!.paragraphs.map((x) => <p key={x}>{t(x)}</p>)}</div>
        <p className="mt-1.5 text-[11px] text-slate-400">{t("After")} NASA Earth Observatory, World of Change: Aral Sea. <a className="text-accent hover:underline" href="https://science.nasa.gov/earth/earth-observatory/world-of-change/aral-sea/" target="_blank" rel="noreferrer">{t("link")}</a></p>
      </Section>

      <Section title={t("What this place cannot show")}>
        <ul className="list-disc space-y-1 pl-4 text-[11.5px] leading-snug text-slate-300" data-testid="aral-limits">
          <li>{t("No water-balance experiment is offered here. Turning river inflow and evaporation into a shoreline needs the shape of the sea bed and a level–area–volume relation for each basin, and none is in this pack.")}</li>
          <li>{t("The maps end in 2021. Nothing here is an observation of a later year, and nothing is a forecast or a restoration plan.")}</li>
          <li>{t("The picture is coarse: each square is about 0.9 km by 0.6 km and is blue when at least half of it was water all year. The areas are added up from the original 30-metre maps.")}</li>
        </ul>
      </Section>

      <details className="border-b border-space-700/70" data-testid="scenario-how">
        <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium text-accent">{t("How does it work?")}</summary>
        <ul className="list-disc space-y-1 px-4 pb-3 pl-8 text-[12px] leading-snug text-slate-200">{location.how.map((x) => <li key={x}>{t(x)}</li>)}</ul>
      </details>
      <details className="border-b border-space-700/70">
        <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium text-accent">{t("Scientific uncertainty and data sources")}</summary>
        <div className="space-y-2 px-4 pb-3 text-[11.5px] leading-snug text-slate-300">
          <p>{t(meta.method)}</p>
          <p>{t(meta.region.note)} ({km2(meta.region.area_km2)} km²)</p>
          <p><b>{t("Water maps:")}</b> {meta.source.name}. {meta.source.citation}. {meta.source.attribution}. {meta.source.licence} {t(meta.source.note)} <a className="text-accent hover:underline" href={meta.source.url} target="_blank" rel="noreferrer">{t("link")}</a></p>
          <p className="text-slate-400">{t("Everything is stored locally: the scenario needs no network.")}</p>
        </div>
      </details>
    </aside>
  );
}
