import { EllipsoidTerrainProvider, ImageryLayer, Material, PointPrimitiveCollection, PolylineCollection, SingleTileImageryProvider, TextureMagnificationFilter, UrlTemplateImageryProvider, WebMercatorTilingScheme, Credit, type CesiumWidget, type PointPrimitive } from "@cesium/engine";
import { Cartesian3, Color, NearFarScalar, Rectangle } from "@cesium/core";
import { bundleBox, frameAt, isFrames, pointsBy, quadrantOutline, stepIndex, tierOf, windColor, type Bundle, type Layer, type RasterGrid, type Tier } from "./types";

const LIFT = 450;
const GIBS_MATRIX: Record<string, [string, number]> = { IMERG_Precipitation_Rate: ["GoogleMapsCompatible_Level6", 6] };

export interface RenderState { bundle?: Bundle; on: Record<string, boolean>; cursor: number }
export interface RenderStats { event?: string; tier: Tier; imagery: string[]; pointLayers: Record<string, { total: number; shown: number }>; lines: number; fixes: number; layers: string[]; cameraKm: number }

interface PointSet { col: PointPrimitiveCollection; prims: PointPrimitive[]; state: Uint8Array; layer: Layer; shown: number }

function parseColor(c: string): [number, number, number] {
  const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(c);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  const col = Color.fromCssColorString(c);
  return [Math.round(col.red * 255), Math.round(col.green * 255), Math.round(col.blue * 255)];
}

export function gridImage(r: RasterGrid): ImageData {
  const stops = r.ramp.map((s) => ({ v: s.v, c: parseColor(s.color) }));
  const img = new ImageData(r.nx, r.ny);
  for (let i = 0; i < r.values.length; i++) {
    const v = r.values[i] * r.scale;
    if (v < r.min_shown) continue;
    let k = 1;
    while (k < stops.length - 1 && stops[k].v < v) k++;
    const a = stops[k - 1], b = stops[k], f = Math.min(1, Math.max(0, (v - a.v) / (b.v - a.v || 1)));
    img.data[i * 4] = a.c[0] + (b.c[0] - a.c[0]) * f;
    img.data[i * 4 + 1] = a.c[1] + (b.c[1] - a.c[1]) * f;
    img.data[i * 4 + 2] = a.c[2] + (b.c[2] - a.c[2]) * f;
    img.data[i * 4 + 3] = 255 * Math.min(1, 0.3 + 0.35 * (v - r.min_shown));
  }
  return img;
}

function gridCanvas(r: RasterGrid): HTMLCanvasElement {
  const small = document.createElement("canvas");
  small.width = r.nx; small.height = r.ny;
  small.getContext("2d")!.putImageData(gridImage(r), 0, 0);

  const k = Math.max(1, Math.min(6, Math.floor(1536 / Math.max(r.nx, r.ny))));
  const c = document.createElement("canvas");
  c.width = r.nx * k; c.height = r.ny * k;
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  g.drawImage(small, 0, 0, c.width, c.height);
  return c;
}

