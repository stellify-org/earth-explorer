import { useEffect } from "react";
import { useStore } from "../store";
import { netStats } from "../vis/frame";

interface NetInfo { effectiveType?: string; downlink?: number; saveData?: boolean; addEventListener?: (t: string, f: () => void) => void }

export function measuredMbps(): number | undefined {
  const samples: { bytes: number; ms: number }[] = [];
  for (const e of performance.getEntriesByType("resource") as PerformanceResourceTiming[]) {
    const dur = e.responseEnd - e.responseStart;
    if (e.transferSize > 50_000 && dur > 50) samples.push({ bytes: e.transferSize, ms: dur });
  }
  for (const s of netStats) if (s.bytes > 5_000 && s.ms > 50) samples.push(s);
  if (!samples.length) return undefined;
  const bytes = samples.reduce((a, s) => a + s.bytes, 0), ms = samples.reduce((a, s) => a + s.ms, 0);
  return (bytes * 8) / 1e6 / (ms / 1000);
}

export function useBandwidthDetection() {
  const setDetected = useStore((s) => s.setLowBandwidthDetected);
  useEffect(() => {
    const check = () => {
      const c = (navigator as unknown as { connection?: NetInfo }).connection;
      const api = c ? !!c.saveData || ["slow-2g", "2g", "3g"].includes(c.effectiveType ?? "") || (c.downlink !== undefined && c.downlink > 0 && c.downlink < 1.5) : false;
      const m = measuredMbps();
      setDetected(api || (m !== undefined && m < 1.5));
    };
    const t = setTimeout(check, 3000);
    const id = setInterval(check, 30_000);
    (navigator as unknown as { connection?: NetInfo }).connection?.addEventListener?.("change", check);
    return () => { clearTimeout(t); clearInterval(id); };
  }, [setDetected]);
}
