const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api/v1";
export function apiURL(path: string, params?: Record<string, string | number | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== "") qs.set(k, String(v));
  return `${BASE}${path}${qs.size ? `?${qs}` : ""}`;
}
export interface QuakeQuery { minlat: number; maxlat: number; minlon: number; maxlon: number; start: string; end: string; minmag: number; limit: number }
export function quakeParams(p: QuakeQuery) { const { minlat, maxlat, minlon, maxlon, start, end, minmag, limit } = p; return { minlat, maxlat, minlon, maxlon, start, end, minmag, limit }; }
