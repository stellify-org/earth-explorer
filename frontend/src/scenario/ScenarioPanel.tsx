import { t } from "../i18n";
import { create } from "zustand";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { CesiumWidget } from "@cesium/engine";
import { onMainViewer } from "../globe/registry";
import { Notice, Section, Spinner, inputCls } from "../components/ui";
import { HM3, KM2, KM3, SECONDS_PER_DAY, LAND_COVER_WATER, degreeDayMeltMm, floodedByClass, loadPack, simulate, storageOf, type Flood, type NurekMeta, type NurekPack } from "./model";
import { useLabPlace, type ScenarioLocation } from "./locations";
import AralPanel from "./AralPanel";
import { ScenarioScene } from "./scene";
import { BuildingsLegend, BuildingsSection } from "./BuildingsSection";

type Kind = "observed" | "derived" | "modeled" | "hypothetical";
const KIND: Record<Kind, { label: string; cls: string }> = {
  observed: { label: "Observed", cls: "border-emerald-400/60 text-emerald-200" },
  derived: { label: "Derived", cls: "border-teal-300/60 text-teal-100" },
  modeled: { label: "Modeled", cls: "border-sky-400/60 text-sky-200" },
  hypothetical: { label: "Hypothetical", cls: "border-amber-400/70 text-amber-200" },
};
function Tag({ kind }: { kind: Kind }) { return <span className={`badge ${KIND[kind].cls}`}>{t(KIND[kind].label)}</span>; }
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const signed = (x: number, d = 1) => (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toFixed(d);
const mcm = (m3: number, d = 1) => (m3 / HM3).toFixed(d);

interface LabState { ready: boolean; before: boolean; level: number; baseline: number; dam: string; exaggeration: number; outline: boolean; quakes: number }
const useLab = create<LabState & { set: (p: Partial<LabState>) => void }>((set) => ({
  ready: false, before: false, level: 0, baseline: 0, dam: "Nurek Dam", exaggeration: 2, outline: false, quakes: 0, set: (p) => set(p),
}));

function Row({ label, value, kind, sub }: { label: string; value: ReactNode; kind: Kind; sub?: ReactNode }) {
  return (
    <div className="border-b border-space-700/60 py-1.5 last:border-0">
      <div className="flex items-baseline justify-between gap-2"><span className="text-[12px] text-slate-300">{t(label)}</span><Tag kind={kind} /></div>
      <div className="font-mono text-[15px] text-slate-50">{value}</div>
      {sub && <div className="text-[11px] leading-snug text-slate-400">{sub}</div>}
    </div>
  );
}

export function ScenarioOverlay() {
  const { ready, before, level, baseline, dam, exaggeration, outline, quakes, set } = useLab();

  const [open, setOpen] = useState(() => (typeof matchMedia === "function" ? matchMedia("(min-width: 768px)").matches : true));
  if (!ready) return null;
  const sw = (c: string) => <span className="inline-block h-3 w-4 shrink-0 rounded-sm" style={{ background: c }} />;
  const raised = level > baseline;
  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-9 z-10 flex flex-wrap items-end justify-between gap-2">
      <details className="card pointer-events-auto max-w-[250px] p-2.5 text-[11.5px] leading-snug text-slate-200" data-testid="scenario-legend" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary className="label cursor-pointer">{t("Legend")}</summary>
        <div className="h-1" />
        <div className="flex items-center gap-2">{sw("#1d62c9")}{t("Water in the data (baseline)")} · {baseline} m</div>
        <div className="flex items-center gap-2">{sw("#2dd4ec")}{t("Added water (your scenario)")}</div>
        <div className="flex items-center gap-2">{sw("#ffffff")}{t("Original water line")}</div>
        <div className="flex items-center gap-2">{sw("#fb923c")}{t("Scenario water line")}</div>
        <div className="flex items-center gap-2">{sw("#bebec4")}{t(dam)}</div>
        {outline && <div className="flex items-center gap-2">{sw("#e879f9")}{t("Lake outline in OpenStreetMap")}</div>}
        {quakes > 0 && <div className="flex items-center gap-2"><span className="inline-block h-3 w-3 shrink-0 rounded-full border border-white" style={{ background: "#f97316" }} />{t("Earthquake of magnitude 7 or more (USGS)")}</div>}
        <BuildingsLegend />
        <div className="mt-1 text-[10.5px] text-slate-400">{exaggeration === 2 ? t("Terrain heights are drawn ×2 (exaggerated). Distances are true.") : <>{t("Terrain heights are drawn")} ×{exaggeration} {t("(exaggerated). Distances are true.")}</>}</div>
      </details>
      <div className="card pointer-events-auto flex items-center gap-1 p-1" role="group" aria-label={t("Before / After")}>
        {([[true, "Before"], [false, "After"]] as const).map(([b, label]) => (
          <button key={label} aria-pressed={before === b} data-testid={b ? "scenario-before" : "scenario-after"} onClick={() => set({ before: b })}
            className={`min-h-9 rounded-lg px-3 text-[12.5px] ${before === b ? "bg-warm font-semibold text-[#1c1403]" : "text-slate-200 hover:text-white"}`}>
            {t(label)} <span className="font-mono text-[11px] opacity-80">{(b ? baseline : level).toFixed(b ? 0 : 1)} m</span>
          </button>
        ))}
        {!raised && level === baseline && <span className="px-2 text-[11px] text-slate-400">{t("no change yet")}</span>}
      </div>
    </div>
  );
}

