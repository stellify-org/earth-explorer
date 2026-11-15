import { EllipsoidTerrainProvider, Material, PointPrimitiveCollection, PolylineCollection, type CesiumWidget } from "@cesium/engine";
import { BoundingSphere, Cartesian2, Cartesian3, Cartographic, Color, HeadingPitchRange, Math as CMath, NearFarScalar } from "@cesium/core";
import { EventEffects, type EffectItem } from "./effects";
import { DAY, STYLE, cluster, clusterCell, clusterSize, depthColor, endedBy, fixesBy, markerAt, markerSize, type Cluster, type Ev } from "./model";

const LIFT = 400;

const MAX_ANIMATED = 150;

const TERRAIN_RANGE = 800_000;

export type Picked = { kind: "event"; ev: Ev } | { kind: "cluster"; cluster: Cluster } | undefined;
interface Tag { ee: "event" | "cluster"; ev?: Ev; cluster?: Cluster }

export interface SceneState { items: Ev[]; cursor: number; selected?: Ev; suppress?: { id: string; track: boolean; outline: boolean; lon?: number; lat?: number } }
export interface SceneStats { markers: number; clusters: number; clustered: number; tracks: number; trackPoints: number; outlineRings: number; cell: number; selected: boolean;  selectedHeight?: number;  fx?: EventEffects["stats"] }

export class EventScene {
  private pts = new PointPrimitiveCollection();
  private ring = new PointPrimitiveCollection();
  private lines = new PolylineCollection();
  private state: SceneState = { items: [], cursor: Date.now() };
  private cell = -1;
  private started = false;

  private near: [number, number][] = [];
  private nearSum = 0;
  private retry = 0;
  private unCamera?: () => void;
  private prevCursor?: number;
  readonly effects: EventEffects;
  stats: SceneStats = { markers: 0, clusters: 0, clustered: 0, tracks: 0, trackPoints: 0, outlineRings: 0, cell: 0, selected: false };

  constructor(private viewer: CesiumWidget) { this.effects = new EventEffects(viewer); }

  start() {
    if (this.started) return;
    this.started = true;
    const p = this.viewer.scene.primitives;
    p.add(this.lines); p.add(this.pts); p.add(this.ring);
    this.effects.start();
    const onCam = () => { if (clusterCell(this.height()) !== this.cell || this.hasTerrain()) this.draw(); };
    this.viewer.camera.changed.addEventListener(onCam);

    this.viewer.camera.moveEnd.addEventListener(onCam);
    this.unCamera = () => { this.viewer.camera.changed.removeEventListener(onCam); this.viewer.camera.moveEnd.removeEventListener(onCam); };
  }
  destroy() {
    if (!this.started || this.viewer.isDestroyed()) return;
    this.unCamera?.();
    window.clearTimeout(this.retry);
    this.effects.destroy();
    const p = this.viewer.scene.primitives;
    p.remove(this.lines); p.remove(this.pts); p.remove(this.ring);
    this.viewer.scene.requestRender();
    this.started = false;
  }

  update(state: SceneState) {
    const before = this.state.cursor;
    this.state = state;

    this.prevCursor = state.cursor > before && state.cursor - before <= 2 * DAY ? before : undefined;
    this.draw();
    this.prevCursor = undefined;
  }
  setAnimated(on: boolean) { this.effects.setEnabled(on); }

  private terrainSum() {
    let sum = 0;
    for (const [lon, lat] of this.near) sum += this.viewer.scene.globe.getHeight(Cartographic.fromDegrees(lon, lat)) ?? -1e4;
    return sum;
  }

  private watchTerrain() {
    window.clearTimeout(this.retry);
    if (!this.near.length) return;
    this.retry = window.setTimeout(() => {
      if (!this.started || this.viewer.isDestroyed()) return;
      if (Math.abs(this.terrainSum() - this.nearSum) > 1) this.draw(); else this.watchTerrain();
    }, 1000);
  }

  private height() { return this.viewer.camera.positionCartographic.height; }
  private hasTerrain() { return !(this.viewer.scene.terrainProvider instanceof EllipsoidTerrainProvider); }

  private at(lon: number, lat: number, near: boolean): Cartesian3 {
    let h = LIFT;
    if (near) {
      const g = this.viewer.scene.globe.getHeight(Cartographic.fromDegrees(lon, lat));
      if (g !== undefined && Number.isFinite(g)) h = g + 60;
      this.near.push([lon, lat]);
    }
    return Cartesian3.fromDegrees(lon, lat, h);
  }

