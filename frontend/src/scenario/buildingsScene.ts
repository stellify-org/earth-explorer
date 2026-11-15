import { PerInstanceColorAppearance, PointPrimitiveCollection, Primitive, ScreenSpaceEventHandler, ScreenSpaceEventType, type CesiumWidget } from "@cesium/engine";
import { BoundingSphere, Cartesian2, Cartesian3, Color, ComponentDatatype, Geometry, GeometryAttribute, GeometryInstance, HeadingPitchRange, IntersectionTests, Math as CMath, NearFarScalar, PolygonPipeline, PrimitiveType, type Ray } from "@cesium/core";
import type { Flood } from "./model";
import { INTERSECTS, NEAR, OUTSIDE, buildingCells, classify, drawnHeightM, drawnSurfaceZ, type Building, type BuildingCells, type Classification } from "./buildings";
import { STEP, WATER_OFFSET, type ScenarioScene } from "./scene";

export const TILE_CELLS = 64;

export const SHOW_WITHIN_M = 14_000;

const RELEASE_BEYOND_M = 20_000;

export const COLOURS = { outside: [176, 178, 186], near: [250, 204, 21], intersects: [239, 68, 68], selected: [192, 132, 252] } as const;
const colourOf = (cls: number) => (cls === INTERSECTS ? COLOURS.intersects : cls === NEAR ? COLOURS.near : COLOURS.outside);

interface Batch {
  positions: Float64Array; indices: Uint32Array;

  shade: Float32Array;
  ids: Int32Array;
  vStart: Uint32Array;
  iStart: Uint32Array;
}
interface Tile { key: number; members: Int32Array; centre: Cartesian3; batch?: Batch; primitive?: Primitive; drawnCls?: Uint8Array; drawnSelected: number }

function makePrimitive(b: Batch, colour: (entry: number) => readonly [number, number, number]): Primitive {
  const col = new Uint8Array((b.positions.length / 3) * 4);
  for (let k = 0; k < b.ids.length; k++) {
    const [r, g, bl] = colour(k);
    for (let v = b.vStart[k]; v < b.vStart[k + 1]; v++) { const s = b.shade[v]; col[v * 4] = r * s; col[v * 4 + 1] = g * s; col[v * 4 + 2] = bl * s; col[v * 4 + 3] = 255; }
  }
  const positions = b.positions.slice();
  return new Primitive({
    geometryInstances: new GeometryInstance({
      geometry: new Geometry({
        attributes: {
          position: new GeometryAttribute({ componentDatatype: ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: positions }),
          color: new GeometryAttribute({ componentDatatype: ComponentDatatype.UNSIGNED_BYTE, componentsPerAttribute: 4, normalize: true, values: col }),
        } as never,
        indices: b.indices.slice(), primitiveType: PrimitiveType.TRIANGLES,
        boundingSphere: BoundingSphere.fromVertices(positions as unknown as number[]),
      }),
    }),
    appearance: new PerInstanceColorAppearance({ flat: true, translucent: false, closed: false }),
    asynchronous: false,
  });
}

export interface Picked { building: Building; cls: number; distanceM: number; depthM: number; groundM: number; areaM2: number; drawnHeightM: number }

export class BuildingsLayer {
  readonly cells: BuildingCells;
  readonly tiles: Tile[] = [];

  current: Classification;
  selected = -1;
  onPick?: (index: number) => void;
  private marks?: { batch: Batch; primitive: Primitive };
  private points?: PointPrimitiveCollection;
  private handler?: ScreenSpaceEventHandler;
  private unCamera: (() => void)[] = [];
  private destroyed = false;

  constructor(private viewer: CesiumWidget, private scene: ScenarioScene, readonly buildings: Building[], flood: Flood) {
    const { t } = scene;
    this.cells = buildingCells(t, buildings);
    this.current = classify(t, this.cells, flood);

    const perRow = Math.ceil(t.w / TILE_CELLS), groups = new Map<number, number[]>();
    for (const b of buildings) {
      const i = Math.min(t.h - 1, Math.max(0, t.row(b.lat))), j = Math.min(t.w - 1, Math.max(0, t.col(b.lon)));
      const key = Math.floor(i / TILE_CELLS) * perRow + Math.floor(j / TILE_CELLS);
      let g = groups.get(key); if (!g) groups.set(key, (g = [])); g.push(b.index);
    }
    for (const [key, list] of groups) {
      const ti = Math.floor(key / perRow), tj = key % perRow;
      const ci = Math.min(t.h, (ti + 0.5) * TILE_CELLS), cj = Math.min(t.w, (tj + 0.5) * TILE_CELLS);
      const lon = t.lon(cj), lat = t.lat(ci);
      this.tiles.push({ key, members: Int32Array.from(list), drawnSelected: -1, centre: Cartesian3.fromDegrees(lon, lat, scene.height(drawnSurfaceZ(t, STEP, lon, lat))) });
    }
  }

