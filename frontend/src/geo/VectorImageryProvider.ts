import {
  Credit, GeographicTilingScheme, type ImageryProvider,
} from "@cesium/engine";
import {
  Event, type Rectangle,
} from "@cesium/core";
import { Math as CMath } from "@cesium/core";
import type { Feature, GeoSet, GeoStore, LayerName } from "./store";

export type VectorStyle = "base" | "coast" | "borders" | "rivers" | "nodata";

const TILE = 256;

export const PALETTE = {
  ocean: "#0c2a47",
  land: "#2b3f35",
  ice: "#8ea3b3",
  shelves: "#5f7d92",
  lake: "#103253",
  coast: "rgba(146, 196, 214, 0.75)",
  border: "rgba(232, 236, 242, 0.62)",
  river: "rgba(84, 160, 214, 0.85)",
  hatch: "rgba(203, 213, 225, 0.30)",
};

function lodFor(level: number): 0 | 1 | 2 {
  if (level <= 2) return 0;
  if (level <= 5) return 1;
  return 2;
}

type Canvas2D = CanvasRenderingContext2D;

function makeCanvas(): { canvas: HTMLCanvasElement; ctx: Canvas2D } {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = TILE;
  return { canvas, ctx: canvas.getContext("2d")! };
}

export class VectorImageryProvider {
  readonly tilingScheme = new GeographicTilingScheme();
  readonly rectangle: Rectangle = this.tilingScheme.rectangle;
  readonly tileWidth = TILE;
  readonly tileHeight = TILE;
  readonly minimumLevel = 0;
  readonly maximumLevel: number;
  readonly tileDiscardPolicy = undefined;
  readonly errorEvent = new Event();
  readonly credit: Credit | undefined;
  readonly proxy = undefined;
  readonly hasAlphaChannel: boolean;

  constructor(private store: GeoStore, private style: VectorStyle, maximumLevel = 13) {
    this.maximumLevel = maximumLevel;
    this.hasAlphaChannel = style !== "base";
    this.credit = style === "base" ? new Credit("Geography: Natural Earth (public domain)", false) : undefined;
  }

  getTileCredits(): Credit[] { return []; }
  pickFeatures(): undefined { return undefined; }

  async requestImage(x: number, y: number, level: number): Promise<HTMLCanvasElement> {
    const r = this.tilingScheme.tileXYToRectangle(x, y, level);
    const w = CMath.toDegrees(r.west), s = CMath.toDegrees(r.south), e = CMath.toDegrees(r.east), n = CMath.toDegrees(r.north);
    const sets = this.style === "nodata" ? [] : await this.dataFor(level, w, s, e, n);
    const { canvas, ctx } = makeCanvas();
    const sx = TILE / (e - w), sy = TILE / (n - s);
    const T = { w, n, sx, sy, level, rect: [w, s, e, n] as const };

    switch (this.style) {
      case "base":
        ctx.fillStyle = PALETTE.ocean;
        ctx.fillRect(0, 0, TILE, TILE);
        for (const set of sets) fillLayer(ctx, set, "land", PALETTE.land, T);
        for (const set of sets) fillLayer(ctx, set, "shelves", PALETTE.shelves, T);
        for (const set of sets) fillLayer(ctx, set, "ice", PALETTE.ice, T);
        for (const set of sets) fillLayer(ctx, set, "lakes", PALETTE.lake, T, (f) => (f.rank ?? 0) <= level + 3);
        break;
      case "coast":
        ctx.lineJoin = "round";
        for (const set of sets) strokeLayer(ctx, set, "coast", PALETTE.coast, level >= 6 ? 1.1 : 0.8, T);
        for (const set of sets) strokeLayer(ctx, set, "lakes", PALETTE.coast, 0.6, T, (f) => (f.rank ?? 0) <= level + 3, true);
        break;
      case "borders":
        ctx.lineJoin = "round";
        for (const set of sets) strokeLayer(ctx, set, "borders", PALETTE.border, level >= 6 ? 1.3 : 0.9, T, (f) => !f.disputed);
        ctx.setLineDash([4, 3]);
        for (const set of sets) strokeLayer(ctx, set, "borders", PALETTE.border, level >= 6 ? 1.2 : 0.8, T, (f) => !!f.disputed);
        break;
      case "rivers":
        ctx.lineJoin = "round";

        for (const set of sets) strokeLayer(ctx, set, "rivers", PALETTE.river, level >= 7 ? 1.0 : 0.7, T, (f) => (f.rank ?? 0) <= level + 1);
        break;
      case "nodata": {

        ctx.strokeStyle = PALETTE.hatch;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let k = -TILE; k <= TILE; k += 16) { ctx.moveTo(k, 0); ctx.lineTo(k + TILE, TILE); }
        ctx.stroke();
        break;
      }
    }
    return canvas;
  }

  private async dataFor(level: number, w: number, s: number, e: number, n: number): Promise<GeoSet[]> {
    await this.store.ready;
    const lod = lodFor(level);
    if (lod === 0) return [this.store.lod0!];
    if (lod === 1) return [await this.store.loadLod1().catch(() => this.store.lod0!)];
    const ids = this.store.chunksFor(w, s, e, n);
    if (ids.length === 0) return [];
    const chunks = await Promise.all(ids.map((id) => this.store.loadChunk(id)));
    if (chunks.every(Boolean)) return chunks as GeoSet[];

    return [await this.store.loadLod1().catch(() => this.store.lod0!)];
  }
}

