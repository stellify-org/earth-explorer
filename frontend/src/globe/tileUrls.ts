import type { Layer } from "../api/types";

export const TERRAIN_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

export const fillTile = (tpl: string, z: number, x: number, y: number) =>
  tpl.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));

export function gibsTemplate(layer: Layer, date?: string): string {
  let url = layer.url_template
    .replace("{TileMatrixSet}", layer.tile_matrix_set)
    .replace("{TileMatrix}", "{z}")
    .replace("{TileRow}", "{y}")
    .replace("{TileCol}", "{x}");
  if (layer.time_enabled) {
    url = url.replace("{Time}", date ?? layer.default_date ?? "default");
  } else if (!url.includes("/default/default/")) {

    url = url.replace(`/default/${layer.tile_matrix_set}/`, `/default/default/${layer.tile_matrix_set}/`);
  }
  return url;
}

export function tileRange(b: [number, number, number, number], z: number) {
  const n = 2 ** z;
  const clamp = (v: number) => Math.min(n - 1, Math.max(0, Math.floor(v)));
  const tx = (lon: number) => clamp(((lon + 180) / 360) * n);
  const ty = (lat: number) => clamp(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
  return { x0: tx(b[0]), x1: tx(b[2]), y0: ty(b[3]), y1: ty(b[1]) };
}

export function tileUrls(tpl: string, b: [number, number, number, number], maxZ: number): { url: string; z: number }[] {
  const out: { url: string; z: number }[] = [];
  for (let z = 0; z <= maxZ; z++) {
    const r = tileRange(b, z);
    for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) out.push({ url: fillTile(tpl, z, x, y), z });
  }
  return out;
}
