import { t } from "../i18n";
import { lazy, Suspense, useEffect, useState } from "react";
import { onMainViewer } from "../globe/registry";
import { ensureLayers, surfaceView } from "../store";
import { useStore, type Mode } from "../store";
import { GuideCard, Home, MapTools, PlaceCard, SearchBox, TimeCard } from "../components/Simple";
import Investigate from "../components/Investigate";
import type { Layer } from "../api/types";
import GlobeView from "../globe/GlobeView";
import { useGlobeLayers } from "../globe/useGlobeLayers";
import { useVis } from "../vis/useVis";
import { setMainViewer } from "../globe/registry";
import LeftPanel from "../components/LeftPanel";

const TrendPanel = lazy(() => import("../components/TrendPanel"));
import Timeline from "../components/Timeline";
const XRayPanel = lazy(() => import("./XRayPanel"));
const ScenarioPanel = lazy(() => import("../scenario/ScenarioPanel"));
const ScenarioOverlay = lazy(() => import("../scenario/ScenarioPanel").then((m) => ({ default: m.ScenarioOverlay })));
const LabHome = lazy(() => import("../scenario/LabHome"));
const EventsPanel = lazy(() => import("../events/EventsPanel"));
const EventTimeline = lazy(() => import("../events/EventsPanel").then((m) => ({ default: m.EventTimeline })));
const ImpactOverlay = lazy(() => import("../events/evidence/ImpactOverlay"));
import { locationById, useLabPlace } from "../scenario/locations";

export default function ExploreMode({ mode }: { mode: Mode }) {

  const lab = mode === "lab", inside = mode === "xray", events = mode === "events", xray = inside || lab || events, time = mode === "time";
  const s = useStore();
  const place = locationById(useLabPlace((x) => x.id));
  const vs = useVis();
  const g = useGlobeLayers(s.satelliteId, s.vizId, s.date, undefined, vs.linesOnTop, inside);
  const [probe, setProbe] = useState<ReturnType<typeof vs.probe>>();

  const driver = vs.driver ?? g.driver;
  const driverAv = vs.driver ? { a: vs.availability, loading: vs.frames.loading, error: vs.frames.error } : g.driverAv;
  const [terrainError, setTerrainError] = useState<string>();
  const hidden = [g.satBefore ? g.sat : undefined, g.vizBefore ? g.viz : undefined].filter((l): l is Layer => !!l);
  const analysing = !xray && s.analyze && !!s.place;

  const simple = !s.advanced && !s.welcome && !xray;

  const investigating = s.investigate && !xray && !time && !s.welcome;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
      {s.advanced && !xray && !investigating && <div className={`order-last min-h-0 md:order-none md:flex ${analysing ? "hidden" : "flex"} max-h-[46%] md:max-h-none`}><LeftPanel vs={vs} probe={probe} terrainError={terrainError} /></div>}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">
          <GlobeView
            layers={g.specs}
            marker={lab || events ? undefined : s.place }
            terrain={s.terrain}
            labels={s.showLabels && !(inside || lab)}
            onTerrainError={setTerrainError}
            onPick={lab || events ? undefined : (lat, lon) => s.setPlace({ lat, lon })}
            onHover={vs.variable ? (lat, lon) => setProbe(vs.probe(lat, lon)) : undefined}
            flyTo={s.place ? { lat: s.place.lat, lon: s.place.lon, height: s.flyHeight, token: s.flyToken } : undefined}
            onViewer={setMainViewer}
          />
          {s.welcome && !xray && <Home />}
          {investigating && <Investigate />}
          {simple && !time && !investigating && <div className="absolute top-3 left-3 z-10 w-[min(320px,calc(100%-80px))]"><SearchBox /></div>}
          {simple && time && <TimeCard vs={vs} />}
          {!s.welcome && !xray && !(investigating && narrow()) && <MapTools />}
          {!s.welcome && !xray && !time && !analysing && !s.guide && !investigating && <PlaceCard />}
          {!s.welcome && <GuideCard />}
          {lab && place && <Suspense fallback={null}><ScenarioOverlay /></Suspense>}
          {events && <Suspense fallback={null}><ImpactOverlay /></Suspense>}
          {lab && !place && <Suspense fallback={null}><LabHome /></Suspense>}
          {!xray && !s.welcome && <GroundHint />}
          {hidden.length > 0 && (
            <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded border border-amber-400/40 bg-black/70 px-3 py-1 text-[11px] text-amber-200">
              {hidden.map((l) => `${l.short_name} starts ${l.id === g.sat?.id ? g.satAv.a?.first : g.vizAv.a?.first}`).join("; ")}{t(" — hidden for this date. ")}</div>
          )}
        </div>
        {!xray && !s.welcome && (time || driver?.time_enabled) && (
          <Timeline date={s.date} setDate={s.setDate} driver={driver} availability={driverAv.a} loading={driverAv.loading} error={driverAv.error}
            extra={[g.sat, g.viz].filter((l): l is NonNullable<typeof l> => !!l && l.id !== driver?.id).map((layer) => ({ layer, a: layer.id === g.sat?.id ? g.satAv.a : g.vizAv.a }))} />
        )}
        {events && <Suspense fallback={null}><EventTimeline /></Suspense>}
      </div>
      <Suspense fallback={<aside className="panel sheet sheet-md p-4 text-xs text-slate-400">{t("Loading…")}</aside>}>
        {lab ? (place ? <ScenarioPanel key={place.id} location={place} /> : null) : events ? <EventsPanel /> : xray ? <XRayPanel /> : analysing ? <TrendPanel /> : null}
      </Suspense>
    </div>
  );
}

const narrow = () => window.innerWidth < 640;

function GroundHint() {
  const { satelliteId, terrain, place, setSatellite, toggle } = useStore();
  const [height, setHeight] = useState(Infinity);
  useEffect(() => onMainViewer((v) => {
    if (!v) return;
    const upd = () => { if (!v.isDestroyed()) setHeight(v.camera.positionCartographic.height); };
    upd();
    v.camera.percentageChanged = 0.05;
    v.camera.changed.addEventListener(upd);
  }), []);
  if (height > 150_000 || (satelliteId && terrain)) return null;
  return (
    <div className="absolute bottom-10 left-1/2 z-10 w-[min(560px,90%)] -translate-x-1/2 rounded border border-accent/40 bg-black/75 px-3 py-2 text-[11.5px] text-slate-200">
      <p>{t("At this height the offline map has no more detail (Natural Earth 1:10m). For the real surface:")}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {!satelliteId && <button className="rounded border border-accent/60 px-2 py-0.5 text-accent hover:bg-accent/10" onClick={async () => { await ensureLayers().catch(() => {}); setSatellite("BlueMarble_NextGeneration"); }}>{t("Satellite: Blue Marble (cloud-free, 500 m)")}</button>}
        {!satelliteId && <button className="rounded border border-space-600 px-2 py-0.5 hover:border-accent/60" onClick={async () => { await ensureLayers().catch(() => {}); setSatellite("Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual"); }}>{t("Landsat WELD (~30 m detail, composite ≈2000)")}</button>}
        {!terrain && <button className="rounded border border-space-600 px-2 py-0.5 hover:border-accent/60" onClick={() => toggle("terrain")}>{t("Terrain (3D relief)")}</button>}
        {place && <button className="rounded border border-space-600 px-2 py-0.5 hover:border-accent/60" onClick={() => surfaceView()}>{t("Surface view")}</button>}
      </div>
    </div>
  );
}
