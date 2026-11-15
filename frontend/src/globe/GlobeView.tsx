import { t } from "../i18n";
import { useEffect, useRef, useState } from "react";
import {
  EllipsoidTerrainProvider, Entity, sampleTerrain, HeightReference, ImageryLayer, LabelCollection, LabelStyle, ScreenSpaceEventHandler, ScreenSpaceEventType, VerticalOrigin, CesiumWidget, Credit, CreditDisplay, type ImageryProvider,
} from "@cesium/engine";
import {
  Cartesian2, Cartesian3, Cartographic, Color, DistanceDisplayCondition, Math as CMath, Matrix4, NearFarScalar,
} from "@cesium/core";
import "@cesium/engine/Source/Widget/CesiumWidget.css";
import { fmtLatLon } from "../lib/format";
import { geo } from "../geo";
import { useLowBandwidth, useStore } from "../store";
import { countryAt } from "../geo/store";
import { createTerrainProvider } from "./terrain";
import { groundRange, maxOffNadir } from "./cameraLimit";
import { installCameraControls, isTopDown, northUp, TILT_BELOW, toggleTilt, zoomStep } from "./controls";

export interface GlobeLayerSpec {
  key: string;
  provider: () => ImageryProvider;
  opacity?: number;

  blackToAlpha?: number;
}

interface Props {
  layers: GlobeLayerSpec[];
  marker?: { lat: number; lon: number };
  onPick?: (lat: number, lon: number) => void;
  onHover?: (lat: number, lon: number) => void;
  flyTo?: { lat: number; lon: number; height?: number; token: number };
  onViewer?: (v: CesiumWidget | null) => void;
  showHud?: boolean;
  terrain?: boolean;
  labels?: boolean;
  onTerrainError?: (msg: string) => void;

  controls?: boolean;
  className?: string;
}

CreditDisplay.cesiumCredit = new Credit('<a href="https://cesium.com/platform/cesiumjs/" target="_blank" rel="noreferrer">CesiumJS</a>', true);

