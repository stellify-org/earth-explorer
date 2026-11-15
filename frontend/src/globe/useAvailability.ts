import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Availability, Layer } from "../api/types";

export function useAvailability(layer: Layer | undefined, date: string, verify = false) {
  const [state, setState] = useState<{ a?: Availability; loading: boolean; error?: string }>({ loading: false });
  useEffect(() => {
    if (!layer || !layer.time_enabled) {
      setState({ loading: false });
      return;
    }
    const ctl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: undefined }));
    const t = setTimeout(() => {
      api.availability(layer.id, date, verify, ctl.signal)
        .then((r) => setState({ a: r.availability, loading: false }))
        .catch((e: Error) => { if (e.name !== "AbortError") setState({ loading: false, error: e.message }); });
    }, 180);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [layer?.id, layer?.time_enabled, date, verify]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}
