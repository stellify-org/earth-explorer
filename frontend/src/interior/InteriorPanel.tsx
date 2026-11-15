import { t } from "../i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { ScreenSpaceEventHandler, ScreenSpaceEventType, type CesiumWidget } from "@cesium/engine";
import { Cartesian2, HeadingPitchRange, Math as CMath, BoundingSphere } from "@cesium/core";
import { Button, Notice, Section } from "../components/ui";
import { useStore } from "../store";
import { CRUST_CITATION, CRUST_LAYERS, MANTLE_COLOR, PLANET_LAYERS, PREM_CITATION, loadCrust1, samplePath, type Crust1, type CrustCell, type PathSample } from "./model";
import { InteriorScene } from "./scene";

export type InteriorMode = "cutaway" | "crust" | "section" | "quakes";
const fmt = (x: number, d = 2) => x.toFixed(d);
const ll = (p: { lat: number; lon: number }) => `${Math.abs(p.lat).toFixed(2)}°${p.lat >= 0 ? "N" : "S"}, ${Math.abs(p.lon).toFixed(2)}°${p.lon >= 0 ? "E" : "W"}`;

function useScene(viewer: CesiumWidget) {
  const scene = useMemo(() => new InteriorScene(viewer), [viewer]);
  useEffect(() => {
    const ctl = viewer.scene.screenSpaceCameraController, before = ctl.enableCollisionDetection;
    ctl.enableCollisionDetection = false;
    return () => { if (!viewer.isDestroyed()) { scene.clear(); ctl.enableCollisionDetection = before; } };
  }, [viewer, scene]);
  return scene;
}

function usePick<T>(viewer: CesiumWidget, key: string, onPick: (v: T | undefined) => void) {
  const cb = useRef(onPick); cb.current = onPick;
  useEffect(() => {
    const h = new ScreenSpaceEventHandler(viewer.scene.canvas);
    h.setInputAction((m: { position: Cartesian2 }) => {
      const id = (viewer.scene.pick(m.position) as { id?: Record<string, unknown> } | undefined)?.id;
      if (id && typeof id === "object" && key in id) cb.current(id[key] as T);
    }, ScreenSpaceEventType.LEFT_CLICK);
    return () => h.destroy();
  }, [viewer, key]);
}
function useCrust1() {
  const [st, setSt] = useState<{ model?: Crust1; error?: string }>({});
  useEffect(() => { let on = true; loadCrust1().then((model) => on && setSt({ model }), (e) => on && setSt({ error: String((e as Error).message ?? e) })); return () => { on = false; }; }, []);
  return st;
}

