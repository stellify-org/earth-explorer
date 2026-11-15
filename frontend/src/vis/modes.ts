import {
  Material, MaterialAppearance, PerInstanceColorAppearance, PointPrimitiveCollection, Primitive, type PointPrimitive, type CesiumWidget,
} from "@cesium/engine";
import {
  Cartesian3, Color, ColorGeometryInstanceAttribute, GeometryInstance, Math as CMath, Rectangle, RectangleGeometry,
} from "@cesium/core";
import { sampleFrame, type Frame } from "./frame";

export const SHELL_HEIGHT_M = 60_000;

export const EXTRUDE_MAX_M = 400_000;

export const FLOW_SECONDS_PER_FRAME = 1800;

export const FLOW_TAIL = 10;
export const FLOW_MAX_STREAKS = 2000;
const FLOW_HEIGHT = 2000;
const FLOW_PX_PER_FRAME = 1.3;
const FLOW_REF_SPEED = 4;
const R_EARTH = 6_371_000;

export class PrimitiveModes {
  private shell?: Primitive;
  private extrude?: Primitive;
  private extrudeKey = "";
  private flowPts?: PointPrimitiveCollection;
  private flowRaf = 0;
  constructor(private v: CesiumWidget) {}

  setShell(material: Material | null) {
    const sc = this.v.scene;
    if (!material) { if (this.shell) { sc.primitives.remove(this.shell); this.shell = undefined; } sc.requestRender(); return; }
    if (!this.shell) {
      this.shell = new Primitive({
        geometryInstances: new GeometryInstance({
          geometry: new RectangleGeometry({
            rectangle: Rectangle.fromDegrees(-180, -90, 180, 90),
            height: SHELL_HEIGHT_M, granularity: CMath.toRadians(1),
            vertexFormat: MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat,
          }),
        }),
        appearance: new MaterialAppearance({ material, translucent: true, flat: true, faceForward: true, materialSupport: MaterialAppearance.MaterialSupport.TEXTURED }),
        asynchronous: false,
      });
      sc.primitives.add(this.shell);
    }
    sc.requestRender();
  }

  setExtrude(f: Frame | null, colorOf: (v: number) => Color, range: [number, number], anomaly: boolean, exaggeration: number) {
    const sc = this.v.scene;
    const key = f ? `${f.h.variable}|${f.h.time}|${f.h.kind}|${f.h.lod}|${f.h.lon_edges[0]}|${range.join(",")}|${anomaly}|${exaggeration}` : "";
    if (key === this.extrudeKey) return;
    this.extrudeKey = key;
    if (this.extrude) { sc.primitives.remove(this.extrude); this.extrude = undefined; }
    if (!f) { sc.requestRender(); return; }
    const h = f.h;
    const [lo, hi] = range;
    const maxAbs = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
    const instances: GeometryInstance[] = [];
    const shrink = 0.08;
    for (let i = 0; i < h.nlat; i++) {
      for (let j = 0; j < h.nlon; j++) {
        const v = f.values[i * h.nlon + j];
        if (!Number.isFinite(v)) continue;
        const t = anomaly ? Math.min(1, Math.abs(v) / maxAbs) : Math.min(1, Math.max(0, (v - lo) / (hi - lo || 1)));
        const height = Math.max(1000, t * EXTRUDE_MAX_M * exaggeration);
        let w = h.lon_edges[j], e = h.lon_edges[j + 1];
        const s = Math.max(-89.9, h.lat_edges[i]), n = Math.min(89.9, h.lat_edges[i + 1]);
        const cw = (e - w) * shrink, ch = (n - s) * shrink;
        w += cw; e -= cw;
        let ww = w, ee = e;
        while (ww >= 180) { ww -= 360; ee -= 360; }
        while (ww < -180) { ww += 360; ee += 360; }
        if (ee > 180) ee = 180;
        instances.push(new GeometryInstance({
          geometry: new RectangleGeometry({ rectangle: Rectangle.fromDegrees(ww, s + ch, ee, n - ch), height: 0, extrudedHeight: height, vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT }),
          attributes: { color: ColorGeometryInstanceAttribute.fromColor(colorOf(v)) },
        }));
      }
    }
    this.extrude = new Primitive({ geometryInstances: instances, appearance: new PerInstanceColorAppearance({ translucent: false, flat: false }), asynchronous: true });
    sc.primitives.add(this.extrude);
    sc.requestRender();
  }