function polygonCanvas(polys: number[][][][], color: string, fill: boolean): { canvas: HTMLCanvasElement; box: [number, number, number, number] } {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const p of polys) for (const [lon, lat] of p[0]) { w = Math.min(w, lon); e = Math.max(e, lon); s = Math.min(s, lat); n = Math.max(n, lat); }
  const pad = Math.max(e - w, n - s) * 0.02 + 0.002;
  w -= pad; e += pad; s -= pad; n += pad;

  const longKm = Math.max((e - w) * Math.cos(((s + n) / 2) * Math.PI / 180), n - s) * 111.2;
  const longPx = Math.min(2048, Math.max(256, longKm * 1000 / 60));
  const scale = Math.min(longPx / (e - w), longPx / (n - s));
  const c = document.createElement("canvas");
  c.width = Math.max(64, Math.round((e - w) * scale)); c.height = Math.max(64, Math.round((n - s) * scale));
  const g = c.getContext("2d")!;
  const [r, gr, b] = parseColor(color);
  g.beginPath();
  for (const p of polys) for (const ring of p) {
    ring.forEach(([lon, lat], i) => { const x = (lon - w) / (e - w) * c.width, y = (n - lat) / (n - s) * c.height; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.closePath();
  }
  if (fill) { g.fillStyle = `rgba(${r},${gr},${b},0.32)`; g.fill("evenodd"); }
  g.lineJoin = "round";
  g.strokeStyle = "rgba(0,0,0,0.55)"; g.lineWidth = 6; g.stroke();
  g.strokeStyle = `rgb(${r},${gr},${b})`; g.lineWidth = 3.2; g.stroke();
  return { canvas: c, box: [w, s, e, n] };
}

export class EventLayerRenderer {
  private lines = new PolylineCollection();
  private small = new PointPrimitiveCollection();
  private imagery = new Map<string, ImageryLayer>();
  private pointSets = new Map<string, PointSet>();
  private state: RenderState = { on: {}, cursor: 0 };
  private started = false;
  private tier: Tier = "global";
  private unCamera?: () => void;
  private pending = new Map<string, number>();
  stats: RenderStats = { tier: "global", imagery: [], pointLayers: {}, lines: 0, fixes: 0, layers: [], cameraKm: 0 };

  onTier?: (t: Tier) => void;

  constructor(private viewer: CesiumWidget) {}

  start() {
    if (this.started) return;
    this.started = true;
    const p = this.viewer.scene.primitives;
    p.add(this.lines); p.add(this.small);
    const onCam = () => { if (this.state.bundle && this.computeTier() !== this.tier) this.draw(); };
    this.viewer.camera.changed.addEventListener(onCam);
    this.viewer.camera.moveEnd.addEventListener(onCam);

    const onTerrain = () => { if (this.state.bundle) this.draw(); };
    this.viewer.scene.terrainProviderChanged.addEventListener(onTerrain);
    this.unCamera = () => { this.viewer.camera.changed.removeEventListener(onCam); this.viewer.camera.moveEnd.removeEventListener(onCam); this.viewer.scene.terrainProviderChanged.removeEventListener(onTerrain); };
  }
  destroy() {
    if (!this.started || this.viewer.isDestroyed()) return;
    this.unCamera?.();
    this.clear();
    const p = this.viewer.scene.primitives;
    p.remove(this.lines); p.remove(this.small);
    this.started = false;
    this.publish();
    this.viewer.scene.requestRender();
  }

  update(state: RenderState) {
    if (state.bundle !== this.state.bundle) this.clear();
    this.state = state;
    this.draw();
  }

  private clear() {
    for (const id of this.pending.values()) window.clearTimeout(id);
    this.pending.clear();
    for (const il of this.imagery.values()) this.viewer.imageryLayers.remove(il, true);
    this.imagery.clear();
    for (const s of this.pointSets.values()) this.viewer.scene.primitives.remove(s.col);
    this.pointSets.clear();
    this.lines.removeAll(); this.small.removeAll();
  }

  private cameraKm(box?: [number, number, number, number]) {
    if (!box) return 0;
    const centre = Cartesian3.fromDegrees((box[0] + box[2]) / 2, (box[1] + box[3]) / 2);
    return Cartesian3.distance(centre, this.viewer.camera.positionWC) / 1000;
  }
  private computeTier(): Tier {
    const box = this.state.bundle && bundleBox(this.state.bundle);
    return tierOf(box, this.cameraKm(box));
  }

  flyTo(b: Bundle, done?: () => void, leftInset = 0) {
    const box = bundleBox(b);
    if (!box) { done?.(); return; }
    const px = Math.max((box[2] - box[0]) * 0.18, 0.05), py = Math.max((box[3] - box[1]) * 0.18, 0.05);
    const extra = (box[2] - box[0] + 2 * px) * leftInset / Math.max(0.2, 1 - leftInset);
    this.viewer.camera.flyTo({ destination: Rectangle.fromDegrees(Math.max(-180, box[0] - px - extra), Math.max(-89, box[1] - py), Math.min(180, box[2] + px), Math.min(89, box[3] + py)), duration: 2.2, complete: done, cancel: done });
  }

  private addImagery(key: string, make: () => ImageryLayer) {
    if (this.imagery.has(key)) return;
    const il = make();
    this.viewer.imageryLayers.add(il);
    this.imagery.set(key, il);
  }

  private draw() {
    if (!this.started || this.viewer.isDestroyed()) return;
    const { bundle, on, cursor } = this.state;
    const tier = this.computeTier();
    if (tier !== this.tier) { this.tier = tier; this.onTier?.(tier); }
    const visible = bundle && tier !== "global" ? bundle.layers.filter((l) => on[l.id]) : [];
    const id = bundle?.event_id ?? "";
    this.lines.removeAll(); this.small.removeAll();
    let fixes = 0;

    const want = new Set<string>();
    for (const l of visible) {
      if (l.kind === "raster" && l.raster) {
        const r = l.raster;
        if (isFrames(r)) {
          const f = frameAt(r.frames, cursor);
          if (!f) continue;
          const key = `${id}|${l.id}|${f.label}`;
          want.add(key);
          this.addImagery(key, () => new ImageryLayer(new SingleTileImageryProvider({ url: f.url, rectangle: Rectangle.fromDegrees(...r.bbox), credit: new Credit(l.source.name, false),
            tileWidth: Math.round((r.bbox[2] - r.bbox[0]) / 0.0021973), tileHeight: Math.round((r.bbox[3] - r.bbox[1]) / 0.0021973) }),
            { alpha: 0.92, magnificationFilter: r.pixelated ? TextureMagnificationFilter.NEAREST : TextureMagnificationFilter.LINEAR }));
        } else {
          const key = `${id}|${l.id}|grid`;
          want.add(key);
          this.addImagery(key, () => { const c = gridCanvas(r); return new ImageryLayer(new SingleTileImageryProvider({ url: c.toDataURL("image/png"), rectangle: Rectangle.fromDegrees(...r.bbox), tileWidth: c.width, tileHeight: c.height, credit: new Credit(l.source.name, false) }), { alpha: 0.72 }); });
        }
      } else if (l.kind === "polygons" && l.polygons?.length) {
        const key = `${id}|${l.id}|poly`;
        want.add(key);
        this.addImagery(key, () => { const { canvas, box } = polygonCanvas(l.polygons!, l.color ?? "#ffffff", l.fill !== false); return new ImageryLayer(new SingleTileImageryProvider({ url: canvas.toDataURL("image/png"), rectangle: Rectangle.fromDegrees(...box), tileWidth: canvas.width, tileHeight: canvas.height, credit: new Credit(l.source.name, false) }), {}); });
      } else if (l.kind === "gibs" && l.gibs?.dates.length) {
        const g = l.gibs;
        const day = new Date(cursor).toISOString().slice(0, 10);
        let date = g.dates[0];
        for (const d of g.dates) if (d <= day) date = d;
        const key = `${id}|${l.id}|${date}`;
        want.add(key);
        const [matrix, maxLevel] = g.matrix ? [g.matrix, g.max_level ?? 6] : GIBS_MATRIX[g.layer] ?? ["GoogleMapsCompatible_Level6", 6];
        this.addImagery(key, () => new ImageryLayer(new UrlTemplateImageryProvider({ url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${g.layer}/default/${date}/${matrix}/{z}/{y}/{x}.png`,
          tilingScheme: new WebMercatorTilingScheme(), maximumLevel: maxLevel, credit: new Credit("NASA GIBS", false) }), { alpha: 0.7 }));
      }
    }

    for (const [key, il] of this.imagery) {
      if (want.has(key) || this.pending.has(key)) continue;
      const base = key.slice(0, key.lastIndexOf("|"));
      const replaced = [...want].some((k) => k.startsWith(base + "|"));
      const drop = () => { this.pending.delete(key); if (this.imagery.get(key) === il && !this.viewer.isDestroyed()) { this.viewer.imageryLayers.remove(il, true); this.imagery.delete(key); this.publish(); this.viewer.scene.requestRender(); } };
      if (replaced) this.pending.set(key, window.setTimeout(drop, 450)); else { this.viewer.imageryLayers.remove(il, true); this.imagery.delete(key); }
    }
    for (const key of want) { const t = this.pending.get(key); if (t !== undefined) { window.clearTimeout(t); this.pending.delete(key); } }

    const scale = new NearFarScalar(1.5e5, 1.5, 3e6, 0.75);
    for (const l of bundle?.layers ?? []) {
      if (l.kind !== "points" || !l.points) continue;
      const show = visible.includes(l);
      let set = this.pointSets.get(l.id);
      if (!set && show) {
        const p = l.points, col = new PointPrimitiveCollection(), base = Color.fromCssColorString(l.color ?? "#ffffff");
        const prims: PointPrimitive[] = [];
        for (let i = 0; i < p.lon.length; i++) {
          const size = p.size_by === "v" && p.v ? 3 + Math.max(0, p.v[i] - 2) * 2.4 : l.size ?? 5;
          prims.push(col.add({ position: Cartesian3.fromDegrees(p.lon[i], p.lat[i], LIFT), pixelSize: size, color: base.withAlpha(0.9), outlineColor: Color.BLACK.withAlpha(0.55), outlineWidth: size > 4 ? 1 : 0,
            scaleByDistance: scale, disableDepthTestDistance: Number.POSITIVE_INFINITY, show: false }));
        }
        this.viewer.scene.primitives.add(col);
        set = { col, prims, state: new Uint8Array(prims.length), layer: l, shown: 0 };
        this.pointSets.set(l.id, set);
      }
      if (!set) continue;
      set.col.show = show;
      if (!show) continue;
      const p = l.points, n = pointsBy(p, cursor);
      const recent = l.recent_color && p.t_min && p.t0 !== undefined ? Color.fromCssColorString(l.recent_color) : undefined;
      const old = recent ? Color.fromCssColorString(l.color ?? "#ffffff").withAlpha(0.62) : undefined;
      const recentFrom = recent ? (cursor - (l.recent_ms ?? 86_400_000) - p.t0!) / 60000 : 0;
      for (let i = 0; i < set.prims.length; i++) {
        const st = i >= n ? 0 : recent && p.t_min![i] > recentFrom ? 2 : 1;
        if (st === set.state[i]) continue;
        set.state[i] = st;
        set.prims[i].show = st > 0;
        if (recent && st) set.prims[i].color = st === 2 ? recent : old!;
      }
      set.shown = n;
    }

    const flat = this.viewer.scene.terrainProvider instanceof EllipsoidTerrainProvider;
    for (const l of visible) {
      if (l.kind === "polygons" && flat) {

        const color = Color.fromCssColorString(l.color ?? "#ffffff");
        for (const poly of l.polygons ?? []) for (const ring of poly) this.lines.add({ positions: ring.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat, LIFT)), width: 2, material: Material.fromType("Color", { color }) });
      }
      else if (l.kind === "track" && l.fixes?.length) {
        const upto = l.fixes.filter((f) => f.t <= cursor);
        const head = upto[upto.length - 1];
        for (let i = 1; i < upto.length; i++) {
          const a = upto[i - 1], b = upto[i];
          this.lines.add({ positions: [Cartesian3.fromDegrees(a.lon, a.lat, LIFT), Cartesian3.fromDegrees(b.lon, b.lat, LIFT)], width: 3.2, material: Material.fromType("Color", { color: Color.fromCssColorString(windColor(l.wind_unit ? b.wind : undefined)) }) });
        }

        const rest = l.fixes.slice(Math.max(0, upto.length - 1));
        if (rest.length > 1) this.lines.add({ positions: rest.map((f) => Cartesian3.fromDegrees(f.lon, f.lat, LIFT)), width: 1.2, material: Material.fromType("Color", { color: Color.WHITE.withAlpha(0.5) }) });
        for (const f of upto) {
          const isHead = f === head;
          this.small.add({ position: Cartesian3.fromDegrees(f.lon, f.lat, LIFT), pixelSize: isHead ? 13 : f.id === "L" ? 9 : 6, color: Color.fromCssColorString(windColor(l.wind_unit ? f.wind : undefined)),
            outlineColor: isHead || f.id === "L" ? Color.WHITE : Color.BLACK.withAlpha(0.6), outlineWidth: isHead || f.id === "L" ? 2 : 1, disableDepthTestDistance: isHead ? Number.POSITIVE_INFINITY : 0 });
          fixes++;
        }
      } else if (l.kind === "radii" && l.rows?.length) {
        const row = l.rows[stepIndex(l.rows, cursor)];
        if (row.t > cursor) continue;
        const rings: [(number | null)[], string, number][] = [[row.r34, l.legend[0]?.color ?? "#facc15", 2.2], [row.r50, l.legend[1]?.color ?? "#fb923c", 2.2], [row.r64, l.legend[2]?.color ?? "#ef4444", 2.6]];
        for (const [radii, color, width] of rings) {
          const outline = quadrantOutline(row.lon, row.lat, radii);
          if (outline) this.lines.add({ positions: outline.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat, LIFT)), width, material: Material.fromType("Color", { color: Color.fromCssColorString(color) }) });
        }
      }
    }

    this.stats = { event: bundle?.event_id, tier, imagery: [...this.imagery.keys()].filter((k) => !this.pending.has(k)), lines: this.lines.length, fixes, layers: visible.map((l) => l.id), cameraKm: Math.round(this.cameraKm(bundle && bundleBox(bundle))),
      pointLayers: Object.fromEntries([...this.pointSets].map(([k, s]) => [k, { total: s.prims.length, shown: s.col.show ? s.shown : 0 }])) };
    this.publish();
    this.viewer.scene.requestRender();
  }

  private publish() {
    const w = window as unknown as { __ee?: Record<string, unknown> };
    w.__ee = { ...(w.__ee ?? {}), evidence: this.started ? this.stats : undefined };
  }
}
