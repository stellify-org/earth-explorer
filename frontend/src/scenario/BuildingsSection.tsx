import { t } from "../i18n";
import { create } from "zustand";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CesiumWidget } from "@cesium/engine";
import { onMainViewer } from "../globe/registry";
import { Notice, Section, Spinner } from "../components/ui";
import type { Flood } from "./model";
import { INTERSECTS, METRES_PER_LEVEL, NEAR, NEAR_BUFFER_M, OUTSIDE, PLACEHOLDER_HEIGHT_M, buildingId, classify, loadBuildings, type BuildingsPack } from "./buildings";
import { BuildingsLayer, COLOURS, SHOW_WITHIN_M } from "./buildingsScene";
import type { ScenarioScene } from "./scene";

const KEY = "ee.lab.buildings";

export const useBuildings = create<{ on: boolean; set: (on: boolean) => void }>((set) => ({
  on: (() => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } })(),
  set: (on) => { try { localStorage.setItem(KEY, on ? "1" : "0"); } catch {  } set({ on }); },
}));
const css = (c: readonly [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`;
const Swatch = ({ c }: { c: readonly [number, number, number] }) => <span className="inline-block h-3 w-4 shrink-0 rounded-sm" style={{ background: css(c) }} />;

export function BuildingsLegend() {
  const on = useBuildings((s) => s.on);
  if (!on) return null;
  return (
    <div className="mt-1.5 border-t border-space-600 pt-1.5" data-testid="buildings-legend">
      <div className="flex items-center gap-2"><Swatch c={COLOURS.outside} />{t("Building outside the modeled water")}</div>
      <div className="flex items-center gap-2"><Swatch c={COLOURS.near} />{t("Building within")} {NEAR_BUFFER_M} m {t("of the modeled water")}</div>
      <div className="flex items-center gap-2"><Swatch c={COLOURS.intersects} />{t("Footprint overlaps the modeled water")}</div>
      <div className="flex items-center gap-2"><Swatch c={COLOURS.selected} />{t("Selected building")}</div>
    </div>
  );
}

const CLASS_LABEL = ["Outside the modeled water", "Near the modeled water", "Overlaps the modeled water"];
const fmt = (n: number) => n.toLocaleString("en-US");

export function BuildingsSection({ scene, flood, before }: { scene: ScenarioScene; flood: Flood; before: boolean }) {
  const { on, set } = useBuildings();
  const [viewer, setViewer] = useState<CesiumWidget | null>(null);
  const [pack, setPack] = useState<BuildingsPack>();
  const [error, setError] = useState<string>();
  const [ids, setIds] = useState<ArrayBuffer>();
  const [selected, setSelected] = useState(-1);
  const [shown, setShown] = useState({ tiles: 0, buildings: 0 });
  useEffect(() => onMainViewer(setViewer), []);
  const floodRef = useRef(flood), useBuildingsBefore = useRef(before);
  floodRef.current = flood; useBuildingsBefore.current = before;

  useEffect(() => {
    if (!on || pack) return;
    let live = true; setError(undefined);
    loadBuildings().then((p) => live && setPack(p), (e) => live && setError(String((e as Error).message ?? e)));
    return () => { live = false; };
  }, [on, pack]);
  useEffect(() => { if (!pack) return; let live = true; pack.ids.then((b) => live && setIds(b)); return () => { live = false; }; }, [pack]);

  const layer = useMemo(() => (on && viewer && pack ? new BuildingsLayer(viewer, scene, pack.buildings, scene.current) : null), [on, viewer, pack, scene]);
  useEffect(() => {
    if (!layer || !viewer) return;
    layer.start(); layer.setFlood(useBuildingsBefore.current ? scene.baseline : floodRef.current);
    layer.onPick = (i) => setSelected(i);
    const count = () => setShown({ tiles: layer.tilesShown(), buildings: layer.buildingsShown() });
    const un = [viewer.camera.changed.addEventListener(count), viewer.camera.moveEnd.addEventListener(count)];
    count();
    const w = window as unknown as { __ee?: Record<string, unknown> };
    w.__ee = { ...(w.__ee ?? {}), buildings: layer };
    return () => { un.forEach((u) => u()); layer.destroy(); setSelected(-1); if (w.__ee) delete w.__ee.buildings; };
  }, [layer, viewer, scene]);

  useEffect(() => {
    if (!layer) return;
    const id = requestAnimationFrame(() => { layer.setFlood(before ? scene.baseline : flood); setShown({ tiles: layer.tilesShown(), buildings: layer.buildingsShown() }); });
    return () => cancelAnimationFrame(id);
  }, [layer, flood, before, scene]);
  useEffect(() => { layer?.select(selected); }, [layer, selected]);

  const summary = useMemo(() => (layer ? classify(scene.t, layer.cells, flood) : undefined), [layer, flood, scene]);
  const meta = pack?.meta;
  const nearest = useMemo(() => {
    if (!summary) return -1;
    let best = -1, rank = 0;
    for (let b = 0; b < summary.cls.length; b++) if (summary.cls[b] > rank) { rank = summary.cls[b]; best = b; if (rank === INTERSECTS) break; }
    return best;
  }, [summary]);
  const info = layer && selected >= 0 ? layer.describe(selected) : undefined;

  const sel = info && summary ? { cls: summary.cls[selected], distanceM: summary.distanceM[selected], depthM: summary.depthM[selected] } : undefined;

  return (
    <Section title={t("Buildings")} right={
      <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-slate-100">
        <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} data-testid="buildings-toggle" aria-label={t("Show Buildings")} />{t("Show Buildings")}
      </label>}>
      {!on && <p className="text-[11.5px] leading-snug text-slate-400">{t("Real mapped building outlines on the 3D terrain, coloured by where they lie relative to the modeled water.")}</p>}
      {on && error && <Notice tone="error">{t(error)}</Notice>}
      {on && !error && (!layer || !summary || !meta) && <Spinner label={t("Loading the buildings pack…")} />}
      {on && layer && summary && meta && (
        <div data-testid="buildings-summary">
          <table className="w-full text-[12px]"><tbody className="font-mono text-slate-100">
            <tr><td className="py-0.5 font-sans text-slate-300">{t("Total mapped buildings")}</td><td className="text-right" data-testid="buildings-total">{fmt(meta.count)}</td></tr>
            <tr><td className="py-0.5 font-sans text-slate-300"><Swatch c={COLOURS.intersects} /> {t("Overlap the modeled water")}</td><td className="text-right" data-testid="buildings-intersect">{fmt(summary.intersects)}</td></tr>
            <tr><td className="py-0.5 font-sans text-slate-300"><Swatch c={COLOURS.near} /> {t("Within")} {NEAR_BUFFER_M} m {t("of the modeled water")}</td><td className="text-right" data-testid="buildings-near">{fmt(summary.near)}</td></tr>
            <tr><td className="py-0.5 font-sans text-slate-300"><Swatch c={COLOURS.outside} /> {t("Outside")}</td><td className="text-right" data-testid="buildings-outside">{fmt(summary.outside)}</td></tr>
            <tr><td className="py-0.5 font-sans text-slate-300">{t("Without height information")}</td><td className="text-right" data-testid="buildings-noheight">{fmt(meta.height_tags.none)}</td></tr>
          </tbody></table>
          <p className="mt-1 text-[11px] leading-snug text-slate-400">{t("Counted against the water of your scenario at")} {flood.level.toFixed(1)} m. {t("Buildings without a mapped height are drawn")} {PLACEHOLDER_HEIGHT_M} m {t("high: a placeholder, not a measurement.")}</p>
          <p className="mt-1 text-[10.5px] leading-snug text-slate-500" data-testid="buildings-attribution">{meta.sources.map((x) => x.attribution).join(" · ")} · ODbL</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {nearest >= 0 && <button className="btn-warm" data-testid="buildings-fly-water" onClick={() => { layer.flyTo(nearest); setSelected(nearest); }}>{t("Go to a building at the water")}</button>}
            <button className="btn-soft" data-testid="buildings-fly-dense" onClick={() => layer.flyTo(layer.densest(), 2_500)}>{t("Go to the densest group")}</button>
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-slate-400" data-testid="buildings-shown">
            {shown.buildings > 0 ? <>{t("Drawn now:")} {fmt(shown.buildings)} {t("buildings near the camera.")}</> : <>{t("No buildings are drawn at this distance: zoom in.")}</>} {t("Buildings are drawn within")} {SHOW_WITHIN_M / 1000} km {t("of the camera; red and yellow ones keep a dot at any distance.")}</p>

          {info && sel && (
            <div className="mt-2 rounded-lg border border-space-600 p-2" data-testid="building-info">
              <div className="flex items-center justify-between gap-2"><span className="label">{t("Selected building")}</span>
                <button className="text-[11px] text-slate-400 hover:text-white" onClick={() => setSelected(-1)} aria-label={t("Close")}>✕</button></div>
              <table className="mt-1 w-full text-[11.5px]"><tbody className="text-slate-100">
                {meta.names[String(selected)] && <tr><td className="pr-2 text-slate-400">{t("Name")}</td><td>{meta.names[String(selected)]}</td></tr>}
                <tr><td className="pr-2 text-slate-400">{t("Source")}</td><td>{meta.sources[info.building.source].name}</td></tr>
                <tr><td className="pr-2 text-slate-400">{t("Identifier")}</td><td className="font-mono break-all" data-testid="building-id">{ids ? (info.building.idKind === 3 ? buildingId(ids, info.building)
                  : <a className="text-accent hover:underline" target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/${buildingId(ids, info.building)}`}>{buildingId(ids, info.building)}</a>) : "—"}</td></tr>
                {meta.kinds[info.building.kind] && <tr><td className="pr-2 text-slate-400">{t("Type in the map data")}</td><td>{meta.kinds[info.building.kind]}</td></tr>}
                <tr><td className="pr-2 text-slate-400">{t("Position")}</td><td className="font-mono">{info.building.lat.toFixed(5)}°N, {info.building.lon.toFixed(5)}°E</td></tr>
                <tr><td className="pr-2 text-slate-400">{t("Footprint area")}</td><td className="font-mono">{info.areaM2.toFixed(0)} m²</td></tr>
                <tr><td className="pr-2 text-slate-400">{t("Height")}</td><td data-testid="building-height">{info.building.heightSource === "height" ? <span className="font-mono">{info.building.heightM} m</span>
                  : info.building.heightSource === "levels" ? <><span className="font-mono">≈ {info.building.heightM} m</span> ({info.building.levels} {t("levels")} × {METRES_PER_LEVEL} m, {t("approximate")})</>
                  : <>{t("not mapped")} ({t("drawn")} {PLACEHOLDER_HEIGHT_M} m)</>}</td></tr>
                <tr><td className="pr-2 text-slate-400">{t("Ground elevation")}</td><td className="font-mono">{Number.isNaN(info.groundM) ? "—" : `${info.groundM} m`}</td></tr>
                <tr><td className="pr-2 text-slate-400">{t("In your scenario")}</td><td data-testid="building-class" data-class={sel.cls}><Swatch c={sel.cls === INTERSECTS ? COLOURS.intersects : sel.cls === NEAR ? COLOURS.near : COLOURS.outside} /> {t(CLASS_LABEL[sel.cls])}</td></tr>
                {sel.cls === NEAR && <tr><td className="pr-2 text-slate-400">{t("Distance to the modeled water")}</td><td className="font-mono">≈ {sel.distanceM.toFixed(0)} m</td></tr>}
                {sel.cls === INTERSECTS && <tr><td className="pr-2 text-slate-400">{t("Modeled water depth at the ground")}</td><td data-testid="building-depth">{Number.isNaN(sel.depthM) ? t("not available") : <span className="font-mono">≈ {sel.depthM.toFixed(0)} m</span>}</td></tr>}
              </tbody></table>
              <p className="mt-1 text-[10.5px] leading-snug text-slate-400">{t("Ground elevation and depth come from elevation cells about 60 m wide with whole-metre heights: the lowest cell under the outline. Depth = scenario level − that elevation.")}
                {sel.cls !== OUTSIDE && <> {t("This is a geometric overlap only. It does not say whether the building would be damaged.")}</>}</p>
            </div>
          )}

          <div className="mt-2" />
          <Notice tone="warn">{t("Overlap of map outlines with the modeled water surface only. It is not an estimate of damage, casualties or financial loss, and nothing downstream of the dam is modeled.")}</Notice>
          <details className="mt-2" data-testid="buildings-advanced">
            <summary className="cursor-pointer text-[12.5px] font-medium text-accent">{t("Advanced")}</summary>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] leading-snug text-slate-400">
              {meta.sources.map((s) => <li key={s.key}><b className="text-slate-300">{fmt(s.count)}</b> — {s.name}. {s.attribution}. {s.licence}. {s.note && t(s.note)}</li>)}
              <li>{t(meta.coverage_note)}</li>
              <li>{t("Red: the outline overlaps at least one elevation cell that the model marks as water. Yellow: no overlap, but such a cell lies within")} {NEAR_BUFFER_M} m {t("of the outline. Grey: neither.")}</li>
              <li>{t("Many outlines that overlap the water below the full level are probably detection errors or floating structures: the reservoir is filled to that level in ordinary years.")}</li>
              <li>{t("Height tags:")} {meta.height_tags.height} height, {meta.height_tags.levels} building:levels, {fmt(meta.height_tags.none)} {t("none")}. {t("Building heights are drawn ×2, like the terrain.")}</li>
              <li>{t("Map data retrieved")} {meta.retrieved_at.slice(0, 10)}. {t("Stored locally after the first use.")}</li>
            </ul>
          </details>
        </div>
      )}
    </Section>
  );
}