export default function ScenarioPanel({ location }: { location: ScenarioLocation }) {
  return location.kind === "history" ? <AralPanel location={location} /> : <WaterPanel location={location} />;
}

function WaterPanel({ location }: { location: ScenarioLocation }) {
  const [viewer, setViewer] = useState<CesiumWidget | null>(null);
  const [data, setData] = useState<Partial<NurekPack> & { error?: string }>({});
  useEffect(() => onMainViewer(setViewer), []);
  useEffect(() => { let on = true; loadPack(location.id).then((d) => on && setData(d), (e) => on && setData({ error: String((e as Error).message ?? e) })); return () => { on = false; }; }, [location.id]);

  const scene = useMemo(() => (viewer && data.meta && data.terrain ? new ScenarioScene(viewer, data.terrain, data.meta, { barrier: data.barrier, outline: data.outline, ...location.scene }) : null), [viewer, data, location]);
  useEffect(() => {
    if (!scene || !data.meta) return;
    const meta = data.meta;
    scene.buildTerrain(); scene.setLabels(t(location.name), meta.labels ? meta.labels.map((l) => ({ ...l, text: t(l.text) })) : t("Nurek Dam")); scene.view();
    useLab.getState().set({ dam: meta.dam.name ?? "Nurek Dam", exaggeration: scene.exaggeration, outline: !!data.outline, quakes: meta.labels?.filter((l) => l.kind === "quake").length ?? 0 });
    const w = window as unknown as { __ee?: Record<string, unknown> };
    w.__ee = { ...(w.__ee ?? {}), scenario: scene };
    return () => { scene.destroy(); useLab.getState().set({ ready: false, before: false }); if (w.__ee) delete w.__ee.scenario; };
  }, [scene, data, location]);

  const back = <button className="mb-2 text-[12px] text-accent hover:underline" data-testid="lab-back" onClick={() => useLabPlace.getState().set(undefined)}>← {t("All places")}</button>;
  if (data.error) return <aside className="panel sheet sheet-md p-4">{back}<Notice tone="error">{t(data.error)}</Notice></aside>;
  if (!scene || !data.meta) return <aside className="panel sheet sheet-md p-4">{back}<Spinner label={t("Loading the data pack of this place…")} /></aside>;
  return <Lab scene={scene} meta={data.meta} landCover={data.landCover} location={location} />;
}

type Tab = "water" | "climate" | "compare";
const TABS: [Tab, string][] = [["water", "Change Water"], ["climate", "Change Climate Inputs"], ["compare", "Compare Results"]];