  start() {
    if (this.handler) return;
    this.destroyed = false;
    const cam = this.viewer.camera, upd = () => this.updateVisible();
    this.unCamera.push(cam.changed.addEventListener(upd), cam.moveEnd.addEventListener(upd));
    this.handler = new ScreenSpaceEventHandler(this.viewer.scene.canvas);
    this.handler.setInputAction((m: { position: Cartesian2 }) => { const hit = this.pickAt(m.position); if (hit >= 0) this.onPick?.(hit); }, ScreenSpaceEventType.LEFT_CLICK);
    this.updateVisible(); this.rebuildMarks();
  }

  private ground(lon: number, lat: number) { return this.scene.height(drawnSurfaceZ(this.scene.t, STEP, lon, lat)); }

  baseHeight(b: Building) { return this.ground(b.lon, b.lat); }

  private prepare(members: ArrayLike<number>, flatAt?: number): Batch {
    const pos: number[] = [], idx: number[] = [], shade: number[] = [], vStart = [0], iStart = [0];
    const push = (lon: number, lat: number, h: number, s: number) => { const p = Cartesian3.fromDegrees(lon, lat, h); pos.push(p.x, p.y, p.z); shade.push(s); return pos.length / 3 - 1; };
    for (let m = 0; m < members.length; m++) {
      const b = this.buildings[members[m]];
      const kx = 111_320 * Math.cos((b.lat * Math.PI) / 180), ky = 111_320;
      const flat: Cartesian2[] = [], holes: number[] = [], ll: [number, number][] = [];
      b.rings.forEach((ring, r) => { if (r > 0) holes.push(flat.length); for (const [lon, lat] of ring) { flat.push(new Cartesian2((lon - b.lon) * kx, (lat - b.lat) * ky)); ll.push([lon, lat]); } });
      let low = Infinity;
      if (flatAt === undefined) for (const [lon, lat] of b.rings[0]) low = Math.min(low, this.ground(lon, lat));
      const top = flatAt ?? this.baseHeight(b) + drawnHeightM(b) * this.scene.exaggeration, bottom = low - 1;

      const base = pos.length / 3;
      for (const [lon, lat] of ll) push(lon, lat, top, 1);
      let tri: number[] = [];
      try { tri = PolygonPipeline.triangulate(flat, holes.length ? holes : undefined); } catch {  }
      for (const k of tri) idx.push(base + k);

      if (flatAt === undefined) for (const ring of b.rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [x0, y0] = ring[j], [x1, y1] = ring[i];
        const ex = (x1 - x0) * kx, ey = (y1 - y0) * ky, len = Math.hypot(ex, ey) || 1;
        const s = 0.62 + 0.26 * Math.abs((ey / len) * -0.7071 + (-ex / len) * 0.7071);
        const a = push(x0, y0, top, s), c = push(x1, y1, top, s), d = push(x1, y1, bottom, s * 0.9), e = push(x0, y0, bottom, s * 0.9);
        idx.push(a, c, d, a, d, e);
      }
      vStart.push(pos.length / 3); iStart.push(idx.length);
    }
    return { positions: Float64Array.from(pos), indices: Uint32Array.from(idx), shade: Float32Array.from(shade), ids: Int32Array.from(members as number[]), vStart: Uint32Array.from(vStart), iStart: Uint32Array.from(iStart) };
  }