  private draw() {
    if (!this.started || this.viewer.isDestroyed()) return;
    const { items, cursor, selected, suppress } = this.state;
    const markerOf = (e: Ev) => suppress?.id === e.id && suppress.lon !== undefined && suppress.lat !== undefined ? { ...markerAt(e, cursor), lon: suppress.lon, lat: suppress.lat } : markerAt(e, cursor);
    const cam = this.viewer.camera.positionWC, terrain = this.hasTerrain() && this.height() < TERRAIN_RANGE;
    const pos = (lon: number, lat: number) => {
      const flat = Cartesian3.fromDegrees(lon, lat, LIFT);
      return terrain && Cartesian3.distance(flat, cam) < TERRAIN_RANGE ? this.at(lon, lat, true) : flat;
    };
    this.cell = clusterCell(this.height());
    this.near = [];
    this.pts.removeAll(); this.lines.removeAll(); this.ring.removeAll();
    const st: SceneStats = { markers: 0, clusters: 0, clustered: 0, tracks: 0, trackPoints: 0, outlineRings: 0, cell: this.cell, selected: false };
    const dark = Color.BLACK.withAlpha(0.65);

    const fx: (EffectItem & { d: number })[] = [];
    let pops = 0;
    const scale = new NearFarScalar(3e5, 1.5, 1.6e7, 0.8);

    const fires = items.filter((e) => e.cat === "wildfires" && e.id !== selected?.id);
    const rest = items.filter((e) => e.cat !== "wildfires" || e.id === selected?.id);
    for (const c of cluster(fires, this.cell)) {
      if (c.members.length === 1) { rest.push(c.members[0]); continue; }
      const n = c.members.length, col = Color.fromCssColorString(STYLE.wildfires.color);

      this.pts.add({ position: pos(c.lon, c.lat), pixelSize: clusterSize(n), color: col.withAlpha(0.55), outlineColor: col.withAlpha(0.95), outlineWidth: 1.5,
        scaleByDistance: scale, id: { ee: "cluster", cluster: c } satisfies Tag });
      st.clusters++; st.clustered += n;
      const burning = c.members.filter((e) => !endedBy(e, cursor)).length;
      if (burning) { const p = pos(c.lon, c.lat); fx.push({ key: `c${c.lon.toFixed(2)},${c.lat.toFixed(2)}`, kind: "cluster", position: p, lat: c.lat, size: clusterSize(burning) / 12, id: { ee: "cluster", cluster: c } satisfies Tag, d: Cartesian3.distanceSquared(p, cam) }); }
    }

    for (const e of rest) {
      const faded = endedBy(e, cursor) && e.id !== selected?.id;
      const base = Color.fromCssColorString(e.cat === "earthquakes" && e.depthKm !== undefined ? depthColor(e.depthKm) : STYLE[e.cat].color);
      const m = markerOf(e);
      if (e.track && !(suppress?.id === e.id && suppress.track)) {
        const fixes = fixesBy(e, cursor);
        if (fixes.length > 1) {

          this.lines.add({ positions: fixes.map((f) => pos(f.lon, f.lat)), width: e.id === selected?.id ? 3 : 1.6,
            material: Material.fromType("Color", { color: base.withAlpha(faded ? 0.35 : 0.9) }) });
          st.tracks++;
        }
        for (const f of fixes.slice(0, -1)) {
          this.pts.add({ position: pos(f.lon, f.lat), pixelSize: 4, color: base.withAlpha(faded ? 0.3 : 0.75), outlineColor: dark, outlineWidth: 1, id: { ee: "event", ev: e } satisfies Tag });
          st.trackPoints++;
        }
      }
      this.pts.add({ position: pos(m.lon, m.lat), pixelSize: markerSize(e), color: base.withAlpha(faded ? 0.38 : 0.95),
        outlineColor: e.geometry === "polygon" ? Color.WHITE.withAlpha(faded ? 0.4 : 0.9) : dark, outlineWidth: e.geometry === "polygon" ? 1.5 : 1,
        scaleByDistance: scale, id: { ee: "event", ev: e } satisfies Tag });
      st.markers++;
      const here = pos(m.lon, m.lat), isSel = e.id === selected?.id;
      const active = e.cat === "earthquakes" ? cursor - e.start < DAY : e.cat !== "other" && !faded;
      if (isSel || active) fx.push({ key: e.id, kind: e.cat, position: here, lat: m.lat, strong: isSel, id: { ee: "event", ev: e } satisfies Tag, d: isSel ? -1 : Cartesian3.distanceSquared(here, cam) });
      if (this.prevCursor !== undefined && e.start > this.prevCursor && pops < 60) { pops++; this.effects.pop(here, STYLE[e.cat].color); }
    }

    if (selected && items.some((e) => e.id === selected.id)) {
      const m = markerOf(selected), col = Color.fromCssColorString(STYLE[selected.cat].color);

      for (const poly of suppress?.id === selected.id && suppress.outline ? [] : selected.polygons ?? []) for (const r of poly) {
        this.lines.add({ positions: r.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat, LIFT)), width: 2.2, loop: true, material: Material.fromType("Color", { color: col.brighten(0.35, new Color()) }) });
        st.outlineRings++;
      }

