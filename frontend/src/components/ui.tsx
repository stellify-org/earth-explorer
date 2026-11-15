import { t } from "../i18n";
import type { ReactNode } from "react";
import type { DataKind } from "../api/types";

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-b border-space-700/70 px-4 py-3">
      <div className="mb-2 flex items-center justify-between"><h3 className="label">{title}</h3>{right}</div>
      {children}
    </section>
  );
}

const KIND_LABEL: Record<DataKind, string> = {
  observation: "Observation",
  satellite_retrieval: "Satellite retrieval",
  reanalysis: "Reanalysis",
  model_estimate: "Model estimate",
  climate_projection: "Projection",
  derived_from_reanalysis: "Reanalysis-derived",
  imagery: "Imagery only",
  event_catalog: "Event catalogue",
};
const KIND_COLOR: Record<DataKind, string> = {
  observation: "#34d399", satellite_retrieval: "#38bdf8", reanalysis: "#a78bfa", model_estimate: "#fbbf24",
  climate_projection: "#f472b6", derived_from_reanalysis: "#a78bfa", imagery: "#94a3b8", event_catalog: "#fb923c",
};

export function KindBadge({ kind }: { kind: DataKind }) {
  return (
    <span className="badge" title={t("How these numbers were produced")}>
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: KIND_COLOR[kind] }} />
      {t(KIND_LABEL[kind])}
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-slate-400">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
      {t(label)}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error"; children: ReactNode }) {
  const c = tone === "error" ? "border-red-500/40 bg-red-500/10 text-red-200" : tone === "warn" ? "border-amber-500/40 bg-amber-500/10 text-amber-100" : "border-accent/30 bg-accent/5 text-slate-200";
  return <div className={`rounded border px-3 py-2 text-xs leading-relaxed ${c}`}>{children}</div>;
}

export function Button({ children, onClick, active, disabled, title, className }: { children: ReactNode; onClick?: () => void; active?: boolean; disabled?: boolean; title?: string; className?: string }) {
  return (
    <button
      type="button" title={title} disabled={disabled} onClick={onClick ? () => onClick() : undefined}
      className={`rounded border px-2.5 py-1 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${active ? "border-accent bg-accent/15 text-accent" : "border-space-600 bg-space-800 text-slate-200 hover:border-accent/60"} ${className ?? ""}`}
    >
      {children}
    </button>
  );
}

export const selectCls = "w-full rounded border border-space-600 bg-space-800 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-accent";
export const inputCls = selectCls;
