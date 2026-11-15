import { t } from "../i18n";
import { useEffect, useRef, useState } from "react";
import type { Availability, Layer } from "../api/types";
import { dayIndex, fromDayIndex, parseISODate, toISODate } from "../lib/dates";
import { Button, Spinner } from "./ui";

interface Props {
  date: string;
  setDate: (d: string) => void;

  driver?: Layer;
  availability?: Availability;
  loading?: boolean;
  error?: string;

  extra?: { layer: Layer; a?: Availability }[];
  compact?: boolean;
}

const MIN = "1980-01-01";

export function describe(a: Availability | undefined): { text: string; tone: "ok" | "warn" } {
  if (!a) return { text: "", tone: "ok" };
  if (a.exact) return { text: `Showing ${a.shown}`, tone: "ok" };
  if (a.requested < a.first) return { text: `Before this layer's coverage (starts ${a.first}). Showing the first available date ${a.shown}.`, tone: "warn" };
  const d = Math.abs(a.delta_days);
  return { text: `Nothing available for ${a.requested}. Showing the nearest earlier date ${a.shown} (${d} day${d === 1 ? "" : "s"} earlier).`, tone: d > 31 ? "warn" : "ok" };
}

export default function Timeline({ date, setDate, driver, availability: a, loading, error, extra, compact }: Props) {
  const today = toISODate(new Date());
  const [playing, setPlaying] = useState(false);
  const aRef = useRef(a);
  aRef.current = a;

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const nx = aRef.current?.next;
      if (nx) setDate(nx);
      else setPlaying(false);
    }, 1600);
    return () => clearInterval(id);
  }, [playing, setDate]);

  const d = describe(a);
  const years = [1980, 1985, 1990, 2000, 2005, 2010, 2015, 2020, 2025];

  return (
    <div className={`panel flex flex-col gap-1.5 px-4 ${compact ? "py-2" : "py-2.5"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="label">{t("Time")}</span>
        <input type="date" value={date} min={MIN} max={today}
          onChange={(e) => parseISODate(e.target.value) && setDate(e.target.value)}
          className="rounded border border-space-600 bg-space-800 px-2 py-0.5 font-mono text-xs text-slate-100" aria-label={t("Date")} />
        <Button disabled={!a?.previous} onClick={() => a?.previous && setDate(a.previous)} title={t("Previous available observation")}>{t("◀ prev")}</Button>
        <Button active={playing} disabled={!driver?.time_enabled} onClick={() => setPlaying((p) => !p)} title={t("Play through available dates")}>{playing ? t("❚❚ pause") : t("▶ play")}</Button>
        <Button disabled={!a?.next} onClick={() => a?.next && setDate(a.next)} title={t("Next available observation")}>{t("next ▶")}</Button>
        {loading && <Spinner />}
        <span className={`text-[11.5px] ${d.tone === "warn" ? "text-amber-300" : "text-slate-300"}`}>
          {driver?.time_enabled ? <><b className="font-medium text-slate-100">{t(driver.short_name)}:</b> {t(d.text)}</> : t("Static base layer — not a dated observation. Choose a dated layer to travel in time.")}
        </span>
        {error && <span className="text-[11px] text-red-300">{t(error)}</span>}
      </div>
      {!compact && (
        <div className="flex items-center gap-3">
          <input type="range" className="flex-1" min={dayIndex(MIN)} max={dayIndex(today)} value={dayIndex(date)}
            onChange={(e) => setDate(fromDayIndex(Number(e.target.value)))} aria-label={t("Timeline")} />
          <div className="hidden gap-1 md:flex">
            {years.map((y) => (
              <button key={y} className="font-mono text-[10.5px] text-slate-400 hover:text-accent" onClick={() => setDate(`${y}-07-01`)}>{y}</button>
            ))}
          </div>
        </div>
      )}
      {!compact && driver?.time_enabled && a && <CoverageBar driver={driver} />}
      {extra && extra.length > 0 && (
        <div className="flex flex-wrap gap-x-4 text-[11px] text-slate-400">
          {extra.map((x) => <span key={x.layer.id}>{t(x.layer.short_name)}: {x.layer.time_enabled ? (x.a ? x.a.shown : "…") : t("static")}</span>)}
        </div>
      )}
    </div>
  );
}

function CoverageBar({ driver }: { driver: Layer }) {
  const lo = dayIndex(MIN);
  const hi = dayIndex(toISODate(new Date()));
  const span = hi - lo;
  return (
    <div className="relative h-1.5 w-full rounded bg-space-700" title={t("Dates with imagery for this layer (from GIBS GetCapabilities)")}>
      {(driver.intervals ?? []).map((iv, i) => {
        const a = Math.max(0, dayIndex(iv.start) - lo) / span;
        const b = Math.min(span, dayIndex(iv.end) - lo) / span;
        return <div key={i} className="absolute top-0 h-full rounded bg-accent/70" style={{ left: `${a * 100}%`, width: `${Math.max(0.25, (b - a) * 100)}%` }} />;
      })}
      {driver.intervals_maybe_truncated && <span className="absolute -top-4 right-0 text-[10px] text-amber-300">{t("older dates may exist (GIBS lists the latest 100 periods)")}</span>}
    </div>
  );
}
