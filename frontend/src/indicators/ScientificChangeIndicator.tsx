import { t } from "../i18n";
import type { ReactNode } from "react";
import { classify, formatChange, indicatorFor, trendEvidence, trendLabel, type Direction, type IndicatorIcon, type IndicatorType, type Tone } from "./registry";

export interface SourceMetadata {

  provider?: string;

  support?: string;
  url?: string;
}

export interface ScientificChangeIndicatorProps {
  variable: string;

  value: number | null | undefined;
  unit: string;
  indicatorType: IndicatorType;

  referencePeriod?: string;

  timestamp?: string;

  direction?: Direction;

  nearNormal?: number;

  statisticalVerdict?: string;
  dataStatus?: "ok" | "loading" | "missing" | "stale";
  sourceMetadata?: SourceMetadata;

  note?: ReactNode;
  compact?: boolean;
  testId?: string;
}

const s = (d: string, extra?: ReactNode) => <><path d={d} />{extra}</>;
const THERMO = "M10 13.500V5a2 2 0 1 1 4 0v8.500a4 4 0 1 1-4 0Z";
const DROP = "M12 3.500c3 3.700 5.500 6.800 5.500 10a5.500 5.500 0 0 1-11 0c0-3.200 2.500-6.300 5.500-10Z";
const CLOUD = "M7 15a4 4 0 0 1 .600-7.950A5.500 5.500 0 0 1 18 8.500 3.250 3.250 0 0 1 17.500 15H7Z";
const SUN = "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2M12 20v2M2 12h2M20 12h2M4.900 4.900l1.400 1.400M17.700 17.700l1.400 1.400M4.900 19.100l1.400-1.400M17.700 6.300l1.400-1.400";
const UP = "M19.500 10V4M17 6.500 19.500 4 22 6.500", DOWN = "M19.500 4v6M17 7.500 19.500 10 22 7.500";
const SOIL = "M3 14h18M5 18h2M11 18h2M17 18h2M8 21h2M14 21h2";
const PATHS: Record<IndicatorIcon, ReactNode> = {
  thermo: s(THERMO), thermoUp: s(THERMO, <path d={UP} />), thermoDown: s(THERMO, <path d={DOWN} />),
  drop: s(DROP), dropUp: s(DROP, <path d={UP} />), dropDown: s(DROP, <path d={DOWN} />),
  rain: s(CLOUD, <path d="M8.500 18v2.500M12 18v3.500M15.500 18v2.500" />),
  dry: s(DROP, <path d="M4 4l16 16" />),
  soil: s(SOIL), soilWet: s(SOIL, <path d="M12 3c1.800 2.200 3 3.800 3 5.500a3 3 0 0 1-6 0C9 6.800 10.200 5.200 12 3Z" />), soilDry: s(SOIL, <path d="M12 3l-2 3.500 3 2-1.500 3" />),
  wind: s("M3 9h10a2.500 2.500 0 1 0-2.500-2.500M3 14h14a2.500 2.500 0 1 1-2.500 2.500"),
  windStrong: s("M3 8h11a2.500 2.500 0 1 0-2.500-2.500M3 12.500h16a2.500 2.500 0 1 1-2.500 2.500M3 17h8"),
  windWeak: s("M5 12h9a2.500 2.500 0 1 0-2.500-2.500"),
  sun: s(SUN), sunUp: s(SUN), sunDown: s("M12 9a3.500 3.500 0 1 0 0 7 3.500 3.500 0 0 0 0-7ZM12 4v1.500M5 12.500h1.500M17.500 12.500H19M7 7.500l1 1M17 7.500l-1 1M3 20h18"),
  arrowUp: s("M12 20V5M6 11l6-6 6 6"), arrowDown: s("M12 4v15M6 13l6 6 6-6"), equal: s("M5 9h14M5 15h14"),
  trendUp: s("M3 17l6-6 4 4 8-8M15 7h6v6"), trendDown: s("M3 7l6 6 4-4 8 8M15 17h6v-6"), trendFlat: s("M3 12h18M4 8l3 2 3-3 3 4 3-3 4 2"),
  unknown: s("M9.500 9a2.500 2.500 0 1 1 3.500 2.300c-.700.400-1 1-1 1.700M12 17v.500M4 4h16v16H4Z"),
};

