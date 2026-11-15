import { ClippingPlane, ClippingPlaneCollection, PerInstanceColorAppearance, PolylineCollection, Primitive, Material, type CesiumWidget } from "@cesium/engine";
import { BoundingSphere, Cartesian3, Color, ComponentDatatype, Geometry, GeometryAttribute, GeometryInstance, PrimitiveType } from "@cesium/core";
import { CRUST_LAYERS, MANTLE_COLOR, PLANET_LAYERS, drawnFraction, type CrustCell, type PathSample } from "./model";

class Mesh {
  pos: number[] = []; col: number[] = []; idx: number[] = [];
  vertex(p: Cartesian3, c: Color, shade = 1) {
    this.pos.push(p.x, p.y, p.z);
    this.col.push(Math.round(c.red * 255 * shade), Math.round(c.green * 255 * shade), Math.round(c.blue * 255 * shade), Math.round(c.alpha * 255));
    return this.pos.length / 3 - 1;
  }
  quad(a: number, b: number, c: number, d: number) { this.idx.push(a, b, c, a, c, d); }

  face(a: Cartesian3, b: Cartesian3, c: Cartesian3, d: Cartesian3, color: Color, shade = 1) {
    this.quad(this.vertex(a, color, shade), this.vertex(b, color, shade), this.vertex(c, color, shade), this.vertex(d, color, shade));
  }
  primitive(id: unknown, translucent: boolean): Primitive | undefined {
    if (!this.idx.length) return undefined;
    const positions = new Float64Array(this.pos);
    return new Primitive({
      geometryInstances: new GeometryInstance({
        id,
        geometry: new Geometry({
          attributes: {
            position: new GeometryAttribute({ componentDatatype: ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: positions }),
            color: new GeometryAttribute({ componentDatatype: ComponentDatatype.UNSIGNED_BYTE, componentsPerAttribute: 4, normalize: true, values: new Uint8Array(this.col) }),
          } as never,
          indices: new Uint32Array(this.idx), primitiveType: PrimitiveType.TRIANGLES,
          boundingSphere: BoundingSphere.fromVertices(Array.from(positions)),
        }),
      }),

      appearance: new PerInstanceColorAppearance({ flat: true, translucent, closed: false }),
      asynchronous: false,
    });
  }
}

const at = (lonDeg: number, latDeg: number, f: number) => Cartesian3.multiplyByScalar(Cartesian3.fromDegrees(lonDeg, latDeg, 0), f, new Cartesian3());

const CENTRE = 0.001;

export interface CutawayOptions {

  centerLon: number;

  angle: number;
  crustExaggeration: number;
  layers: Record<string, { show: boolean; alpha: number }>;
}

export class InteriorScene {
  private prims: Primitive[] = [];
  private lines?: PolylineCollection;
  private clipped = false;
  constructor(private viewer: CesiumWidget) {}

  private add(p: Primitive | undefined) { if (p) { this.viewer.scene.primitives.add(p); this.prims.push(p); } }

  clear() {
    const sc = this.viewer.scene;
    for (const p of this.prims) sc.primitives.remove(p);
    this.prims = [];
    if (this.lines) { sc.primitives.remove(this.lines); this.lines = undefined; }
    if (this.clipped) { sc.globe.clippingPlanes.enabled = false; this.clipped = false; }
    sc.requestRender();
  }

