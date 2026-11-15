import { t } from "../i18n";
import { useEffect, useState } from "react";
import type { TrendResponse } from "../api/types";
import { useTrend } from "../api/useTrend";
import { friendlyName, trendEvidence, trendHeadline } from "../indicators/registry";
import { PeriodPicker, TrendIndicators, cellSupport } from "./Investigate";
import { Icon } from "./Simple";
import { useStore } from "../store";
import { fmt, fmtLatLon, fmtP, fmtSigned } from "../lib/format";
import { KindBadge, Notice, Section, Spinner, selectCls } from "./ui";
import TrendChart from "./TrendChart";
import SaveOffline from "./SaveOffline";

const EVIDENCE_STYLE: Record<string, string> = {
  detected: "border-emerald-400/50 bg-emerald-400/10 text-emerald-100",
  weak: "border-amber-400/40 bg-amber-400/5 text-amber-100",
  inconclusive: "border-amber-400/50 bg-amber-400/10 text-amber-100",
  none: "border-slate-400/40 bg-slate-400/10 text-slate-100",
  unknown: "border-slate-500/40 bg-slate-500/10 text-slate-200",
};

function toCSV(d: TrendResponse): string {
  const r = d.result;
  const head = [
    `# Earth Explorer export — ${d.variable.name} (${d.variable.units_label})`,
    `# location: lat ${d.location.lat}, lon ${d.location.lon}; ${d.location.cell_note}`,
    `# source: ${r.provenance.provider} ${r.provenance.api_version ?? ""}, parameter ${r.provenance.parameter}, upstream ${(r.provenance.upstream_sources ?? []).join("+")}`,
    `# request: ${r.provenance.request_url}`,
    `# retrieved: ${r.provenance.retrieved_at}; computed: ${r.method.computed_at}; code: ${r.method.code_version}`,
    `# anomaly baseline: ${r.method.baseline}`,
    "date,value,anomaly",
  ];
  const rows = r.points.map((p) => `${p.date},${p.value ?? ""},${p.anomaly ?? ""}`);
  return [...head, ...rows].join("\n");
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function TrendPanel() {
  const { place, variableId, startYear, endYear, variables, setVariable, setAnalyze, advanced, eventReturn, setMode, setEventReturn, startInvestigation } = useStore();
  const [details, setDetails] = useState(advanced);
  useEffect(() => setDetails(advanced), [advanced]);
  const state = useTrend(place, variableId, startYear, endYear);

  const d = state.data;
  const r = d?.result;
  const tr = r?.trend;
  const u = d?.variable.units_label ?? "";
  const placeName = place ? (place.label ? t(place.label) : fmtLatLon(place.lat, place.lon)) : "";

  const subject = place?.label ? t(place.label).split(",")[0] : t("This place");

  return (
    <aside className="panel sheet sheet-lg scroll-thin flex flex-col" aria-label={t("Analyze this change")} data-testid="trend-panel">
      <div className="flex items-start justify-between gap-2 border-b border-space-700/70 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold text-slate-50">{placeName}</h2>
          <p className="text-[11.5px] text-slate-400">{t("Trend Detective")} · {t("Analyze this change")}</p>
        </div>
        <div className="flex items-center gap-2">
          {state.loading && <Spinner label={t("NASA POWER…")} />}
          <button className="icon-btn -my-2 -mr-2 text-slate-400 hover:text-white" onClick={() => setAnalyze(false)} aria-label={t("Close")} data-testid="trend-close">✕</button>
        </div>
      </div>
      {eventReturn && (
        <div className="border-b border-space-700/70 px-4 py-2">
          <button className="btn-soft min-h-10 w-full truncate text-left" data-testid="back-to-event" onClick={() => { setMode("events"); setEventReturn(undefined); }}>← {t("Back to the event")}: {eventReturn.title}</button>
          <p className="mt-1 text-[11.5px] leading-snug text-slate-400">{t("The long-term record of this grid cell is background. It does not show what caused the event.")}</p>
        </div>
      )}
      <div className="space-y-2 border-b border-space-700/70 px-4 py-2.5">
        <select className={`${selectCls} min-h-10`} value={variableId} onChange={(e) => setVariable(e.target.value)} aria-label={t("What to analyze")} data-testid="trend-variable">
          {variables.map((v) => <option key={v.id} value={v.id}>{t(friendlyName(v.id, v.name))} — {t(v.name)} ({v.units_label})</option>)}
        </select>
        <PeriodPicker compact />
      </div>
      {state.error && <div className="p-4"><Notice tone="error">{t(state.error)}</Notice></div>}
      {!d && state.loading && <p className="px-4 py-6 text-[12.5px] text-slate-400">{t("Reading the record for this place…")}</p>}

      {d && r && (
        <div className={state.loading ? "opacity-50 transition" : "transition"}>
          <section className="border-b border-space-700/70 px-4 py-3">
            {tr && (
              <div className={`rounded-xl border px-3 py-2.5 ${EVIDENCE_STYLE[trendEvidence(tr.verdict.code)]}`} data-testid="trend-plain" data-verdict={tr.verdict.code}>
                <div className="text-[17px] leading-snug font-semibold text-slate-50">{t(trendHeadline(d.variable.id, tr.verdict.code, tr.primary.slope_per_decade, subject))}</div>
                <p className="mt-0.5 text-[12px] text-slate-300">{t("Based on the selected historical NASA data.")} {t(friendlyName(d.variable.id, d.variable.name))}, {r.start_year}–{r.end_year}.</p>
              </div>
            )}
            <div className="mt-2"><TrendIndicators d={d} /></div>
            <div className="mt-3"><TrendChart r={r} unit={u} /></div>
            {tr && (
              <>
                <h3 className="mt-3 text-[13px] font-semibold text-slate-100">{t("What does this mean?")}</h3>
                <p className="mt-1 text-[12.5px] leading-snug text-slate-200"><b>{t(tr.verdict.label)}.</b> {t(tr.verdict.explanation)}</p>
                <p className="mt-1.5 text-[12px] leading-relaxed text-slate-300">{t(tr.summary)}</p>
                <p className="mt-1.5 text-[12px] leading-snug text-slate-400">{t(tr.causality_note)}</p>
              </>
            )}
            {r.warnings && r.warnings.length > 0 && <p className="mt-2 text-[11.5px] text-amber-200">{t(`This result has ${r.warnings.length} known limitations — see “How do we know?”.`)}</p>}
            <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px] text-slate-400">{t("Source: ")}{r.provenance.provider} ({(r.provenance.upstream_sources ?? []).join(", ")}) <KindBadge kind={d.variable.data_kind} /></p>
            <p className="mt-1 text-[11.5px] leading-snug text-slate-400">{t(cellSupport(d.variable.spatial_resolution))}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button className="btn-soft inline-flex min-h-10 items-center gap-1.5" onClick={startInvestigation} data-testid="new-investigation"><Icon name="search" size={15} />{t("New investigation")}</button>
            </div>
            <SaveOffline path="/trends" params={{ variable: d.variable.id, lat: round(d.location.lat), lon: round(d.location.lon), start: r.start_year, end: r.end_year }} data={d} title={t(d.variable.name)} kind="trend" />
          </section>

          <details open={details} onToggle={(e) => setDetails(e.currentTarget.open)} data-testid="trend-details">
            <summary className="flex min-h-11 cursor-pointer items-center px-4 text-[13.5px] font-medium text-accent">{t("How do we know?")}</summary>
            <p className="px-4 pb-2 text-[11.5px] leading-snug text-slate-400">{t("Statistical tests, confidence interval, method, data source, limits and downloads.")}</p>
            <Section title={t("Series")}>
              <p className="font-mono text-[11px] text-slate-400">{fmtLatLon(d.location.lat, d.location.lon)} · {r.start_year}–{r.end_year} · {r.coverage.n_valid}/{r.coverage.n_months}{t(" months valid ")}{d.location.elevation_m !== undefined && <>{t(" · elev. ")}{fmt(d.location.elevation_m, 4)}{t(" m")}<sup title={d.location.elevation_note}>†</sup></>}</p>
              {tr && tr.verdict.code !== "insufficient_data" && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Stat label={t("Rate of change")} value={`${fmtSigned(tr.primary.slope_per_decade)} ${u}/decade`} sub={t(`95% CI ${fmt(tr.primary.ci_low_per_decade)} to ${fmt(tr.primary.ci_high_per_decade)}`)} />
                  <Stat label={t("Total change (fitted)")} value={`${fmtSigned(tr.practical.total_change)} ${u}`} sub={t(`over ${tr.practical.span_years.toFixed(1)} years`)} />
                </div>
              )}
            </Section>
            {tr && (
              <>
              {tr.verdict.code !== "insufficient_data" && (
                <Section title={t("Statistical evidence")}>
                  <table className="w-full text-[11.5px]">
                    <thead className="text-left text-slate-400"><tr><th className="font-normal">{t("Test")}</th><th className="font-normal">{t("Slope /decade")}</th><th className="text-right font-normal">{t("p")}</th></tr></thead>
                    <tbody className="font-mono text-slate-200">
                      <Row name={t("OLS, AR(1)-adjusted ★")} slope={tr.primary.slope_per_decade} p={tr.primary.p_value} />
                      <Row name={t("Modified Mann-Kendall ★ / Sen")} slope={tr.mann_kendall.sen_slope_per_decade} p={tr.mann_kendall.p_value} />
                      {tr.seasonal_kendall && <Row name={t("Seasonal Kendall")} slope={tr.seasonal_kendall.sen_slope_per_decade} p={tr.seasonal_kendall.p_value} />}
                      {tr.annual_ols && <Row name={t("OLS on annual means")} slope={tr.annual_ols.slope_per_decade} p={tr.annual_ols.p_value} />}
                      <Row name={t("OLS, naive (ignores autocorr.)")} slope={tr.primary.slope_per_decade} p={tr.primary.p_value_naive} muted />
                      <Row name={t("Original MK (ignores autocorr.)")} slope={null} p={tr.mann_kendall_unadjusted.p_value} muted />
                    </tbody>
                  </table>
                  <p className="mt-2 text-[10.5px] leading-snug text-slate-400">{t(" ★ used for the verdict. n = ")}{tr.primary.n}{t(" months; lag-1 autocorrelation r₁ = ")}{fmt(tr.primary.lag1_autocorrelation)}{t("; effective sample size n_eff = ")}{fmt(tr.primary.n_eff, 4)}{t(". Naive p-values are shown only to illustrate how ignoring autocorrelation overstates confidence. ")}</p>
                  {tr.sensitivity && tr.sensitivity.length > 0 && (
                    <div className="mt-2 space-y-0.5 text-[11px] text-slate-300">
                      <div className="label">{t("Endpoint sensitivity")}</div>
                      {tr.sensitivity.map((s) => (
                        <div key={s.label} className="flex justify-between font-mono"><span className="font-sans text-slate-400">{t(s.label)} ({s.start_year}–{s.end_year})</span><span>{fmtSigned(s.slope_per_decade)}{t(" · p ")}{fmtP(s.p_value)}</span></div>
                      ))}
                    </div>
                  )}
                </Section>
              )}

              {tr.verdict.code !== "insufficient_data" && (
                <Section title={t("Statistical vs practical significance")}>
                  <p className="text-[11.5px] text-slate-200">{t(" Fitted change ")}{fmtSigned(tr.practical.total_change)} {u}{t(" vs typical year-to-year variability ±")}{fmt(tr.practical.interannual_sd)} {u}
                    {" "}{t("→ ratio ")}<b className="font-mono">{fmt(tr.practical.change_to_variability_ratio)}</b>.
                  </p>
                  <p className="mt-1 text-[10.5px] leading-snug text-slate-400">{t(tr.practical.explanation)}</p>
                </Section>
              )}
              </>
            )}

            {r.warnings && r.warnings.length > 0 && (
              <Section title={t(`Limitations & warnings (${r.warnings.length})`)}>
                <ul className="list-disc space-y-1 pl-4 text-[11px] leading-snug text-amber-100/90">
                  {r.warnings.map((w, i) => <li key={i}>{t(w)}</li>)}
                </ul>
                <p className="mt-2 text-[10.5px] text-slate-400">{t(d.location.cell_note)}</p>
              </Section>
            )}

          <Section title={t("Method & provenance")} right={
              <div className="flex gap-2">
                <button className="text-[11px] text-accent hover:underline" onClick={() => download(`earth-explorer_${d.variable.id}_${d.location.lat}_${d.location.lon}_${r.start_year}-${r.end_year}.csv`, toCSV(d), "text/csv")}>{t("CSV")}</button>
                <button className="text-[11px] text-accent hover:underline" onClick={() => download(`earth-explorer_${d.variable.id}_result.json`, JSON.stringify(d, null, 2), "application/json")}>{t("JSON")}</button>
              </div>}>
              <details className="text-[11px] text-slate-300">
                <summary className="cursor-pointer text-slate-200">{t("How this was computed")}</summary>
                <p className="mt-1">{t(r.method.deseasonalization)}{t(" Baseline: ")}{r.method.baseline}.</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">{r.method.tests.map((t) => <li key={t}>{t}</li>)}</ul>
                <p className="mt-1"><b>{t("Verdict rule:")}</b> {t(r.method.verdict_rule)}</p>
                <p className="mt-1 text-slate-400">{r.method.references.join(" · ")}</p>
                <p className="mt-1 font-mono text-slate-500">{r.method.code_version}{t(" · computed ")}{r.method.computed_at}</p>
              </details>
              <details className="mt-2 text-[11px] text-slate-300" open>
                <summary className="cursor-pointer text-slate-200">{t("Data source")}</summary>
                <p className="mt-1">{r.provenance.provider} {r.provenance.api_version}{t(" · parameter ")}<code>{r.provenance.parameter}</code> ({t(r.provenance.long_name)}{t(") · upstream: ")}{(r.provenance.upstream_sources ?? []).join(", ")}</p>
                <p className="mt-1">{t("Retrieved ")}{r.provenance.retrieved_at}{r.provenance.from_cache ? t(" (served from cache)") : ""}.</p>
                <a className="mt-1 block break-all font-mono text-[10px] text-accent/80 hover:underline" href={r.provenance.request_url} target="_blank" rel="noreferrer">{r.provenance.request_url}</a>
                <ul className="mt-2 space-y-1 text-slate-400">
                  {d.variable.citations.map((c) => (
                    <li key={c.text}>{t(c.text)}{c.doi && <> <a className="text-accent/80 hover:underline" href={`https://doi.org/${c.doi}`} target="_blank" rel="noreferrer">{t("doi:")}{c.doi}</a></>}</li>
                  ))}
                </ul>
              </details>
            </Section>
          </details>
        </div>
      )}
    </aside>
  );
}

function round(x: number) { return Math.round(x * 1e4) / 1e4; }

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-space-700 bg-space-800/70 px-2.5 py-2">
      <div className="label">{t(label)}</div>
      <div className="mt-0.5 font-mono text-[15px] text-slate-50">{value}</div>
      {sub && <div className="font-mono text-[10.5px] text-slate-400">{sub}</div>}
    </div>
  );
}

function Row({ name, slope, p, muted }: { name: string; slope: number | null; p: number | null; muted?: boolean }) {
  return (
    <tr className={muted ? "text-slate-500" : ""}>
      <td className="py-0.5 pr-2 font-sans">{name}</td>
      <td>{slope === null ? "—" : fmtSigned(slope)}</td>
      <td className="text-right">{fmtP(p)}</td>
    </tr>
  );
}