export default function GlobeView({ layers, marker, onPick, onHover, flyTo, onViewer, showHud = true, terrain = false, labels = false, onTerrainError, controls = true, className }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<CesiumWidget | null>(null);
  const live = useRef<{ key: string; il: ImageryLayer }[]>([]);
  const markerRef = useRef<Entity | null>(null);
  const labelsRef = useRef<LabelCollection | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const hoverRef = useRef(onHover);
  hoverRef.current = onHover;
  const low = useLowBandwidth();
  const lowRef = useRef(low);
  lowRef.current = low;
  const terrErrRef = useRef(onTerrainError);
  terrErrRef.current = onTerrainError;
  const [hud, setHud] = useState<{ lat?: number; lon?: number; height: number; country?: string; elev?: number }>({ height: 0 });
  const [error, setError] = useState<string>();
  const [ready, setReady] = useState(0);
  const [view, setView] = useState({ heading: 0, pitch: -Math.PI / 2, height: Infinity });

  useEffect(() => {
    if (!el.current) return;
    let viewer: CesiumWidget;
    try {
      viewer = new CesiumWidget(el.current, {
        baseLayer: false,
        terrainProvider: new EllipsoidTerrainProvider(),
        requestRenderMode: true, maximumRenderTimeChange: Infinity,

        skyBox: false,
      });
    } catch (e) {
      setError(`WebGL globe could not start: ${(e as Error).message}`);
      return;
    }
    viewerRef.current = viewer;
    const scene = viewer.scene;
    scene.globe.baseColor = Color.fromCssColorString("#0c2a47");

    scene.globe.showGroundAtmosphere = false;
    scene.highDynamicRange = false;
    scene.globe.enableLighting = false;
    scene.globe.maximumScreenSpaceError = 2;
    scene.globe.tileCacheSize = 200;
    const unControls = installCameraControls(viewer);
    scene.backgroundColor = Color.fromCssColorString("#03060d");
    scene.sun = undefined as never;
    scene.moon = undefined as never;
    viewer.camera.setView({ destination: Cartesian3.fromDegrees(40, 20, 22_000_000) });

    const handler = new ScreenSpaceEventHandler(scene.canvas);
    let raf = 0;
    const pickLatLon = (pos: Cartesian2) => {
      const ray = viewer.camera.getPickRay(pos);
      const c = (ray && scene.globe.pick(ray, scene)) || viewer.camera.pickEllipsoid(pos, scene.globe.ellipsoid);
      if (!c) return undefined;
      const g = Cartographic.fromCartesian(c);
      return { lat: CMath.toDegrees(g.latitude), lon: CMath.toDegrees(g.longitude), carto: g };
    };
    handler.setInputAction((m: { endPosition: Cartesian2 }) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (viewer.isDestroyed()) return;
        const ll = pickLatLon(m.endPosition);
        const isTerrain = !(scene.terrainProvider instanceof EllipsoidTerrainProvider);
        const elev = ll && isTerrain ? scene.globe.getHeight(ll.carto) : undefined;
        if (ll) hoverRef.current?.(ll.lat, ll.lon);
        setHud({ lat: ll?.lat, lon: ll?.lon, height: viewer.camera.positionCartographic.height,
          country: ll ? countryAt(geo.countries, ll.lon, ll.lat)?.name : undefined, elev });

        if (!geo.countries && !lowRef.current) geo.loadCountries().catch(() => {});
      });
    }, ScreenSpaceEventType.MOUSE_MOVE);
    handler.setInputAction((m: { position: Cartesian2 }) => {
      const ll = pickLatLon(m.position);
      if (ll) pickRef.current?.(ll.lat, ll.lon);
    }, ScreenSpaceEventType.LEFT_CLICK);
    const onCam = () => {
      if (viewer.isDestroyed()) return;
      const height = viewer.camera.positionCartographic.height;
      setHud((h) => ({ ...h, height }));
      setView({ heading: viewer.camera.heading, pitch: viewer.camera.pitch, height });
    };
    viewer.camera.changed.addEventListener(onCam);
    onCam();

    const SLACK = 0.02;
    const nadir = new Cartesian3(), focus = new Cartesian3();
    let hasFocus = false;
    const offNadir = () => {
      const c = viewer.camera;
      Cartesian3.normalize(Cartesian3.negate(c.positionWC, nadir), nadir);
      return Cartesian3.angleBetween(c.directionWC, nadir);
    };
    const unFocus = scene.preRender.addEventListener(() => {
      const c = viewer.camera, dist = Cartesian3.magnitude(c.positionWC), off = offNadir();
      const allowed = maxOffNadir(dist);
      if (allowed !== undefined && off > allowed + SLACK) return;
      const range = groundRange(dist, off);
      if (range === undefined) return;
      Cartesian3.add(c.positionWC, Cartesian3.multiplyByScalar(c.directionWC, range, focus), focus);
      hasFocus = true;
    });
    const recentre = () => {
      if (viewer.isDestroyed()) return;
      const c = viewer.camera;
      if (!Matrix4.equals(c.transform, Matrix4.IDENTITY)) return;
      const dist = Cartesian3.magnitude(c.positionWC);
      const allowed = maxOffNadir(dist);
      if (allowed === undefined || offNadir() <= allowed + SLACK) return;
      const above = hasFocus ? focus : c.positionWC;
      c.flyTo({
        destination: Cartesian3.multiplyByScalar(Cartesian3.normalize(above, new Cartesian3()), dist, new Cartesian3()),
        orientation: { heading: 0, pitch: -CMath.PI_OVER_TWO, roll: 0 }, duration: 0.8,
      });
    };
    const unLimit = viewer.camera.moveEnd.addEventListener(recentre);

    const w = window as unknown as { __ee?: Record<string, unknown> };
    const unProgress = scene.globe.tileLoadProgressEvent.addEventListener((queued: number) => {
      if (queued === 0 && scene.globe.tilesLoaded && !(w.__ee && "firstGlobeMs" in w.__ee)) {
        w.__ee = { ...(w.__ee ?? {}), firstGlobeMs: Math.round(performance.now()) };
      }
    });
    onViewer?.(viewer);
    setReady((x) => x + 1);
    return () => {
      unProgress();
      unControls();
      unLimit();
      unFocus();
      cancelAnimationFrame(raf);
      viewer.camera.changed.removeEventListener(onCam);
      handler.destroy();
      onViewer?.(null);
      viewer.destroy();
      viewerRef.current = null;
      live.current = [];
      labelsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    const want = layers.map((l) => l.key);
    live.current = live.current.filter((x) => {
      if (want.includes(x.key)) return true;
      v.imageryLayers.remove(x.il, true);
      return false;
    });
    layers.forEach((spec) => {
      let entry = live.current.find((x) => x.key === spec.key);
      if (!entry) {
        const il = new ImageryLayer(spec.provider(), spec.blackToAlpha !== undefined
          ? { colorToAlpha: Color.BLACK, colorToAlphaThreshold: spec.blackToAlpha } : {});
        v.imageryLayers.add(il);
        entry = { key: spec.key, il };
        live.current.push(entry);
      }
      entry.il.alpha = spec.opacity ?? 1;
    });
    layers.forEach((spec, i) => {
      const entry = live.current.find((x) => x.key === spec.key);
      if (!entry) return;
      while (v.imageryLayers.indexOf(entry.il) > i) v.imageryLayers.lower(entry.il);
      while (v.imageryLayers.indexOf(entry.il) < i) v.imageryLayers.raise(entry.il);
    });
    v.scene.requestRender();
  }, [layers, ready]);

  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    v.terrainProvider = terrain ? createTerrainProvider((m) => terrErrRef.current?.(m)) : new EllipsoidTerrainProvider();
    v.scene.requestRender();
  }, [terrain, ready]);

  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    let cancelled = false;
    if (!labels) {
      if (labelsRef.current) labelsRef.current.show = false;
      v.scene.requestRender();
      return;
    }
    if (labelsRef.current) {
      labelsRef.current.show = true;
      v.scene.requestRender();
      return;
    }
    geo.loadLabels().then((list) => {
      if (cancelled || v.isDestroyed()) return;
      const lc = new LabelCollection({ scene: v.scene });
      for (const [name, lx, ly, rank] of list) {
        const f = { name, label: [lx, ly] as [number, number] };
        const far = rank <= 2 ? 2.4e7 : rank <= 3 ? 1.1e7 : rank <= 4 ? 6e6 : rank <= 5 ? 3e6 : 1.5e6;
        lc.add({
          position: Cartesian3.fromDegrees(f.label[0], f.label[1], 0), text: f.name,
          font: "500 12px Inter, system-ui, sans-serif", fillColor: Color.fromCssColorString("#e2e8f0"),
          outlineColor: Color.fromCssColorString("#03060d"), outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: VerticalOrigin.CENTER, distanceDisplayCondition: new DistanceDisplayCondition(0, far),
          scaleByDistance: new NearFarScalar(1e6, 1.1, 2e7, 0.8),
        });
      }
      v.scene.primitives.add(lc);
      labelsRef.current = lc;
      v.scene.requestRender();
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [labels, ready]);

  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    if (markerRef.current) v.entities.remove(markerRef.current);
    markerRef.current = null;
    if (marker) {
      markerRef.current = v.entities.add({
        position: Cartesian3.fromDegrees(marker.lon, marker.lat),
        point: { pixelSize: 11, color: Color.fromCssColorString("#22d3ee"), outlineColor: Color.WHITE, outlineWidth: 2, heightReference: terrain ? HeightReference.CLAMP_TO_GROUND : HeightReference.NONE, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      });
    }
    v.scene.requestRender();
  }, [marker?.lat, marker?.lon, terrain, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !flyTo || flyTo.token === 0) return;
    const h = flyTo.height ?? 600_000;
    const go = (ground: number) => v.camera.flyTo({
      destination: Cartesian3.fromDegrees(flyTo.lon, flyTo.lat - (h < 50_000 ? h / 111_000 / 1.2 : 0), h + ground),
      orientation: h < 50_000 ? { heading: 0, pitch: CMath.toRadians(-35), roll: 0 } : undefined,
      duration: 2.8,
    });
    if (terrain && h < 50_000) {

      sampleTerrain(v.terrainProvider, 11, [Cartographic.fromDegrees(flyTo.lon, flyTo.lat)])
        .then(([c]) => go(Number.isFinite(c.height) ? c.height : 0))
        .catch(() => go(3000));
    } else go(0);
  }, [flyTo?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = (fn: (v: CesiumWidget) => void) => { const v = viewerRef.current; if (v && !v.isDestroyed()) fn(v); };

  const autoTerrain = useRef(false);
  const tilt3d = (v: CesiumWidget) => {
    const st = useStore.getState(), to3d = isTopDown(v.camera.pitch);
    if (to3d && !st.terrain) {
      const lowNow = st.lowBandwidthChoice ?? st.lowBandwidthDetected;
      if (!lowNow || window.confirm(t("Low Bandwidth Mode is on. Terrain downloads about 13 MB for one low view. Continue?"))) { st.toggle("terrain"); autoTerrain.current = true; }
    } else if (!to3d && autoTerrain.current) { if (st.terrain) st.toggle("terrain"); autoTerrain.current = false; }
    toggleTilt(v);
  };
  return (
    <div className={`relative h-full w-full ${className ?? ""}`}>
      <div ref={el} className="absolute inset-0" />
      {error && <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-red-300">{t(error)}</div>}

      {controls && !error && (
        <div className="absolute top-1/2 left-2 z-10 flex -translate-y-1/2 flex-col gap-1.5 sm:right-2 sm:left-auto" data-testid="camera-controls">
          <div className="hidden flex-col gap-1.5 sm:flex">
            <button className={ctlBtn} onClick={() => act(northUp)} aria-label={t("North up")} title={t("North up")} data-testid="cam-north">
              <svg viewBox="0 0 24 24" width="20" height="20" style={{ transform: `rotate(${-view.heading}rad)` }} aria-hidden="true">
                <path d="M12 3 16 12H8z" fill="#f87171" /><path d="M12 21 8 12h8z" fill="#94a3b8" />
              </svg>
            </button>
            {view.height < TILT_BELOW && (
              <button className={`${ctlBtn} text-[12px] font-semibold`} onClick={() => act(tilt3d)} data-testid="cam-tilt"
                aria-label={t(isTopDown(view.pitch) ? "3D view with relief" : "Look straight down")} title={t(isTopDown(view.pitch) ? "3D view with relief" : "Look straight down")}>
                {isTopDown(view.pitch) ? "3D" : "2D"}
              </button>
            )}
          </div>
          <button className={`${ctlBtn} text-xl leading-none`} onClick={() => act((v) => zoomStep(v, "in"))} aria-label={t("Zoom in")} title={t("Zoom in")} data-testid="cam-zoom-in">+</button>
          <button className={`${ctlBtn} text-xl leading-none`} onClick={() => act((v) => zoomStep(v, "out"))} aria-label={t("Zoom out")} title={t("Zoom out")} data-testid="cam-zoom-out">−</button>
        </div>
      )}
      {showHud && (
        <div className="pointer-events-none absolute right-2 bottom-2 hidden rounded bg-black/60 px-2 py-1 font-mono text-[11px] text-slate-200 sm:block">
          {hud.lat !== undefined && hud.lon !== undefined ? fmtLatLon(hud.lat, hud.lon) : "—"}
          {hud.country && <span className="ml-2 text-accent">{hud.country}</span>}
          {hud.elev !== undefined && <span className="ml-2 text-slate-300">{t("elev ≈ ")}{Math.round(hud.elev)}{t(" m")}</span>}
          <span className="ml-3 text-slate-400">{t("camera ")}{formatHeight(hud.height)}</span>
          {!terrain && <span className="ml-3 text-slate-500">{t("terrain off")}</span>}
        </div>
      )}
    </div>
  );
}

const ctlBtn = "card icon-btn select-none text-slate-200 hover:border-accent hover:text-accent";

function formatHeight(h: number) {
  if (!Number.isFinite(h)) return "—";
  return h > 10_000 ? `${(h / 1000).toFixed(0)} km` : `${h.toFixed(0)} m`;
}
