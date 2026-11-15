import { t } from "../i18n";
import { useEffect, useRef, useState } from "react";
import {
  PointPrimitive, PointPrimitiveCollection, PolylineCollection, ScreenSpaceEventHandler, ScreenSpaceEventType, Material, type CesiumWidget,
} from "@cesium/engine";
import {
  BoundingSphere, HeadingPitchRange, Cartesian2, Cartesian3, Color, Math as CMath, NearFarScalar,
} from "@cesium/core";
import { api, ApiError } from "../api/client";
import { quakeParams, type QuakeQuery } from "../api/url";
import SaveOffline from "../components/SaveOffline";
import { CrustPanel, CutawayPanel, SectionPanel, type InteriorMode } from "../interior/InteriorPanel";
import type { Quake, QuakeResponse } from "../api/types";
import { onMainViewer } from "../globe/registry";
import { useLowBandwidth, useStore } from "../store";
import { fmt } from "../lib/format";
import { Button, KindBadge, Notice, Section, Spinner, inputCls } from "../components/ui";

const DEPTH_CLASSES = [
  { max: 70, label: "Shallow (0–70 km)", color: "#fde68a" },
  { max: 300, label: "Intermediate (70–300 km)", color: "#f59e0b" },
  { max: Infinity, label: "Deep (> 300 km)", color: "#c2410c" },
];
const depthColor = (d: number) => DEPTH_CLASSES.find((c) => d <= c.max)!.color;

const REGIONS = [
  { label: "Pamir – Hindu Kush", minlat: 33, maxlat: 42, minlon: 65, maxlon: 77 },
  { label: "Japan", minlat: 28, maxlat: 46, minlon: 128, maxlon: 148 },
  { label: "Tonga – Fiji", minlat: -32, maxlat: -12, minlon: 172, maxlon: 192 },
  { label: "Andes (Chile)", minlat: -40, maxlat: -15, minlon: -78, maxlon: -62 },
  { label: "Global", minlat: -90, maxlat: 90, minlon: -180, maxlon: 180 },
];

const INTERIOR_MODES: [InteriorMode, string][] = [["cutaway", "Planetary Cutaway"], ["crust", "Crust Explorer"], ["section", "Geological Cross-Section"], ["quakes", "Earthquakes"]];