  cutaway(o: CutawayOptions) {
    this.clear();
    const sc = this.viewer.scene, angle = Math.min(300, Math.max(0, o.angle));
    const west = o.centerLon - angle / 2, east = o.centerLon + angle / 2;
    if (angle > 0) {

      const w = west * Math.PI / 180, e = east * Math.PI / 180;
      sc.globe.clippingPlanes = new ClippingPlaneCollection({
        planes: [new ClippingPlane(new Cartesian3(Math.sin(w), -Math.cos(w), 0), 0), new ClippingPlane(new Cartesian3(-Math.sin(e), Math.cos(e), 0), 0)],
        unionClippingRegions: angle > 180, edgeWidth: 0,
      });
      this.clipped = true;
    }
    const LAT = 3, LON = 5;
    for (const layer of PLANET_LAYERS) {
      const st = o.layers[layer.id] ?? { show: true, alpha: 1 };
      if (!st.show || st.alpha <= 0) continue;
      const fo = drawnFraction(layer.top, o.crustExaggeration), fi = layer.id === "inner_core" ? CENTRE : drawnFraction(layer.bottom, o.crustExaggeration);
      const color = Color.fromCssColorString(layer.color).withAlpha(st.alpha);
      const m = new Mesh();

      if (layer.id !== "crust") {
        const span = 360 - angle, nLon = Math.max(2, Math.ceil(span / LON)), nLat = 180 / LAT;
        const grid: number[][] = [];
        for (let i = 0; i <= nLat; i++) {
          const lat = -90 + i * LAT, row: number[] = [];
          for (let j = 0; j <= nLon; j++) row.push(m.vertex(at(east + (span * j) / nLon, lat, fo), color, 0.78 + 0.22 * Math.cos(lat * Math.PI / 180)));
          grid.push(row);
        }
        for (let i = 0; i < nLat; i++) for (let j = 0; j < nLon; j++) m.quad(grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]);
      }

      if (angle > 0) {
        for (const lon of [west, east]) {
          const nLat = 180 / LAT, rings = 2, grid: number[][] = [];
          for (let i = 0; i <= nLat; i++) {
            const row: number[] = [];
            for (let k = 0; k <= rings; k++) row.push(m.vertex(at(lon, -90 + i * LAT, fo + ((fi - fo) * k) / rings), color, 1 - 0.18 * (k / rings)));
            grid.push(row);
          }
          for (let i = 0; i < nLat; i++) for (let k = 0; k < rings; k++) m.quad(grid[i][k], grid[i][k + 1], grid[i + 1][k + 1], grid[i + 1][k]);
        }
      }
      this.add(m.primitive({ interiorLayer: layer.id }, st.alpha < 1));
    }
    sc.requestRender();
  }

  viewCutaway(centerLon: number, close = false) {
    this.viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(centerLon, close ? 8 : 22, close ? 4.5e6 : 1.75e7), duration: 1.5 });
  }

  column(cell: CrustCell, exaggeration: number, mantleKm = 10) {
    this.clear();
    const lift = 20_000, zBottom = cell.moho - mantleKm;
    const h = (zKm: number) => lift + (zKm - zBottom) * 1000 * exaggeration;
    const corners = [[cell.lon - 0.5, cell.lat - 0.5], [cell.lon + 0.5, cell.lat - 0.5], [cell.lon + 0.5, cell.lat + 0.5], [cell.lon - 0.5, cell.lat + 0.5]];
    const ring = (zKm: number) => corners.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat, h(zKm)));
    const block = (top: number, bottom: number, color: Color, id: unknown) => {
      const m = new Mesh(), t = ring(top), b = ring(bottom);
      for (let i = 0; i < 4; i++) m.face(t[i], t[(i + 1) % 4], b[(i + 1) % 4], b[i], color, [1, 0.86, 0.94, 0.8][i]);
      m.face(t[0], t[1], t[2], t[3], color); m.face(b[0], b[1], b[2], b[3], color, 0.7);
      this.add(m.primitive(id, false));
    };
    for (const l of cell.layers) block(l.top, l.bottom, Color.fromCssColorString(l.color), { crustLayer: l.index });
    block(cell.moho, zBottom, Color.fromCssColorString(MANTLE_COLOR), { crustLayer: 8 });

    const lines = new PolylineCollection(), mat = () => Material.fromType("Color", { color: Color.WHITE.withAlpha(0.7) });
    const ground = corners.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat, 0));
    lines.add({ positions: [...ground, ground[0]], width: 1.5, material: mat() });
    const base = ring(zBottom);
    for (let i = 0; i < 4; i++) lines.add({ positions: [ground[i], base[i]], width: 1, material: mat() });
    this.viewer.scene.primitives.add(lines); this.lines = lines;
    const top = h(cell.surface), centre = Cartesian3.fromDegrees(cell.lon, cell.lat, (lift + top) / 2);
    this.viewer.scene.requestRender();
    return { centre, radius: Math.max(90_000, (top - lift) * 0.75) };
  }

  section(samples: PathSample[], exaggeration: number, mantleKm = 10) {
    this.clear();
    if (samples.length < 2) return undefined;
    const zBottom = Math.min(...samples.map((s) => s.cell.moho)) - mantleKm, lift = 20_000;
    const h = (zKm: number) => lift + (zKm - zBottom) * 1000 * exaggeration;
    const meshes = [...CRUST_LAYERS.map((l) => ({ m: new Mesh(), c: Color.fromCssColorString(l.color) })), { m: new Mesh(), c: Color.fromCssColorString(MANTLE_COLOR) }];
    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i], b = samples[i + 1], cell = a.cell;
      const wall = (top: number, bottom: number, k: number) => meshes[k].m.face(
        Cartesian3.fromDegrees(a.lon, a.lat, h(top)), Cartesian3.fromDegrees(b.lon, b.lat, h(top)),
        Cartesian3.fromDegrees(b.lon, b.lat, h(bottom)), Cartesian3.fromDegrees(a.lon, a.lat, h(bottom)), meshes[k].c);
      for (const l of cell.layers) wall(l.top, l.bottom, l.index);
      wall(cell.moho, zBottom, 8);
    }
    meshes.forEach(({ m }, k) => this.add(m.primitive({ crustLayer: k }, false)));
    const lines = new PolylineCollection();
    lines.add({ positions: samples.map((s) => Cartesian3.fromDegrees(s.lon, s.lat, 0)), width: 3, material: Material.fromType("Color", { color: Color.fromCssColorString("#22d3ee") }) });
    for (const s of [samples[0], samples[samples.length - 1]]) lines.add({ positions: [Cartesian3.fromDegrees(s.lon, s.lat, 0), Cartesian3.fromDegrees(s.lon, s.lat, h(zBottom))], width: 1, material: Material.fromType("Color", { color: Color.WHITE.withAlpha(0.7) }) });
    this.viewer.scene.primitives.add(lines); this.lines = lines;
    this.viewer.scene.requestRender();
    const top = h(Math.max(...samples.map((s) => s.cell.surface)));
    return BoundingSphere.fromPoints([...samples.map((s) => Cartesian3.fromDegrees(s.lon, s.lat, 0)), ...samples.map((s) => Cartesian3.fromDegrees(s.lon, s.lat, top))]);
  }
}
