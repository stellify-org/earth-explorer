import { t } from "../i18n";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ScreenSpaceEventHandler, ScreenSpaceEventType, type CesiumWidget } from "@cesium/engine";
import type { Cartesian2 } from "@cesium/core";
import { onMainViewer } from "../globe/registry";
import { ensureLayers, useLowBandwidth, useStore } from "../store";
import { fmtLatLon } from "../lib/format";
import { KindBadge, Notice, Section, Spinner, selectCls } from "../components/ui";
import { Icon } from "../components/Simple";
import { CATS, DEPTH_CLASSES, STORIES, STYLE, beforeAfter, countByCat, geometryNote, isoDay, isoMinute, markerAt, type Ev } from "./model";
import { EventScene } from "./scene";
import { PERIODS, shownEvents, timeSteps, useEvents, type Period } from "./store";
import { investigateTrend } from "./trend";
import { EventLayerRenderer } from "./evidence/renderer";
import { activeBundle, useEvidence } from "./evidence/store";
import { stepIndex } from "./evidence/types";

const MODIS = "MODIS_Terra_CorrectedReflectance_TrueColor";
const MODIS_FIRST = Date.UTC(2000, 2, 1);
const LIST_STEP = 40;

const Dot = ({ color, size = 10 }: { color: string; size?: number }) => <span aria-hidden className="inline-block shrink-0 rounded-full" style={{ background: color, width: size, height: size }} />;

