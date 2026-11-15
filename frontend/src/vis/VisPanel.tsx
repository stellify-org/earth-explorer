import { t } from "../i18n";
import { useStore, type VisMode } from "../store";
import { Button, KindBadge, Notice, Section, Spinner, selectCls, inputCls } from "../components/ui";
import { fmt } from "../lib/format";
import { cssGradient, PALETTES } from "./palettes";
import { EXTRUDE_MAX_M, SHELL_HEIGHT_M } from "./modes";
import type { VisState } from "./useVis";

const MODES: [VisMode, string][] = [["surface", "Surface heatmap"], ["shell", "Atmospheric shell"], ["extrude", "Extruded cells"], ["flow", "Flow"]];

export default function VisPanel({ vs, probe }: { vs: VisState; probe?: ReturnType<VisState["probe"]> }) {
  const { vis, setVis } = useStore();
  const v = vs.variable;
  const f = vs.mode === "flow" ? vs.frames.u : vs.frames.planet ?? vs.frames.region;
  const regionOnly = vs.mode !== "flow" && !vs.frames.planet && !!vs.frames.region;
  const lod = vs.frames.region ? vs.frames.region.h : f?.h;
  const units = v?.units_label ?? "";
  const unitsAnom = vs.kind === "anomaly" ? `${units} vs 1991–2020` : units;

  return (
    <Section title={t("Scientific visualization · numeric")} right={vs.frames.loading ? <Spinner /> : undefined}>
      {vs.catErr && <Notice tone="warn">{t("Numeric grids unavailable: ")}{vs.catErr}</Notice>}
      <select className={selectCls} value={vis.variable ?? ""} onChange={(e) => setVis({ variable: e.target.value || undefined })} aria-label={t("Visualisation variable")}>
        <option value="">{t("Off")}</option>
        {vs.catalog?.variables.map((x) => <option key={x.id} value={x.id}>{t(x.name)}</option>)}
      </select>
      {v && (
        <div className="mt-2 space-y-2 text-[11px]">
          <div className="flex flex-wrap gap-1">
            {MODES.map(([m, label]) => {
              const ok = v.modes.includes(m);
              return <Button key={m} active={vs.mode === m} disabled={!ok} onClick={() => setVis({ mode: m })}
                title={ok ? undefined : m === "flow" ? t("Flow needs eastward and northward vector components; this variable is a scalar.") : t("Not offered for this variable.")}>{t(label)}</Button>;
            })}
          </div>
          {vs.mode !== "flow" && (
            <div className="flex gap-1">
              <Button active={!vs.annual} onClick={() => setVis({ temporal: "monthly" })}>{t("Monthly")}</Button>
              <Button active={vs.annual} onClick={() => setVis({ temporal: "annual" })} title={t("Mean of the 12 monthly means of each complete year")}>{t("Annual means")}</Button>
            </div>
          )}
          {vs.low && vs.viewBox && vs.mode !== "flow" && vs.mode !== "shell" && !vis.detail && (
            <Button onClick={() => setVis({ detail: true })} title={t("Low Bandwidth Mode: native cells are only downloaded on request")}>{t("Load native detail for this view (~3–20 kB)")}</Button>
          )}
          {v.anomaly && vs.mode !== "flow" && (
            <div className="flex gap-1">
              <Button active={vs.kind === "value"} onClick={() => setVis({ kind: "value" })}>{t("Absolute")}</Button>
              <Button active={vs.kind === "anomaly"} onClick={() => setVis({ kind: "anomaly" })} title={t("Value minus the 1991–2020 mean of the same calendar month")}>{t("Anomaly")}</Button>
            </div>
          )}
          {vs.mode !== "flow" && <label className="block text-slate-400">{t("Opacity ")}{Math.round(vis.opacity * 100)}%
            <input type="range" min={0.1} max={1} step={0.05} value={vis.opacity} onChange={(e) => setVis({ opacity: Number(e.target.value) })} className="w-full" /></label>}
          {vs.mode !== "flow" && (
            <div className="grid grid-cols-2 gap-1.5">
              <select className={selectCls} value={vis.palette ?? ""} onChange={(e) => setVis({ palette: e.target.value || undefined })} aria-label={t("Colour scale")}>
                <option value="">{t("Default scale")}</option>
                {Object.entries(PALETTES).filter(([k]) => k !== "speed").map(([k, p]) => <option key={k} value={k}>{p.name.split(" (")[0]}</option>)}
              </select>
              <select className={selectCls} value={vis.range} onChange={(e) => setVis({ range: e.target.value as "fixed" | "auto" | "manual" })} aria-label={t("Data range")}>
                <option value="fixed">{t("Fixed range (comparable)")}</option>
                <option value="auto">{t("Auto (this month)")}</option>
                <option value="manual">{t("Manual")}</option>
              </select>
            </div>
          )}
          {vis.range === "manual" && vs.mode !== "flow" && (
            <div className="flex items-center gap-1.5">
              <input className={inputCls} type="number" placeholder={t("min")} value={vis.manualMin ?? ""} onChange={(e) => setVis({ manualMin: e.target.value === "" ? undefined : Number(e.target.value) })} aria-label={t("Manual minimum")} />
              <input className={inputCls} type="number" placeholder={t("max")} value={vis.manualMax ?? ""} onChange={(e) => setVis({ manualMax: e.target.value === "" ? undefined : Number(e.target.value) })} aria-label={t("Manual maximum")} />
            </div>
          )}
          {vs.mode === "extrude" && <label className="block text-slate-400">{t("Vertical exaggeration ×")}{vis.exaggeration.toFixed(1)}
            <input type="range" min={0.2} max={4} step={0.1} value={vis.exaggeration} onChange={(e) => setVis({ exaggeration: Number(e.target.value) })} className="w-full" /></label>}
          {vs.mode === "flow" && <label className="block text-slate-400">{t("Particles ")}{vis.density}
            <input type="range" min={500} max={8000} step={500} value={vis.density} onChange={(e) => setVis({ density: Number(e.target.value) })} className="w-full" /></label>}

          <div className="rounded border border-space-700 bg-space-800/60 p-2">
            <div className="h-3 rounded" style={{ background: cssGradient(vs.mode === "flow" ? "speed" : vs.palette) }} />
            <div className="mt-0.5 flex justify-between font-mono text-[10px] text-slate-300">
              <span>{fmt(vs.range[0])}</span><span>{fmt((vs.range[0] + vs.range[1]) / 2)}</span><span>{fmt(vs.range[1])}</span>
            </div>
            <div className="text-[10.5px] text-slate-400">{vs.mode === "flow" ? t("speed of the monthly-mean vector, m/s") : unitsAnom}{vis.range === "fixed" ? t(" · fixed scale") : vis.range === "auto" ? t(" · 2–98th percentile of this month") : t(" · manual")}</div>
            {vs.mode !== "flow" && <div className="mt-1 flex items-center gap-1.5 text-[10.5px] text-slate-400"><span className="inline-block h-2.5 w-4 rounded-sm border border-space-600" />{t(" No data: transparent (base map shows)")}</div>}
            <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[10.5px]">
              <dt className="text-slate-500">{t("Dataset")}</dt><dd className="text-slate-300">{t("NASA POWER v10, MERRA-2 based ")}<KindBadge kind={v.data_kind} /></dd>
              <dt className="text-slate-500">{vs.annual ? t("Year") : t("Month")}</dt><dd className="font-mono text-slate-200">{vs.month ?? "—"}{vs.annual && <span className="font-sans text-slate-400">{t(" (annual mean)")}</span>}{vs.availability && !vs.availability.exact && <span className="text-amber-300">{t(" (requested ")}{vs.availability.requested.slice(0, 7)})</span>}</dd>
              <dt className="text-slate-500">{t("Grid")}</dt><dd className="text-slate-300">{lod ? (lod.lod === "native subset" ? "native 0.5° × 0.625° (region)" : "2° × 2.5° block mean (planet)") : "—"}</dd>
              <dt className="text-slate-500">{t("Frame")}</dt><dd className="font-mono text-slate-400">{f ? t(`${(f.bytes / 1024).toFixed(0)} kB · ${f.source === "pack" ? "offline pack" : f.source === "cache" ? "browser cache" : "network"}`) : "—"}{vs.frames.ms !== undefined && t(` · ${vs.frames.ms} ms`)}</dd>
            </dl>
            <p className="mt-1.5 font-mono text-[11px] text-slate-100">
              {probe ? (Number.isFinite(probe.v) ? `${fmt(probe.v)} ${vs.mode === "flow" ? "" : unitsAnom} · cell ${probe.lat.toFixed(2)}, ${probe.lon.toFixed(3)} (${probe.cell})` : "No data in this cell") : t("Hover the globe to read the value")}
            </p>
          </div>
          {vs.frames.error && <Notice tone="error">{t(vs.frames.error)}</Notice>}
          {regionOnly && <Notice tone="warn">{t("The planet-scale frame for this period could not be loaded (offline?). Showing only the downloaded regional pack; everything outside it is transparent, not missing in the source.")}</Notice>}
          <p className="text-[10.5px] leading-snug text-slate-500">
            {vs.mode === "surface" && t("Rendered on the GPU: each surface point shows the value of the data cell it lies in (no interpolation). Below ~3,500 km the native grid is loaded for the view. Coastlines and borders are drawn above the data (1:50m).")}
            {vs.mode === "shell" && t(`Drawn ${SHELL_HEIGHT_M / 1000} km above the surface only to keep it separate from the ground layers. It shows a 2 m field; it is not a vertical profile of the atmosphere.`)}
            {vs.mode === "extrude" && (vs.kind === "anomaly"
              ? `Column height ∝ |anomaly| (top of scale = ${EXTRUDE_MAX_M / 1000 * vis.exaggeration} km); colour gives the sign. Heights are a visual encoding, not altitudes.`
              : `Column height ∝ value − scale minimum (top of scale = ${EXTRUDE_MAX_M / 1000 * vis.exaggeration} km). Heights are a visual encoding, not altitudes.`)}
            {vs.mode === "flow" && t(`${v.note} Each particle moves with the vector of the cell it is in (no interpolation); each streak is the recent path of one particle. The time step is scaled with the zoom so that the motion stays readable: compare speeds between places, not against a clock. Not a transport simulation.`)}
            {vs.mode !== "flow" && v.note && ` ${v.note}`}
          </p>
          <p className="text-[10px] text-slate-600">{t("Visualisation frames are quantised (step ≤ 0.01 ")}{units}{t("); Trend Detective uses the full-precision POWER point series.")}</p>
        </div>
      )}
    </Section>
  );
}