  private drawTile(tile: Tile) {
    const sc = this.viewer.scene;
    if (tile.primitive) sc.primitives.remove(tile.primitive);
    tile.batch ??= this.prepare(tile.members);
    const cls = this.current.cls, batch = tile.batch;
    tile.primitive = sc.primitives.add(makePrimitive(batch, (k) => (batch.ids[k] === this.selected ? COLOURS.selected : colourOf(cls[batch.ids[k]])))) as Primitive;
    tile.drawnCls = Uint8Array.from(tile.members, (b) => cls[b]);
    tile.drawnSelected = this.selected;
  }
  private stale(tile: Tile) {
    if (!tile.primitive || !tile.drawnCls) return true;
    const hasSel = (s: number) => s >= 0 && tile.members.includes(s);
    if (tile.drawnSelected !== this.selected && (hasSel(tile.drawnSelected) || hasSel(this.selected))) return true;
    for (let k = 0; k < tile.members.length; k++) if (tile.drawnCls[k] !== this.current.cls[tile.members[k]]) return true;
    return false;
  }

  updateVisible() {
    if (!this.handler || this.destroyed || this.viewer.isDestroyed()) return;
    const cam = this.viewer.camera.positionWC, sc = this.viewer.scene;
    let changed = false;
    for (const tile of this.tiles) {
      const d = Cartesian3.distance(cam, tile.centre);
      if (d <= SHOW_WITHIN_M) {
        if (this.stale(tile)) { this.drawTile(tile); changed = true; }
        else if (!tile.primitive!.show) { tile.primitive!.show = true; changed = true; }
      } else if (tile.primitive) {
        if (d > RELEASE_BEYOND_M) { sc.primitives.remove(tile.primitive); tile.primitive = undefined; tile.drawnCls = undefined; changed = true; }
        else if (tile.primitive.show) { tile.primitive.show = false; changed = true; }
      }
    }
    if (changed) sc.requestRender();
  }

  private rebuildMarks() {
    if (!this.handler || this.destroyed || this.viewer.isDestroyed()) return;
    const sc = this.viewer.scene, c = this.current;
    if (this.marks) sc.primitives.remove(this.marks.primitive);
    if (this.points) sc.primitives.remove(this.points);
    this.marks = undefined; this.points = undefined;
    const red: number[] = [], pts = new PointPrimitiveCollection();
    const waterTop = this.scene.height(c.level + WATER_OFFSET + 1.5);
    for (let b = 0; b < c.cls.length; b++) {
      if (c.cls[b] === OUTSIDE) continue;
      const bd = this.buildings[b], roof = this.baseHeight(bd) + drawnHeightM(bd) * this.scene.exaggeration;
      if (c.cls[b] === INTERSECTS) red.push(b);
      const [r, g, bl] = colourOf(c.cls[b]);
      pts.add({ id: b, position: Cartesian3.fromDegrees(bd.lon, bd.lat, Math.max(roof, c.cls[b] === INTERSECTS ? waterTop : 0) + 4), color: Color.fromBytes(r, g, bl, 255), outlineColor: Color.BLACK, outlineWidth: 1.5,
        pixelSize: 9, scaleByDistance: new NearFarScalar(1_500, 0.45, 25_000, 1), disableDepthTestDistance: Number.POSITIVE_INFINITY });
    }
    if (pts.length) this.points = sc.primitives.add(pts) as PointPrimitiveCollection;
    if (red.length) {
      const batch = this.prepare(red, waterTop);
      this.marks = { batch, primitive: sc.primitives.add(makePrimitive(batch, (k) => (batch.ids[k] === this.selected ? COLOURS.selected : COLOURS.intersects))) as Primitive };
    }
    sc.requestRender();
  }

  setFlood(f: Flood): Classification {
    this.current = classify(this.scene.t, this.cells, f);
    this.rebuildMarks(); this.updateVisible();
    return this.current;
  }
  select(index: number) { if (index === this.selected) return; this.selected = index; this.rebuildMarks(); this.updateVisible(); }

  private hitBatch(ray: Ray, b: Batch): { index: number; t: number } | undefined {
    const p = b.positions, v = (k: number, out: Cartesian3) => Cartesian3.fromElements(p[k * 3], p[k * 3 + 1], p[k * 3 + 2], out);
    const p0 = new Cartesian3(), p1 = new Cartesian3(), p2 = new Cartesian3();
    let best: { index: number; t: number } | undefined;
    for (let k = 0; k < b.ids.length; k++) for (let i = b.iStart[k]; i < b.iStart[k + 1]; i += 3) {
      const t = IntersectionTests.rayTriangleParametric(ray, v(b.indices[i], p0), v(b.indices[i + 1], p1), v(b.indices[i + 2], p2), false);
      if (t !== undefined && t > 0 && (!best || t < best.t)) best = { index: b.ids[k], t };
    }
    return best;
  }