export default function XRayPanel() {
  const savedQuery = useStore((s) => s.savedQuakeQuery);

  const insideTab = useStore((s) => s.insideTab), insideToken = useStore((s) => s.insideToken);
  const [interior, setInterior] = useState<InteriorMode>(savedQuery ? "quakes" : insideTab);

  const firstToken = useRef(insideToken);
  useEffect(() => { if (insideToken !== firstToken.current) setInterior(insideTab); }, [insideToken]); // eslint-disable-line react-hooks/exhaustive-deps
  const quakes = interior === "quakes";
  const place = useStore((s) => s.place);
  const reliefShading = useStore((s) => s.reliefShading);
  const toggle = useStore((s) => s.toggle);
  const [viewer, setViewer] = useState<CesiumWidget | null>(null);
  const [region, setRegion] = useState(REGIONS[0]);
  const [start, setStart] = useState("2000-01-01");
  const [end, setEnd] = useState(new Date().toISOString().slice(0, 10));
  const [minmag, setMinmag] = useState(4.5);
  const [alpha, setAlpha] = useState(0.35);
  const [underground, setUnderground] = useState(true);
  const [res, setRes] = useState<{ data?: QuakeResponse; query?: QuakeQuery; loading: boolean; error?: string }>({ loading: false });
  const [picked, setPicked] = useState<Quake>();
  const prims = useRef<{ pts?: PointPrimitiveCollection; lines?: PolylineCollection }>({});

  useEffect(() => onMainViewer(setViewer), []);
  const low = useLowBandwidth();

  const autoLoaded = useRef(false);
  useEffect(() => {
    if (viewer && quakes && !autoLoaded.current && !low && !savedQuery) { autoLoaded.current = true; load(); }
  }, [viewer, low, quakes]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!viewer || !savedQuery) return;
    autoLoaded.current = true;
    setInterior("quakes");
    setRegion({ label: "Saved earthquake region", ...savedQuery });
    setStart(savedQuery.start); setEnd(savedQuery.end); setMinmag(savedQuery.minmag);
    void load(savedQuery);
  }, [viewer, savedQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!viewer) return;
    const g = viewer.scene.globe;

    const cutaway = interior === "cutaway";
    g.translucency.enabled = quakes || cutaway;
    g.translucency.frontFaceAlpha = cutaway ? 0.995 : alpha;
    g.translucency.backFaceAlpha = cutaway ? 0 : Math.min(1, alpha + 0.2);
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = !cutaway;
    if (quakes) viewer.scene.screenSpaceCameraController.enableCollisionDetection = !underground;
    if (prims.current.pts) prims.current.pts.show = quakes;
    if (prims.current.lines) prims.current.lines.show = quakes;
    viewer.scene.requestRender();
  }, [viewer, alpha, underground, quakes, interior]);
  useEffect(() => () => {
    if (!viewer || viewer.isDestroyed()) return;
    viewer.scene.globe.translucency.enabled = false;
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
    viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;
    if (prims.current.pts) viewer.scene.primitives.remove(prims.current.pts);
    if (prims.current.lines) viewer.scene.primitives.remove(prims.current.lines);
    prims.current = {};
    viewer.scene.requestRender();
  }, [viewer]);

  useEffect(() => {
    if (!viewer) return;
    const h = new ScreenSpaceEventHandler(viewer.scene.canvas);
    h.setInputAction((m: { position: Cartesian2 }) => {
      const p = viewer.scene.pick(m.position);
      const q = (p?.primitive as PointPrimitive | undefined)?.id as Quake | undefined;
      setPicked(q && typeof q === "object" && "depth_km" in q ? q : undefined);
    }, ScreenSpaceEventType.LEFT_CLICK);
    return () => h.destroy();
  }, [viewer]);

  const load = async (query = quakeParams({ ...region, start, end, minmag, limit: 5000 })) => {
    setRes({ loading: true });
    setPicked(undefined);
    try {
      const data = await api.earthquakes(query);
      setRes({ data, query, loading: false });
      draw(data.events);
      if (viewer && data.events.length) {

        const sphere = BoundingSphere.fromPoints(data.events.map((q) => Cartesian3.fromDegrees(q.lon, q.lat, -q.depth_km * 1000)));
        const radius = Math.max(sphere.radius, 300_000);
        viewer.camera.flyToBoundingSphere(new BoundingSphere(sphere.center, radius), { offset: new HeadingPitchRange(0, CMath.toRadians(-40), radius * 2.8), duration: 2.5 });
      }
    } catch (e) {
      setRes({ loading: false, error: e instanceof ApiError ? e.message : String(e) });
    }
  };

  const draw = (events: Quake[]) => {
    if (!viewer) return;
    const sc = viewer.scene;
    if (prims.current.pts) sc.primitives.remove(prims.current.pts);
    if (prims.current.lines) sc.primitives.remove(prims.current.lines);
    const pts = new PointPrimitiveCollection();
    const lines = new PolylineCollection();
    for (const q of events) {
      const pos = Cartesian3.fromDegrees(q.lon, q.lat, -q.depth_km * 1000);
      const c = Color.fromCssColorString(depthColor(q.depth_km));
      pts.add({ position: pos, color: c, pixelSize: 3 + Math.max(0, (q.mag ?? 4) - 3.5) * 3.2, outlineColor: Color.BLACK.withAlpha(0.6), outlineWidth: 1, id: q,
        scaleByDistance: new NearFarScalar(2e5, 1.4, 2e7, 0.7) });
      if (events.length <= 3000) {
        lines.add({ positions: [Cartesian3.fromDegrees(q.lon, q.lat, 0), pos], width: 1, material: Material.fromType("Color", { color: c.withAlpha(0.35) }) });
      }
    }
    sc.primitives.add(lines);
    sc.primitives.add(pts);
    prims.current = { pts, lines };
    sc.requestRender();
  };

  const useAroundPlace = () => {
    if (!place) return;
    setRegion({ label: "Around selected point (±6°)", minlat: Math.max(-90, place.lat - 6), maxlat: Math.min(90, place.lat + 6), minlon: place.lon - 6, maxlon: place.lon + 6 });
  };

  return (
    <aside className="panel sheet sheet-md scroll-thin flex flex-col">
      <div className="border-b border-space-700/70 px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-slate-50">{t("What's inside our planet?")}</h2>
          <button className="btn-soft shrink-0 !px-2 !py-1 text-[12px]" data-testid="inside-back" onClick={() => useStore.getState().setMode("explore")}>← {t("Back to the globe")}</button>
        </div>
        {interior === "cutaway" ? (
          <ul className="mt-1.5 space-y-1 text-[12.5px] leading-snug text-slate-200" data-testid="inside-intro">
            {([["#b08968", "Crust", "The thin layer of solid rock we live on."], ["#c2562d", "Mantle", "Hot solid rock that flows very slowly."], ["#f2b632", "Outer core", "Earth's outer core is liquid and surrounds the solid inner core."], ["#fff1a8", "Inner core", "A solid ball of iron alloy at the centre."]] as const).map(([c, name, line]) => (
              <li key={name} className="flex gap-2"><span aria-hidden className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c }} /><span><b className="text-slate-50">{t(name)}</b> — {t(line)}</span></li>
            ))}
          </ul>
        ) : <p className="mt-1 text-[11.5px] text-slate-400">{t("Open the planet, read the modelled crust under any place, or look at catalogued earthquakes at their reported depths.")}</p>}
        <p className="mt-1.5 text-[11.5px] text-slate-400">{t("Click a layer on the globe for its depth. Depths, model details and more views are below.")}</p>
                <div className="mt-1 flex flex-wrap gap-1" role="tablist" aria-label={t("Earth Interior")}>
          {INTERIOR_MODES.map(([m, label]) => <Button key={m} active={interior === m} onClick={() => setInterior(m)}>{t(label)}</Button>)}
        </div>
      </div>
      {viewer && interior === "cutaway" && <CutawayPanel viewer={viewer} />}
      {viewer && interior === "crust" && <CrustPanel viewer={viewer} />}
      {viewer && interior === "section" && <SectionPanel viewer={viewer} />}
      {quakes && <>
      <Section title={t("Region & period")}>
        <select className={inputCls} value={region.label} onChange={(e) => setRegion(REGIONS.find((r) => r.label === e.target.value) ?? region)} aria-label={t("Region")}>
          {REGIONS.map((r) => <option key={r.label} value={r.label}>{t(r.label)}</option>)}
          {!REGIONS.some((r) => r.label === region.label) && <option value={region.label}>{t(region.label)}</option>}
        </select>
        <Button className="mt-2" disabled={!place} onClick={useAroundPlace}>{t("Use area around selected point")}</Button>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="text-[11px] text-slate-400">{t("From")}<input type="date" className={inputCls} value={start} min="1900-01-01" onChange={(e) => setStart(e.target.value)} /></label>
          <label className="text-[11px] text-slate-400">{t("To")}<input type="date" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        </div>
        <label className="mt-2 block text-[11px] text-slate-400">{t("Minimum magnitude: ")}<b className="text-slate-200">{minmag.toFixed(1)}</b>
          <input type="range" min={2.5} max={7.5} step={0.5} value={minmag} onChange={(e) => setMinmag(Number(e.target.value))} className="w-full" /></label>
        <Button className="mt-2 w-full" active onClick={() => void load()} disabled={res.loading}>{res.loading ? t("Loading…") : t("Load earthquakes")}</Button>
      </Section>

      <Section title={t("View")}>
        <label className="block text-[11px] text-slate-400">{t("Surface opacity: ")}<b className="text-slate-200">{Math.round(alpha * 100)}%</b>
          <input type="range" min={0.05} max={1} step={0.05} value={alpha} onChange={(e) => setAlpha(Number(e.target.value))} className="w-full" /></label>
        <label className="mt-2 flex items-center gap-2 text-[11.5px] text-slate-300">
          <input type="checkbox" checked={underground} onChange={(e) => setUnderground(e.target.checked)} />{t(" Allow camera below the surface ")}</label>
        <label className="mt-1.5 flex items-center gap-2 text-[11.5px] text-slate-300" title={t("Hillshade computed from Terrain Tiles DEM (SRTM, GMTED2010 and national DEMs); the sea is not shaded")}>
          <input type="checkbox" checked={reliefShading && !low} disabled={low} onChange={() => toggle("reliefShading")} />{t(" Relief shading (land)")}{low && t(" — off in Low Bandwidth Mode")}
        </label>
        <div className="mt-3 space-y-1">
          {DEPTH_CLASSES.map((c) => (
            <div key={c.label} className="flex items-center gap-2 text-[11px] text-slate-300"><span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />{t(c.label)}</div>
          ))}
          <div className="text-[10.5px] text-slate-500">{t("Marker size grows with magnitude. Thin lines connect each hypocentre to the surface point above it (epicentre).")}</div>
        </div>
      </Section>

      {res.error && <div className="p-4"><Notice tone="error">{t(res.error)}</Notice></div>}
      {res.loading && <div className="p-4"><Spinner label={t("Querying USGS ComCat…")} /></div>}
      {res.data && (
        <Section title={t("Catalogue extract")} right={<KindBadge kind="event_catalog" />}>
          <p className="text-[12px] text-slate-200">{res.data.count}{t(" events (M ≥ ")}{minmag}{t(") · ordered by ")}{res.data.ordered_by}</p>
          {res.data.possibly_truncated && <Notice tone="warn">{t("Result reached the ")}{res.data.limit}{t("-event limit; smaller events in this query are not shown. Raise the minimum magnitude or narrow the region.")}</Notice>}
          {res.data.count > 0 && (
            <p className="mt-1 font-mono text-[11px] text-slate-400">{t("depth range ")}{fmt(Math.min(...res.data.events.map((e) => e.depth_km)))}–{fmt(Math.max(...res.data.events.map((e) => e.depth_km)))}{t(" km")}</p>
          )}
          <ul className="mt-2 list-disc space-y-1 pl-4 text-[10.5px] leading-snug text-slate-400">{res.data.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          <p className="mt-2 text-[10.5px] text-slate-400">{t("Source: ")}{res.data.source}{t(". Retrieved ")}{res.data.retrieved_at}.</p>
          {res.query && <SaveOffline path="/earthquakes" params={quakeParams(res.query)} data={res.data} title={t("Earthquake catalogue")} kind="earthquakes" />}
          <a className="block break-all font-mono text-[10px] text-accent/80 hover:underline" href={res.data.request_url} target="_blank" rel="noreferrer">{res.data.request_url}</a>
        </Section>
      )}
      {picked && (
        <Section title={t("Selected event")}>
          <p className="text-sm text-slate-100">{t("M ")}{fmt(picked.mag)} {picked.mag_type} — {picked.place}</p>
          <p className="font-mono text-[11px] text-slate-300">{picked.time}{t(" · depth ")}{fmt(picked.depth_km)}{t(" km · ")}{picked.lat.toFixed(3)}, {picked.lon.toFixed(3)} · {picked.status}</p>
          <a className="text-[11px] text-accent hover:underline" href={picked.url} target="_blank" rel="noreferrer">{t("USGS event page ↗")}</a>
        </Section>
      )}
      <Section title={t("What this is — and is not")}>
        <p className="text-[11px] leading-snug text-slate-400">{t(" Points are ")}<b className="text-slate-200">{t("measured events")}</b>{t(" from a catalogue. No crustal layers, faults or plate boundaries are drawn yet: those come from interpreted geological models (e.g. CRUST1.0, GEM Global Active Faults) and will be added as separately labelled model layers. ")}</p>
      </Section>
      </>}
    </aside>
  );
}
