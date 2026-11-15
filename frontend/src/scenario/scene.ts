import { LabelCollection, LabelStyle, PerInstanceColorAppearance, PointPrimitiveCollection, Primitive, VerticalOrigin, type CesiumWidget } from "@cesium/engine";
import { BoundingSphere, Cartesian2, Cartesian3, Cartographic, Color, ComponentDatatype, Geometry, GeometryAttribute, GeometryInstance, HeadingPitchRange, Math as CMath, PrimitiveType } from "@cesium/core";
import { damBarrier, flood, type Flood, type NurekMeta, type Terrain } from "./model";
import { addGround } from "../globe/controls";

const LIFT = 60;
export const WATER_OFFSET = 0.4;
export const STEP = 2;

export class Mesh {
  pos: number[] = []; col: number[] = []; idx: number[] = [];
  vertex(p: Cartesian3, r: number, g: number, b: number, a = 255) { this.pos.push(p.x, p.y, p.z); this.col.push(r, g, b, a); return this.pos.length / 3 - 1; }
  primitive(translucent: boolean): Primitive | undefined {
    if (!this.idx.length) return undefined;
    const positions = new Float64Array(this.pos);
    return new Primitive({
      geometryInstances: new GeometryInstance({
        geometry: new Geometry({
          attributes: {
            position: new GeometryAttribute({ componentDatatype: ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: positions }),
            color: new GeometryAttribute({ componentDatatype: ComponentDatatype.UNSIGNED_BYTE, componentsPerAttribute: 4, normalize: true, values: new Uint8Array(this.col) }),
          } as never,
          indices: new Uint32Array(this.idx), primitiveType: PrimitiveType.TRIANGLES,
          boundingSphere: BoundingSphere.fromVertices(positions as unknown as number[]),
        }),
      }),
      appearance: new PerInstanceColorAppearance({ flat: true, translucent, closed: false }),
      asynchronous: false,
    });
  }
}

const RAMP: [number, number, number, number][] = [[500, 78, 116, 66], [1000, 132, 148, 84], [1500, 172, 152, 100], [2100, 150, 124, 100], [2700, 176, 174, 172], [3300, 190, 186, 182], [4500, 214, 212, 210], [6000, 250, 250, 250]];
function tint(z: number): [number, number, number] {
  for (let k = 1; k < RAMP.length; k++) if (z <= RAMP[k][0] || k === RAMP.length - 1) {
    const a = RAMP[k - 1], b = RAMP[k], f = Math.min(1, Math.max(0, (z - a[0]) / (b[0] - a[0])));
    return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f];
  }
  return [128, 128, 128];
}

export interface SceneOptions {

  barrier?: Uint8Array;

  outline?: Uint8Array;
  exaggeration?: number;

  view?: { col: number; row: number; heading: number; pitch: number; range: number; radius: number };
}

export class ScenarioScene {
  readonly barrier: Uint8Array;

  readonly baseline: Flood;
  readonly zBase: number;
  exaggeration = 2;

  current: Flood;
  private terrainPrim?: Primitive; private outlinePrim?: Primitive; private waterPrims: Primitive[] = [];

  outlineCells = 0;
  private firstWaterVertex?: Cartesian3;
  private labels?: LabelCollection; private points?: PointPrimitiveCollection;

  shoreCells = { baseline: 0, scenario: 0 };

  constructor(private viewer: CesiumWidget, readonly t: Terrain, readonly meta: NurekMeta, private opts: SceneOptions = {}) {
    this.barrier = opts.barrier ?? damBarrier(t, meta.dam);
    this.exaggeration = opts.exaggeration ?? 2;
    this.baseline = flood(t, meta.dem_water.seed, meta.dem_water.level_m, meta.dem_water.level_m, this.barrier);

    const sorted = Int16Array.from(t.z).sort();
    this.zBase = sorted[Math.floor(sorted.length * 0.005)];
    this.current = this.baseline;
    this.unGround = addGround(viewer, (lon, lat) => this.groundAt(lon, lat));
  }
  private unGround: () => void;

  groundAt(lonDeg: number, latDeg: number): number | undefined {
    const { t } = this, j = t.col(lonDeg), i = t.row(latDeg);
    if (!(i >= 0 && j >= 0 && i < t.h && j < t.w)) return undefined;
    let z = -Infinity;
    for (let a = Math.max(0, i - STEP); a <= Math.min(t.h - 1, i + STEP); a++) for (let b = Math.max(0, j - STEP); b <= Math.min(t.w - 1, j + STEP); b++) {
      const c = a * t.w + b, v = this.current.mask[c] ? Math.max(t.z[c], this.current.level + WATER_OFFSET) : t.z[c];
      if (v > z) z = v;
    }
    return this.height(z);
  }

