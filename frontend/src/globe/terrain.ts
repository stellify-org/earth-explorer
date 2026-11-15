import {
  Credit, CustomHeightmapTerrainProvider, GeographicTilingScheme, WebMercatorTilingScheme, type ImageryProvider,
} from "@cesium/engine";
import {
  Event, Math as CMath, type Rectangle,
} from "@cesium/core";

export const TERRAIN_ATTRIBUTION =
  "Terrain Tiles (Mapzen/Tilezen, AWS Open Data): SRTM, GMTED2010 and 3DEP courtesy of the U.S. Geological Survey; ETOPO1 courtesy of NOAA; plus national DEMs (see attribution list).";

const SIZE = 65;
const MAX_Z = 14;

type Reply = { id: number; heights?: Float32Array; missing?: boolean; rgba?: Uint8ClampedArray | null; error?: string };
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (r: Reply) => void>();

function call(msg: Record<string, unknown>): Promise<Reply> {
  if (!worker) {
    worker = new Worker(new URL("./dem.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (ev: MessageEvent<Reply>) => {
      const cb = pending.get(ev.data.id);
      pending.delete(ev.data.id);
      cb?.(ev.data);
    };
  }
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker!.postMessage({ ...msg, id });
  });
}

const deg = (r: Rectangle) => ({ w: CMath.toDegrees(r.west), s: CMath.toDegrees(r.south), e: CMath.toDegrees(r.east), n: CMath.toDegrees(r.north) });

export function createTerrainProvider(onError?: (msg: string) => void): CustomHeightmapTerrainProvider {
  const tiling = new GeographicTilingScheme();
  return new CustomHeightmapTerrainProvider({
    width: SIZE,
    height: SIZE,
    tilingScheme: tiling,
    credit: new Credit("Terrain: Mapzen/Tilezen Terrain Tiles (USGS, NOAA and national DEMs)", false),
    callback: async (x: number, y: number, level: number) => {

      const r = await call({ op: "heights", z: Math.min(MAX_Z, level), ...deg(tiling.tileXYToRectangle(x, y, level)), size: SIZE });
      if (r.missing) onError?.("Terrain tiles unavailable (offline or blocked); showing a flat surface for this area.");
      return r.heights ?? new Float32Array(SIZE * SIZE);
    },
  });
}

export class HillshadeImageryProvider {
  readonly tilingScheme = new WebMercatorTilingScheme();
  readonly rectangle = this.tilingScheme.rectangle;
  readonly tileWidth = 256;
  readonly tileHeight = 256;
  readonly minimumLevel = 0;
  readonly maximumLevel = 13;
  readonly tileDiscardPolicy = undefined;
  readonly errorEvent = new Event();
  readonly credit = new Credit("Relief shading from Terrain Tiles (USGS SRTM/GMTED2010/3DEP, NOAA ETOPO1)", false);
  readonly proxy = undefined;
  readonly hasAlphaChannel = true;

  getTileCredits(): Credit[] { return []; }
  pickFeatures(): undefined { return undefined; }

  async requestImage(x: number, y: number, level: number): Promise<HTMLCanvasElement> {
    const r = await call({ op: "shade", z: level, x, y });
    const c = document.createElement("canvas");
    if (!r.rgba) { c.width = c.height = 1; return c; }
    c.width = c.height = 256;
    c.getContext("2d")!.putImageData(new ImageData(r.rgba as Uint8ClampedArray<ArrayBuffer>, 256, 256), 0, 0);
    return c;
  }
}

export const hillshadeProvider = () => new HillshadeImageryProvider() as unknown as ImageryProvider;