function Lab({ scene, meta, landCover, location }: { scene: ScenarioScene; meta: NurekMeta; landCover?: Uint8Array; location: ScenarioLocation }) {
  const pub = meta.published, L0 = meta.dem_water.level_m;

  const storage = useMemo(() => storageOf(pub), [pub]);
  const min = storage?.min ?? L0, max = storage?.max ?? L0 + (location.raiseMaxM ?? 20);
  const meanInflow = pub.mean_inflow_m3s?.value ?? (pub.mean_inflow_hm3_per_year ? Math.round((pub.mean_inflow_hm3_per_year.value * HM3) / (365 * SECONDS_PER_DAY)) : 0);

  const evapTable = pub.evaporation_mm_per_month?.values;
  const defaults = { startLevel: L0, inflow: meanInflow, outflow: meanInflow, pFactor: 1, eFactor: 1, evapYear: 0, days: 90, startMonth: 3, snowArea: 0, ddf: 4, snowTemp: 5 };

  const step = Number.isInteger(min * 2) && Number.isInteger(max * 2) ? 0.5 : 0.1;
  const tabs = TABS.filter(([k]) => k !== "climate" || (!!storage && location.features.balance));
  const [tab, setTab] = useState<Tab>("water");

  const [source, setSource] = useState<"level" | "climate">("level");
  const [manual, setManual] = useState(L0);
  const [b, setB] = useState(defaults);
  const before = useLab((s) => s.before);

  const run = useMemo(() => (source === "climate" && storage ? simulate(storage, {
    startLevel: b.startLevel, inflowM3s: b.inflow, outflowM3s: b.outflow, precipitationMmPerDay: meta.precipitation_mm_per_day,
    evaporationMmPerMonth: evapTable ?? DAYS_IN_MONTH.map((d) => (b.evapYear * d) / 365), precipitationFactor: b.pFactor, evaporationFactor: evapTable ? b.eFactor : 1, days: b.days, startMonth: b.startMonth,
    snowmelt: b.snowArea > 0 ? { areaKm2: b.snowArea, degreeDayFactorMmPerCDay: b.ddf, temperatureC: b.snowTemp } : undefined,
  }) : undefined), [source, b, storage, meta, evapTable]);

  const level = run ? run.endLevel : manual;

  const [f, setF] = useState<Flood>(scene.current);
  useEffect(() => {
    const id = requestAnimationFrame(() => { const scenario = scene.setLevel(level); setF(scenario); if (before) scene.setLevel(L0); });
    return () => cancelAnimationFrame(id);
  }, [scene, level, before, L0]);
  useEffect(() => { useLab.getState().set({ ready: true, level, baseline: L0 }); }, [level, L0]);

  const choose = (next: Tab) => {
    if (next === "water" && source === "climate") { setManual(Math.min(max, Math.max(min, Math.round(level / step) * step))); setSource("level"); }
    if (next === "climate" && source === "level") { setB((s) => ({ ...s, startLevel: Math.min(max, Math.max(min, manual)) })); setSource("climate"); }
    setTab(next); useLab.getState().set({ before: false });
  };
  const reset = () => { setSource("level"); setManual(L0); setB(defaults); setTab("water"); useLab.getState().set({ before: false }); scene.view(1.2); };
  const num = (key: keyof typeof b, lo: number, hi: number) => (e: { target: { value: string } }) => { const v = Number(e.target.value); if (Number.isFinite(v)) setB((s) => ({ ...s, [key]: Math.min(hi, Math.max(lo, v)) })); };

  const dLevel = level - L0, dV = storage ? storage.volume(level) - storage.volume(L0) : f.belowData ? 0 : f.volumeAboveBaselineM3;
  const demArea = (f.baselineAreaM2 + f.newAreaM2) / KM2, lawArea = storage ? storage.area(level) / KM2 : NaN;

  const lc = meta.land_cover;
  const cover = useMemo(() => (lc && landCover && !f.belowData && f.newAreaM2 > 0 ? floodedByClass(scene.t, f.mask, landCover) : null), [lc, landCover, f, scene]);
  const slider = (label: string, key: keyof typeof b, lo: number, hi: number, step: number, unit: string, kind: Kind) => (
    <label className="block text-[12px] text-slate-300">
      <span className="flex items-baseline justify-between"><span>{t(label)}</span><span className="font-mono text-slate-100">{unit === "×" ? `×${b[key].toFixed(1)}` : `${b[key]} ${t(unit)}`} <Tag kind={kind} /></span></span>
      <input type="range" className="w-full" min={lo} max={hi} step={step} value={Math.min(hi, b[key])} onChange={num(key, lo, hi)} aria-label={t(label)} />
    </label>
  );

  return (
    <aside className="panel sheet sheet-md scroll-thin flex flex-col" aria-label={t("Scenario Lab")} data-testid="scenario-panel">
      <div className="border-b border-space-700/70 px-4 py-3">
        <button className="mb-1 text-[12px] text-accent hover:underline" data-testid="lab-back" onClick={() => useLabPlace.getState().set(undefined)}>← {t("All places")}</button>
        <h2 className="text-sm font-semibold text-slate-100">{t("Scenario Lab — What If?")}</h2>
        <p className="text-[12px] text-slate-300">{t(meta.name)}</p>
        <p className="text-[11.5px] text-warm/90">{t(location.question)}</p>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="font-mono text-2xl text-warm" data-testid="scenario-level">{level.toFixed(1)} m</span>
          <span className="sr-only" data-testid="scenario-dlevel">{signed(dLevel)} m · {storage?.kind === "table" ? "≈ " : ""}{signed(dV / HM3, 0)} {t("million m³")}</span>
        </div>
        <p className="text-[11px] text-slate-400"><Tag kind="hypothetical" /> {t("water level in your scenario")} · {t("baseline")} {L0} m <Tag kind="observed" /></p>

        <div className="mt-2 grid grid-cols-3 gap-1.5" data-testid="scenario-tiles">
          {([
            ["M12 20V5M6 11l6-6 6 6", "Water level change", `${signed(dLevel)} m`, "hypothetical"],
            ["M5 8c0-1.700 3.100-3 7-3s7 1.300 7 3v8c0 1.700-3.100 3-7 3s-7-1.300-7-3V8ZM5 8c0 1.700 3.100 3 7 3s7-1.300 7-3", "Estimated storage change", `${storage?.kind === "table" ? "≈ " : ""}${signed(dV / HM3, 0)} ${t("million m³")}`, "modeled"],
            ["M3 17c2-2 4 2 6 0s4 2 6 0 4 2 6 0M4 12l5-6 4 4 3-3 4 5", "Estimated newly inundated land", f.belowData ? "—" : `${(f.newAreaM2 / KM2).toFixed(1)} km²`, "modeled"],
          ] as const).map(([path, label, value, kind]) => (
            <div key={label} className="rounded-lg border border-space-600 bg-space-800/60 px-2 py-1.5">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="text-accent" aria-hidden><path d={path} /></svg>
              <div className="mt-0.5 text-[10.5px] leading-tight text-slate-400">{t(label)}</div>
              <div className="font-mono text-[12.5px] leading-tight text-slate-50">{value}</div>
              <div className="mt-0.5"><Tag kind={kind} /></div>
            </div>
          ))}
        </div>
        <p className="mt-1 text-[11px] leading-snug text-slate-400">{t("Flooded land here is geometry: where the water surface meets the terrain. It is not a forecast of damage.")}</p>
        <div className={`mt-2 grid gap-1 ${tabs.length === 3 ? "grid-cols-3" : "grid-cols-2"}`} role="tablist" aria-label={t("Scenario Lab")}>
          {tabs.map(([k, label], i) => (
            <button key={k} role="tab" aria-selected={tab === k} data-testid={`scenario-tab-${k}`} onClick={() => choose(k)}
              className={`min-h-11 rounded-lg border px-1 text-[11.5px] leading-tight ${tab === k ? "border-warm bg-warm/10 text-warm" : "border-space-600 text-slate-200 hover:border-accent"}`}>
              <span className="block font-mono text-[10px] opacity-70">{i + 1}</span>{t(label)}</button>
          ))}
        </div>
      </div>

      {tab === "water" && (
        <Section title={t("Change the Water Level")} right={<Tag kind="hypothetical" />}>
          <input type="range" className="w-full" min={min} max={max} step={step} value={level} aria-label={t("Water level")} onChange={(e) => setManual(Number(e.target.value))} />
          <div className="flex justify-between font-mono text-[10.5px] text-slate-400"><span>{min} m</span><span>{t("baseline")} {L0} m</span><span>{max} m</span></div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button className="btn-warm" onClick={reset} data-testid="scenario-reset">{t("Reset to baseline")}</button>
            <button className="btn-soft" onClick={() => setManual(max)}>{t(storage ? "Full" : "Highest")} {max} m</button>
            {min < L0 && <button className="btn-soft" onClick={() => setManual(min)}>{t("Lowest")} {min} m</button>}
          </div>
          {!storage && <p className="mt-2 text-[11.5px] leading-snug text-slate-400">{t("Only a small rise is offered here. The lake bed is not in any open data, so the water cannot be lowered in this model.")}</p>}
          <p className="mt-2 text-[11.5px] leading-snug text-slate-400"><Tag kind="observed" /> {t("Baseline")} {L0} m: {t("the water surface recorded in the elevation data (SRTM radar survey, February 2000). One past moment, not today's level.")}</p>
        </Section>
      )}

      {tab === "climate" && run && (
        <Section title={t("Climate & Water")} right={<Tag kind="hypothetical" />}>
          <Notice tone="warn">{t("Exploratory water-balance model, not an operational hydrological forecast.")}</Notice>
          <div className="mt-2 space-y-2">
            {slider("River inflow", "inflow", 0, 2000, 10, "m³/s", "hypothetical")}
            {slider("Outflow through the dam", "outflow", 0, 2000, 10, "m³/s", "hypothetical")}
            {slider("Rain on the lake", "pFactor", 0, 3, 0.1, "×", "hypothetical")}
            {evapTable ? slider("Evaporation", "eFactor", 0, 3, 0.1, "×", "hypothetical") : slider("Evaporation from the lake, per year", "evapYear", 0, 2000, 50, "mm", "hypothetical")}
            {slider("How long", "days", 10, 365, 5, "days", "hypothetical")}
          </div>
          <p className="mt-1 text-[11px] leading-snug text-slate-400">{t("More rain on the lake does not change the river inflow here: set the inflow yourself.")}</p>
          <div className="mt-2 rounded-lg border border-space-600 p-2 text-[12px]" data-testid="scenario-balance-result">
            <div className="mb-1 flex items-center justify-between"><span className="label">{t("Water balance over")} {run.days} {t("days")}</span><Tag kind="modeled" /></div>
            <table className="w-full font-mono text-[11.5px] text-slate-200"><tbody>
              <tr><td className="font-sans text-slate-400">{t("River inflow")}</td><td className="text-right">+{mcm(run.inflowM3)}</td></tr>
              {run.snowmeltM3 > 0 && <tr><td className="font-sans text-slate-400">{t("Snowmelt (degree-day)")}</td><td className="text-right">+{mcm(run.snowmeltM3)}</td></tr>}
              <tr><td className="font-sans text-slate-400">{t("Outflow through the dam")}</td><td className="text-right">−{mcm(run.outflowDeliveredM3)}</td></tr>
              <tr><td className="font-sans text-slate-400">{t("Rain on the lake")}</td><td className="text-right">+{mcm(run.precipitationM3, 2)}</td></tr>
              <tr><td className="font-sans text-slate-400">{t("Evaporation")}</td><td className="text-right">−{mcm(run.evaporationM3, 2)}</td></tr>
              {run.spillM3 > 0 && <tr className="text-amber-200"><td className="font-sans">{t("Spill through the spillways (reservoir full)")}</td><td className="text-right" data-testid="scenario-spill">−{mcm(run.spillM3)}</td></tr>}
              {run.unplacedLossM3 > 0 && <tr className="text-amber-200"><td className="font-sans">{t("Loss not taken (at minimum level)")}</td><td className="text-right">+{mcm(run.unplacedLossM3, 2)}</td></tr>}
              <tr className="border-t border-space-600 text-slate-50"><td className="font-sans">{t("Storage change")}</td><td className="text-right" data-testid="scenario-balance-dv">{signed((run.endStorageM3 - run.startStorageM3) / HM3, 1)}</td></tr>
            </tbody></table>
            <p className="mt-1 text-[11px] text-slate-400">{t("million m³")} · {t("level")} {b.startLevel.toFixed(1)} → <b className="text-slate-100">{run.endLevel.toFixed(2)} m</b> · {t("balance check")}: <span data-testid="scenario-closure">{Math.abs(run.closureM3) < 1 ? "0" : run.closureM3.toFixed(0)}</span> m³</p>
            {run.spillM3 > 0 && <p className="mt-1 text-[11.5px] leading-snug text-amber-200">{t("The reservoir reached its full level")} ({max} m) {t("and stayed there for")} {run.daysAtFull} {t("days")}. {t("Water that does not fit is counted as spill; it is not lost from the balance.")}</p>}
            {run.outflowShortfallM3 > 0 && <p className="mt-1 text-[11.5px] leading-snug text-amber-200" data-testid="scenario-shortfall">{t("At the minimum level")} ({min} m) {t("the dam could not release")} {mcm(run.outflowShortfallM3)} {t("million m³")} {t("of the requested outflow")} ({run.daysAtMinimum} {t("days")}).</p>}
          </div>
          <details className="mt-2" data-testid="scenario-advanced">
            <summary className="cursor-pointer text-[12.5px] font-medium text-accent">{t("Advanced")}</summary>
            <p className="mt-2 font-mono text-[11.5px] text-slate-200">dV/dt = Q<sub>in</sub> + Q<sub>melt</sub> − Q<sub>out</sub> + (P − E) · A − {t("spill")}</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11.5px] text-slate-300">
              <label>{t("Inflow, m³/s")}<input type="number" className={inputCls} min={0} max={5000} step={10} value={b.inflow} onChange={num("inflow", 0, 5000)} aria-label={t("Inflow, m³/s")} /></label>
              <label>{t("Outflow, m³/s")}<input type="number" className={inputCls} min={0} max={5000} step={10} value={b.outflow} onChange={num("outflow", 0, 5000)} aria-label={t("Outflow, m³/s")} /></label>
              <label>{t("Rain on the lake, ×")}<input type="number" className={inputCls} min={0} max={5} step={0.1} value={b.pFactor} onChange={num("pFactor", 0, 5)} aria-label={t("Rain on the lake, ×")} /></label>
              {evapTable ? <label>{t("Evaporation, ×")}<input type="number" className={inputCls} min={0} max={5} step={0.1} value={b.eFactor} onChange={num("eFactor", 0, 5)} aria-label={t("Evaporation, ×")} /></label>
                : <label>{t("Evaporation, mm per year")}<input type="number" className={inputCls} min={0} max={3000} step={50} value={b.evapYear} onChange={num("evapYear", 0, 3000)} aria-label={t("Evaporation, mm per year")} /></label>}
              <label>{t("Duration, days")}<input type="number" className={inputCls} min={1} max={365} step={1} value={b.days} onChange={num("days", 1, 365)} aria-label={t("Duration, days")} /></label>
              <label>{t("Start month")}<select className={inputCls} value={b.startMonth} onChange={(e) => setB((s) => ({ ...s, startMonth: Number(e.target.value) }))} aria-label={t("Start month")}>{MONTHS.map((m, i) => <option key={m} value={i}>{t(m)}</option>)}</select></label>
            </div>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] leading-snug text-slate-400">
              {pub.mean_inflow_hm3_per_year && <li><Tag kind="observed" /> {t("Inflow default")} {meanInflow} m³/s = {pub.mean_inflow_hm3_per_year.value} {t("million m³ per year, the published long-term mean. Any other value is your assumption.")}</li>}
              {pub.mean_inflow_m3s && <li><Tag kind="observed" /> {t("Inflow default")} {meanInflow} m³/s: {t("the published long-term mean flow of the river at the dam. Any other value is your assumption.")} ({t(pub.mean_inflow_m3s.where)})</li>}
              <li><Tag kind="hypothetical" /> {t("Outflow default equals the inflow: our assumption of a balanced reservoir, not a measured release.")}</li>
              <li><Tag kind="observed" /> {t("Rain: NASA POWER monthly climatology for the grid cell over the lake. Rain on the lake only; runoff from the mountains is part of the inflow you set and is not computed here.")}</li>
              {pub.evaporation_mm_per_month ? <li><Tag kind="observed" /> {t("Evaporation: the monthly table published in the reservoir operation study")} ({pub.evaporation_mm_per_month.year_total_mm} mm/{t("year")}).</li>
                : <li><Tag kind="hypothetical" /> {t("Evaporation: no published figure was found for this lake. The yearly depth is your own input, spread evenly over the year; 0 means evaporation is left out.")}</li>}
              {storage?.kind === "table" && <li><Tag kind="modeled" /> {t("Lake area for rain and evaporation: the storage change per metre of level, the same at every level in this straight-line estimate")} ({(storage.area(L0) / KM2).toFixed(0)} km²).</li>}
            </ul>
            <div className="mt-3 rounded-lg border border-space-600 p-2">
              <div className="flex items-center justify-between"><span className="label">{t("Optional: seasonal snowmelt")}</span><Tag kind="hypothetical" /></div>
              <p className="mt-1 font-mono text-[11px] text-slate-200">Q<sub>melt</sub> = DDF · max(T − 0 °C, 0) · A<sub>snow</sub></p>
              <div className="mt-1 grid grid-cols-3 gap-2 text-[11px] text-slate-300">
                <label>{t("Snow area, km²")}<input type="number" className={inputCls} min={0} max={30000} step={100} value={b.snowArea} onChange={num("snowArea", 0, 30000)} aria-label={t("Snow area, km²")} /></label>
                <label>{t("DDF, mm/°C/day")}<input type="number" className={inputCls} min={0} max={20} step={0.5} value={b.ddf} onChange={num("ddf", 0, 20)} aria-label={t("DDF, mm/°C/day")} /></label>
                <label>{t("Air temp., °C")}<input type="number" className={inputCls} min={-30} max={30} step={0.5} value={b.snowTemp} onChange={num("snowTemp", -30, 30)} aria-label={t("Air temp., °C")} /></label>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-slate-400">{b.snowArea > 0 ? <>{degreeDayMeltMm(b.ddf, b.snowTemp).toFixed(1)} mm/{t("day")} × {b.snowArea} km² = {((degreeDayMeltMm(b.ddf, b.snowTemp) / 1000) * b.snowArea * KM2 / SECONDS_PER_DAY).toFixed(0)} m³/s. </> : <>{t("Off (snow area 0).")} </>}
                {t("Degree-day (temperature-index) approximation. All three numbers are your assumptions: no snow-cover or mountain temperature data are loaded. The melt is added to the inflow at once and in full, with a constant snow area and temperature, so it is an upper bound, not a snowmelt forecast. The default 4 mm/°C/day is only a starting value for trying the control, not a measurement for this basin.")}</p>
            </div>
          </details>
        </Section>
      )}

      {tab === "compare" && (
        <Section title={t("Compare Results")}>
          <table className="w-full text-[12px]" data-testid="scenario-compare">
            <thead><tr className="text-left text-slate-400"><th className="font-normal" /><th className="font-normal">{t("Before")} <Tag kind="observed" /></th><th className="font-normal">{t("After")} <Tag kind="modeled" /></th></tr></thead>
            <tbody className="font-mono text-slate-100">
              <tr><td className="py-1 font-sans text-slate-300">{t("Water level")}</td><td>{L0} m</td><td>{level.toFixed(1)} m</td></tr>
              <tr><td className="py-1 font-sans text-slate-300">{t("Water surface area")}</td><td>{(scene.baseline.baselineAreaM2 / KM2).toFixed(1)} km²</td><td>{f.belowData ? "—" : `${demArea.toFixed(1)} km²`}</td></tr>
              <tr><td className="py-1 font-sans text-slate-300">{t("Newly flooded land")}</td><td>0 km²</td><td>{f.belowData ? "—" : `${(f.newAreaM2 / KM2).toFixed(1)} km²`}</td></tr>
              <tr><td className="py-1 font-sans text-slate-300">{t("Storage change")}</td><td>0</td><td>{signed(dV / HM3, 0)} {t("million m³")}</td></tr>
              {run && run.spillM3 > 0 && <tr><td className="py-1 font-sans text-slate-300">{t("Spill through the spillways (reservoir full)")}</td><td>—</td><td>{mcm(run.spillM3, 0)} {t("million m³")}</td></tr>}
            </tbody>
          </table>
          {cover && lc && (
            <div className="mt-3 rounded-lg border border-space-600 p-2" data-testid="scenario-landcover">
              <div className="flex items-center justify-between gap-2"><span className="label">{t("Newly flooded cells on a satellite land-cover map of 2021")}</span><Tag kind="modeled" /></div>
              <table className="mt-1 w-full text-[12px]"><tbody className="font-mono text-slate-100">
                {cover.map(({ code, areaM2: a }) => (
                  <tr key={code} data-class={code}><td className="py-0.5 font-sans text-slate-300">{t(code === LAND_COVER_WATER ? "Already water in 2021" : lc.classes[String(code)] ?? `class ${code}`)}</td>
                    <td className="text-right">{(a / KM2).toFixed(2)} km²</td><td className="w-12 text-right text-slate-400">{((a / f.newAreaM2) * 100).toFixed(0)}%</td></tr>
                ))}
              </tbody></table>
              <p className="mt-1 text-[11px] leading-snug text-slate-400">{t("The map is from 2021, when the reservoir stood higher than in the elevation data (February 2000). Cells it shows as water were already under water in 2021: there the satellite map and the elevation model agree. The other rows are an overlap of two maps, not a forecast of vegetation loss.")}</p>
              <p className="mt-1 text-[10.5px] leading-snug text-slate-500">{lc.name}. {lc.attribution}. {lc.licence}.</p>
            </div>
          )}
          <p className="mt-2 text-[11.5px] leading-snug text-slate-400">{t("Use Before / After on the map to switch the picture. “Before” is the water recorded in the elevation data; “After” is your scenario.")}</p>
        </Section>
      )}

      {location.story && (
        <Section title={t(location.story.title)}>
          <div className="space-y-1.5 text-[12.5px] leading-snug text-slate-200" data-testid="scenario-story">{location.story.paragraphs.map((x) => <p key={x}>{t(x)}</p>)}</div>
        </Section>
      )}
      {meta.earthquakes && <Quakes meta={meta} />}
      {pub.facts && (
        <Section title={t("What is known")}>
          <div data-testid="scenario-facts">{pub.facts.map((x) => <Row key={x.label} kind={x.kind ?? "observed"} label={x.label} value={<span className="text-[13.5px]">{t(x.value)}</span>} sub={t(x.where)} />)}</div>
        </Section>
      )}
      {location.features.buildings && <BuildingsSection scene={scene} flood={f} before={before} />}

      <Section title={t("Results")}>
        {storage?.kind === "law" && <Row kind="modeled" label="Estimated storage change" value={<span data-testid="scenario-dv">{signed(dV / HM3, 0)} {t("million m³")} ({signed(dV / KM3, 2)} km³)</span>}
          sub={t("From the published storage law (fitted to 1991–2011 operation). A change, not the volume stored today.")} />}
        {storage?.kind === "table" && <Row kind="modeled" label="Approximate storage change" value={<span data-testid="scenario-dv">≈ {signed(dV / HM3, 0)} {t("million m³")} ({signed(dV / KM3, 2)} km³)</span>}
          sub={<>{t(storage.note)} <span className="text-slate-500">{t(storage.where)}</span></>} />}
        {!storage && !f.belowData && <Row kind="derived" label="Water added above the recorded surface" value={<span data-testid="scenario-dv">{signed(dV / HM3, 0)} {t("million m³")} ({signed(dV / KM3, 2)} km³)</span>}
          sub={t("Added up over the terrain cells between the recorded water surface and your level. Only the layer above the recorded surface: the volume of the lake itself is not known here.")} />}
        {!f.belowData && <Row kind="modeled" label="Newly flooded land" value={<span data-testid="scenario-newarea">{(f.newAreaM2 / KM2).toFixed(1)} km²</span>}
          sub={t("Land in the elevation data that water can reach at this level (cells connected to the lake, about 60 m each).")} />}

        {!f.belowData && <Row kind="modeled" label="Water surface area" value={<>{demArea.toFixed(1)} km²</>}
          sub={storage?.kind === "law" ? <>{t("From the elevation data. The storage law implies")} {lawArea.toFixed(1)} km².</> : t("From the elevation data: cells connected to the lake at or below this level.")} />}
        {storage && !f.belowData && dLevel > 0 && <Row kind="modeled" label="Independent check (elevation data)" value={<>{signed(f.volumeAboveBaselineM3 / HM3, 0)} {t("million m³")}</>}
          sub={<>{t("Volume between the two water surfaces, added up over the terrain cells. Difference from the storage law:")} {signed(((f.volumeAboveBaselineM3 - dV) / dV) * 100, 0)}%.</>} />}
        {f.belowData && <div className="mt-2"><Notice tone="warn">{storage?.kind === "table" ? t("Below the baseline the lake bed is not in the elevation data, so the new shoreline and the land that would fall dry cannot be drawn. The grey wall marks where the unknown bed begins. The storage change is the straight-line estimate.") : t("Below the baseline the lake bed is not in the elevation data, so the new shoreline cannot be drawn. The grey wall marks where the unknown bed begins. The storage change still comes from the published storage law.")}</Notice></div>}
        {f.touchesEdge && <div className="mt-2"><Notice tone="warn">{t("The flooded area reaches the edge of the local data; the area shown is incomplete.")}</Notice></div>}
      </Section>

      <details className="border-b border-space-700/70" data-testid="scenario-how">
        <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium text-accent">{t("How does it work?")}</summary>
        <ul className="list-disc space-y-1 px-4 pb-3 pl-8 text-[12px] leading-snug text-slate-200">{location.how.map((x) => <li key={x}>{t(x)}</li>)}</ul>
      </details>
      <details className="border-b border-space-700/70">
        <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium text-accent">{t("Scientific uncertainty and data sources")}</summary>
        <div className="space-y-2 px-4 pb-3 text-[11.5px] leading-snug text-slate-300">
          <ul className="list-disc space-y-1 pl-4">
            {pub.storage_law && <li>{t("The storage law is an average for 1991–2011. Sediment keeps filling the reservoir, so today's storage for a given level is probably smaller.")}</li>}
            {pub.capacity_surveys_km3 && <li>{t("Published surveys of the total volume differ (km³):")} {pub.capacity_surveys_km3.years.map((y, i) => `${y}: ${pub.capacity_surveys_km3!.total[i].toFixed(2)}`).join(", ")}. {t("The current stored volume is not shown because it is not known here.")}</li>}
            {pub.notes?.map((n) => <li key={n}>{t(n)}</li>)}
            {meta.grid.approx_cell_m < 80 ? <li>{t("Elevation cells are about 60 m wide with heights in whole metres; narrow side valleys are not resolved, so flooded areas are approximate.")}</li>
              : <li>{t("Elevation cells are about 120 m wide with heights in whole metres, so flooded areas are approximate, most of all for changes of a metre or two.")}</li>}
            <li>{t("The elevation data and the published levels use different height systems; they can differ by about a metre.")}</li>
            <li>{t("No waves, flow, dam operation, sediment or groundwater is modelled. Nothing here predicts the future.")}</li>
          </ul>
          <p><b>{t("Elevation:")}</b> {meta.sources.elevation.name}. {meta.sources.elevation.licence}.</p>
          {pub.citation && <p><b>{t("Reservoir figures:")}</b> {pub.citation} <a className="text-accent hover:underline" href={pub.url} target="_blank" rel="noreferrer">PDF</a></p>}
          {pub.references?.map((r) => <p key={r.url}>{r.citation.replace(/,? ?https?:\/\/\S+$/, "")} <a className="text-accent hover:underline" href={r.url} target="_blank" rel="noreferrer">{t("link")}</a></p>)}
          {meta.sources.outline && <p><b>{t("Outlines and names:")}</b> {meta.sources.outline.name}; {meta.sources.outline.attribution}; {meta.sources.outline.licence}. {t(meta.sources.outline.note)}</p>}
          {meta.earthquakes && <p><b>{t("Earthquakes:")}</b> {meta.earthquakes.source}; {t("retrieved")} {meta.earthquakes.retrieved_at.slice(0, 10)}. {t(meta.earthquakes.note)}</p>}
          <p><b>{t("Precipitation:")}</b> {meta.sources.precipitation.name}; {meta.sources.precipitation.period}; {t("retrieved")} {meta.sources.precipitation.retrieved_at.slice(0, 10)}.</p>
          {lc && <p><b>{t("Land cover:")}</b> {lc.name}; {lc.licence}; {lc.attribution}. {t(lc.method)}</p>}
          <p className="text-slate-400">{t("Everything is stored locally: the scenario needs no network.")}</p>
        </div>
      </details>
    </aside>
  );
}

function Quakes({ meta }: { meta: NurekMeta }) {
  const q = meta.earthquakes!, top = [...q.events].sort((a, b) => b.mag - a.mag).slice(0, 6).sort((a, b) => a.time.localeCompare(b.time));
  return (
    <Section title={t("Real earthquakes nearby")} right={<Tag kind="observed" />}>
      <p className="text-[11.5px] leading-snug text-slate-400" data-testid="scenario-quakes">{q.events.length} {t("earthquakes of magnitude 5.5 or more since 1900 within about 100 km (USGS catalog). The six strongest:")}</p>
      <table className="mt-1 w-full text-[12px]"><tbody className="font-mono text-slate-100">
        {top.map((e) => <tr key={e.id}><td className="py-0.5">{e.time.slice(0, 10)}</td><td>M {e.mag.toFixed(1)}</td><td className="text-right text-slate-400">{e.depth_km.toFixed(0)} km {t("deep")}</td></tr>)}
      </tbody></table>
      <p className="mt-1 text-[11px] leading-snug text-slate-400">{t("These are past events from the catalog. Nothing here predicts earthquakes.")}</p>
    </Section>
  );
}
