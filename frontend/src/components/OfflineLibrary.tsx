import { t } from "../i18n";
import { useEffect, useState } from "react";
import { useStore } from "../store";
import { deleteSnapshot, listSnapshots, type Snapshot } from "../offline/snapshots";
import type { QuakeQuery } from "../api/url";
import { Button } from "./ui";

interface Item { kind: "trend" | "grid"; variable: string; lat: number; lon: number; start?: number; end?: number; year?: number }

function parse(urls: string[]): Item[] {
  const out: Item[] = [];
  for (const u of urls) {
    const url = new URL(u);
    const q = url.searchParams;
    const base = { variable: q.get("variable") ?? "", lat: Number(q.get("lat")), lon: Number(q.get("lon")) };
    if (url.pathname.endsWith("/trends")) out.push({ kind: "trend", ...base, start: Number(q.get("start")), end: Number(q.get("end")) });
    else if (url.pathname === "/api/v1/grid") out.push({ kind: "grid", ...base, year: Number(q.get("year")) });
  }
  return out;
}

export default function OfflineLibrary({ onClose, embedded }: { onClose: () => void; embedded?: boolean }) {
  const s = useStore();
  const [items, setItems] = useState<Item[] | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [deleteError, setDeleteError] = useState("");
  useEffect(() => { void listSnapshots().then(setSnapshots); }, []);
  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw?.controller) { setItems([]); return; }
    const onMsg = (e: MessageEvent) => { if (e.data?.type === "api-list") setItems(parse(e.data.urls)); };
    sw.addEventListener("message", onMsg);
    sw.controller.postMessage({ type: "list-api" });
    return () => sw.removeEventListener("message", onMsg);
  }, []);
  const name = (id: string) => s.variables.find((v) => v.id === id)?.name ?? id;
  const body = (
      <div>
        <h2 className="mb-2 text-base font-semibold text-slate-50">{t("Analyses available offline on this device")}</h2>
        <p className="mb-2 text-[11.5px] text-slate-400">{t("Use Download for offline in Trend Detective or X-Ray to keep a snapshot of the selected point or region and period.")}</p>
        <ul className="mb-4 space-y-2">
          {snapshots.map((snapshot) => <li key={snapshot.url} className="rounded border border-emerald-500/30 p-2">
            <button className="w-full text-left" onClick={() => {
              const p = snapshot.params;
              if (snapshot.kind === "earthquakes") s.openQuakeSnapshot(p as unknown as QuakeQuery);
              else {
                s.setVariable(String(p.variable)); s.setPeriod(Number(p.start), Number(p.end));
                s.setMode("explore"); s.flyTo({ lat: Number(p.lat), lon: Number(p.lon) });
              }
              onClose();
            }}>
              <span className="block text-emerald-200">{t(snapshot.title)}</span>
              <span className="block font-mono text-[11px]">{String(snapshot.params.start)}–{String(snapshot.params.end)} · {snapshot.kind === "trend" ? `${snapshot.params.lat}, ${snapshot.params.lon}` : `${snapshot.params.minlat}…${snapshot.params.maxlat}, ${snapshot.params.minlon}…${snapshot.params.maxlon}`} · {Math.ceil(snapshot.bytes / 1024)}{t(" kB")}</span>
              <span className="block text-[10px] text-slate-400">{t("Saved: ")}{snapshot.saved}</span>
            </button>
            <Button onClick={async () => {
              try { await deleteSnapshot(snapshot.url); setSnapshots(await listSnapshots()); setDeleteError(""); }
              catch { setDeleteError("Could not delete offline copy."); }
            }}>{t("Delete offline copy")}</Button>
          </li>)}
        </ul>
        {deleteError && <p className="text-red-300">{t(deleteError)}</p>}
        <p className="mb-3 text-[11.5px] text-slate-400">{t("Results you retrieved before are stored in this browser and open without a connection. Base geography always works offline.")}</p>
        {items === null && <p>{t("Reading cache…")}</p>}
        {items?.length === 0 && <p className="text-slate-400">{t("Nothing cached yet")}{navigator.serviceWorker?.controller ? "" : t(" (offline storage becomes active after the first full load of the production build)")}.</p>}
        <ul className="space-y-1">
          {items?.map((it, i) => (
            <li key={i}>
              <button className="w-full rounded border border-space-700 px-3 py-1.5 text-left hover:border-accent/60" onClick={() => {
                if (it.kind === "trend") { s.setVariable(it.variable); s.setPeriod(it.start!, it.end!); }
                else { s.setGridVariable(it.variable); s.setDate(`${it.year}-07-01`); }
                s.setMode("explore");
                s.flyTo({ lat: it.lat, lon: it.lon });
                onClose();
              }}>
                <span className="text-slate-100">{it.kind === "trend" ? t("Trend") : t("Grid")} · {name(it.variable)}</span>
                <span className="ml-2 font-mono text-[11px] text-slate-400">{it.lat.toFixed(2)}, {it.lon.toFixed(2)} · {it.kind === "trend" ? `${it.start}–${it.end}` : it.year}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
  );
  if (embedded) return body;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="panel scroll-thin max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg p-5 text-[12.5px] text-slate-300" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t("Offline library")}>{body}</div>
    </div>
  );
}
