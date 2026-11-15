import { t } from "../i18n";
import { useState } from "react";
import LayerPanel from "./LayerPanel";
import VisPanel from "../vis/VisPanel";
import type { VisState } from "../vis/useVis";
import { surfaceView, useStore } from "../store";
import { Button, KindBadge, Section, inputCls, selectCls } from "./ui";
import { PLACES } from "../lib/places";
import { fmtLatLon, parseLatLon } from "../lib/format";

export default function LeftPanel({ vs, probe, terrainError }: { vs: VisState; probe?: ReturnType<VisState["probe"]>; terrainError?: string }) {
  const s = useStore();
  const [coordText, setCoordText] = useState("");
  const [coordErr, setCoordErr] = useState<string>();
  const variable = s.variables.find((v) => v.id === s.variableId);
  const lastYear = new Date().getUTCFullYear() - 1;

  const go = () => {
    const p = parseLatLon(coordText);
    if (!p) return setCoordErr("Enter decimal degrees as “lat, lon”, e.g. 38.56, 68.78");
    setCoordErr(undefined);
    s.flyTo({ ...p });
  };

  return (
    <aside className="panel sheet sheet-sm scroll-thin flex !max-h-none flex-col" aria-label={t("Advanced tools")}>
      <Section title={t("1 · Location")}>
        <div className="flex gap-1.5">
          <input className={inputCls} placeholder={t("lat, lon  (e.g. 38.56, 68.78)")} value={coordText}
            onChange={(e) => setCoordText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} aria-label={t("Coordinates")} />
          <Button onClick={go}>{t("Go")}</Button>
        </div>
        {coordErr && <p className="mt-1 text-[11px] text-red-300">{t(coordErr)}</p>}
        <select className={`${selectCls} mt-2`} value="" onChange={(e) => {
          const p = PLACES[Number(e.target.value)];
          if (p) s.flyTo({ lat: p.lat, lon: p.lon, label: p.label });
        }} aria-label={t("Example places")}>
          <option value="">{t("Example places…")}</option>
          {PLACES.map((p, i) => <option key={p.label} value={i}>{t(p.label)}</option>)}
        </select>
        <p className="mt-2 text-[11px] text-slate-400">{t("…or click anywhere on the globe.")}</p>
        {s.place && (
          <div className="mt-2 flex items-center justify-between rounded bg-space-800 px-2 py-1.5 text-xs">
            <span className="font-mono text-accent">{s.place.label ? t(s.place.label) : fmtLatLon(s.place.lat, s.place.lon)}</span>
            <Button title={t("Fly to an oblique view ~30 km above the ground with terrain and satellite imagery")} onClick={() => surfaceView()}>{t("Surface view")}</Button>
          </div>
        )}
      </Section>

      <Section title={t("2 · Variable")}>
        <select className={selectCls} value={s.variableId} onChange={(e) => s.setVariable(e.target.value)} aria-label={t("Variable")}>
          {s.variables.map((v) => <option key={v.id} value={v.id}>{t(v.name)} ({v.units_label})</option>)}
        </select>
        {variable && (
          <div className="mt-2 space-y-1.5 text-[11.5px] leading-snug text-slate-300">
            <p>{t(variable.description)}</p>
            <div className="flex flex-wrap gap-1.5">
              <KindBadge kind={variable.data_kind} />
              <span className="badge">{t(variable.spatial_resolution)}</span>
              <span className="badge">{t(variable.temporal_resolution)} · {variable.coverage_start_year}→</span>
            </div>
            <p className="text-slate-400">{t("Source: NASA POWER ← ")}{variable.upstream_products.join(", ")}</p>
          </div>
        )}
      </Section>

      <Section title={t("3 · Period")}>
        <div className="flex items-center gap-2 text-sm">
          <input type="number" className={inputCls} min={variable?.coverage_start_year ?? 1981} max={s.endYear} value={s.startYear}
            onChange={(e) => s.setPeriod(Number(e.target.value), s.endYear)} aria-label={t("Start year")} />
          <span className="text-slate-500">–</span>
          <input type="number" className={inputCls} min={s.startYear} max={lastYear} value={s.endYear}
            onChange={(e) => s.setPeriod(s.startYear, Number(e.target.value))} aria-label={t("End year")} />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button onClick={() => s.setPeriod(variable?.coverage_start_year ?? 1981, lastYear)}>{t("Full record")}</Button>
          <Button onClick={() => s.setPeriod(1991, 2020)}>1991–2020</Button>
          <Button onClick={() => s.setPeriod(2001, lastYear)}>2001→</Button>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">{t("Trends need ≥ 10 years; 20–30+ are recommended.")}</p>
      </Section>

      <VisPanel vs={vs} probe={probe} />
      <LayerPanel terrainError={terrainError} />
    </aside>
  );
}