const DEFAULT_LAYERS = () => Object.fromEntries(PLANET_LAYERS.map((l) => [l.id, { show: true, alpha: 1 }]));
export function CutawayPanel({ viewer }: { viewer: CesiumWidget }) {
  const scene = useScene(viewer);
  const [centerLon] = useState(() => CMath.toDegrees(viewer.camera.positionCartographic.longitude));
  const [angle, setAngle] = useState(90);
  const [crustEx, setCrustEx] = useState(5);
  const [layers, setLayers] = useState(DEFAULT_LAYERS);
  const [selected, setSelected] = useState<string>();
  usePick<string>(viewer, "interiorLayer", setSelected);
  useEffect(() => { scene.cutaway({ centerLon, angle, crustExaggeration: crustEx, layers }); }, [scene, centerLon, angle, crustEx, layers]);
  useEffect(() => { scene.viewCutaway(centerLon); }, [scene, centerLon]);
  const sel = PLANET_LAYERS.find((l) => l.id === selected);
  const set = (id: string, patch: Partial<{ show: boolean; alpha: number }>) => setLayers((s) => ({ ...s, [id]: { ...s[id], ...patch } }));
  return (
    <>
      <Section title={t("Planetary cutaway")}>
        <Notice tone="info">{t("Schematic view of a reference Earth model, not a direct observation: nobody has seen these layers. Boundaries come from seismology and are drawn as perfect shells.")}</Notice>
        <label className="mt-2 block text-[11px] text-slate-400">{t("Opening angle: ")}<b className="text-slate-200" data-testid="cutaway-angle">{angle}°</b>
          <input type="range" min={0} max={300} step={5} value={angle} onChange={(e) => setAngle(Number(e.target.value))} className="w-full" aria-label={t("Opening angle")} /></label>
        <label className="mt-1 block text-[11px] text-slate-400">{t("Crust drawn thicker: ")}<b className="text-slate-200">×{crustEx}</b>
          <input type="range" min={1} max={10} step={1} value={crustEx} onChange={(e) => setCrustEx(Number(e.target.value))} className="w-full" aria-label={t("Crust exaggeration")} /></label>
        <p className="text-[10.5px] text-slate-500">{t("Only the crust is exaggerated (at true scale it is 0.4% of the radius). All other boundaries are at their model depth.")}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button onClick={() => scene.viewCutaway(centerLon)}>{t("View whole cutaway")}</Button>
          <Button onClick={() => scene.viewCutaway(centerLon, true)}>{t("Interior close-up")}</Button>
          <Button onClick={() => { setAngle(0); setLayers(DEFAULT_LAYERS()); setCrustEx(5); setSelected(undefined); scene.viewCutaway(centerLon); }}>{t("Reset to complete globe")}</Button>
        </div>
      </Section>
      <Section title={t("Layers")}>
        <ul className="space-y-1.5">
          {PLANET_LAYERS.map((l) => (
            <li key={l.id} className={`rounded px-1.5 py-1 ${selected === l.id ? "bg-accent/10" : ""}`}>
              <div className="flex items-center gap-2 text-[11.5px] text-slate-200">
                <input type="checkbox" checked={layers[l.id].show} onChange={(e) => set(l.id, { show: e.target.checked })} aria-label={t("Show layer")} />
                <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: l.color }} />
                <button className="flex-1 text-left hover:text-accent" onClick={() => setSelected(l.id)}>{t(l.name)}</button>
                <span className="font-mono text-[10.5px] text-slate-400">{l.top}–{l.bottom}{t(" km")}</span>
              </div>
              <label className="flex items-center gap-2 pl-7 text-[10.5px] text-slate-500">{t("Opacity")}
                <input type="range" min={0.1} max={1} step={0.1} value={layers[l.id].alpha} disabled={!layers[l.id].show} onChange={(e) => set(l.id, { alpha: Number(e.target.value) })} className="flex-1" aria-label={t("Layer opacity")} />
                <span className="w-8 text-right">{Math.round(layers[l.id].alpha * 100)}%</span></label>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-[10.5px] text-slate-500">{t("Click a layer on the globe or its name for details.")}</p>
      </Section>
      {sel && (
        <Section title={t("Selected layer")}>
          <p className="text-sm text-slate-100" data-testid="cutaway-selected">{t(sel.name)}</p>
          <p className="font-mono text-[11px] text-slate-300">{t("Depth ")}{sel.top}–{sel.bottom}{t(" km")} · {t("thickness ")}{fmt(sel.bottom - sel.top, 1)}{t(" km")}</p>
          <p className="mt-1 text-[11px] leading-snug text-slate-400">{t(sel.description)}</p>
        </Section>
      )}
      <Section title={t("Source")}>
        <p className="text-[10.5px] leading-snug text-slate-400">{t("Layer boundaries: Preliminary Reference Earth Model (PREM), a radially symmetric average of the Earth.")} {PREM_CITATION}</p>
      </Section>
    </>
  );
}

function CrustUnavailable({ error }: { error: string }) {
  return <div className="p-4"><Notice tone="warn">{t("Real-data mode unavailable: the CRUST1.0 file is not installed or could not be read.")} {error}. {t("The planetary cutaway does not need it.")}</Notice></div>;
}
function CrustSource() {
  return (
    <Section title={t("Model and limits")}>
      <p className="text-[10.5px] leading-snug text-slate-400">{t("CRUST1.0 gives one average column per 1° × 1° cell (about 111 km north–south). It is a global model built from seismic data and geological settings, with no uncertainty estimate per cell; it cannot show the geology under a town, a building or a street. Values are shown exactly as in the model, without interpolation.")}</p>
      <p className="mt-1 text-[10.5px] leading-snug text-slate-400">{CRUST_CITATION} <a className="text-accent hover:underline" href="https://igppweb.ucsd.edu/~gabi/crust1.html" target="_blank" rel="noreferrer">igppweb.ucsd.edu/~gabi/crust1.html</a></p>
    </Section>
  );
}
function LayerTable({ cell, selected, onSelect }: { cell: CrustCell; selected?: number; onSelect: (i: number) => void }) {
  return (
    <table className="mt-2 w-full text-[10.5px]" data-testid="crust-table">
      <thead><tr className="text-left text-slate-500"><th className="font-normal">{t("Layer")}</th><th className="font-normal">{t("Top, km")}</th><th className="font-normal">{t("Bottom, km")}</th><th className="font-normal">{t("Thick., km")}</th></tr></thead>
      <tbody>
        {cell.layers.map((l) => (
          <tr key={l.index} onClick={() => onSelect(l.index)} className={`cursor-pointer text-slate-200 hover:bg-space-800 ${selected === l.index ? "bg-accent/10" : ""}`}>
            <td><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: l.color }} />{t(l.name)}</td>
            <td className="font-mono">{fmt(l.top)}</td><td className="font-mono">{fmt(l.bottom)}</td><td className="font-mono">{fmt(l.thickness)}</td>
          </tr>
        ))}
        <tr onClick={() => onSelect(8)} className={`cursor-pointer text-slate-200 hover:bg-space-800 ${selected === 8 ? "bg-accent/10" : ""}`}>
          <td><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: MANTLE_COLOR }} />{t("Mantle below the Moho")}</td>
          <td className="font-mono">{fmt(cell.moho)}</td><td>—</td><td>—</td>
        </tr>
      </tbody>
    </table>
  );
}
function LayerDetails({ cell, index }: { cell: CrustCell; index: number }) {
  const l = cell.layers.find((x) => x.index === index);
  const p = index === 8 ? cell.mantle : l;
  if (!p) return <p className="mt-2 text-[11px] text-slate-400">{t(CRUST_LAYERS[index].name)}: {t("this layer is absent in this cell (thickness 0 in the model).")}</p>;
  return (
    <div className="mt-2 rounded border border-space-600 p-2 text-[11px]" data-testid="crust-details">
      <p className="text-slate-100">{index === 8 ? t("Mantle below the Moho") : t(l!.name)}</p>
      {l && <p className="font-mono text-slate-300">{fmt(l.top)} … {fmt(l.bottom)}{t(" km relative to sea level")} · {fmt(l.thickness)}{t(" km thick")}</p>}
      <p className="font-mono text-slate-300">Vp {fmt(p.vp)} km/s · Vs {fmt(p.vs)} km/s · ρ {fmt(p.rho)} g/cm³</p>
      <p className="mt-1 text-[10.5px] text-slate-500">{t("P- and S-wave speed and density given by the model for this layer in this cell.")}{index === 8 ? " " + t("Values just below the Moho.") : ""}</p>
    </div>
  );
}

