import { t } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { useLowBandwidth } from "../store";
import { chunkCount, deletePack, downloadPack, listPacks, packRecord, requestPersistence, storageInfo, type Pack, type PackRecord } from "../offline/packs";
import OfflineLibrary from "./OfflineLibrary";
import { Button, Notice, Spinner } from "./ui";

const fmtBytes = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} kB`);
const secondsAt = (b: number, mbps: number) => Math.round((b * 8) / (mbps * 1e6));

export default function OfflineData({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"packs" | "saved">("packs");
  const low = useLowBandwidth();
  const [packs, setPacks] = useState<Pack[] | null>(null);
  const [recs, setRecs] = useState<Record<string, PackRecord | undefined>>({});
  const [busy, setBusy] = useState<Record<string, { done: number; total: number; bytes: number; error?: string }>>({});
  const [store, setStore] = useState<{ usage: number; quota: number; persisted: boolean }>();
  const ctl = useRef<Record<string, AbortController>>({});

  const refresh = async (ps?: Pack[]) => {
    const list = ps ?? packs ?? [];
    const r: Record<string, PackRecord | undefined> = {};
    for (const p of list) r[p.id] = await packRecord(p.id);
    setRecs(r);
    setStore(await storageInfo());
  };
  useEffect(() => { listPacks().then((p) => { setPacks(p); refresh(p); }); return () => Object.values(ctl.current).forEach((c) => c.abort()); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async (p: Pack) => {
    const c = new AbortController();
    ctl.current[p.id] = c;
    setBusy((b) => ({ ...b, [p.id]: { done: 0, total: chunkCount(p), bytes: 0 } }));
    try {
      await downloadPack(p, { concurrency: low ? 1 : 3, signal: c.signal, onProgress: (done, total, bytes) => setBusy((b) => ({ ...b, [p.id]: { done, total, bytes } })) });
      setBusy((b) => { const n = { ...b }; delete n[p.id]; return n; });
    } catch (e) {
      const msg = (e as Error).name === "AbortError" ? "Paused — resume continues where it stopped." : `Interrupted: ${(e as Error).message}. Resume continues where it stopped.`;
      setBusy((b) => ({ ...b, [p.id]: { ...(b[p.id] ?? { done: 0, total: chunkCount(p), bytes: 0 }), error: msg } }));
    }
    refresh();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="panel scroll-thin max-h-[86vh] w-full max-w-2xl overflow-y-auto rounded-lg p-5 text-[12.5px] text-slate-300" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t("Offline data")}>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex gap-1">
            <Button active={tab === "packs"} onClick={() => setTab("packs")}>{t("Data packs")}</Button>
            <Button active={tab === "saved"} onClick={() => setTab("saved")}>{t("Saved analyses")}</Button>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white" aria-label={t("Close")}>✕</button>
        </div>
        {tab === "saved" ? <OfflineLibrary onClose={onClose} embedded /> : (
          <>
            <p className="text-[11.5px] text-slate-400">{t("Download once, explore without internet. Nothing here downloads automatically. Each pack is split into small chunks, so an interrupted download resumes where it stopped. Science data chunks are verified (SHA-256); map tiles of 3D packs come straight from their sources and carry no checksum.")}</p>
            {store && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px]">
                <span>{t("Storage used by this site: ")}<b className="font-mono text-slate-100">{fmtBytes(store.usage)}</b>{t(" of ")}{fmtBytes(store.quota)}{t(" available")}</span>
                {store.persisted ? <span className="badge">{t("persistent")}</span> : <Button onClick={async () => { await requestPersistence(); setStore(await storageInfo()); }} title={t("Ask the browser not to evict offline data under storage pressure")}>{t("Keep offline data")}</Button>}
              </div>
            )}
            {!packs && <div className="mt-3"><Spinner label={t("Reading pack list…")} /></div>}
            {packs?.length === 0 && <Notice tone="warn">{t("No packs available (offline, or the server has no ingested grids).")}</Notice>}
            <ul className="mt-3 space-y-2">
              {packs?.map((p) => {
                const r = recs[p.id], b = busy[p.id];
                const done = r?.complete && r.version === p.version;
                return (
                  <li key={p.id} className="rounded border border-space-700 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-slate-100">{t(p.title)}</div>
                        <div className="text-[11px] text-slate-400">{t(p.description)}</div>
                        <div className="mt-1 font-mono text-[10.5px] text-slate-500">
                          {fmtBytes(p.bytes)} · {chunkCount(p)}{t(" chunks · ≈")}{secondsAt(p.bytes, 1)}{t(" s at 1 Mbit/s · ")}{t(p.spatial_resolution)}{p.from && ` · ${p.from}–${p.to}`}{t(" · data ")}{p.version}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        {b && !b.error ? <Button onClick={() => ctl.current[p.id]?.abort()}>{t("Pause")}</Button>
                          : done ? <Button onClick={async () => {
                              try { await deletePack(p); } catch (e) { setBusy((x) => ({ ...x, [p.id]: { done: chunkCount(p), total: chunkCount(p), bytes: p.bytes, error: `Could not delete: ${(e as Error).message}` } })); }
                              refresh();
                            }}>{t("Delete")}</Button>
                          : <Button active onClick={() => start(p)}>{r && r.done > 0 ? t("Resume") : t("Download")}</Button>}
                      </div>
                    </div>
                    {(b || (r && !done)) && (
                      <div className="mt-2">
                        <div className="h-1.5 rounded bg-space-700"><div className="h-full rounded bg-accent" style={{ width: `${(100 * (b?.done ?? r?.done ?? 0)) / chunkCount(p)}%` }} /></div>
                        <div className="mt-0.5 text-[10.5px] text-slate-400">{b?.done ?? r?.done} / {chunkCount(p)}{t(" chunks")}{b?.error && <span className="text-amber-300"> — {t(b.error)}</span>}</div>
                      </div>
                    )}
                    {done && <div className="mt-1 text-[10.5px] text-emerald-300">{t("✓ Available offline")}</div>}
                    <div className="mt-1 text-[10px] text-slate-500">{t("Source: ")}{p.citation} {p.upstream_doi && t(`Upstream DOI ${p.upstream_doi}.`)}</div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