interface TileT { w: number; n: number; sx: number; sy: number; level: number; rect: readonly [number, number, number, number] }

function intersects(b: Feature["bbox"], r: TileT["rect"], marginDeg: number) {
  return !(b[2] < r[0] - marginDeg || b[0] > r[2] + marginDeg || b[3] < r[1] - marginDeg || b[1] > r[3] + marginDeg);
}

function tracePath(ctx: Canvas2D, p: Float32Array, T: TileT, close: boolean) {
  let lx = NaN, ly = NaN;
  for (let i = 0; i < p.length; i += 2) {
    const px = (p[i] - T.w) * T.sx, py = (T.n - p[i + 1]) * T.sy;
    if (i === 0) { ctx.moveTo(px, py); lx = px; ly = py; continue; }

    if (Math.abs(px - lx) < 0.5 && Math.abs(py - ly) < 0.5 && i < p.length - 2) continue;
    ctx.lineTo(px, py); lx = px; ly = py;
  }
  if (close) ctx.closePath();
}

function fillLayer(ctx: Canvas2D, set: GeoSet, name: LayerName, color: string, T: TileT, keep?: (f: Feature) => boolean) {
  const layer = set[name];
  if (!layer) return;
  ctx.fillStyle = color;
  for (const f of layer.features) {
    if (!intersects(f.bbox, T.rect, 0) || (keep && !keep(f))) continue;
    ctx.beginPath();
    for (const rings of f.parts) for (const ring of rings) tracePath(ctx, ring, T, true);
    ctx.fill("evenodd");
  }
}

function strokeLayer(ctx: Canvas2D, set: GeoSet, name: LayerName, color: string, width: number, T: TileT, keep?: (f: Feature) => boolean, polygonOutline = false) {
  const layer = set[name];
  if (!layer) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  const margin = 2 / T.sx;
  ctx.beginPath();
  for (const f of layer.features) {
    if (!intersects(f.bbox, T.rect, margin) || (keep && !keep(f))) continue;
    for (const rings of f.parts) for (const ring of rings) tracePath(ctx, ring, T, polygonOutline);
  }
  ctx.stroke();
}

export function asProvider(p: VectorImageryProvider): ImageryProvider {
  return p as unknown as ImageryProvider;
}