export function CrustPanel({ viewer }: { viewer: CesiumWidget }) {
  const scene = useScene(viewer);
  const place = useStore((s) => s.place);
  const { model, error } = useCrust1();
  const [ex, setEx] = useState(3);
  const [mantleKm, setMantleKm] = useState(10);
  const [selected, setSelected] = useState<number>();
  usePick<number>(viewer, "crustLayer", setSelected);
  const cell = useMemo(() => (model && place ? model.cell(place.lat, place.lon) : undefined), [model, place?.lat, place?.lon]); // eslint-disable-line react-hooks/exhaustive-deps
  const view = useRef<{ centre: BoundingSphere["center"]; radius: number }>(undefined);
  const fly = () => { if (view.current) viewer.camera.flyToBoundingSphere(new BoundingSphere(view.current.centre, view.current.radius), { offset: new HeadingPitchRange(CMath.toRadians(25), CMath.toRadians(-18), view.current.radius * 3.2), duration: 1.5 }); };
  useEffect(() => { if (!cell) { scene.clear(); return; } view.current = scene.column(cell, ex, mantleKm); }, [scene, cell, ex, mantleKm]);
  useEffect(() => { if (cell) fly(); }, [cell?.lat, cell?.lon]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <CrustUnavailable error={error} />;
  return (
    <>
      <Section title={t("Crust Explorer")}>
        {!place && <Notice tone="info">{t("Click anywhere on the globe to read the CRUST1.0 column of that place.")}</Notice>}
        {!model && !error && <p className="text-[11px] text-slate-400">{t("Loading CRUST1.0…")}</p>}
        {place && cell && (
          <>
            <p className="text-[11.5px] text-slate-200">{t("Selected point: ")}<span className="font-mono text-accent">{ll(place)}</span></p>
            <p className="text-[11px] text-slate-400">{t("Model cell (1° × 1°), centre ")}<span className="font-mono" data-testid="crust-cell">{ll(cell)}</span></p>
            <p className="mt-1 font-mono text-[11px] text-slate-300" data-testid="crust-summary">{t("Surface ")}{fmt(cell.surface)}{t(" km")} · {t("Moho ")}{fmt(cell.moho)}{t(" km")} · {t("crust ")}{fmt(cell.crustThickness)}{t(" km")}</p>
            <p className="text-[10.5px] text-slate-500">{t("Elevations are relative to sea level (negative = below). Crust = top of rock (below water and ice) to the Moho.")}</p>
            <label className="mt-2 block text-[11px] text-slate-400">{t("Vertical exaggeration of the 3D block: ")}<b className="text-slate-200">×{ex}</b>
              <input type="range" min={1} max={10} step={1} value={ex} onChange={(e) => setEx(Number(e.target.value))} className="w-full" aria-label={t("Vertical exaggeration")} /></label>
            <label className="block text-[11px] text-slate-400">{t("Depth range: mantle shown below the Moho: ")}<b className="text-slate-200">{mantleKm}{t(" km")}</b>
              <input type="range" min={0} max={50} step={5} value={mantleKm} onChange={(e) => setMantleKm(Number(e.target.value))} className="w-full" aria-label={t("Depth range")} /></label>
            <p className="text-[10.5px] text-slate-500">{t("The block is lifted above the surface so it can be seen, and stretched vertically by the factor above. The numbers in the table are the model values, not the drawn sizes.")}</p>
            <Button className="mt-1" onClick={fly}>{t("View crust block")}</Button>
            <LayerTable cell={cell} selected={selected} onSelect={setSelected} />
            {selected !== undefined && <LayerDetails cell={cell} index={selected} />}
          </>
        )}
      </Section>
      <CrustSource />
    </>
  );
}

function Profile({ samples, lengthKm, maxDepth, onHover }: { samples: PathSample[]; lengthKm: number; maxDepth: number; onHover: (s?: PathSample) => void }) {
  const W = 300, H = 170, L = 30, B = 18, top = Math.max(...samples.map((s) => s.cell.surface), 0);
  const x = (km: number) => L + (km / lengthKm) * (W - L - 4), y = (z: number) => 4 + ((top - z) / (top + maxDepth)) * (H - B - 4);
  const ticks = [0, -10, -20, -30, -40, -50, -60, -70].filter((z) => -z <= maxDepth);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full rounded bg-space-950" data-testid="section-profile" onMouseLeave={() => onHover(undefined)}
      onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const km = (((e.clientX - r.left) / r.width) * W - L) / (W - L - 4) * lengthKm; onHover(samples.reduce((a, b) => (Math.abs(b.km - km) < Math.abs(a.km - km) ? b : a))); }}>
      <clipPath id="sec-clip"><rect x={L} y={4} width={W - L - 4} height={H - B - 4} /></clipPath>
      <g clipPath="url(#sec-clip)">
        {samples.slice(0, -1).map((s, i) => {
          const x0 = x(s.km), w = x(samples[i + 1].km) - x0 + 0.3;
          return <g key={i}>
            <rect x={x0} y={y(s.cell.moho)} width={w} height={H} fill={MANTLE_COLOR} />
            {s.cell.layers.map((l) => <rect key={l.index} x={x0} y={y(l.top)} width={w} height={Math.max(0, y(l.bottom) - y(l.top))} fill={l.color} />)}
          </g>;
        })}
      </g>
      {ticks.map((z) => <g key={z}><line x1={L - 3} x2={L} y1={y(z)} y2={y(z)} stroke="#64748b" /><text x={L - 5} y={y(z) + 3} textAnchor="end" fontSize="8" fill="#94a3b8">{z}</text></g>)}
      {[0, 0.5, 1].map((f) => <text key={f} x={x(f * lengthKm)} y={H - 6} textAnchor={f === 0 ? "start" : f === 1 ? "end" : "middle"} fontSize="8" fill="#94a3b8">{Math.round(f * lengthKm)} km</text>)}
      <text x={L + 2} y={12} fontSize="9" fill="#e2e8f0">A</text><text x={W - 6} y={12} textAnchor="end" fontSize="9" fill="#e2e8f0">B</text>
      <text x={4} y={10} fontSize="7" fill="#94a3b8">km</text>
    </svg>
  );
}
export function SectionPanel({ viewer }: { viewer: CesiumWidget }) {
  const scene = useScene(viewer);
  const place = useStore((s) => s.place);
  const { model, error } = useCrust1();
  const [a, setA] = useState<{ lat: number; lon: number }>();
  const [b, setB] = useState<{ lat: number; lon: number }>();
  const [ex, setEx] = useState(20);
  const [maxDepth, setMaxDepth] = useState(70);
  const [shown, setShown] = useState<{ samples: PathSample[]; lengthKm: number }>();
  const [hover, setHover] = useState<PathSample>();
  const [selected, setSelected] = useState<number>();
  usePick<number>(viewer, "crustLayer", setSelected);
  const sphere = useRef<BoundingSphere>(undefined);
  const fly = () => { if (sphere.current) viewer.camera.flyToBoundingSphere(sphere.current, { offset: new HeadingPitchRange(0, CMath.toRadians(-35), sphere.current.radius * 2.6), duration: 1.5 }); };
  useEffect(() => { if (!shown) { scene.clear(); return; } sphere.current = scene.section(shown.samples, ex); }, [scene, shown, ex]);
  useEffect(() => { if (shown) fly(); }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <CrustUnavailable error={error} />;
  const cells = shown ? new Set(shown.samples.map((s) => `${s.cell.lat},${s.cell.lon}`)).size : 0;
  const at = hover ?? shown?.samples[0];
  return (
    <>
      <Section title={t("Geological cross-section")}>
        <p className="text-[11px] text-slate-400">{t("Click a point on the globe, then store it as A or B.")}</p>
        <p className="mt-1 text-[11.5px] text-slate-200">{t("Selected point: ")}<span className="font-mono text-accent">{place ? ll(place) : "—"}</span></p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <Button disabled={!place} onClick={() => { setA(place && { lat: place.lat, lon: place.lon }); setShown(undefined); }}>{t("Set point A")}</Button>
          <Button disabled={!place} onClick={() => { setB(place && { lat: place.lat, lon: place.lon }); setShown(undefined); }}>{t("Set point B")}</Button>
        </div>
        <p className="mt-1.5 font-mono text-[11px] text-slate-300">A: <span data-testid="section-a">{a ? ll(a) : "—"}</span><br />B: <span data-testid="section-b">{b ? ll(b) : "—"}</span></p>
        <Button className="mt-2 w-full" active disabled={!a || !b || !model} onClick={() => { if (a && b && model) { setSelected(undefined); setShown(samplePath(model, a, b)); } }}>{t("Show geological profile")}</Button>
        {!model && !error && <p className="mt-1 text-[11px] text-slate-400">{t("Loading CRUST1.0…")}</p>}
      </Section>
      {shown && at && (
        <Section title={t("Profile A–B")}>
          <p className="font-mono text-[11px] text-slate-300" data-testid="section-summary">{t("Length ")}{Math.round(shown.lengthKm)}{t(" km")} · {shown.samples.length}{t(" samples")} · {cells}{t(" model cells")}</p>
          <Profile samples={shown.samples} lengthKm={shown.lengthKm} maxDepth={maxDepth} onHover={setHover} />
          <p className="text-[10.5px] text-slate-500">{t("Vertical axis: elevation relative to sea level, km. Horizontal axis: distance along the great circle from A. The drawing is stretched vertically; steps are the edges of 1° model cells, not real faults.")}</p>
          <label className="mt-1 block text-[11px] text-slate-400">{t("Depth shown in the chart: ")}<b className="text-slate-200">{maxDepth}{t(" km")}</b>
            <input type="range" min={10} max={80} step={10} value={maxDepth} onChange={(e) => setMaxDepth(Number(e.target.value))} className="w-full" aria-label={t("Depth shown")} /></label>
          <label className="block text-[11px] text-slate-400">{t("Vertical exaggeration of the 3D curtain: ")}<b className="text-slate-200">×{ex}</b>
            <input type="range" min={1} max={50} step={1} value={ex} onChange={(e) => setEx(Number(e.target.value))} className="w-full" aria-label={t("Vertical exaggeration")} /></label>
          <Button className="mt-1" onClick={fly}>{t("View cross-section")}</Button>
          <p className="mt-2 text-[11px] text-slate-200">{hover ? t("Under the cursor: ") : t("At point A: ")}<span className="font-mono">{Math.round(at.km)}{t(" km")} · {ll(at)}</span></p>
          <p className="font-mono text-[11px] text-slate-300">{t("Surface ")}{fmt(at.cell.surface)}{t(" km")} · {t("Moho ")}{fmt(at.cell.moho)}{t(" km")} · {t("crust ")}{fmt(at.cell.crustThickness)}{t(" km")}</p>
          <LayerTable cell={at.cell} selected={selected} onSelect={setSelected} />
          {selected !== undefined && <LayerDetails cell={at.cell} index={selected} />}
        </Section>
      )}
      <CrustSource />
    </>
  );
}
