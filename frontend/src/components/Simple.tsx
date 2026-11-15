import { t } from "../i18n";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ensureLayers, surfaceView, useLowBandwidth, useStore, type GuideId, type Mode } from "../store";
import { geo } from "../geo";
import { getMainViewer } from "../globe/registry";
import { PLACES } from "../lib/places";
import { fmt, fmtLatLon, parseLatLon } from "../lib/format";
import { cssGradient } from "../vis/palettes";
import { friendlyName } from "../indicators/registry";
import type { VisState } from "../vis/useVis";
import { Notice, Spinner, selectCls } from "./ui";
import { useTrend } from "../api/useTrend";
import { TrendIndicators, cellSupport } from "./Investigate";
import ScientificChangeIndicator from "../indicators/ScientificChangeIndicator";

const ICONS: Record<string, ReactNode> = {
  explore: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></>,
  time: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  xray: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5.5" /><circle cx="12" cy="12" r="2" /></>,
  events: <><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 10v5M12 17.5v.5" /></>,
  lab: <><path d="M3 9c3-3 6 3 9 0s6 3 9 0" /><path d="M3 15c3-3 6 3 9 0s6 3 9 0" /><path d="M12 3v3M12 18v3" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></>,
  home: <><path d="M4 11 12 4l8 7" /><path d="M6 10v9h12v-9" /></>,
  tools: <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6" />,
  pin: <><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.800 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></>,
  chart: <path d="M4 20V5M4 20h16M7 16l4-5 3 3 5-7" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.500 2.500M15.500 15.500 18 18M6 18l2.500-2.500M15.500 8.500 18 6" />,
};
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{ICONS[name]}</svg>;
}

export const EXPERIENCES: { mode: Mode; label: string; hint: string }[] = [
  { mode: "explore", label: "Explore Earth", hint: "Spin the globe and pick any place" },
  { mode: "time", label: "Travel in Time", hint: "Watch the planet change since 1981" },
  { mode: "events", label: "Event Detective", hint: "Fires, storms, floods and earthquakes on the globe" },
  { mode: "xray", label: "Inside Earth", hint: "Cut the planet open, see earthquakes" },
  { mode: "lab", label: "What If?", hint: "Raise the water in a real mountain lake" },
];
const exp = (m: Mode) => EXPERIENCES.find((e) => e.mode === m)!;

export type NavGroupId = "explore" | "investigate" | "discover" | "whatif";
export const NAV: { id: NavGroupId; label: string; icon: string; items: typeof EXPERIENCES }[] = [
  { id: "explore", label: "Explore", icon: "explore", items: [exp("explore"), exp("time")] },
  { id: "investigate", label: "Investigate", icon: "chart", items: [] },
  { id: "discover", label: "Discover", icon: "spark", items: [exp("events"), exp("xray")] },
  { id: "whatif", label: "What If?", icon: "lab", items: [exp("lab")] },
];

export function navGroup(mode: Mode, investigating: boolean): NavGroupId {
  if (mode === "lab") return "whatif";
  if (mode === "events" || mode === "xray") return "discover";
  return investigating && mode === "explore" ? "investigate" : "explore";
}