export function IndicatorGlyph({ name, size = 22 }: { name: IndicatorIcon; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{PATHS[name]}</svg>;
}

const TONE: Record<Tone | "missing", string> = {
  warm: "border-orange-400/50 bg-orange-400/10 text-orange-200",
  cool: "border-sky-400/50 bg-sky-400/10 text-sky-200",
  wet: "border-cyan-400/50 bg-cyan-400/10 text-cyan-200",
  dry: "border-amber-400/50 bg-amber-400/10 text-amber-200",
  neutral: "border-slate-400/40 bg-slate-400/10 text-slate-200",
  missing: "border-dashed border-slate-500/50 bg-transparent text-slate-400",
};
const KIND: Record<IndicatorType, string> = { anomaly: "Anomaly", trend: "Long-term trend", observedChange: "Observed change" };
const WORD: Record<Direction, string> = { up: "above", down: "below", neutral: "close to", missing: "" };

export default function ScientificChangeIndicator(p: ScientificChangeIndicatorProps) {
  const spec = indicatorFor(p.variable);
  const trend = p.indicatorType === "trend";
  const decimals = trend ? spec.digits.trend : spec.digits.anomaly;
  const status = p.dataStatus ?? "ok";
  const evidence = trend ? trendEvidence(p.statisticalVerdict) : undefined;
  let dir: Direction = p.direction ?? classify(p.value, decimals, trend ? undefined : p.nearNormal);
  if (status === "missing" || status === "loading") dir = "missing";

  const shown: Direction = trend && dir !== "missing" && evidence !== "detected" ? "neutral" : dir;

  const icon: IndicatorIcon = dir === "missing" ? "unknown"
    : trend ? (shown === "up" ? "trendUp" : shown === "down" ? "trendDown" : "trendFlat")
    : spec.icon[shown as "up" | "down" | "neutral"];
  const tone = dir === "missing" ? "missing" : shown === "neutral" ? "neutral" : spec.tone[shown as "up" | "down"];
  const label = status === "loading" ? "Loading…" : dir === "missing" ? "No data for this place and time"
    : trend ? trendLabel(p.statisticalVerdict, p.value)
    : p.indicatorType === "anomaly" ? spec.anomaly[shown as "up" | "down" | "neutral"]
    : shown === "up" ? "Increase" : shown === "down" ? "Decrease" : "Almost no change";
  const number = dir === "missing" ? "—" : formatChange(p.value, decimals);
  const unit = p.unit || spec.unit;
  const per = trend ? t(" per decade") : "";
  const aria = dir === "missing" ? `${t(KIND[p.indicatorType])}: ${t(label)}`
    : `${t(KIND[p.indicatorType])}: ${t(label)}, ${number} ${unit}${per}${!trend && WORD[dir] ? ` (${t(WORD[dir])} ${t("the reference")})` : ""}${p.referencePeriod ? `. ${p.referencePeriod}` : ""}`;

  return (
    <div className={`rounded-xl border ${TONE[tone]} ${p.compact ? "px-2.5 py-2" : "px-3 py-2.5"}`} role="group" aria-label={aria} data-testid={p.testId} data-direction={dir} data-kind={p.indicatorType}>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0"><IndicatorGlyph name={icon} size={p.compact ? 20 : 26} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-slate-400">
            <span className="font-medium text-slate-300">{t(KIND[p.indicatorType])}</span>
            {p.timestamp && <span>{p.timestamp}</span>}
            {status === "stale" && <span className="text-amber-200">{t("saved copy")}</span>}
          </div>
          <div className={`font-semibold leading-snug ${p.compact ? "text-[13px]" : "text-[14px]"}`}>{t(label)}</div>
          {dir !== "missing" && (
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-slate-50">
              <span className={`font-mono font-semibold ${p.compact ? "text-[17px]" : "text-[22px]"}`} data-testid={p.testId ? `${p.testId}-value` : undefined}>{number}</span>
              <span className="text-[13px] text-slate-200">{unit}{per}</span>
            </div>
          )}
          {p.referencePeriod && dir !== "missing" && <p className="mt-0.5 text-[11.5px] leading-snug text-slate-300">{p.referencePeriod}</p>}
          {p.note && dir !== "missing" && <p className="mt-0.5 text-[11.5px] leading-snug text-slate-300">{p.note}</p>}
          {(p.sourceMetadata || spec.limitation) && (
            <details className="mt-1 text-[11px] leading-snug text-slate-400">
              <summary className="cursor-pointer text-slate-400 hover:text-slate-200">{t("Source and limits")}</summary>
              {p.sourceMetadata?.provider && <p className="mt-1">{t("Source: ")}{p.sourceMetadata.url ? <a className="text-accent hover:underline" href={p.sourceMetadata.url} target="_blank" rel="noreferrer">{p.sourceMetadata.provider}</a> : p.sourceMetadata.provider}</p>}
              {p.sourceMetadata?.support && <p className="mt-0.5">{t("Where it applies: ")}{t(p.sourceMetadata.support)}</p>}
              <p className="mt-0.5">{t(spec.limitation)}</p>
              {p.indicatorType === "anomaly" && <p className="mt-0.5">{t("“Near normal” is a description of size, not a statistical test.")}</p>}
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

export function AnomalyVsTrend() {
  return <p className="text-[11.5px] leading-snug text-slate-400" data-testid="anomaly-vs-trend">{t("An anomaly compares one month with the average for that month. A trend is the rate of change over the whole period. One unusual month does not prove a trend.")}</p>;
}
