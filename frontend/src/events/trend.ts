import { useStore } from "../store";
import type { Ev } from "./model";

export function investigateTrend(ev: Ev, at: { lat: number; lon: number }) {
  const g = useStore.getState();
  g.setMode("explore");
  g.flyTo({ lat: at.lat, lon: at.lon, label: ev.title }, 600_000);
  g.setAnalyze(true);
  g.setEventReturn({ id: ev.id, title: ev.title });
}
