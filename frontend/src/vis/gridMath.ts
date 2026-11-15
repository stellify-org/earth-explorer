import type { Frame } from "./frame";

export function gridParams(f: Frame) {
  const h = f.h;
  const dlon = h.lon_edges[1] - h.lon_edges[0];
  const dlat = h.nlat > 2 ? h.lat_edges[2] - h.lat_edges[1] : h.lat_edges[1] - h.lat_edges[0];
  const latOrigin = h.nlat > 2 ? h.lat_edges[1] - dlat : h.lat_edges[0];
  const wraps = h.wraps_longitude ? 1 : 0;
  return { grid: [h.lon_edges[0], latOrigin, dlon, dlat] as const, dims: [h.nlon, h.nlat, wraps, wraps] as const };
}

export function shaderCell(g: readonly number[], d: readonly number[], lon: number, lat: number): [number, number] | null {
  let x = lon;
  if (d[2] < 0.5 && x < g[0]) x += 360;
  let j = Math.floor((x - g[0]) / g[2]);
  if (d[2] > 0.5) j = ((j % d[0]) + d[0]) % d[0];
  else if (j < 0 || j > d[0] - 1) return null;
  let i = Math.floor((lat - g[1]) / g[3]);
  if (d[3] > 0.5) i = Math.min(d[1] - 1, Math.max(0, i));
  else if (i < 0 || i > d[1] - 1) return null;
  return [i, j];
}
