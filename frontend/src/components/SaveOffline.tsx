import { t } from "../i18n";
import { useEffect, useState } from "react";
import { apiURL } from "../api/url";
import { readSnapshot, saveSnapshot, type Snapshot } from "../offline/snapshots";
import { Button, Notice } from "./ui";

export default function SaveOffline({ path, params, data, title, kind }: { path: string; params: Snapshot["params"]; data: unknown; title: string; kind: Snapshot["kind"] }) {
  const [saved, setSaved] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const url = apiURL(path, params);
  useEffect(() => { let active = true; setSaved(false); readSnapshot(url).then((r) => { if (active) setSaved(!!r); }); return () => { active = false; }; }, [url]);
  return <div className="mt-2 space-y-1">
    <Button disabled={busy} onClick={async () => {
      setBusy(true); setError("");
      try { await saveSnapshot(path, params, data, title, kind); setSaved(true); }
      catch { setError("Could not save offline. Check available browser storage."); }
      finally { setBusy(false); }
    }}>{busy ? t("Saving…") : saved ? t("Update offline copy") : t("Download for offline")}</Button>
    {saved && <p className="text-[11px] text-emerald-300">{t("Saved with the original retrieval date. Open it in Offline data → Saved analyses.")}</p>}
    {error && <Notice tone="error">{t(error)}</Notice>}
  </div>;
}
