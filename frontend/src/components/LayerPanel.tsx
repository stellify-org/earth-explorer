import { t } from "../i18n";
import { useMemo } from "react";
import { ensureLayers, useLowBandwidth, useStore } from "../store";
import { Button, Notice, Section, selectCls } from "./ui";
import { TERRAIN_ATTRIBUTION } from "../globe/terrain";

export default function LayerPanel({ terrainError }: { terrainError?: string }) {
  const s = useStore();
  const low = useLowBandwidth();

  const confirmHeavy = (what: string, perView: string) => !low || window.confirm(`Low Bandwidth Mode is on.\n\n${what} downloads roughly ${perView} for each new view (measured tile sizes; varies with zoom and region). At 1 Mbit/s that is several seconds per view.\n\nContinue?`);

  const satChoices = useMemo(() => [...s.layers.filter((l) => l.group === "base"), ...s.layers.filter((l) => l.group === "true_color")], [s.layers]);
  const vizChoices = useMemo(() => s.layers.filter((l) => l.group === "science"), [s.layers]);
  const sat = s.layers.find((l) => l.id === s.satelliteId);
  const viz = s.layers.find((l) => l.id === s.vizId);

  return (
    <>
      <Section title={t("Base Earth · local, works offline")}>
        <div className="flex gap-1.5">
          <Button active={s.baseStyle === "vector"} onClick={() => s.setBaseStyle("vector")}>{t("Vector geography")}</Button>
          <Button active={s.baseStyle === "relief"} onClick={() => s.setBaseStyle("relief")}>{t("Shaded relief")}</Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button active={s.showBorders} onClick={() => s.toggle("showBorders")}>{t("Borders")}</Button>
          <Button active={s.showCoastlines} onClick={() => s.toggle("showCoastlines")}>{t("Coasts & lakes")}</Button>
          <Button active={s.showRivers} onClick={() => s.toggle("showRivers")}>{t("Rivers")}</Button>
          <Button active={s.showLabels} onClick={() => s.toggle("showLabels")}>{t("Labels")}</Button>
        </div>
        <p className="mt-2 text-[10.5px] leading-snug text-slate-500">{t(" Natural Earth 1:110m → 1:50m → 1:10m, more detail as you zoom (public domain). Present-day boundaries; disputed lines dashed. ")}{s.baseStyle === "relief" && t(" Relief: Natural Earth II raster bundled with CesiumJS (coarse, ~20 km).")}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <Button active={s.terrain} onClick={() => { if (s.terrain || confirmHeavy("Terrain (DEM tiles)", "up to about 13 MB for a low oblique view (about 80 kB per tile)")) s.toggle("terrain"); }} title={TERRAIN_ATTRIBUTION}>{t("Terrain (3D relief)")}</Button>
          <span className="text-[10.5px] text-slate-500">{s.terrain ? t("Elevation tiles, loaded only for the view (from a downloaded 3D pack when offline)") : t("Off: smooth ellipsoid")}</span>
        </div>
        {s.terrain && (
          <label className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-400">
            <input type="checkbox" checked={s.reliefShading} onChange={() => s.toggle("reliefShading")} />{t(" Relief shading (hillshade from the same DEM, light from the north-west) ")}</label>
        )}
        {terrainError && s.terrain && <p className="mt-1 text-[10.5px] text-amber-300">{terrainError}</p>}
      </Section>

      <Section title={t("Satellite imagery · NASA GIBS")}>
        <select className={selectCls} value={s.satelliteId ?? ""} onChange={(e) => { const v = e.target.value || undefined; if (!v || confirmHeavy("Satellite imagery (NASA GIBS)", "0.4–1.5 MB (20–40 tiles of 15–40 kB)")) s.setSatellite(v); }} aria-label={t("Satellite imagery")} onFocus={() => ensureLayers().catch(() => {})} onMouseDown={() => ensureLayers().catch(() => {})}>
          <option value="">{t("Off")}</option>
          {satChoices.length === 0 && <option disabled>{t("Loading layer list…")}</option>}
          {satChoices.map((l) => <option key={l.id} value={l.id}>{t(l.short_name)}{l.group === "base" ? t(" — cloud-free composite (static)") : ""}</option>)}
        </select>
        {sat && (
          <div className="mt-1.5 space-y-1 text-[10.5px] leading-snug text-slate-400">
            <p>{t(sat.data_resolution_note)}{t(". Date follows the timeline.")}</p>
            <p className="flex items-center gap-1.5"><span className="inline-block h-3 w-5 rounded-sm" style={{ background: "repeating-linear-gradient(45deg, #22362f 0 4px, #8b98a8 4px 5px)" }} />{t(" Hatched = no observation shown here for this date (orbit gap, polar night, or tile not loaded yet).")}</p>
            <p>{t("Daily mosaics join neighbouring orbits taken at different times; GIBS zoom levels can come from different overpasses, so straight seams may appear. That is in the source imagery.")}</p>
            {sat.caveat && <Notice tone="warn">{t(sat.caveat)}</Notice>}
          </div>
        )}
      </Section>

      <Section title={t("NASA visualisations · imagery")}>
        <select className={selectCls} value={s.vizId ?? ""} onChange={(e) => { const v = e.target.value || undefined; if (!v || confirmHeavy("A NASA visualisation layer (GIBS)", "0.2–1 MB")) s.setViz(v); }} aria-label={t("NASA visualisation layer")} onFocus={() => ensureLayers().catch(() => {})} onMouseDown={() => ensureLayers().catch(() => {})}>
          <option value="">{t("None")}</option>
          {vizChoices.map((l) => <option key={l.id} value={l.id}>{t(l.short_name)}</option>)}
        </select>
        {viz && (
          <div className="mt-2 space-y-1.5">
            <input type="range" min={0} max={1} step={0.05} value={s.vizOpacity} onChange={(e) => s.setVizOpacity(Number(e.target.value))} className="w-full" aria-label={t("Visualisation opacity")} />
            {viz.legend_url && <img src={viz.legend_url} alt={`Legend for ${viz.short_name}`} className="w-full rounded bg-white/90 p-1" loading="lazy" />}
            <p className="text-[10.5px] text-slate-400">{t(viz.measures)}. {t(viz.data_resolution_note)}{t(". Colour-mapped by NASA; never read as numbers here.")}</p>
            {viz.caveat && <Notice tone="warn">{t(viz.caveat)}</Notice>}
          </div>
        )}
      </Section>

    </>
  );
}