  height(z: number) { return LIFT + Math.max(0, z - this.zBase) * this.exaggeration; }

  private add(p: Primitive | undefined) { if (p) this.viewer.scene.primitives.add(p); return p; }

  buildTerrain() {
    const { t } = this, sc = this.viewer.scene;
    if (this.terrainPrim) sc.primitives.remove(this.terrainPrim);
    const m = new Mesh(), rows = Math.floor((t.h - 1) / STEP) + 1, cols = Math.floor((t.w - 1) / STEP) + 1;
    const cellM = Math.sqrt(t.rowArea[t.h >> 1]), ids = new Int32Array(rows * cols);
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      const i = r * STEP, j = q * STEP, c = i * t.w + j, z = t.z[c];

      const zw = t.z[c - (j > 0 ? 1 : 0)], ze = t.z[c + (j < t.w - 1 ? 1 : 0)], zn = t.z[c - (i > 0 ? t.w : 0)], zs = t.z[c + (i < t.h - 1 ? t.w : 0)];
      const gx = (ze - zw) / (2 * cellM), gy = (zn - zs) / (2 * cellM), len = Math.hypot(gx, gy, 1);
      const shade = 0.5 + 0.5 * Math.max(0, (gx * 0.5 - gy * 0.5 + 0.7071) / len);
      let [cr, cg, cb] = tint(z);
      if (this.barrier[c]) { cr = 190; cg = 190; cb = 196; }
      ids[r * cols + q] = m.vertex(Cartesian3.fromDegrees(t.lon(j + 0.5), t.lat(i + 0.5), this.height(z)), cr * shade, cg * shade, cb * shade);
    }
    const wet = (r: number, q: number) => this.baseline.mask[r * STEP * t.w + q * STEP] === 1;
    for (let r = 0; r < rows - 1; r++) for (let q = 0; q < cols - 1; q++) {

      if (wet(r, q) && wet(r, q + 1) && wet(r + 1, q) && wet(r + 1, q + 1)) continue;
      const a = ids[r * cols + q], b = ids[r * cols + q + 1], c = ids[(r + 1) * cols + q + 1], d = ids[(r + 1) * cols + q];
      m.idx.push(a, b, c, a, c, d);
    }

