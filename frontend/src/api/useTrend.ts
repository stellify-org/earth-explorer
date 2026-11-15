import { useEffect, useState } from "react";
import { api, ApiError } from "./client";
import type { TrendResponse } from "./types";

export interface TrendState { data?: TrendResponse; loading: boolean; error?: string }
const round = (x: number) => Math.round(x * 1e4) / 1e4;

export function useTrend(place: { lat: number; lon: number } | undefined, variable: string, start: number, end: number, enabled = true): TrendState {
  const [state, setState] = useState<TrendState>({ loading: false });
  const lat = place?.lat, lon = place?.lon;
  useEffect(() => {
    if (!enabled || lat === undefined || lon === undefined) return;
    if (!(end >= start) || start < 1900) return;
    const ctl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: undefined }));
    const timer = setTimeout(() => {
      api.trends({ variable, lat: round(lat), lon: round(lon), start, end }, ctl.signal)
        .then((data) => setState({ data, loading: false }))
        .catch((e: Error) => {
          if (e.name === "AbortError") return;
          setState({ loading: false, error: e instanceof ApiError ? e.message : String(e) });
        });
    }, 300);
    return () => { clearTimeout(timer); ctl.abort(); };
  }, [enabled, lat, lon, variable, start, end]);
  return state;
}