      this.ring.add({ position: pos(m.lon, m.lat), pixelSize: markerSize(selected) + 16, color: Color.WHITE.withAlpha(0.01), outlineColor: Color.WHITE, outlineWidth: 3,
        disableDepthTestDistance: Number.POSITIVE_INFINITY });
      this.ring.add({ position: pos(m.lon, m.lat), pixelSize: markerSize(selected) + 24, color: Color.WHITE.withAlpha(0.01), outlineColor: col.withAlpha(0.9), outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY });
      st.selected = true;
      st.selectedHeight = Cartographic.fromCartesian(pos(m.lon, m.lat)).height;
    }
    this.near = this.near.slice(0, 400);
    this.nearSum = this.terrainSum();
    this.watchTerrain();
    fx.sort((a, b) => a.d - b.d);
    this.effects.set(fx.slice(0, MAX_ANIMATED));
    st.fx = this.effects.stats;
    this.stats = st;
    (window as unknown as { __ee?: Record<string, unknown> }).__ee = { ...((window as unknown as { __ee?: Record<string, unknown> }).__ee ?? {}), events: st };
    this.viewer.scene.requestRender();
  }

  pick(p: Cartesian2): Picked {
    const hit = this.viewer.scene.pick(p) as { id?: Tag } | undefined;
    const tag = hit?.id;
    if (!tag || typeof tag !== "object" || !("ee" in tag)) return undefined;
    if (tag.ee === "event" && tag.ev) return { kind: "event", ev: tag.ev };
    if (tag.ee === "cluster" && tag.cluster) return { kind: "cluster", cluster: tag.cluster };
    return undefined;
  }

  symbolAt(x: number, y: number): string | undefined {
    const hit = this.viewer.scene.pick(new Cartesian2(x, y)) as { id?: Tag; primitive?: unknown } | undefined;
    return hit && this.effects.owns(hit.primitive) && hit.id?.ee === "event" ? hit.id.ev?.id : undefined;
  }

  screenOf(e: Ev): { x: number; y: number } | undefined {
    const m = markerAt(e, this.state.cursor);
    const w = this.viewer.scene.cartesianToCanvasCoordinates(Cartesian3.fromDegrees(m.lon, m.lat, LIFT));
    return w ? { x: w.x, y: w.y } : undefined;
  }

  flyTo(e: Ev, height = 1_500_000, done?: () => void) {
    const pts: Cartesian3[] = [];
    for (const f of e.track ?? []) pts.push(Cartesian3.fromDegrees(f.lon, f.lat));
    if (e.bbox) { const [w, s, east, n] = e.bbox; pts.push(Cartesian3.fromDegrees(w, s), Cartesian3.fromDegrees(east, n), Cartesian3.fromDegrees(w, n), Cartesian3.fromDegrees(east, s)); }
    if (pts.length < 2) {
      this.viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(e.lon, e.lat, height), duration: 2.2, complete: done, cancel: done });
      return;
    }
    const sphere = BoundingSphere.fromPoints(pts);
    const range = Math.max(sphere.radius * 3.2, 150_000);
    this.viewer.camera.flyToBoundingSphere(sphere, { offset: new HeadingPitchRange(0, -CMath.PI_OVER_TWO, range), duration: 2.2, complete: done, cancel: done });
  }

  openCluster(c: Cluster) {
    const h = this.height();
    this.viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(c.lon, c.lat, h > 9e6 ? 4_400_000 : h > 4.5e6 ? 1_900_000 : 900_000), duration: 1.6 });
  }
}