  pickAt(pos: Cartesian2): number {
    const sc = this.viewer.scene, picked = sc.pick(pos) as { primitive?: unknown; id?: unknown } | undefined;
    if (!picked) return -1;
    if (this.points && picked.primitive && (picked as { collection?: unknown }).collection === this.points && typeof picked.id === "number") return picked.id;
    if (typeof picked.id === "number" && this.points?.contains(picked.primitive as never)) return picked.id;
    const ray = this.viewer.camera.getPickRay(pos);
    if (!ray) return -1;
    if (this.marks && picked.primitive === this.marks.primitive) return this.hitBatch(ray, this.marks.batch)?.index ?? -1;
    const tile = this.tiles.find((x) => x.primitive === picked.primitive);
    return tile?.batch ? this.hitBatch(ray, tile.batch)?.index ?? -1 : -1;
  }

  describe(index: number): Picked {
    const b = this.buildings[index], c = this.current;
    const kx = 111_320 * Math.cos((b.lat * Math.PI) / 180), ky = 111_320;
    let area = 0;
    b.rings.forEach((ring, r) => { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - b.lon) * kx * (ring[i][1] - b.lat) * ky - (ring[i][0] - b.lon) * kx * (ring[j][1] - b.lat) * ky; area += (r === 0 ? 1 : -1) * Math.abs(a / 2); });
    return { building: b, cls: c.cls[index], distanceM: c.distanceM[index], depthM: c.depthM[index], groundM: this.cells.groundMin[index], areaM2: area, drawnHeightM: drawnHeightM(b) };
  }
  tilesShown() { return this.tiles.filter((x) => x.primitive?.show).length; }
  buildingsShown() { return this.tiles.reduce((s, x) => s + (x.primitive?.show ? x.members.length : 0), 0); }

  drawnCounts() { const n = [0, 0, 0]; for (const x of this.tiles) if (x.primitive?.show && x.drawnCls) for (const c of x.drawnCls) n[c]++; return n; }

  visibleTop(index: number) {
    const b = this.buildings[index], roof = this.baseHeight(b) + drawnHeightM(b) * this.scene.exaggeration;
    return this.current.cls[index] === INTERSECTS ? Math.max(roof, this.scene.height(this.current.level + WATER_OFFSET + 1.5)) : roof;
  }

  windowPosition(index: number) {
    const b = this.buildings[index];
    const p = this.viewer.scene.cartesianToCanvasCoordinates(Cartesian3.fromDegrees(b.lon, b.lat, this.visibleTop(index)));
    return p ? { x: p.x, y: p.y } : undefined;
  }

  flyTo(index: number, range = 1_200) {
    const b = this.buildings[index], centre = Cartesian3.fromDegrees(b.lon, b.lat, this.baseHeight(b));
    this.viewer.camera.flyToBoundingSphere(new BoundingSphere(centre, 60), { offset: new HeadingPitchRange(CMath.toRadians(15), CMath.toRadians(-52), range), duration: 1.6 });
  }

  densest(): number {
    const tile = this.tiles.reduce((a, x) => (x.members.length > a.members.length ? x : a));
    let best = tile.members[0], bd = Infinity;
    for (const m of tile.members) { const b = this.buildings[m], d = Cartesian3.distanceSquared(tile.centre, Cartesian3.fromDegrees(b.lon, b.lat, 0)); if (d < bd) { bd = d; best = m; } }
    return best;
  }

  destroy() {
    this.destroyed = true;
    this.unCamera.forEach((u) => u()); this.unCamera = [];
    if (this.handler && !this.handler.isDestroyed()) this.handler.destroy();
    this.handler = undefined;
    if (this.viewer.isDestroyed()) return;
    const sc = this.viewer.scene;
    for (const x of this.tiles) if (x.primitive) { sc.primitives.remove(x.primitive); x.primitive = undefined; x.drawnCls = undefined; }
    if (this.marks) sc.primitives.remove(this.marks.primitive);
    if (this.points) sc.primitives.remove(this.points);
    this.marks = undefined; this.points = undefined;
    sc.requestRender();
  }
}