const lastYear = new Date().getUTCFullYear() - 1;
interface Guide { id: GuideId; question: string; step: (hasPlace: boolean, low: boolean) => string; more: string; start: () => void }
export const GUIDES: Guide[] = [
  {
    id: "past", question: "Can you travel 30 years into the past?",
    step: () => "The colours show the average air temperature of one year, 30 years ago. Press ▶ play to travel forward in time, or drag the timeline.",
    more: "Switch to “Difference from normal” to see where a year was warmer or colder than the 1991–2020 average. Every coloured cell is a value from the NASA POWER dataset.",
    start: () => { const s = useStore.getState(); s.setMode("time"); s.setVis({ variable: "t2m", mode: "surface", temporal: "annual", kind: "value" }); s.setDate(`${lastYear - 30}-07-01`); s.startGuide("past"); },
  },
  {
    id: "inside", question: "What's inside our planet?",
    step: () => "The planet is cut open. Click a coloured layer to read how deep it is.",
    more: "Nobody has seen these layers. Their depths come from a reference Earth model built from how earthquake waves travel through the planet. Only the crust is drawn thicker than it really is.",
    start: () => { const s = useStore.getState(); s.openInside("cutaway"); s.startGuide("inside"); },
  },
  {
    id: "quakes", question: "Where do earthquakes happen?",
    step: (_p, low) => low
      ? "Press “Load earthquakes” in the panel. Every dot will be a real earthquake from the USGS catalogue, drawn at the depth where it started."
      : "Every dot is a real earthquake from the USGS catalogue, drawn at the depth where it started. Click a dot to see its strength and date.",
    more: "Bigger dots are stronger earthquakes; darker dots are deeper. Choose another region in the panel to compare. The catalogue lists measured events; it is not a forecast.",
    start: () => { const s = useStore.getState(); s.openInside("quakes"); s.startGuide("quakes"); },
  },
];

export function GuideCard() {
  const id = useStore((s) => s.guide), hasPlace = useStore((s) => !!s.place), startGuide = useStore((s) => s.startGuide);
  const low = useLowBandwidth();
  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [id]);
  const g = GUIDES.find((x) => x.id === id);
  if (!g) return null;
  return (
    <div className="card fade-in absolute bottom-10 left-3 z-10 w-[min(340px,calc(100%-24px))] p-3" role="note" data-testid="guide-card">
      <div className="flex items-start justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-warm"><Icon name="spark" size={15} />{t(g.question)}</h3>
        <button className="-mt-1 -mr-1 p-1 text-slate-400 hover:text-white" onClick={() => startGuide(undefined)} aria-label={t("Close")}><Icon name="close" size={15} /></button>
      </div>
      <p className="mt-1 text-[12.5px] leading-snug text-slate-200">{t(g.step(hasPlace, low))}</p>
      {more && <p className="mt-1.5 text-[12px] leading-snug text-slate-400">{t(g.more)}</p>}
      {!more && <button className="mt-1.5 text-[12px] text-accent hover:underline" onClick={() => setMore(true)}>{t("Learn more")}</button>}
    </div>
  );
}

interface Hit { label: string; lat: number; lon: number; height: number; raw?: boolean }

