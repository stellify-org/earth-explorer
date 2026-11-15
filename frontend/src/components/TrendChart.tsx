import { t } from "../i18n";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AnalysisResult } from "../api/types";
import { fmt } from "../lib/format";

const SERIES = "#3987e5";
const TREND = "#d95926";
const GRID = "#1d3157";
const AXIS = "#94a3b8";

type View = "anomaly" | "raw" | "annual" | "season";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function TrendChart({ r, unit }: { r: AnalysisResult; unit: string }) {
  const [view, setView] = useState<View>("anomaly");
  const tr = r.trend;

  const data = useMemo(() => {
    const valid = r.points.filter((p) => p.anomaly !== null);
    const tbar = valid.reduce((s, p) => s + p.t, 0) / Math.max(1, valid.length);
    const p = tr?.primary;
    const at = (t: number, perDecade: number | null) =>
      p && perDecade !== null && p.intercept !== null && p.slope_per_decade !== null
        ? (p.intercept + (p.slope_per_decade / 10) * tbar) + (perDecade / 10) * (t - tbar)
        : null;
    return r.points.map((pt) => ({
      t: pt.t, date: pt.date, value: pt.value, anomaly: pt.anomaly,
      trend: at(pt.t, p?.slope_per_decade ?? null),
      lo: at(pt.t, p?.ci_low_per_decade ?? null),
      hi: at(pt.t, p?.ci_high_per_decade ?? null),
    }));
  }, [r, tr]);

  const annual = useMemo(() => {
    const a = tr?.annual_ols;
    return r.annual.map((x) => ({
      year: x.year, mean: x.mean,
      trend: a && a.intercept !== null && a.slope_per_decade !== null ? a.intercept + (a.slope_per_decade / 10) * (x.year + 0.5) : null,
    }));
  }, [r, tr]);

  const tabs: [View, string][] = [["anomaly", "Monthly anomalies"], ["raw", "Raw monthly"], ["annual", "Annual means"], ["season", "Seasonal cycle"]];
  const tick = { fill: AXIS, fontSize: 10.5 };
  const tooltipStyle = { background: "#0b1528", border: "1px solid #1d3157", borderRadius: 6, fontSize: 12, color: "#e2e8f0" };

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)}
            className={`rounded px-2 py-0.5 text-[11px] ${view === k ? "bg-accent/15 text-accent" : "text-slate-400 hover:text-slate-200"}`}>{t(label)}</button>
        ))}
      </div>
      <div className="h-[210px]">
        <ResponsiveContainer width="100%" height="100%">
          {view === "season" ? (
            <BarChart data={r.climatology.map((c) => ({ m: MONTHS[c.month - 1], mean: c.mean, n: c.n_years }))} margin={{ top: 6, right: 8, bottom: 0, left: -6 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="m" tick={tick} stroke={GRID} />
              <YAxis tick={tick} stroke={GRID} width={46} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#ffffff10" }} formatter={(v) => [`${fmt(v as number)} ${unit}`, "Mean"]} />
              <Bar dataKey="mean" fill={SERIES} radius={[4, 4, 0, 0]} />
            </BarChart>
          ) : view === "annual" ? (
            <ComposedChart data={annual} margin={{ top: 6, right: 8, bottom: 0, left: -6 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="year" type="number" domain={["dataMin", "dataMax"]} tick={tick} stroke={GRID} allowDecimals={false} />
              <YAxis tick={tick} stroke={GRID} width={46} domain={["auto", "auto"]} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={(y) => `Year ${y}`} formatter={(v, n) => [`${fmt(v as number)} ${unit}`, n === "mean" ? "Annual mean" : "OLS trend (annual)"]} />
              <Legend wrapperStyle={{ fontSize: 11, color: AXIS }} formatter={(n) => (n === "mean" ? "Annual mean" : "OLS trend (annual means)")} />
              <Line dataKey="mean" stroke={SERIES} strokeWidth={2} dot={{ r: 2.5, fill: SERIES, strokeWidth: 0 }} isAnimationActive={false} connectNulls={false} />
              <Line dataKey="trend" stroke={TREND} strokeWidth={2} dot={false} isAnimationActive={false} />
            </ComposedChart>
          ) : (
            <ComposedChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -6 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tick={tick} stroke={GRID} tickFormatter={(t) => String(Math.floor(t))} allowDecimals={false} />
              <YAxis tick={tick} stroke={GRID} width={46} domain={["auto", "auto"]} />
              <Tooltip contentStyle={tooltipStyle}
                labelFormatter={(_, p) => (p?.[0]?.payload?.date as string) ?? ""}
                formatter={(v, n) => [`${fmt(v as number)} ${unit}`, n === "anomaly" ? "Anomaly" : n === "value" ? "Value" : n === "trend" ? "Fitted trend" : n === "lo" ? "CI slope (low)" : "CI slope (high)"]} />
              <Legend wrapperStyle={{ fontSize: 11, color: AXIS }}
                formatter={(n) => n === "anomaly" ? "Monthly anomaly" : n === "value" ? "Monthly value" : n === "trend" ? "OLS trend" : n === "lo" ? "95% CI of slope" : ""} />
              <Line dataKey={view === "raw" ? "value" : "anomaly"} stroke={SERIES} strokeWidth={1.25} dot={false} isAnimationActive={false} connectNulls={false} />
              {view === "anomaly" && <Line dataKey="trend" stroke={TREND} strokeWidth={2} dot={false} isAnimationActive={false} />}
              {view === "anomaly" && <Line dataKey="lo" stroke={TREND} strokeWidth={1} strokeDasharray="4 3" dot={false} isAnimationActive={false} />}
              {view === "anomaly" && <Line dataKey="hi" stroke={TREND} strokeWidth={1} strokeDasharray="4 3" dot={false} isAnimationActive={false} legendType="none" />}
            </ComposedChart>
          )}
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[10.5px] leading-snug text-slate-500">
        {view === "anomaly" && t("Anomaly = value minus the mean of its calendar month over the selected period. Dashed lines: slopes at the ends of the 95% confidence interval, pivoting at the period midpoint.")}
        {view === "raw" && t("Raw monthly values including the seasonal cycle. Trend tests are run on anomalies, not on these values (except the Seasonal Kendall test).")}
        {view === "annual" && t("Annual means are shown only for years with all 12 months valid.")}
        {view === "season" && t("Mean annual cycle over the selected period (the climatology removed to form anomalies).")}
      </p>
    </div>
  );
}