export default function EventsPanel() {
  const s = useEvents();
  const [viewer, setViewer] = useState<CesiumWidget | null>(null);
  const scene = useRef<EventScene | null>(null);
  const renderer = useRef<EventLayerRenderer | null>(null);
  const [limit, setLimit] = useState(LIST_STEP);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => { if (s.selected) panel.current?.scrollTo({ top: 0 }); }, [s.selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => onMainViewer(setViewer), []);

  const low = useLowBandwidth();
  useEffect(() => { const st = useEvents.getState(); if (st.catalogue && !st.data && !st.loading && !low) void s.load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!viewer) return;
    const sc = new EventScene(viewer);
    sc.start();
    scene.current = sc;

    const rd = new EventLayerRenderer(viewer);
    rd.onTier = (tier) => useEvidence.getState().setTier(tier);
    rd.start();
    renderer.current = rd;
    (window as unknown as { __eeEvents?: unknown }).__eeEvents = { screenOf: (id: string) => { const e = shownEvents(useEvents.getState()).find((x) => x.id === id); return e && sc.screenOf(e); }, symbols: () => sc.effects.snapshot(), symbolAt: (x: number, y: number) => sc.symbolAt(x, y) };
    const h = new ScreenSpaceEventHandler(viewer.scene.canvas);
    h.setInputAction((m: { position: Cartesian2 }) => {
      const hit = sc.pick(m.position);
      if (hit?.kind === "event") useEvents.getState().select(hit.ev);
      else if (hit?.kind === "cluster") sc.openCluster(hit.cluster);
    }, ScreenSpaceEventType.LEFT_CLICK);
    h.setInputAction((m: { endPosition: Cartesian2 }) => { viewer.scene.canvas.style.cursor = sc.pick(m.endPosition) ? "pointer" : ""; }, ScreenSpaceEventType.MOUSE_MOVE);
    return () => { h.destroy(); if (!viewer.isDestroyed()) viewer.scene.canvas.style.cursor = ""; sc.destroy(); scene.current = null; rd.destroy(); renderer.current = null; useEvidence.getState().close(); };
  }, [viewer]);

  const evidence = useEvidence();
  const bundle = activeBundle(evidence, s.selected?.id);

  const evidenceTime = !!bundle && bundle.steps.length > 1;
  const sceneCursor = evidenceTime && !s.story ? s.data?.to ?? s.cursor : s.cursor;

  const shown = useMemo(() => (s.story ? (evidenceTime && s.focus ? [s.focus] : shownEvents(s)) : s.catalogue ? shownEvents({ ...s, cursor: sceneCursor }) : []), [s.focus, s.story, s.data, s.cats, s.minMag, s.cursor, s.catalogue, evidenceTime, sceneCursor]); // eslint-disable-line react-hooks/exhaustive-deps

  const suppress = useMemo(() => {
    if (!bundle) return undefined;
    const track = bundle.layers.find((l) => l.kind === "track" && evidence.on[l.id]);
    const head = track?.fixes?.length ? track.fixes[stepIndex(track.fixes, s.cursor)] : undefined;
    return { id: bundle.event_id, track: !!track, outline: bundle.layers.some((l) => l.id === "outline" && evidence.on[l.id]), lon: head?.lon, lat: head?.lat };
  }, [bundle, evidence.on, s.cursor]);
  useEffect(() => { scene.current?.update({ items: shown, cursor: sceneCursor, selected: s.selected, suppress }); }, [shown, sceneCursor, s.selected, suppress, viewer]);
  useEffect(() => { renderer.current?.update({ bundle, on: evidence.on, cursor: s.cursor }); }, [bundle, evidence.on, s.cursor, viewer]);
  useEffect(() => { if (s.flyToken && s.selected) scene.current?.flyTo(s.selected, s.story?.height, () => { const st = useEvents.getState(); if (st.story?.play && st.focus && !activeBundle(useEvidence.getState(), st.focus.id) && !(st.story.impact && useEvidence.getState().status === "loading")) st.setPlaying(true); }); }, [s.flyToken, viewer]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const e = useEvidence.getState(); if (e.eventId && e.eventId !== s.selected?.id) e.close(); }, [s.selected?.id]);

  useEffect(() => { if (s.story?.impact && s.focus && !low) void useEvidence.getState().open(s.focus); }, [s.focus?.id, s.story?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const e = useEvidence.getState(); if (s.selected?.polygons && e.eventId === s.selected.id && e.bundle?.builder === "catalogue record" && !e.bundle.layers.some((l) => l.id === "outline")) void e.open(s.selected); }, [s.selected?.polygons]); // eslint-disable-line react-hooks/exhaustive-deps

  const hadBundle = useRef(false);
  useEffect(() => {
    const st = useEvents.getState();
    if (bundle) {
      if (bundle.steps.length) {
        st.setPlaying(false);
        const after = bundle.compare && bundle.steps.find((x) => x.label === bundle.compare!.after);
        st.setCursor((after ?? bundle.steps[st.story?.play ? 0 : bundle.steps.length - 1]).t);
      }
    } else if (hadBundle.current) {
      st.setPlaying(false);
      st.setCursor(st.story && st.focus ? st.focus.end : st.data?.to ?? Date.now());
    }
    hadBundle.current = !!bundle;
  }, [bundle?.event_id, bundle?.built_at]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!evidence.flyToken || !bundle) return;

    const canvas = viewer?.scene.canvas, inset = canvas && window.innerWidth >= 768 ? Math.min(0.45, 400 / canvas.clientWidth) : 0;
    renderer.current?.flyTo(bundle, () => { const st = useEvents.getState(); if (st.story?.play && bundle.steps.length > 1 && activeBundle(useEvidence.getState(), st.selected?.id)) st.setPlaying(true); }, inset);
  }, [evidence.flyToken, viewer]); // eslint-disable-line react-hooks/exhaustive-deps

  const imagery = useRef<{ sat?: string; date: string } | null>(null);
  useEffect(() => () => { if (imagery.current) { useStore.getState().setSatellite(imagery.current.sat); useStore.getState().setDate(imagery.current.date); } }, []);
  const photo = async (date?: string) => {
    const g = useStore.getState();
    if (!date) { if (imagery.current) { g.setSatellite(imagery.current.sat); g.setDate(imagery.current.date); imagery.current = null; } setPhotoDay(undefined); return; }
    if (low && !imagery.current && !window.confirm(t("Low Bandwidth Mode is on. Satellite imagery downloads about 1 MB for each new view. Continue?"))) return;
    imagery.current ??= { sat: g.satelliteId, date: g.date };
    await ensureLayers().catch(() => {});
    g.setSatellite(MODIS); g.setDate(date); setPhotoDay(date);
  };
  const [photoDay, setPhotoDay] = useState<string>();

  const [animated, setAnimated] = useState(() => { try { return localStorage.getItem("ee.events.anim") !== "0"; } catch { return true; } });
  useEffect(() => { scene.current?.setAnimated(animated); try { localStorage.setItem("ee.events.anim", animated ? "1" : "0"); } catch {  } }, [animated, viewer]);
  useEffect(() => { if (photoDay) void photo(undefined); }, [s.selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => countByCat(s.data?.events ?? []), [s.data]);
  const catalogue = s.catalogue;
  const d = s.data;
  const period = PERIODS.find((p) => p.days === s.days)!;

  return (
    <aside ref={panel} className="panel sheet sheet-md scroll-thin flex flex-col" aria-label={t("Event Detective")} data-testid="events-panel">
      <div className="border-b border-space-700/70 px-4 py-3">
        <div className="flex items-center justify-between gap-2"><h2 className="text-[15px] font-semibold text-slate-50">{t("Explore Earth's Real Events")}</h2><KindBadge kind="event_catalog" /></div>
        <p className="mt-0.5 text-[12.5px] text-slate-300">{t("Discover what happened and investigate the evidence.")}</p>
        {catalogue && <p className="mt-1 text-[11.5px] text-slate-400">{t("Natural events reported by agencies, drawn where and when the catalogues place them. Click a marker to investigate.")}</p>}
      </div>

      {s.story && <StoryCard />}
      {s.selected && <EventCard ev={s.selected} photoDay={photoDay} onPhoto={photo} onFly={() => scene.current?.flyTo(s.selected!, s.story?.height)} />}
      {!s.story && !catalogue && (
        <section className="border-b border-space-700/70 px-4 py-3" data-testid="ev-intro">
          <div className="flex flex-col gap-2">
            {STORIES.filter((x) => x.card).map((x) => (
              <article key={x.id} className="rounded-xl border border-space-600 bg-space-800/60 p-3">
                <div className="flex items-center gap-1.5 text-[11.5px] text-slate-300"><Dot color={STYLE[x.cat].color} />{t(STYLE[x.cat].one)} · {t(x.card!.where)} · {t(x.card!.when)}</div>
                <h3 className="mt-1 text-[14px] leading-snug font-semibold text-slate-50">{t(x.title)}</h3>
                <p className="mt-0.5 text-[12.5px] leading-snug text-slate-300">{t(x.card!.line)}</p>
                <button className="btn-warm mt-2 min-h-10" onClick={() => void s.openStory(x)} data-testid={`ev-story-${x.id}`}>{t("Investigate")}</button>
              </article>
            ))}
          </div>
          <p className="mt-3 text-[12px] text-slate-400">{t("More cases")}</p>
          <div className="mt-1 flex flex-col gap-1">
            {STORIES.filter((x) => !x.card).map((x) => (
              <button key={x.id} onClick={() => void s.openStory(x)} data-testid={`ev-story-${x.id}`} className="flex min-h-10 items-center gap-2 rounded-lg border border-space-700 px-2.5 text-left text-[12.5px] text-slate-200 hover:border-warm hover:text-warm"><Dot color={STYLE[x.cat].color} />{t(x.title)}</button>
            ))}
          </div>
          <button className="btn-soft mt-3 flex min-h-11 w-full items-center justify-center gap-2" onClick={() => s.openCatalogue(!low)} data-testid="ev-all"><Icon name="events" size={17} />{t("Explore all events")}</button>
          <p className="mt-1.5 text-[11.5px] leading-snug text-slate-400">{t("The full catalogue: about a month of fires, storms, floods and earthquakes from NASA EONET and the USGS, with filters and a timeline.")}</p>
        </section>
      )}
      {!s.story && catalogue && (
        <Section title={t("Show")} right={s.loading ? <Spinner /> : undefined}>
          <select className={selectCls} value={s.days} onChange={(e) => void s.load(Number(e.target.value) as Period)} aria-label={t("Period")} data-testid="ev-period">
            {PERIODS.map((p) => <option key={p.days} value={p.days}>{t(p.label)}</option>)}
          </select>
          {!d && !s.loading && <button className="btn-warm mt-2" onClick={() => void s.load()} data-testid="ev-load">{t("Load events")}</button>}
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={t("Kinds of events")}>
            {CATS.filter((c) => counts[c] > 0 || (c !== "other" && d)).map((c) => (
              <button key={c} aria-pressed={s.cats[c]} onClick={() => s.toggleCat(c)} data-testid={`ev-cat-${c}`} data-count={counts[c]}
                className={`flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors ${s.cats[c] ? "border-space-600 bg-space-800 text-slate-100" : "border-space-700 text-slate-500"}`}>
                <Dot color={s.cats[c] ? STYLE[c].color : "#475569"} />{t(STYLE[c].label)}<span className="font-mono text-[11px] text-slate-400">{counts[c]}</span>
              </button>
            ))}
          </div>
          {d && counts.earthquakes > 0 && s.cats.earthquakes && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-slate-300">
              <label className="flex items-center gap-1.5">{t("Earthquakes from magnitude")}
                <select className="rounded border border-space-600 bg-space-800 px-1 py-0.5 text-[12px]" value={s.minMag} onChange={(e) => s.setMinMag(Number(e.target.value))} data-testid="ev-minmag">
                  {[4.5, 5.5, 6, 6.5, 7].filter((m) => m >= period.minMag).map((m) => <option key={m} value={m}>{m.toFixed(1)}</option>)}
                </select>
              </label>
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5" title={t("Bigger dot = larger magnitude. Colour = depth of the hypocentre.")}>
                {DEPTH_CLASSES.map((c) => <span key={c.label} className="flex items-center gap-1"><Dot color={c.color} size={8} />{t(c.label)}</span>)}
              </span>
            </div>
          )}
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12px] text-slate-200">
            <input type="checkbox" className="h-4 w-4 accent-[#fbbf24]" checked={animated} onChange={(e) => setAnimated(e.target.checked)} data-testid="ev-animate" />
            {t("Animated symbols")}<span className="text-[11px] text-slate-500">{t("(turn off if the globe feels slow)")}</span>
          </label>
          {d?.eonetError && <div className="mt-2"><Notice tone="warn">{t("NASA EONET did not answer: ")}{t(d.eonetError)}</Notice></div>}
          {d?.quakeError && <div className="mt-2"><Notice tone="warn">{t("The USGS earthquake catalogue did not answer: ")}{t(d.quakeError)}</Notice></div>}
          {(d?.eonet?.stale || d?.quakes?.stale) && <div className="mt-2"><Notice tone="warn">{t("The source is unreachable. Showing the list retrieved at ")}{isoMinute(Date.parse((d.eonet?.stale ? d.eonet.retrieved : d.quakes!.retrieved)))}.</Notice></div>}
          {d?.quakes?.truncated && <p className="mt-1.5 text-[11.5px] text-amber-200">{t("More earthquakes exist than were loaded; the strongest are shown.")}</p>}
          {d && <p className="mt-1.5 text-[11px] leading-snug text-slate-500" data-testid="ev-summary">{shown.length} {t("on the globe")} · {isoDay(d.from)} → {isoDay(sceneCursor)}{d.eonet && <> · {t("retrieved")} {isoMinute(Date.parse(d.eonet.retrieved))}</>}</p>}
        </Section>
      )}

      {!s.story && catalogue && (
        <Section title={t("Guided investigations")}>
          <div className="flex flex-col gap-1">
            {STORIES.map((x) => (
              <button key={x.id} onClick={() => void s.openStory(x)} data-testid={`ev-story-${x.id}`} className="flex items-center gap-2 rounded-lg border border-space-700 px-2.5 py-1.5 text-left text-[12.5px] text-slate-200 hover:border-warm hover:text-warm">
                <Dot color={STYLE[x.cat].color} />{t(x.title)}
              </button>
            ))}
          </div>
        </Section>
      )}

      {!s.story && catalogue && d && (
        <Section title={t("Events on the globe")} right={<span className="font-mono text-[11px] text-slate-400">{shown.length}</span>}>
          {shown.length === 0 && <p className="text-[12px] text-slate-400">{t("No events match. Turn a kind back on or move the time slider.")}</p>}
          <ul className="flex flex-col">
            {shown.slice(0, limit).map((e) => (
              <li key={e.id}>
                <button onClick={() => s.select(e, true)} data-testid="ev-row" data-id={e.id} aria-current={s.selected?.id === e.id ? "true" : undefined}
                  className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[12px] hover:bg-space-700 ${s.selected?.id === e.id ? "bg-space-700 text-white" : "text-slate-200"}`}>
                  <Dot color={STYLE[e.cat].color} size={8} /><span className="min-w-0 flex-1 truncate">{e.title}</span><span className="shrink-0 font-mono text-[10.5px] text-slate-500">{isoDay(e.end)}</span>
                </button>
              </li>
            ))}
          </ul>
          {shown.length > limit && <button className="mt-1 text-[12px] text-accent hover:underline" onClick={() => setLimit((n) => n + 200)}>{t("Show more")}</button>}
        </Section>
      )}

      <Section title={t("About these data")}>
        <ul className="list-disc space-y-1 pl-4 text-[11.5px] leading-snug text-slate-400">
          <li>{t("Fires, storms, floods, volcanoes, landslides and ice: NASA EONET v3, which collects reports from agencies such as GDACS, IRWIN, JTWC, NOAA NHC and the Smithsonian GVP.")}</li>
          <li>{t("Earthquakes: U.S. Geological Survey catalogue (ComCat).")}</li>
          <li>{t("A catalogue lists what was reported, not everything that happened. More markers in one region or month do not mean more events occurred there.")}</li>
          <li>{t("The moving symbols (spiral, flame, ripples, rings, plume, stones) are icons for the kind of event. Their size and speed are not data: they do not show how large a fire, storm or flood is. A symbol moves while the event is open in the catalogue at the slider time; earthquake rings mark the 24 hours after the shock. Only the turning direction of the storm spiral is real: counter-clockwise north of the equator, clockwise south of it.")}</li>
          <li>{t("Far from the globe, fires in the same grid cell are merged into one disc drawn at their mean position. Zoom in to separate them.")}</li>
        </ul>
      </Section>
    </aside>
  );
}

function StoryCard() {
  const catalogue = useEvents((s) => s.catalogue), story = useEvents((s) => s.story)!, closeStory = useEvents((s) => s.closeStory), error = useEvents((s) => s.storyError), loading = useEvents((s) => s.detail.loading), focus = useEvents((s) => s.focus);
  return (
    <section className="border-b border-space-700/70 px-4 py-3" data-testid="ev-story">
      <div className="flex items-start justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-warm"><Icon name="spark" size={15} />{t(story.title)}</h3>
        <button className="btn-soft !px-2 !py-1 text-[12px]" onClick={closeStory} data-testid="ev-story-close">{t(catalogue ? "Back to all events" : "Back to the cases")}</button>
      </div>
      <p className="mt-1.5 text-[12.5px] leading-snug text-slate-200">{t(story.text)}</p>
      {loading && !focus && <div className="mt-2"><Spinner label="Loading the record…" /></div>}
      {error && <div className="mt-2"><Notice tone="error">{t("This record could not be loaded: ")}{t(error)}</Notice></div>}
    </section>
  );
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return <div className="flex gap-2 py-0.5"><dt className="w-[38%] shrink-0 text-slate-400">{t(k)}</dt><dd className="min-w-0 flex-1 text-slate-100">{children}</dd></div>;
}

function EventCard({ ev, photoDay, onPhoto, onFly }: { ev: Ev; photoDay?: string; onPhoto: (d?: string) => void; onFly: () => void }) {
  const cursor = useEvents((s) => s.cursor), detail = useEvents((s) => s.detail), select = useEvents((s) => s.select), story = useEvents((s) => s.story);
  const m = markerAt(ev, cursor);
  const ba = beforeAfter(ev);
  const instant = ev.start === ev.end;
  const terrain = useStore((g) => g.terrain), low = useLowBandwidth();
  const toggleTerrain = () => {
    if (!terrain && low && !window.confirm(t("Low Bandwidth Mode is on. Terrain downloads about 13 MB for one low view. Continue?"))) return;
    useStore.getState().toggle("terrain");
  };
  const analyze = () => investigateTrend(ev, m);
  const impact = useEvidence((x) => x.eventId === ev.id ? x.status : "idle");

  const drawn = useEvidence((x) => x.eventId === ev.id && x.status === "ready" && !!x.bundle?.layers.length);
  const toggleImpact = () => { const e = useEvidence.getState(); if (impact === "idle") void e.open(ev); else e.close(); };
  return (
    <section className="border-b border-space-700/70 px-4 py-3" data-testid="event-card" data-id={ev.id}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-300"><Dot color={STYLE[ev.cat].color} />{t(STYLE[ev.cat].one)}<span className="text-slate-500">· {t("observed event record")}</span></div>
          <h3 className="mt-0.5 text-[14px] leading-snug font-semibold text-slate-50" data-testid="event-title">{ev.title}</h3>
        </div>
        {!story && <button className="-mt-1 -mr-1 p-1.5 text-slate-400 hover:text-white" onClick={() => select(undefined)} aria-label={t("Close")} data-testid="event-close"><Icon name="close" size={16} /></button>}
      </div>
      <dl className="mt-2 text-[12px]">
        {instant ? <Row k={ev.cat === "earthquakes" ? "Time" : "Reported"}>{isoMinute(ev.start)}</Row> : <><Row k="First report">{isoMinute(ev.start)}</Row><Row k="Last report">{isoMinute(ev.end)}</Row></>}
        {ev.catalog === "eonet" && <Row k="Catalogue status">{ev.closed ? <>{t("Closed on ")}{isoDay(ev.closed)}</> : t("Open")}</Row>}
        {ev.cat === "earthquakes" && ev.mag !== undefined && <Row k="Magnitude"><b data-testid="event-mag">{ev.mag.toFixed(1)}</b>{ev.magUnit ? ` (${ev.magUnit})` : ""}</Row>}
        {ev.depthKm !== undefined && <Row k="Depth">{ev.depthKm.toFixed(0)} {t("km")}</Row>}
        {ev.cat !== "earthquakes" && m.mag !== undefined && <Row k={ev.track ? "Reported at this position" : "Size given by the source"}><b>{m.mag}</b> {m.unit ?? ev.magUnit}</Row>}
        {ev.track && ev.magMax !== undefined && <Row k="Largest value in the record">{ev.magMax} {ev.magUnit}</Row>}
        {ev.track && <Row k="Reported positions"><span data-testid="event-fixes">{ev.track.filter((f) => f.t <= cursor).length} / {ev.track.length}</span></Row>}
        {ev.polygonCount ? <Row k="Outline"><span data-testid="event-outline">{ev.polygonVertices} {t("points from the source")}{detail.loading ? ` · ${t("loading…")}` : ev.polygons ? ` · ${t("drawn")}` : ""}</span></Row> : null}
        <Row k={ev.position === "polygon_bbox_centre" ? "Marker (centre of the outline box)" : ev.position === "latest_reported_point" ? "Position shown" : "Position"}><span className="font-mono text-[11.5px]">{fmtLatLon(m.lat, m.lon)}</span></Row>
        <Row k="Source">
          {ev.sources.map((x, i) => <span key={x.id + i}>{i > 0 && ", "}<a className="text-accent hover:underline" href={x.url} target="_blank" rel="noreferrer">{x.id}</a></span>)}
          {ev.catalog === "eonet" && <> · <a className="text-accent hover:underline" href={ev.link} target="_blank" rel="noreferrer">NASA EONET</a></>}
        </Row>
      </dl>
      {detail.error && <div className="mt-1.5"><Notice tone="warn">{t("The outline could not be loaded: ")}{t(detail.error)}</Notice></div>}
      <p className="mt-1.5 text-[11.5px] leading-snug text-slate-400" data-testid="event-geometry-note">{t(drawn ? "This is the catalogue record of the event. Everything drawn on the globe beyond the marker comes from the evidence layers listed in the impact card, each with its own source." : geometryNote(ev))}</p>

      <button className={`mt-2.5 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border px-3 text-[13.5px] font-semibold transition-colors ${impact === "idle" ? "border-warm bg-warm text-space-950 hover:brightness-110" : "border-warm text-warm"}`}
        onClick={toggleImpact} aria-pressed={impact !== "idle"} data-testid="ev-impact"><Icon name="layers" size={17} />{t(impact === "idle" ? "Show Event Impact" : "Hide Event Impact")}</button>
      <p className="mt-1 text-[11.5px] leading-snug text-slate-400">{t("Draws the documented geographic evidence of this event on the globe: only layers that real observations or published models support.")}</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button className="btn-soft" onClick={onFly} data-testid="ev-fly">{t("Fly to the event")}</button>
        <button className={`btn-soft ${terrain ? "!border-warm !text-warm" : ""}`} aria-pressed={terrain} onClick={toggleTerrain} data-testid="ev-terrain" title={t("Draw the marker on the 3D relief (SRTM-based terrain tiles, needs internet)")}>{t("Terrain (3D relief)")}</button>
        <button className="btn-warm inline-flex items-center gap-1.5" onClick={analyze} data-testid="ev-analyze"><Icon name="chart" size={16} />{t("Analyze this region")}</button>
      </div>
      <p className="mt-1.5 text-[11.5px] leading-snug text-slate-400">{t("Opens the long-term climate record (NASA POWER, since 1981) of the grid cell at this point. A trend there is background, not the cause of this event: one event cannot be explained by a trend, and a trend cannot be read from one event.")}</p>

      {ev.start >= MODIS_FIRST && (
        <div className="mt-2.5">
          <div className="label">{t("Satellite photo of the day")}</div>
          <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label={t("Satellite photo of the day")}>
            {([[ba.before, "Day before"], [ba.after, "Day after"]] as const).map(([day, label]) => (
              <button key={label} aria-pressed={photoDay === day} onClick={() => onPhoto(day)} data-testid={`ev-photo-${label === "Day before" ? "before" : "after"}`}
                className={`rounded-lg border px-2 py-1 text-[12px] ${photoDay === day ? "border-warm text-warm" : "border-space-600 text-slate-200 hover:border-accent"}`}>{t(label)} <span className="font-mono text-[10.5px] text-slate-400">{day}</span></button>
            ))}
            {photoDay && <button className="rounded-lg border border-space-600 px-2 py-1 text-[12px] text-slate-200 hover:border-accent" onClick={() => onPhoto(undefined)} data-testid="ev-photo-off">{t("Off")}</button>}
          </div>
          <p className="mt-1 text-[11px] leading-snug text-slate-500">{t("MODIS Terra true colour from NASA GIBS, 250 m. Clouds, smoke or missing swaths can hide the ground. The photo is context, not a measurement of the event.")}</p>
        </div>
      )}
    </section>
  );
}

export function EventTimeline() {
  const s = useEvents();

  const bundle = useEvidence((e) => activeBundle(e, s.selected?.id));
  const dated = bundle && bundle.steps.length > 1 ? bundle : undefined;
  const steps = useMemo(() => dated ? dated.steps.map((x) => x.t) : timeSteps(s), [s.focus, s.story, s.data, dated]); // eslint-disable-line react-hooks/exhaustive-deps
  let index = 0;
  for (let i = 0; i < steps.length; i++) if (steps[i] <= s.cursor) index = i;
  useEffect(() => {
    if (!s.playing || steps.length < 2) return;
    const id = window.setInterval(() => {
      const st = useEvents.getState();
      let i = 0;
      for (let k = 0; k < steps.length; k++) if (steps[k] <= st.cursor) i = k;
      if (i >= steps.length - 1) st.setPlaying(false); else st.setCursor(steps[i + 1]);
    }, dated ? (steps.length > 60 ? 220 : 450) : s.story ? 450 : steps.length > 120 ? 120 : steps.length > 45 ? 220 : 380);
    return () => window.clearInterval(id);
  }, [s.playing, steps, s.story, dated]);
  if (steps.length < 2) return null;
  const play = () => {
    if (s.playing) return s.setPlaying(false);
    if (index >= steps.length - 1) s.setCursor(steps[0]);
    s.setPlaying(true);
  };
  return (
    <div className="flex shrink-0 items-center gap-3 border-t border-space-700 bg-space-950 px-3 py-2" data-testid="ev-timeline" data-source={dated ? "evidence" : "catalogue"} data-steps={steps.length}>
      <button className="icon-btn card text-slate-100 hover:border-accent hover:text-accent" onClick={play} aria-label={t(s.playing ? "Pause" : "Play")} title={t(s.playing ? "Pause" : "Play")} data-testid="ev-play">{s.playing ? "❚❚" : "▶"}</button>
      <div className="min-w-0 flex-1">
        <input type="range" className="w-full accent-[#fbbf24]" min={0} max={steps.length - 1} step={1} value={index} data-testid="ev-slider"
          aria-label={t("Time")} aria-valuetext={dated ? dated.steps[index].label : isoDay(steps[index])} onChange={(e) => { s.setPlaying(false); s.setCursor(steps[Number(e.target.value)]); }} />
        <div className="flex justify-between font-mono text-[10.5px] text-slate-500"><span>{isoDay(steps[0])}</span><span>{isoDay(steps[steps.length - 1])}</span></div>
      </div>
      <div className="w-[132px] shrink-0 text-right font-mono text-[12px] leading-tight text-slate-100">
        {dated?.steps_label && <div className="font-sans text-[10px] text-slate-500">{t(dated.steps_label)}</div>}
        <div data-testid="ev-cursor">{dated ? t(dated.steps[index].label) : s.story ? isoMinute(steps[index]).replace(" UTC", "") : isoDay(steps[index])}</div>
      </div>
    </div>
  );
}
