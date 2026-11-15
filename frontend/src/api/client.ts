import type { Availability, CompareResponse, DatasetsResponse, GridResponse, Layer, QuakeResponse, TrendResponse, VisCatalog } from "./types";
import { apiURL, quakeParams, type QuakeQuery } from "./url";
import type { EonetDetail, EonetList } from "../events/model";
import { readSnapshot } from "../offline/snapshots";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public field?: string) {
    super(message);
  }
}

async function get<T>(path: string, params?: Record<string, string | number | undefined>, signal?: AbortSignal): Promise<T> {
  const url = apiURL(path, params);
  const saved = path === "/trends" || path === "/earthquakes" ? await readSnapshot(url) : undefined;
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  if (saved && !navigator.onLine) return await saved.json() as T;
  let resp: Response;
  try {
    resp = await fetch(url, { signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    if (saved) return await saved.json() as T;
    throw new ApiError(0, "network_error", "Cannot reach the Earth Explorer API. Is the backend running?");
  }
  if (resp.status >= 500 && saved) return await saved.json() as T;
  const text = await resp.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiError(resp.status, "bad_response", `Unexpected response (${resp.status})`);
  }
  if (!resp.ok) {
    const e = (body as { error?: { code: string; message: string; field?: string } }).error;
    throw new ApiError(resp.status, e?.code ?? "error", e?.message ?? `HTTP ${resp.status}`, e?.field);
  }
  return body as T;
}

export const api = {
  datasets: (s?: AbortSignal) => get<DatasetsResponse>("/datasets", undefined, s),
  layers: (s?: AbortSignal) => get<{ layers: Layer[]; source: string }>("/layers", undefined, s),
  availability: (id: string, date: string, verify = false, s?: AbortSignal) =>
    get<{ layer: string; time_enabled: boolean; availability?: Availability; intervals_maybe_truncated?: boolean }>(
      `/layers/${encodeURIComponent(id)}/availability`, { date, verify: verify ? 1 : undefined }, s),
  trends: (p: { variable: string; lat: number; lon: number; start: number; end: number; alpha?: number }, s?: AbortSignal) =>
    get<TrendResponse>("/trends", p, s),
  compare: (p: { variable: string; lat: number; lon: number; period_a: string; period_b: string }, s?: AbortSignal) =>
    get<CompareResponse>("/compare", p, s),
  visCatalog: (s?: AbortSignal) => get<VisCatalog>("/vis/catalog", undefined, s),
  grid: (p: { variable: string; lat: number; lon: number; year: number }, s?: AbortSignal) => get<GridResponse>("/grid", p, s),
  health: (s?: AbortSignal) => get<{ status: string; upstream?: Record<string, { reachable: boolean | null; last_ok?: string; last_error?: string }> }>("/health", undefined, s),
  events: (days: number, category?: string, s?: AbortSignal) => get<EonetList>("/events", { days, category }, s),
  event: (id: string, s?: AbortSignal) => get<EonetDetail>(`/events/${encodeURIComponent(id)}`, undefined, s),
  earthquakes: (p: QuakeQuery, s?: AbortSignal) => get<QuakeResponse>("/earthquakes", quakeParams(p), s),
};
