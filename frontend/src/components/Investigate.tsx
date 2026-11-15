import { t } from "../i18n";
import { useEffect, useState, type ReactNode } from "react";
import { useStore } from "../store";
import { PLACES } from "../lib/places";
import { fmtLatLon } from "../lib/format";
import { friendlyName, indicatorFor, latestAnomaly, nearNormalBand } from "../indicators/registry";
import ScientificChangeIndicator, { AnomalyVsTrend, IndicatorGlyph } from "../indicators/ScientificChangeIndicator";
import type { TrendResponse } from "../api/types";
import { Icon, SearchBox } from "./Simple";

export const lastFullYear = () => new Date().getUTCFullYear() - 1;

export function monthLabel(year: number, month: number): string {
  try { return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" }); } catch { return `${year}-${String(month).padStart(2, "0")}`; }
}
function monthOnly(month: number): string {
  try { return new Date(Date.UTC(2001, month - 1, 1)).toLocaleDateString("en", { month: "long", timeZone: "UTC" }); } catch { return String(month); }
}

export function cellSupport(resolution: string): string {
  return `One model grid cell that contains this point (${resolution}) — an area tens of kilometres wide, not one street or building.`;
}

export function TrendIndicators({ d, compact }: { d: TrendResponse; compact?: boolean }) {
  const r = d.result, tr = r.trend, u = d.variable.units_label;
  const last = latestAnomaly(r.points);
  const src = { provider: `${r.provenance.provider} (${(r.provenance.upstream_sources ?? []).join(", ")})`, support: cellSupport(d.variable.spatial_resolution), url: r.provenance.request_url };
  const noTrend = !tr || tr.verdict.code === "insufficient_data";
  return (
    <div className={compact ? "grid gap-2 sm:grid-cols-2" : "grid gap-2"}>
      <ScientificChangeIndicator testId="ind-trend" compact={compact} variable={d.variable.id} indicatorType="trend" unit={u}
        value={noTrend ? null : tr.primary.slope_per_decade} dataStatus={noTrend ? "missing" : "ok"} statisticalVerdict={tr?.verdict.code}
        timestamp={`${r.start_year}–${r.end_year}`}
        referencePeriod={t("Rate of change over the whole period.")}
        note={!noTrend && !compact ? <>{t("95% range ")}<span className="font-mono">{fmtRange(tr.primary.ci_low_per_decade, tr.primary.ci_high_per_decade, indicatorFor(d.variable.id).digits.trend)}</span> {u}{t(" per decade")}</> : undefined}
        sourceMetadata={src} />
      <ScientificChangeIndicator testId="ind-anomaly" compact={compact} variable={d.variable.id} indicatorType="anomaly" unit={u}
        value={last?.anomaly} dataStatus={last ? "ok" : "missing"} nearNormal={last ? nearNormalBand(r.points, last.month) : undefined}
        timestamp={last ? monthLabel(last.year, last.month) : undefined}
        referencePeriod={last ? t("Compared with the {0}–{1} average for {2}.").replace("{0}", String(r.start_year)).replace("{1}", String(r.end_year)).replace("{2}", monthOnly(last.month)) : undefined}
        sourceMetadata={src} />
      {!compact && <AnomalyVsTrend />}
    </div>
  );
}
function fmtRange(lo: number | null, hi: number | null, digits: number): string {
  const f = (x: number | null) => x === null || !Number.isFinite(x) ? "n/a" : (x < 0 ? "−" : "") + Math.abs(x).toFixed(digits);
  return `${f(lo)} ${t("to")} ${f(hi)}`;
}

type Preset = "full" | "last30" | "custom";

export function PeriodPicker({ compact }: { compact?: boolean }) {
  const variableId = useStore((s) => s.variableId), variables = useStore((s) => s.variables);
  const startYear = useStore((s) => s.startYear), endYear = useStore((s) => s.endYear), setPeriod = useStore((s) => s.setPeriod);
  const first = variables.find((v) => v.id === variableId)?.coverage_start_year ?? 1981, last = lastFullYear();
  const from30 = Math.max(first, last - 29);
  const matched: Preset = startYear === first && endYear === last ? "full" : startYear === from30 && endYear === last ? "last30" : "custom";
  const [custom, setCustom] = useState(matched === "custom");
  const active: Preset = custom ? "custom" : matched;
  const [a, setA] = useState(String(startYear)), [b, setB] = useState(String(endYear));
  useEffect(() => { setA(String(startYear)); setB(String(endYear)); }, [startYear, endYear]);
  const na = Number(a), nb = Number(b);
  const problem = !Number.isInteger(na) || !Number.isInteger(nb) ? "Enter whole years."
    : na < first || nb > last ? `The record for this variable covers ${first} to ${last}.`
    : nb < na ? "The last year must not be before the first year." : undefined;
  const apply = (x: string, y: string) => { const p = Number(x), q = Number(y); if (Number.isInteger(p) && Number.isInteger(q) && p >= first && q <= last && q >= p) setPeriod(p, q); };
  const presets: [Preset, string, string, () => void][] = [
    ["full", "Full available record", `${first}–${last}`, () => { setCustom(false); setPeriod(first, last); }],
    ["last30", "Last 30 years", `${from30}–${last}`, () => { setCustom(false); setPeriod(from30, last); }],
    ["custom", "Custom period", "", () => setCustom(true)],
  ];
  const yearCls = "min-h-10 w-20 rounded-lg border border-space-600 bg-space-800 px-2 text-center font-mono text-sm text-slate-100 outline-none focus:border-accent";
  return (
    <div data-testid="period-picker">
      <div className={`grid gap-1.5 ${compact ? "grid-cols-3" : "grid-cols-1 sm:grid-cols-3"}`} role="group" aria-label={t("Time period")}>
        {presets.map(([k, label, years, fn]) => (
          <button key={k} type="button" aria-pressed={active === k} onClick={fn} data-testid={`period-${k}`}
            className={`min-h-10 rounded-lg border px-2 py-1 text-[12px] leading-tight ${active === k ? "border-accent bg-accent/15 text-accent" : "border-space-600 bg-space-800 text-slate-200 hover:border-accent/60"}`}>
            <span className="block">{t(label)}</span>{years && <span className="block font-mono text-[10.5px] opacity-80">{years}</span>}
          </button>
        ))}
      </div>
      {active === "custom" && (
        <div className="mt-2">
          <div className="flex items-center gap-2 text-[12.5px] text-slate-300">
            <input className={yearCls} type="number" inputMode="numeric" min={first} max={last} value={a} aria-label={t("First year")} data-testid="period-start" onChange={(e) => { setA(e.target.value); apply(e.target.value, b); }} />
            <span aria-hidden>–</span>
            <input className={yearCls} type="number" inputMode="numeric" min={first} max={last} value={b} aria-label={t("Last year")} data-testid="period-end" onChange={(e) => { setB(e.target.value); apply(a, e.target.value); }} />
          </div>
          {problem ? <p className="mt-1 text-[11.5px] text-amber-200" role="alert">{t(problem)}</p> : <p className="mt-1 text-[11.5px] text-slate-400">{t(`The record for this variable covers ${first} to ${last}.`)}</p>}
        </div>
      )}
    </div>
  );
}

function Step({ n, title, summary, open, onOpen, children }: { n: number; title: string; summary?: string; open: boolean; onOpen: () => void; children: ReactNode }) {
  return (
    <section className="border-t border-space-700/70 first:border-t-0" data-testid={`inv-step-${n}`}>
      <button type="button" className="flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left" aria-expanded={open} onClick={onOpen}>
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${open ? "bg-warm text-[#1c1403]" : summary ? "bg-accent/20 text-accent" : "bg-space-700 text-slate-300"}`} aria-hidden>{n}</span>
        <span className="min-w-0 flex-1">
          <span className={`block text-[13.5px] ${open ? "font-semibold text-slate-50" : "text-slate-200"}`}>{t(title)}</span>
          {!open && summary && <span className="block truncate text-[12px] text-accent">{summary}</span>}
        </span>
        {!open && <span className="text-[12px] text-slate-400">{summary ? t("Change") : ""}</span>}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </section>
  );
}

export default function Investigate() {
  const place = useStore((s) => s.place), flyTo = useStore((s) => s.flyTo);
  const variables = useStore((s) => s.variables), variableId = useStore((s) => s.variableId), setVariable = useStore((s) => s.setVariable);
  const startYear = useStore((s) => s.startYear), endYear = useStore((s) => s.endYear);
  const setAnalyze = useStore((s) => s.setAnalyze), setInvestigate = useStore((s) => s.setInvestigate), catalogError = useStore((s) => s.catalogError);
  const [step, setStep] = useState(place ? 2 : 1);

  useEffect(() => { if (place) setStep((s) => (s === 1 ? 2 : s)); }, [place?.lat, place?.lon]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = variables.find((x) => x.id === variableId);
  const placeName = place ? (place.label ? t(place.label) : fmtLatLon(place.lat, place.lon)) : undefined;

  return (
    <div className="card fade-in absolute bottom-8 left-3 z-10 flex max-h-[64%] w-[min(380px,calc(100%-24px))] flex-col overflow-hidden sm:top-3 sm:bottom-auto sm:max-h-[calc(100%-24px)]" data-testid="investigate" role="region" aria-label={t("Investigation")}>
      <div className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-1.5">
        <h2 className="flex items-center gap-2 text-[14px] font-semibold text-warm"><Icon name="chart" size={17} />{t("Start an investigation")}</h2>
        <button className="icon-btn -my-1.5 -mr-2 text-slate-400 hover:text-white" onClick={() => setInvestigate(false)} aria-label={t("Close")} data-testid="investigate-close"><Icon name="close" size={16} /></button>
      </div>
      <div className="scroll-thin min-h-0 overflow-y-auto">
        <Step n={1} title="Where should we investigate?" summary={placeName} open={step === 1} onOpen={() => setStep(1)}>
          <SearchBox />
          <p className="mt-2 text-[12.5px] text-slate-300">{t("Or click any place on the globe.")}</p>
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={t("Suggested places")}>
            {PLACES.slice(0, 6).map((p) => (
              <button key={p.label} type="button" className="min-h-9 rounded-full border border-space-600 bg-space-800 px-3 text-[12px] text-slate-200 hover:border-accent" onClick={() => flyTo({ lat: p.lat, lon: p.lon, label: p.label })}>{t(p.label).split(",")[0]}</button>
            ))}
          </div>
          {placeName && <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-slate-100" data-testid="inv-place"><span className="text-warm"><Icon name="pin" size={15} /></span>{placeName}<button type="button" className="ml-auto text-[12px] text-accent hover:underline" onClick={() => setStep(2)}>{t("Next")}</button></p>}
          <details className="mt-2 text-[11.5px] leading-snug text-slate-400">
            <summary className="cursor-pointer hover:text-slate-200">{t("What can I search for?")}</summary>
            <p className="mt-1">{t("The search knows country names, ten example places and coordinates such as “38.56, 68.78”. It works without internet, so it has no list of towns: for your own town, click it on the globe.")}</p>
          </details>
        </Step>

        <Step n={2} title="What would you like to investigate?" summary={v ? t(friendlyName(v.id, v.name)) : undefined} open={step === 2} onOpen={() => setStep(2)}>
          {variables.length === 0 && <p className="text-[12.5px] text-slate-400">{catalogError ? t("The list of variables could not be loaded.") : t("Loading…")}</p>}
          <div className="grid grid-cols-2 gap-1.5" role="group" aria-label={t("Variable")}>
            {variables.map((x) => (
              <button key={x.id} type="button" aria-pressed={x.id === variableId} title={`${t(x.name)} (${x.units_label})`} data-testid={`inv-var-${x.id}`}
                onClick={() => { setVariable(x.id); setStep(3); }}
                className={`flex min-h-11 items-center gap-2 rounded-lg border px-2.5 text-left text-[12.5px] leading-tight ${x.id === variableId ? "border-accent bg-accent/15 text-accent" : "border-space-600 bg-space-800 text-slate-200 hover:border-accent/60"}`}>
                <IndicatorGlyph name={indicatorFor(x.id).icon.neutral} size={20} />{t(friendlyName(x.id, x.name))}
              </button>
            ))}
          </div>
          {v && (
            <details className="mt-2 text-[11.5px] leading-snug text-slate-400">
              <summary className="cursor-pointer hover:text-slate-200">{t("Scientific name")}</summary>
              <p className="mt-1 text-slate-300">{t(v.name)} · {v.units_label} · {v.provider} <code>{v.provider_parameter}</code></p>
              <p className="mt-0.5">{t(v.description)}</p>
              <p className="mt-0.5">{t("Grid: ")}{v.spatial_resolution}</p>
            </details>
          )}
        </Step>

        <Step n={3} title="How far back should we look?" summary={`${startYear}–${endYear}`} open={step === 3} onOpen={() => setStep(3)}>
          <PeriodPicker />
        </Step>
      </div>
      <div className="border-t border-space-700/70 p-3">
        <button type="button" className="btn-warm flex min-h-11 w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50" disabled={!place || !v} data-testid="analyze-changes"
          onClick={() => { setAnalyze(true); setInvestigate(false); }}><Icon name="chart" size={17} />{t("Analyze Changes")}</button>
        {!place && <p className="mt-1.5 text-center text-[11.5px] text-slate-400">{t("Choose a place first.")}</p>}
      </div>
    </div>
  );
}
