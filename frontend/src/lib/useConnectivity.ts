import { useEffect, useState } from "react";
import { api } from "../api/client";

export type Connectivity = "online" | "degraded" | "offline";

export function useConnectivity(): { state: Connectivity; detail: string } {
  const [st, setSt] = useState<{ state: Connectivity; detail: string }>({ state: navigator.onLine ? "online" : "offline", detail: "" });
  useEffect(() => {
    let alive = true;
    const check = async () => {
      if (!navigator.onLine) { setSt({ state: "offline", detail: "Browser reports no network. Showing locally stored geography and cached data." }); return; }
      try {
        const h = await api.health(AbortSignal.timeout(6000));
        const bad = Object.entries(h.upstream ?? {}).filter(([, v]) => v.reachable === false).map(([k]) => k.toUpperCase());
        if (!alive) return;
        setSt(bad.length
          ? { state: "degraded", detail: `${bad.join(", ")} not reachable from the server; previously retrieved data is served from cache.` }
          : { state: "online", detail: "Connected. Data retrieved now is cached for offline use." });
      } catch {
        if (alive) setSt({ state: "offline", detail: "API not reachable. Showing locally stored geography and data cached in this browser." });
      }
    };
    check();
    const id = setInterval(check, 30_000);
    window.addEventListener("online", check);
    window.addEventListener("offline", check);
    return () => { alive = false; clearInterval(id); window.removeEventListener("online", check); window.removeEventListener("offline", check); };
  }, []);
  return st;
}
