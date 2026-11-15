import { useState, type ReactNode } from "react";
import { t } from "../../i18n";
import { useLowBandwidth } from "../../store";
import { STYLE, markerAt, type Cat } from "../model";
import { useEvents } from "../store";
import { investigateTrend } from "../trend";
import { useEvidence } from "./store";
import { EVIDENCE, isFrames, readout, type Bundle, type EvidenceClass, type Layer } from "./types";

const PATHS: Record<string, ReactNode> = {
  area: <path d="M5 8 11 4l7 3 2 8-6 5-8-2-2-6Z" />,
  heat: <path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9Z" />,
  track: <><path d="M4 19c4-1 3-7 7-8s4-5 9-6" /><circle cx="4" cy="19" r="1.6" /><circle cx="11" cy="11" r="1.6" /><circle cx="20" cy="5" r="1.6" /></>,
  wind: <path d="M3 9h10a3 3 0 1 0-3-3M3 14h15a3 3 0 1 1-3 3M3 19h6" />,
  rain: <><path d="M7 14a4 4 0 0 1 .5-8 5 5 0 0 1 9.500 1A3.500 3.500 0 0 1 17 14H7Z" /><path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3" /></>,
  water: <><path d="M3 9c3-3 6 3 9 0s6 3 9 0" /><path d="M3 15c3-3 6 3 9 0s6 3 9 0" /></>,
  shake: <path d="M2 12h4l2-6 3 12 3-9 2 5 2-2h4" />,
  fault: <path d="M4 20 10 4M14 20 20 4M9 12h7" />,
  dots: <><circle cx="6" cy="8" r="2" /><circle cx="15" cy="6" r="1.5" /><circle cx="12" cy="14" r="3" /><circle cx="19" cy="17" r="1.5" /></>,
  station: <><path d="M12 21V11" /><path d="M8 7a5.500 5.500 0 0 1 8 0M5 4.500a9.500 9.500 0 0 1 14 0" /><circle cx="12" cy="10" r="1" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  chart: <path d="M4 20V5M4 20h16M7 16l4-5 3 3 5-7" />,
  target: <><circle cx="12" cy="12" r="7" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></>,
};
const Svg = ({ name, size = 16 }: { name: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">{PATHS[name] ?? PATHS.area}</svg>
);

export function EvidenceBadge({ cls }: { cls: EvidenceClass }) {
  const e = EVIDENCE[cls];
  return <span className="inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] leading-4 whitespace-nowrap" style={{ borderColor: e.color + "99", color: e.color }} title={t(e.hint)} data-evidence={cls}><span className="h-1.5 w-1.5 rounded-full" style={{ background: e.color }} />{t(e.label)}</span>;
}

function DepthGauge({ depth }: { depth: NonNullable<Bundle["depth"]> }) {

  const x = (km: number) => 4 + 192 * Math.sqrt(Math.min(700, Math.max(0, km)) / 700);
  const cls = depth.km <= 70 ? "Shallow (0–70 km)" : depth.km <= 300 ? "Intermediate (70–300 km)" : "Deep (> 300 km)";
  return (
    <div className="mt-2" data-testid="impact-depth">
      <div className="flex items-baseline justify-between text-[11px] text-slate-300"><span>{t("Depth")}: <b className="text-slate-50">{depth.km.toFixed(0)} {t("km")}</b> · {t(cls)}</span><span className="text-slate-500">0 → 700 {t("km")}</span></div>
      <svg viewBox="0 0 200 18" className="mt-0.5 h-[18px] w-full" role="img" aria-label={`${t("Depth")} ${depth.km.toFixed(0)} km`}>
        <rect x="4" y="7" width={x(70) - 4} height="5" fill="#e9d5ff" /><rect x={x(70)} y="7" width={x(300) - x(70)} height="5" fill="#a855f7" /><rect x={x(300)} y="7" width={196 - x(300)} height="5" fill="#6b21a8" />
        {depth.rupture_top_km !== undefined && depth.rupture_base_km !== undefined && <rect x={x(depth.rupture_top_km)} y="4" width={Math.max(2, x(depth.rupture_base_km) - x(depth.rupture_top_km))} height="11" fill="none" stroke="#fff" strokeWidth="1" />}
        <path d={`M${x(depth.km)} 1v16`} stroke="#fbbf24" strokeWidth="2" />
      </svg>
      {depth.rupture_top_km !== undefined && <p className="text-[10.5px] leading-snug text-slate-500">{t("White frame: depth range of the fault model")} ({depth.rupture_top_km}–{depth.rupture_base_km} {t("km")}).</p>}
    </div>
  );
}

function LegendRow({ l }: { l: Layer }) {
  return (
    <div className="border-t border-space-700/60 py-1.5 first:border-t-0" data-testid="impact-legend-layer" data-layer={l.id}>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5"><span className="text-[12px] font-medium text-slate-100">{t(l.label)}</span><EvidenceBadge cls={l.evidence} /></div>
      <ul className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
        {(l.legend ?? []).map((x) => <li key={x.label} className="flex items-center gap-1.5 text-[11px] text-slate-300"><span className="h-2.5 w-2.5 shrink-0 rounded-sm border border-white/20" style={{ background: x.color }} />{t(x.label)}</li>)}
      </ul>
      {l.legend_image && <img src={l.legend_image} alt={t("Colour scale of the NASA image") + (l.units ? `: ${l.units}` : "")} className="mt-1 max-h-16 w-full rounded bg-white/90 object-contain px-1 text-[10.5px] text-slate-700" loading="lazy" />}
      <p className="mt-0.5 truncate text-[10.5px] leading-snug text-slate-500" title={`${l.source.name} · ${l.resolution}`}>{l.date} · {t(l.source.name)}</p>
    </div>
  );
}

export default function ImpactOverlay() {
  const ev = useEvents((s) => s.selected), cursor = useEvents((s) => s.cursor), setCursor = useEvents((s) => s.setCursor), setPlaying = useEvents((s) => s.setPlaying);
  const e = useEvidence();
  const low = useLowBandwidth();
  const [open, setOpen] = useState(() => window.innerWidth >= 768);
  if (!ev || e.eventId !== ev.id || e.status === "idle") return null;
  const b = e.bundle;
  const cat = STYLE[(b?.category ?? ev.cat) as Cat] ?? STYLE.other;
  const toggle = (l: Layer) => {
    if (l.kind === "gibs" && !e.on[l.id] && low && !window.confirm(t("Low Bandwidth Mode is on. Satellite imagery downloads about 1 MB for each new view. Continue?"))) return;
    e.toggle(l.id);
  };
  const shown = b?.layers.filter((l) => e.on[l.id]) ?? [];
  const lines = b ? readout(b, e.on, cursor) : [];
  const cmp = b?.compare, cmpLayer = cmp && b.layers.find((l) => l.id === cmp.layer);
  const frames = cmpLayer?.raster && isFrames(cmpLayer.raster) ? cmpLayer.raster.frames : [];
  const jump = (label: string) => { const f = frames.find((x) => x.label === label); if (f) { setPlaying(false); setCursor(f.t); } };
  const at = markerAt(ev, cursor);

  return (
    <section className="absolute bottom-3 left-3 z-10 flex max-h-[calc(100%-24px)] w-[min(384px,calc(100%-72px))] flex-col overflow-hidden rounded-xl border border-space-600 bg-space-950/92 shadow-2xl backdrop-blur" aria-label={t("Event impact")} data-testid="impact" data-event={ev.id} data-status={e.status} data-tier={e.tier}>
      <header className="flex items-start gap-2 px-3 pt-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={{ background: cat.color + "33", color: cat.color }}><Svg name={b?.layers[0]?.icon ?? "target"} /></span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] leading-tight font-semibold text-slate-50" data-testid="impact-title">{b ? t(b.title) : ev.title}</h3>
          <p className="text-[11.5px] text-slate-400">{t(cat.one)}{b?.subtitle ? ` · ${b.subtitle}` : ""}</p>
        </div>
        <button className="-mt-1 -mr-1 p-1.5 text-slate-400 hover:text-white" onClick={() => e.close()} aria-label={t("Hide event impact")} title={t("Hide event impact")} data-testid="impact-close"><Svg name="close" /></button>
      </header>

      <div className="scroll-thin min-h-0 overflow-y-auto px-3 pb-2.5">
        {e.status === "loading" && <p className="py-3 text-[12px] text-slate-300" role="status">{t("Loading the evidence…")}</p>}
        {e.status === "error" && <p className="mt-2 rounded border border-rose-400/40 bg-rose-950/40 px-2 py-1.5 text-[12px] text-rose-100" role="alert" data-testid="impact-error">{t(e.error)}</p>}
        {b && <>
          {b.stale && <p className="mt-1.5 text-[11px] text-amber-200">{t("The source is unreachable; showing the copy saved earlier.")}</p>}
          <dl className={`mt-2 grid gap-1.5 ${b.summary.length === 4 ? "grid-cols-2" : b.summary.length >= 3 ? "grid-cols-3" : "grid-cols-2"}`} data-testid="impact-summary">
            {b.summary.map((m) => (
              <div key={m.label} className="rounded-lg border border-space-700 bg-space-900/70 px-2 py-1.5" title={t(m.note)} data-testid="impact-measure" data-evidence={m.evidence}>
                <dd className="text-[15px] leading-tight font-semibold text-slate-50"><span data-testid="impact-value">{m.value}</span>{m.unit && <span className="ml-1 text-[11px] font-normal text-slate-300">{t(m.unit)}</span>}</dd>
                <dt className="mt-0.5 flex items-start gap-1 text-[10.5px] leading-tight text-slate-400"><span className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: EVIDENCE[m.evidence].color }} />{t(m.label)}</dt>
                {m.also && <div className="mt-0.5 text-[10px] leading-tight text-slate-500">{m.also}</div>}
              </div>
            ))}
          </dl>
          {b.depth && <DepthGauge depth={b.depth} />}

          {b.layers.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={t("Evidence layers")}>
              {b.layers.map((l) => (
                <button key={l.id} aria-pressed={!!e.on[l.id]} onClick={() => toggle(l)} title={t(l.label)} data-testid={`impact-layer-${l.id}`}
                  className={`flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors ${e.on[l.id] ? "border-warm/70 bg-space-800 text-slate-50" : "border-space-700 text-slate-400 hover:text-slate-200"}`}>
                  <Svg name={l.icon} size={15} />{t(l.short)}
                </button>
              ))}
            </div>
          )}
          {e.tier === "global" && b.layers.length > 0 && (
            <button className="mt-2 flex w-full items-center gap-2 rounded-lg border border-accent/50 px-2.5 py-1.5 text-left text-[12px] text-accent hover:bg-accent/10" onClick={() => useEvidence.setState((s) => ({ flyToken: s.flyToken + 1 }))} data-testid="impact-approach">
              <Svg name="target" />{t("From this far the evidence is too small to see. Fly closer")}
            </button>
          )}
          {lines.length > 0 && <p className="mt-2 font-mono text-[11.5px] leading-snug text-slate-200" data-testid="impact-readout">{lines.map((x) => t(x)).join(" — ")}</p>}
          {cmp && frames.length > 1 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label={t("Before / After")} data-testid="impact-compare">
              <span className="text-[11px] text-slate-400">{t("Compare")}:</span>
              {([["before", cmp.before, "Before"], ["after", cmp.after, "After"]] as const).map(([k, label, name]) => {
                const cur = frames.find((f) => f.label === label), active = cur && cursor === cur.t;
                return <button key={k} aria-pressed={!!active} onClick={() => jump(label)} data-testid={`impact-${k}`} className={`rounded-lg border px-2 py-1 text-[12px] ${active ? "border-warm text-warm" : "border-space-600 text-slate-200 hover:border-accent"}`}>{t(name)} <span className="font-mono text-[10.5px] text-slate-400">{label}</span></button>;
              })}
            </div>
          )}

          {b.layers.length === 0 && <p className="mt-2 rounded-lg border border-space-700 bg-space-900/70 px-2.5 py-2 text-[12px] leading-snug text-slate-200" data-testid="impact-none">{t("No mapped extent is available for this event. The marker shows the reported location; nothing else is drawn.")}</p>}
          {b.unavailable.length > 0 && (
            <ul className="mt-2 space-y-1" data-testid="impact-unavailable">
              {b.unavailable.map((u) => <li key={u.label} className="text-[11px] leading-snug text-slate-400"><span className="text-slate-300">{t(u.label)}: </span>{t(u.reason)}</li>)}
            </ul>
          )}

          {shown.length > 0 && (
            <details className="mt-2 rounded-lg border border-space-700 bg-space-900/60 px-2.5" open={open} onToggle={(x) => setOpen((x.target as HTMLDetailsElement).open)} data-testid="impact-legend">
              <summary className="cursor-pointer py-1.5 text-[12px] text-slate-200">{t("What you are seeing")}</summary>
              {shown.map((l) => <LegendRow key={l.id} l={l} />)}
            </details>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button className="btn-warm inline-flex min-h-9 items-center gap-1.5" onClick={() => investigateTrend(ev, at)} data-testid="impact-trend"><Svg name="chart" />{t("Investigate the Trend")}</button>
          </div>
          <details className="mt-2 text-[11px] leading-snug text-slate-400" data-testid="impact-sources">
            <summary className="cursor-pointer text-slate-300">{t("How do we know?")}</summary>
            <p className="mt-1">{t(b.association)}</p>
            {b.layers.map((l) => (
              <div key={l.id} className="mt-1.5">
                <div className="text-slate-200">{t(l.label)} — <span style={{ color: EVIDENCE[l.evidence].color }}>{t(EVIDENCE[l.evidence].label)}</span></div>
                <div>{t(l.note)}</div>
                {l.units && <div>{t("Units")}: {t(l.units)}</div>}
                <div>{t("Uncertainty")}: {t(l.uncertainty)}</div>
                <div>{t("Source")}: <a className="text-accent hover:underline" href={l.source.url} target="_blank" rel="noreferrer">{t(l.source.name)}</a>{l.source.licence ? ` · ${t(l.source.licence)}` : ""} · {t("retrieved")} {l.source.retrieved}</div>
              </div>
            ))}
            <p className="mt-1.5">{t("The layers show where something was observed, estimated or reported. They do not show casualties, damage to buildings or financial losses.")}</p>
          </details>
        </>}
      </div>
    </section>
  );
}