    const edge: [number, number][] = [];
    for (let q = 0; q < cols; q++) edge.push([0, q]); for (let r = 1; r < rows; r++) edge.push([r, cols - 1]);
    for (let q = cols - 2; q >= 0; q--) edge.push([rows - 1, q]); for (let r = rows - 2; r >= 0; r--) edge.push([r, 0]);
    let prevTop = -1, prevBottom = -1;
    for (const [r, q] of edge) {
      const top = ids[r * cols + q], bottom = m.vertex(Cartesian3.fromDegrees(t.lon(q * STEP + 0.5), t.lat(r * STEP + 0.5), 0), 24, 30, 42);
      if (prevTop >= 0) m.idx.push(prevTop, top, bottom, prevTop, bottom, prevBottom);
      prevTop = top; prevBottom = bottom;
    }
    this.terrainPrim = this.add(m.primitive(false));
    this.buildOutline();
    sc.requestRender();
  }

  private buildOutline() {
    const { t } = this, o = this.opts.outline, sc = this.viewer.scene;
    if (this.outlinePrim) sc.primitives.remove(this.outlinePrim);
    this.outlinePrim = undefined; this.outlineCells = 0;
    if (!o) return;
    const m = new Mesh(), L0 = this.meta.dem_water.level_m, inside = (i: number, j: number) => i >= 0 && j >= 0 && i < t.h && j < t.w && o[i * t.w + j] === 1;
    for (let i = 0; i < t.h; i++) for (let j = 0; j < t.w; j++) if (inside(i, j) && !(inside(i - 1, j) && inside(i + 1, j) && inside(i, j - 1) && inside(i, j + 1))) {

      let z = L0; for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const ni = Math.min(t.h - 1, Math.max(0, i + di)), nj = Math.min(t.w - 1, Math.max(0, j + dj)); if (t.z[ni * t.w + nj] > z) z = t.z[ni * t.w + nj]; }
      const hLine = this.height(z) + 6;
      const p = m.vertex(Cartesian3.fromDegrees(t.lon(j + 0.2), t.lat(i + 0.2), hLine), 232, 121, 249), q = m.vertex(Cartesian3.fromDegrees(t.lon(j + 0.8), t.lat(i + 0.2), hLine), 232, 121, 249);
      const s2 = m.vertex(Cartesian3.fromDegrees(t.lon(j + 0.8), t.lat(i + 0.8), hLine), 232, 121, 249), u = m.vertex(Cartesian3.fromDegrees(t.lon(j + 0.2), t.lat(i + 0.8), hLine), 232, 121, 249);
      m.idx.push(p, q, s2, p, s2, u); this.outlineCells++;
    }
    this.outlinePrim = this.add(m.primitive(false));
  }

  setLabels(waterBody: string, others: { text: string; lat: number; lon: number; kind?: string }[] | string) {
    const { t } = this, sc = this.viewer.scene;
    if (this.labels) sc.primitives.remove(this.labels);
    if (this.points) sc.primitives.remove(this.points);
    this.points = undefined;
    const lc = new LabelCollection(), [si, sj] = this.meta.dem_water.seed, pts = new PointPrimitiveCollection();
    const top = this.meta.published.full_supply_level_masl?.value ?? this.meta.dem_water.level_m, ex = this.exaggeration / 2;
    const common = { font: "600 15px sans-serif", fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 4, style: LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: VerticalOrigin.BOTTOM, pixelOffset: new Cartesian2(0, -6), disableDepthTestDistance: Number.POSITIVE_INFINITY };
    lc.add({ ...common, text: waterBody, position: Cartesian3.fromDegrees(t.lon(sj + 0.5), t.lat(si + 0.5), this.height(top) + 150 * ex) });
    const list = typeof others === "string" ? [{ text: others, lat: this.meta.dam.lat, lon: this.meta.dam.lon, kind: "dam" }] : others;
    for (const l of list) {
      const i = Math.min(t.h - 1, Math.max(0, t.row(l.lat))), j = Math.min(t.w - 1, Math.max(0, t.col(l.lon)));
      const ground = l.kind === "dam" ? this.height(top) + 400 * ex : this.height(t.z[i * t.w + j]) + 120 * ex;
      lc.add({ ...common, font: l.kind === "dam" ? "600 13px sans-serif" : "500 12px sans-serif", text: l.text, position: Cartesian3.fromDegrees(l.lon, l.lat, ground),
        ...(l.kind === "quake" ? { fillColor: Color.fromBytes(253, 186, 116, 255), pixelOffset: new Cartesian2(0, -12) } : {}) });

      if (l.kind === "quake") pts.add({ position: Cartesian3.fromDegrees(l.lon, l.lat, ground), color: Color.fromBytes(249, 115, 22, 255), outlineColor: Color.WHITE, outlineWidth: 2, pixelSize: 13, disableDepthTestDistance: Number.POSITIVE_INFINITY });
    }
    if (pts.length) this.points = sc.primitives.add(pts) as PointPrimitiveCollection;
    this.labels = sc.primitives.add(lc) as LabelCollection;
    sc.requestRender();
  }

  setLevel(level: number): Flood {
    const { t } = this, sc = this.viewer.scene, L0 = this.meta.dem_water.level_m;
    const f = flood(t, this.meta.dem_water.seed, L0, level, this.barrier, this.baseline.mask);
    for (const p of this.waterPrims) sc.primitives.remove(p);
    this.waterPrims = []; this.firstWaterVertex = undefined;
    const hWater = this.height(level + WATER_OFFSET), W = t.w + 1;
    const build = (code: number, r: number, g: number, b: number, a: number) => {
      const m = new Mesh(), ids = new Int32Array(W * (t.h + 1)).fill(-1);
      const v = (i: number, j: number) => { const k = i * W + j; if (ids[k] < 0) ids[k] = m.vertex(Cartesian3.fromDegrees(t.lon(j), t.lat(i), hWater), r, g, b, a); return ids[k]; };
      for (let i = 0; i < t.h; i++) for (let j = 0; j < t.w; j++) if (f.mask[i * t.w + j] === code) {
        const p = v(i, j), q = v(i, j + 1), s = v(i + 1, j + 1), u = v(i + 1, j);
        m.idx.push(p, q, s, p, s, u);
      }
      if (!this.firstWaterVertex && m.pos.length) this.firstWaterVertex = new Cartesian3(m.pos[0], m.pos[1], m.pos[2]);
      const prim = this.add(m.primitive(a < 255)); if (prim) this.waterPrims.push(prim);
    };
    build(1, 29, 98, 201, 235);
    build(2, 45, 212, 236, 215);

    const wet = (i: number, j: number, scenario: boolean) => i >= 0 && j >= 0 && i < t.h && j < t.w && (scenario ? f.mask[i * t.w + j] > 0 : this.baseline.mask[i * t.w + j] === 1);
    const shore = (scenario: boolean, r: number, g: number, b: number, lift: number) => {
      const m = new Mesh(), hLine = this.height(level + WATER_OFFSET + lift); let n = 0;
      for (let i = 0; i < t.h; i++) for (let j = 0; j < t.w; j++) if (wet(i, j, scenario) && !(wet(i - 1, j, scenario) && wet(i + 1, j, scenario) && wet(i, j - 1, scenario) && wet(i, j + 1, scenario))) {
        const p = m.vertex(Cartesian3.fromDegrees(t.lon(j), t.lat(i), hLine), r, g, b), q = m.vertex(Cartesian3.fromDegrees(t.lon(j + 1), t.lat(i), hLine), r, g, b);
        const s2 = m.vertex(Cartesian3.fromDegrees(t.lon(j + 1), t.lat(i + 1), hLine), r, g, b), u = m.vertex(Cartesian3.fromDegrees(t.lon(j), t.lat(i + 1), hLine), r, g, b);
        m.idx.push(p, q, s2, p, s2, u); n++;
      }
      const prim = this.add(m.primitive(false)); if (prim) this.waterPrims.push(prim);
      return n;
    };
    this.shoreCells = { baseline: level >= L0 ? shore(false, 255, 255, 255, 0.5) : 0, scenario: level > L0 ? shore(true, 251, 146, 60, 5) : 0 };
    if (f.belowData) {

      const m = new Mesh(), hTop = this.height(L0), wetAt = (i: number, j: number) => i >= 0 && j >= 0 && i < t.h && j < t.w && this.baseline.mask[i * t.w + j] === 1;
      const wall = (i0: number, j0: number, i1: number, j1: number) => {
        const a = m.vertex(Cartesian3.fromDegrees(t.lon(j0), t.lat(i0), hTop), 122, 132, 150), b = m.vertex(Cartesian3.fromDegrees(t.lon(j1), t.lat(i1), hTop), 122, 132, 150);
        const c = m.vertex(Cartesian3.fromDegrees(t.lon(j1), t.lat(i1), hWater), 84, 94, 112), d = m.vertex(Cartesian3.fromDegrees(t.lon(j0), t.lat(i0), hWater), 84, 94, 112);
        m.idx.push(a, b, c, a, c, d);
      };
      for (let i = 0; i < t.h; i++) for (let j = 0; j < t.w; j++) if (wetAt(i, j)) {
        if (!wetAt(i - 1, j)) wall(i, j, i, j + 1); if (!wetAt(i + 1, j)) wall(i + 1, j, i + 1, j + 1);
        if (!wetAt(i, j - 1)) wall(i, j, i + 1, j); if (!wetAt(i, j + 1)) wall(i, j + 1, i + 1, j + 1);
      }
      const prim = this.add(m.primitive(false)); if (prim) this.waterPrims.push(prim);
    }
    this.current = f;
    sc.requestRender();
    return f;
  }

  renderedLevel(): number | undefined {
    if (!this.firstWaterVertex) return undefined;
    const h = Cartographic.fromCartesian(this.firstWaterVertex).height;
    return (h - LIFT) / this.exaggeration + this.zBase - WATER_OFFSET;
  }

  waterPrimitiveCount() { return (this.current.baselineAreaM2 > 0 ? 1 : 0) + (this.current.newAreaM2 > 0 ? 1 : 0); }

  view(duration = 1.6, retries = 5) {
    if (this.viewer.isDestroyed() || this.destroyed) return;
    const { t } = this, v = this.opts.view ?? { col: 0.42, row: 0.55, heading: 20, pitch: -38, range: 52_000, radius: 16_000 };
    const centre = Cartesian3.fromDegrees(t.lon(t.w * v.col), t.lat(t.h * v.row), this.height(this.meta.dem_water.level_m));
    this.viewer.camera.flyToBoundingSphere(new BoundingSphere(centre, v.radius), {
      offset: new HeadingPitchRange(CMath.toRadians(v.heading), CMath.toRadians(v.pitch), v.range), duration,
      cancel: () => { if (retries > 0) setTimeout(() => this.view(duration, retries - 1), 400); },
    });
  }
  private destroyed = false;

  destroy() {
    this.destroyed = true;
    this.unGround();
    if (this.viewer.isDestroyed()) return;
    const sc = this.viewer.scene;
    if (this.terrainPrim) sc.primitives.remove(this.terrainPrim);
    if (this.outlinePrim) sc.primitives.remove(this.outlinePrim);
    for (const p of this.waterPrims) sc.primitives.remove(p);
    if (this.labels) sc.primitives.remove(this.labels);
    if (this.points) sc.primitives.remove(this.points);
    this.points = undefined;
    this.terrainPrim = undefined; this.outlinePrim = undefined; this.waterPrims = []; this.labels = undefined;
    sc.requestRender();
  }
}