export function SearchBox() {
  const flyTo = useStore((s) => s.flyTo);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [countries, setCountries] = useState<[string, number, number, number][]>([]);
  const load = () => { setOpen(true); if (!countries.length) geo.loadLabels().then(setCountries).catch(() => {}); };
  const hits = useMemo<Hit[]>(() => {
    const k = q.trim().toLowerCase();
    const places: Hit[] = PLACES.map((p) => ({ ...p, height: 600_000 }));
    if (!k) return places.slice(0, 5);
    const c = parseLatLon(q);
    if (c) return [{ label: fmtLatLon(c.lat, c.lon), ...c, height: 600_000, raw: true }];
    const all = [...places, ...countries.map(([label, lon, lat]) => ({ label, lat, lon, height: 2_500_000 }))];
    const score = (h: Hit) => { const a = h.label.toLowerCase(), b = t(h.label).toLowerCase(); return a.startsWith(k) || b.startsWith(k) ? 0 : a.includes(k) || b.includes(k) ? 1 : 2; };
    return all.map((h) => [score(h), h] as const).filter(([sc]) => sc < 2).sort((a, b) => a[0] - b[0]).slice(0, 7).map(([, h]) => h);
  }, [q, countries]);
  const go = (h: Hit) => { flyTo({ lat: h.lat, lon: h.lon, label: h.raw ? undefined : h.label }, h.height); setQ(""); setOpen(false); (document.activeElement as HTMLElement | null)?.blur(); };
  return (
    <div className="relative w-full text-left" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <label className="card flex items-center gap-2 px-3 py-2 text-slate-300 focus-within:border-accent">
        <Icon name="search" />
        <input className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-400" role="combobox" aria-expanded={open} aria-controls="ee-search-list"
          placeholder={t("Search a country, a place or “lat, lon”")} aria-label={t("Search for a place")} value={q}
          onFocus={load} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onKeyDown={(e) => { if (e.key === "Enter" && hits[0]) go(hits[0]); if (e.key === "Escape") setOpen(false); }} />
      </label>
      {open && (
        <ul id="ee-search-list" role="listbox" className="card absolute top-full right-0 left-0 z-30 mt-1 max-h-64 overflow-y-auto py-1">
          {hits.length === 0 && <li className="px-3 py-2 text-[12.5px] text-slate-400">{t("Nothing found. Try a country name, or click the globe.")}</li>}
          {hits.map((h) => (
            <li key={h.label} role="option" aria-selected={false}>
              <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-slate-100 hover:bg-space-700" onClick={() => go(h)}><Icon name="pin" size={15} />{t(h.label)}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const SECONDARY: { mode: Mode; label: string }[] = [
  { mode: "events", label: "Explore real Earth events" },
  { mode: "time", label: "Travel through time" },
  { mode: "lab", label: "Experiment with nature" },
  { mode: "xray", label: "Discover what's inside Earth" },
];
export function Home() {
  const setMode = useStore((s) => s.setMode), setWelcome = useStore((s) => s.setWelcome), startInvestigation = useStore((s) => s.startInvestigation), setVariable = useStore((s) => s.setVariable);
  const shadow = { textShadow: "0 1px 10px #03060d, 0 0 2px #03060d" };
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-between gap-2 p-3 pb-8 sm:p-5 sm:pb-9" data-testid="home">
      <div className="fade-in w-full max-w-xl text-center">
        <h1 className="text-[26px] leading-tight font-semibold text-slate-50 sm:text-[38px]" style={shadow}>{t("Earth Explorer")}</h1>
        <p className="mt-1 text-[14px] text-slate-200 sm:text-[17px]" style={shadow}>{t("Discover how our planet is changing.")}</p>
      </div>
      <div className="fade-in pointer-events-auto w-full max-w-2xl">
        <div className="card mx-auto max-w-md px-4 py-3 text-center sm:py-4" data-testid="home-featured">
          <h2 className="text-[17px] leading-snug font-semibold text-slate-50 sm:text-[20px]">{t("Is your city getting warmer?")}</h2>
          <p className="mt-1 text-[13px] text-slate-300">{t("Explore decades of real NASA data and find out.")}</p>
          <button className="btn-warm mt-3 inline-flex min-h-11 items-center justify-center gap-2 !px-6 !text-[15px]" data-testid="start-investigating"
            onClick={() => { setVariable("t2m"); startInvestigation(); }}><Icon name="chart" />{t("Start Investigating")}</button>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4 sm:gap-2">
          {SECONDARY.map((e) => (
            <button key={e.mode} data-testid={`home-${e.mode}`} onClick={() => setMode(e.mode)}
              className="card flex min-h-11 items-center gap-2 px-2.5 py-1.5 text-left text-[12.5px] leading-tight text-slate-200 transition-colors hover:border-accent hover:text-white">
              <span className="shrink-0 text-accent"><Icon name={e.mode} size={20} /></span>{t(e.label)}
            </button>
          ))}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-4 text-[12.5px]">
          <button className="min-h-9 px-2 text-slate-300 underline-offset-2 hover:text-white hover:underline" onClick={() => setWelcome(false)} data-testid="home-explore">{t("Just let me look around")}</button>
          <details className="group relative">
            <summary className="flex min-h-9 cursor-pointer list-none items-center px-2 text-slate-300 underline-offset-2 hover:text-white hover:underline" data-testid="more-questions">{t("More questions")}</summary>
            <div className="card absolute bottom-full left-1/2 mb-1 flex w-64 -translate-x-1/2 flex-col gap-1 p-2">
              {GUIDES.map((g) => (
                <button key={g.id} data-testid={`guide-${g.id}`} onClick={g.start} className="min-h-9 rounded-lg px-2 text-left text-[12.5px] text-slate-200 hover:bg-space-700 hover:text-warm">{t(g.question)}</button>
              ))}
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

function PlaceFacts() {
  const place = useStore((s) => s.place), variableId = useStore((s) => s.variableId), startYear = useStore((s) => s.startYear), endYear = useStore((s) => s.endYear);
  const st = useTrend(place, variableId, startYear, endYear);
  if (st.error) return <div className="mt-2"><Notice tone="error">{t(st.error)}</Notice></div>;
  if (!st.data) return <div className="mt-2"><Spinner label={t("Asking NASA POWER…")} /></div>;
  const d = st.data;
  return (
    <div className="mt-2" data-testid="place-facts-result">
      <p className="mb-1.5 text-[12px] text-slate-300">{t(friendly(d.variable.id, d.variable.name))} · {d.result.start_year}–{d.result.end_year}</p>
      <TrendIndicators d={d} compact />
      <p className="mt-1.5 text-[11px] leading-snug text-slate-400">{t(cellSupport(d.variable.spatial_resolution))}</p>
    </div>
  );
}
const friendly = (id: string, name: string) => friendlyName(id, name);

export function PlaceCard() {
  const place = useStore((s) => s.place), setPlace = useStore((s) => s.setPlace), setAnalyze = useStore((s) => s.setAnalyze), openInside = useStore((s) => s.openInside);
  const [facts, setFacts] = useState(false);
  useEffect(() => setFacts(false), [place?.lat, place?.lon]);
  if (!place) return null;
  return (
    <div className="card fade-in scroll-thin absolute bottom-10 left-1/2 z-10 max-h-[70%] w-[min(460px,calc(100%-24px))] -translate-x-1/2 overflow-y-auto p-3" data-testid="place-card">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-warm"><Icon name="pin" />
          <div className="min-w-0">
            {place.label && <div className="truncate text-sm font-semibold text-slate-50">{t(place.label)}</div>}
            <div className={`font-mono ${place.label ? "text-[11px] text-slate-400" : "text-[13px] text-slate-100"}`}>{fmtLatLon(place.lat, place.lon)}</div>
          </div>
        </div>
        <button className="icon-btn -mt-2 -mr-2 text-slate-400 hover:text-white" onClick={() => setPlace(undefined)} aria-label={t("Close")}><Icon name="close" size={16} /></button>
      </div>
      {!facts && <p className="mt-2 text-[12.5px] text-slate-300">{t("See what NASA data show for this place since the 1980s.")}</p>}
      {facts && <PlaceFacts />}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button className="btn-warm inline-flex min-h-10 items-center gap-1.5" onClick={() => setAnalyze(true)} data-testid="analyze"><Icon name="chart" size={16} />{t("Analyze this change")}</button>
        {!facts && <button className="btn-soft min-h-10" onClick={() => setFacts(true)} data-testid="place-facts">{t("Quick look")}</button>}
        <button className="min-h-10 px-1 text-[12.5px] text-accent hover:underline" onClick={() => surfaceView()} title={t("Fly to an oblique view ~30 km above the ground with terrain and satellite imagery")}>{t("See it up close")}</button>
        <button className="min-h-10 px-1 text-[12.5px] text-accent hover:underline" onClick={() => openInside("crust")}>{t("Look underneath")}</button>
      </div>
    </div>
  );
}

export function TimeCard({ vs }: { vs: VisState }) {
  const vis = useStore((s) => s.vis), setVis = useStore((s) => s.setVis), setMode = useStore((s) => s.setMode);
  const variables = useStore((s) => s.variables), setVariable = useStore((s) => s.setVariable);
  const place = useStore((s) => s.place), setAnalyze = useStore((s) => s.setAnalyze);
  const v = vs.variable;
  const units = v?.units_label ?? "";

  const [full, setFull] = useState(() => window.innerWidth >= 640);
  const pick = (id: string) => {
    const x = vs.catalog?.variables.find((c) => c.id === id);
    setVis({ variable: id || undefined, ...(x && !x.modes.includes(vis.mode) ? { mode: x.modes[0] } : {}) });
    if (variables.some((p) => p.id === id)) setVariable(id);
  };
  return (
    <div className="card fade-in absolute top-3 left-3 z-10 w-[min(300px,calc(100%-24px))] p-3" data-testid="time-card">
      <div className="flex items-center justify-between gap-2"><span className="label">{t("What to show")}</span>{vs.frames.loading && <Spinner />}
        <button className="ml-auto text-[12px] text-accent sm:hidden" onClick={() => setFull((f) => !f)} aria-expanded={full}>{full ? t("Less") : t("More")}</button></div>
      {vs.catErr && <Notice tone="warn">{t("Numeric grids unavailable: ")}{vs.catErr}</Notice>}
      <select className={`${selectCls} mt-1`} value={vis.variable ?? ""} onChange={(e) => pick(e.target.value)} aria-label={t("What to show")}>
        {!vis.variable && <option value="">{t("Choose…")}</option>}
        {vs.catalog?.variables.map((x) => <option key={x.id} value={x.id}>{t(x.name)}</option>)}
      </select>
      {v && vs.mode !== "flow" && (
        <>
          {full && v.anomaly && (
            <div className="mt-2 grid grid-cols-2 gap-1 text-[12px]" role="group" aria-label={t("Values or difference")}>
              {([["value", "Measured values"], ["anomaly", "Difference from normal"]] as const).map(([k, label]) => (
                <button key={k} aria-pressed={vs.kind === k} onClick={() => setVis({ kind: k })} title={k === "anomaly" ? t("Value minus the 1991–2020 mean of the same calendar month") : undefined}
                  className={`rounded-lg border px-2 py-1.5 ${vs.kind === k ? "border-warm text-warm" : "border-space-600 text-slate-300 hover:border-accent"}`}>{t(label)}</button>
              ))}
            </div>
          )}
          <div className="mt-2.5">
            <div className="h-2.5 rounded" style={{ background: cssGradient(vs.palette) }} />
            <div className="mt-0.5 flex justify-between font-mono text-[11px] text-slate-300"><span>{fmt(vs.range[0])}</span><span>{units}{vs.kind === "anomaly" ? " vs 1991–2020" : ""}</span><span>{fmt(vs.range[1])}</span></div>
          </div>
          <p className="mt-1 text-[11.5px] text-slate-400">{vs.annual ? t("Year") : t("Month")}: <b className="font-mono text-slate-100">{vs.month ?? "—"}</b>{full && <> · {t("NASA POWER v10, MERRA-2 based ")}</>}</p>
        </>
      )}
      {v && vs.mode === "flow" && (
        <p className="mt-2 text-[11.5px] leading-snug text-slate-400" data-testid="flow-note">{t("Direction and speed of every streak come from NASA data: the monthly-mean wind 10 m above the ground (MERRA-2). The streaks themselves are a drawing aid — they start at random points and are not measurements, and their pace on screen is not real time. A monthly mean is not the wind of one day.")}</p>
      )}
      {vs.frames.error && <Notice tone="error">{t(vs.frames.error)}</Notice>}
      {v && place && vs.mode !== "flow" && <CellIndicator vs={vs} lat={place.lat} lon={place.lon} />}
      <div className="mt-2 flex flex-wrap gap-2">
        {full && <button className="btn-soft" onClick={() => setMode("compare")} data-testid="time-compare">{t("Compare two dates")}</button>}
        {place && <button className="btn-warm inline-flex items-center gap-1.5" onClick={() => setAnalyze(true)}><Icon name="chart" size={16} />{t("Analyze this change")}</button>}
      </div>
      {!place && full && <p className="mt-1.5 text-[11.5px] text-slate-400">{t("Click a place on the globe to open its chart.")}</p>}
    </div>
  );
}

function CellIndicator({ vs, lat, lon }: { vs: VisState; lat: number; lon: number }) {
  const v = vs.variable!, hit = vs.probe(lat, lon);
  const when = vs.month ?? "";
  const support = hit ? `Grid cell ${hit.cell} centred at ${fmtLatLon(hit.lat, hit.lon)}` : undefined;
  if (vs.kind !== "anomaly") {
    return (
      <div className="mt-2 rounded-xl border border-space-600 px-2.5 py-2 text-[12px] text-slate-300" data-testid="cell-value">
        <span className="text-slate-400">{t("At the selected place")} · {when}</span>
        <div className="font-mono text-[15px] text-slate-50">{hit && hit.v !== null && Number.isFinite(hit.v) ? <>{fmt(hit.v)} <span className="font-sans text-[12px] text-slate-200">{v.units_label}</span></> : t("No data for this place and time")}</div>
        {support && <div className="text-[11px] text-slate-400">{support}</div>}
      </div>
    );
  }
  return (
    <div className="mt-2">
      <ScientificChangeIndicator testId="cell-anomaly" compact variable={v.id} indicatorType="anomaly" unit={v.units_label}
        value={hit?.v} dataStatus={hit && hit.v !== null && Number.isFinite(hit.v) ? "ok" : "missing"} timestamp={when}
        referencePeriod={vs.annual ? t("Compared with the 1991–2020 average.") : t("Compared with the 1991–2020 average for this month.")}
        sourceMetadata={{ provider: v.source, support }} />
    </div>
  );
}

export function MapTools() {
  const s = useStore();
  const low = useLowBandwidth();
  const [open, setOpen] = useState(false);
  const sat = s.satelliteId === "BlueMarble_NextGeneration";
  const toggleSat = async () => {
    if (s.satelliteId) return s.setSatellite(undefined);
    if (low && !window.confirm(t("Low Bandwidth Mode is on. Satellite imagery downloads about 1 MB for each new view. Continue?"))) return;
    await ensureLayers().catch(() => {});
    s.setSatellite("BlueMarble_NextGeneration");
  };
  const items: [string, boolean, () => void][] = [
    ["Country names", s.showLabels, () => s.toggle("showLabels")],
    ["Borders", s.showBorders, () => s.toggle("showBorders")],
    ["Rivers", s.showRivers, () => s.toggle("showRivers")],
    ["Shaded relief", s.baseStyle === "relief", () => s.setBaseStyle(s.baseStyle === "relief" ? "vector" : "relief")],
    ["Satellite photo (needs internet)", sat || !!s.satelliteId, toggleSat],
  ];
  const tool = "card icon-btn text-slate-200 hover:border-accent hover:text-accent";
  return (
    <div className="absolute top-3 right-3 z-10 flex flex-col items-end gap-2">
      <button className={tool} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={t("Map layers")} title={t("Map layers")} data-testid="map-layers"><Icon name="layers" /></button>
      {open && (
        <div className="card fade-in w-60 p-2" role="group" aria-label={t("Map layers")}>
          {items.map(([label, on, fn]) => (
            <label key={label} className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-2 text-[13px] text-slate-200 hover:bg-space-700">
              <input type="checkbox" checked={on} onChange={fn} className="h-4 w-4 accent-[#22d3ee]" />{t(label)}
            </label>
          ))}
          <button className="mt-1 w-full rounded px-2 py-1.5 text-left text-[12px] text-accent hover:bg-space-700" onClick={() => { s.setAdvanced(true); setOpen(false); }}>{t("More layers and settings → Advanced tools")}</button>
        </div>
      )}
      <button className={tool} onClick={() => getMainViewer()?.camera.flyHome(1.2)} aria-label={t("Reset view")} title={t("Reset view")} data-testid="reset-view"><Icon name="home" /></button>
      <button className={`${tool} ${s.advanced ? "!border-warm !text-warm" : ""}`} onClick={() => s.setAdvanced(!s.advanced)} aria-pressed={s.advanced} aria-label={t("Advanced tools")} title={t("Advanced tools")} data-testid="advanced-toggle"><Icon name="tools" /></button>
    </div>
  );
}
