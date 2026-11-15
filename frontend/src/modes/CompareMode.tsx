import { t } from "../i18n";
import { useEffect, useRef, useState } from "react";
import type { CesiumWidget } from "@cesium/engine";
import { ensureLayers, useStore } from "../store";
import GlobeView from "../globe/GlobeView";
import { useGlobeLayers } from "../globe/useGlobeLayers";
import Timeline from "../components/Timeline";
import { api, ApiError } from "../api/client";
import type { CompareResponse } from "../api/types";
import { Button, KindBadge, Notice, Spinner, selectCls } from "../components/ui";
import { fmt, fmtLatLon, fmtP, fmtSigned } from "../lib/format";

function syncCamera(from: CesiumWidget, to: CesiumWidget) {
  const c = from.camera;
  to.camera.setView({ destination: c.positionWC.clone(), orientation: { direction: c.directionWC.clone(), up: c.upWC.clone() } });
  to.scene.requestRender();
}

export default function CompareMode() {
  const s = useStore();
  useEffect(() => { ensureLayers().catch(() => {}); }, []);
  const [layerId, setLayerId] = useState(s.vizId ?? s.satelliteId ?? "MODIS_Terra_CorrectedReflectance_TrueColor");
  const [dateA, setDateA] = useState("2001-07-01");
  const [dateB, setDateB] = useState(s.date);
  const timeLayers = s.layers.filter((l) => l.time_enabled);
  const isOverlay = s.layers.find((l) => l.id === layerId)?.group === "science";

  const satForPanes = isOverlay ? undefined : layerId;
  const vizForPanes = isOverlay ? layerId : undefined;
  const A = useGlobeLayers(satForPanes, vizForPanes, dateA);
  const B = useGlobeLayers(satForPanes, vizForPanes, dateB);

  const va = useRef<CesiumWidget | null>(null);
  const vb = useRef<CesiumWidget | null>(null);
  const active = useRef<"a" | "b">("a");
  const [ready, setReady] = useState(0);

  useEffect(() => {
    const a = va.current, b = vb.current;
    if (!a || !b) return;
    syncCamera(a, b);

    if (import.meta.env.DEV) (window as unknown as { __eeCompare?: unknown }).__eeCompare = { a, b, setActive: (k: "a" | "b") => (active.current = k) };
    const ra = a.scene.postRender.addEventListener(() => { if (active.current === "a") syncCamera(a, b); });
    const rb = b.scene.postRender.addEventListener(() => { if (active.current === "b") syncCamera(b, a); });
    return () => { ra(); rb(); };
  }, [ready]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="panel flex flex-wrap items-center gap-3 px-4 py-2">
        <span className="label">{t("Compare")}</span>
        <select className={`${selectCls} !w-auto`} value={layerId} onChange={(e) => setLayerId(e.target.value)} aria-label={t("Layer to compare")}>
          {timeLayers.map((l) => <option key={l.id} value={l.id}>{t(l.short_name)}</option>)}
        </select>
        <span className="text-[11px] text-slate-400">{t("Same layer, two dates. Cameras are locked together; move either globe.")}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {([["a", A, dateA, setDateA, va], ["b", B, dateB, setDateB, vb]] as const).map(([k, g, date, setDate, ref]) => (
          <div key={k} className="relative flex min-h-0 flex-1 flex-col border-space-700 md:border-r" onPointerEnter={() => (active.current = k)} onWheel={() => (active.current = k)}>
            <div className="relative min-h-0 flex-1">
              <GlobeView layers={g.specs} marker={s.place} showHud={false} labels={s.showLabels}
                onViewer={(v) => { ref.current = v; setReady((x) => x + 1); }} />
              <div className="pointer-events-none absolute top-2 left-2 rounded bg-black/65 px-2 py-1 font-mono text-[11px] text-slate-100">
                {k.toUpperCase()} · {g.driverAv.a ? g.driverAv.a.shown : "…"}
                {g.driverAv.a?.gibs_time_actual && <span className="ml-2 text-slate-400">{t("GIBS: ")}{g.driverAv.a.gibs_time_actual.slice(0, 10)}</span>}
              </div>
            </div>
            <Timeline compact date={date} setDate={setDate} driver={g.driver} availability={g.driverAv.a} loading={g.driverAv.loading} error={g.driverAv.error} />
          </div>
        ))}
      </div>
      <QuantCompare />
    </div>
  );
}

function QuantCompare() {
  const { place, variableId, variables, setVariable } = useStore();
  const last = new Date().getUTCFullYear() - 1;
  const [pa, setPa] = useState("1981-1990");
  const [pb, setPb] = useState(`${last - 9}-${last}`);
  const [st, setSt] = useState<{ d?: CompareResponse; loading: boolean; error?: string }>({ loading: false });
  const run = () => {
    if (!place) return;
    setSt({ loading: true });
    api.compare({ variable: variableId, lat: place.lat, lon: place.lon, period_a: pa, period_b: pb })
      .then((d) => setSt({ d, loading: false }))
      .catch((e: Error) => setSt({ loading: false, error: e instanceof ApiError ? e.message : String(e) }));
  };
  const d = st.d;
  return (
    <div className="panel flex flex-wrap items-start gap-4 px-4 py-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="label">{t("Values at point")}</span>
        <select className={`${selectCls} !w-auto !py-1 !text-xs`} value={variableId} onChange={(e) => setVariable(e.target.value)} aria-label={t("Variable")}>
          {variables.map((v) => <option key={v.id} value={v.id}>{t(v.name)}</option>)}
        </select>
        <input className={`${selectCls} !w-24 !py-1 font-mono !text-xs`} value={pa} onChange={(e) => setPa(e.target.value)} aria-label={t("Period A (YYYY-YYYY)")} />
        <span className="text-slate-500">{t("vs")}</span>
        <input className={`${selectCls} !w-24 !py-1 font-mono !text-xs`} value={pb} onChange={(e) => setPb(e.target.value)} aria-label={t("Period B (YYYY-YYYY)")} />
        <Button onClick={run} disabled={!place || st.loading}>{t("Compare")}</Button>
        {!place && <span className="text-slate-400">{t("Select a point in Explore first (click the globe).")}</span>}
        {st.loading && <Spinner />}
      </div>
      {st.error && <Notice tone="error">{t(st.error)}</Notice>}
      {d && (
        <div className="min-w-[320px] flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-slate-200">
            <KindBadge kind={d.variable.data_kind} />
            <span className="font-mono">{fmtLatLon(d.location.lat, d.location.lon)}</span>
            <span>{t("A ")}{d.period_a.start}–{d.period_a.end}: <b className="font-mono">{fmt(d.period_a.mean)} {d.units}</b></span>
            <span>{t("B ")}{d.period_b.start}–{d.period_b.end}: <b className="font-mono">{fmt(d.period_b.mean)} {d.units}</b></span>
            <span>{t("B − A: ")}<b className="font-mono text-accent">{fmtSigned(d.difference.b_minus_a)} {d.units}</b>{t(" (95% CI ")}{fmt(d.difference.ci_low)}{t(" to ")}{fmt(d.difference.ci_high)}{t(", p ")}{fmtP(d.difference.p_value)})</span>
          </div>
          <p className="text-[10.5px] text-slate-400">{d.notes.join(" ")}{t(" Source: ")}{d.provenance.provider} {d.provenance.api_version} ({(d.provenance.upstream_sources ?? []).join(", ")}{t("). Imagery above is visual context only; these numbers come from the data series.")}</p>
        </div>
      )}
    </div>
  );
}