  setFlow(u: Frame | null, vv: Frame | null, count: number, colorOf: (speed: number) => Color) {
    const sc = this.v.scene;
    cancelAnimationFrame(this.flowRaf);
    if (this.flowPts) { sc.primitives.remove(this.flowPts); this.flowPts = undefined; }
    if (!u || !vv) { sc.requestRender(); return; }

    const n = Math.max(200, Math.min(FLOW_MAX_STREAKS, Math.round(count / 2)));
    const pts = new PointPrimitiveCollection();
    const lon = new Float64Array(n), lat = new Float64Array(n), age = new Int32Array(n), life = new Int32Array(n);
    const P: PointPrimitive[] = [];

    let box = { w: -180, s: -85, e: 180, n: 85 };
    const look = () => {
      const r = this.v.camera.computeViewRectangle(sc.globe.ellipsoid);
      if (!r) { box = { w: -180, s: -85, e: 180, n: 85 }; return; }
      let w = CMath.toDegrees(r.west), e = CMath.toDegrees(r.east);
      if (e <= w) e += 360;
      if (e - w > 300) { w = -180; e = 180; }
      box = { w, s: Math.max(-85, CMath.toDegrees(r.south)), e, n: Math.min(85, CMath.toDegrees(r.north)) };
    };
    look();
    const areaOf = () => (box.e - box.w) * (Math.sin(CMath.toRadians(box.n)) - Math.sin(CMath.toRadians(box.s)));
    let area = areaOf();
    const spawn = (k: number) => {
      const a = Math.sin(CMath.toRadians(box.s)), b = Math.sin(CMath.toRadians(box.n));
      lat[k] = CMath.toDegrees(Math.asin(a + (b - a) * Math.random()));
      let x = box.w + (box.e - box.w) * Math.random();
      if (x > 180) x -= 360;
      lon[k] = x;
      age[k] = 0; life[k] = 50 + Math.floor(Math.random() * 90);
      const at = Cartesian3.fromDegrees(lon[k], lat[k], FLOW_HEIGHT);
      for (let j = 0; j < FLOW_TAIL; j++) P[k * FLOW_TAIL + j].position = at;
    };
    for (let k = 0; k < n; k++) {
      for (let j = 0; j < FLOW_TAIL; j++) {
        const f = 1 - j / FLOW_TAIL;
        P.push(pts.add({ position: Cartesian3.ZERO, pixelSize: 1.2 + 2.6 * f, color: Color.WHITE.withAlpha(0.95 * f * f) }));
      }
      spawn(k);
    }
    sc.primitives.add(pts);
    this.flowPts = pts;

    (window as unknown as { __ee?: Record<string, unknown> }).__ee = { ...((window as unknown as { __ee?: Record<string, unknown> }).__ee ?? {}), flow: { lon, lat, age, tail: FLOW_TAIL, box: () => box } };
    const inView = (k: number) => {
      if (lat[k] < box.s || lat[k] > box.n) return false;
      let x = lon[k]; if (x < box.w) x += 360;
      return x <= box.e;
    };
    let frame = 0;
    const tick = () => {
      if (this.v.isDestroyed() || this.flowPts !== pts) return;
      if (document.hidden) { this.flowRaf = requestAnimationFrame(tick); return; }
      if (frame++ % 6 === 0) {
        look();

        const now = areaOf();
        if (now > area * 1.25) for (let k = 0; k < n; k++) { spawn(k); age[k] = Math.floor(Math.random() * life[k] * 0.5); }
        area = now;
      }

      const cam = this.v.camera, fovy = (cam.frustum as { fovy?: number }).fovy ?? 1;
      const mpp = (cam.positionCartographic.height * 2 * Math.tan(fovy / 2)) / Math.max(1, sc.canvas.clientHeight);
      const dt = Math.min(6 * 3600, (FLOW_PX_PER_FRAME * mpp) / FLOW_REF_SPEED);
      const shift = frame % 2 === 0;
      for (let k = 0; k < n; k++) {
        const a = sampleFrame(u, lat[k], lon[k]), b = sampleFrame(vv, lat[k], lon[k]);
        const ue = a?.v, vn = b?.v;
        if (ue === undefined || vn === undefined || !Number.isFinite(ue) || !Number.isFinite(vn) || ++age[k] > life[k] || Math.abs(lat[k]) > 85 || !inView(k)) {
          spawn(k);
          continue;
        }

        lat[k] += CMath.toDegrees((vn * dt) / R_EARTH);
        lon[k] += CMath.toDegrees((ue * dt) / (R_EARTH * Math.cos(CMath.toRadians(lat[k]))));
        if (lon[k] > 180) lon[k] -= 360;
        if (lon[k] < -180) lon[k] += 360;
        const o = k * FLOW_TAIL;
        if (shift) for (let j = FLOW_TAIL - 1; j > 0; j--) P[o + j].position = P[o + j - 1].position;
        P[o].position = Cartesian3.fromDegrees(lon[k], lat[k], FLOW_HEIGHT);

        if ((frame + k) % 12 === 0) {

          const c = Color.lerp(colorOf(Math.hypot(ue, vn)), Color.WHITE, 0.4, new Color());
          for (let j = 0; j < FLOW_TAIL; j++) { const f = 1 - j / FLOW_TAIL; P[o + j].color = c.withAlpha(0.95 * f * f); }
        }
      }
      sc.requestRender();
      this.flowRaf = requestAnimationFrame(tick);
    };
    this.flowRaf = requestAnimationFrame(tick);
  }

  destroy() {

    if (this.v.isDestroyed()) { cancelAnimationFrame(this.flowRaf); return; }
    this.setShell(null);
    this.extrudeKey = "x";
    this.setExtrude(null, () => Color.WHITE, [0, 1], false, 1);
    this.setFlow(null, null, 0, () => Color.WHITE);
  }
}
