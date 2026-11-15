import { t } from "../i18n";
import { Notice } from "../components/ui";

const ADAPTERS = [
  { name: "Climate projections (NEX-GDDP-CMIP6 via NASA POWER)", kind: "Published model output — selection among emission scenarios, not user-tunable physics", status: "Planned: data source identified, not integrated" },
  { name: "Geometric water-level illustration on ETOPO 2022", kind: "Geometric 'bathtub' illustration — ignores hydrodynamics, defences and subsidence", status: "Planned: requires ETOPO integration" },
  { name: "Published empirical relations (with citation and validity range)", kind: "Literature relation applied only inside its documented domain", status: "Not started" },
  { name: "Physical models (hydrology, land surface, land-atmosphere)", kind: "Calibrated research models (would need scientific partners)", status: "Out of scope for this prototype" },
];

export default function ScenarioLab() {
  return (
    <div className="scroll-thin flex-1 overflow-y-auto px-6 py-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <span className="badge border-amber-400/50 text-amber-200">{t("Not active — architecture preview")}</span>
          <h1 className="mt-3 text-2xl font-semibold text-slate-50">{t("Scenario Lab")}</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">{t(" Scenario Lab will let users explore “what if” questions using established, cited scientific models — kept visibly separate from observed history. ")}<b className="text-slate-100">{t(" No simulation runs in this version.")}</b>{t(" Nothing on this page is a prediction. ")}</p>
        </div>
        <Notice tone="warn">{t(" Rules every future scenario must satisfy: a declared physical basis, a documented validity domain, uncertainty estimates, a citation, and provenance for every output. If no validated model covers a request, the answer is “not supported by a validated model”. Language models are never used to produce physical predictions. ")}</Notice>
        <div>
          <h2 className="label mb-2">{t("Planned model adapters")}</h2>
          <div className="divide-y divide-space-700 rounded border border-space-700">
            {ADAPTERS.map((a) => (
              <div key={a.name} className="grid gap-1 px-4 py-3 md:grid-cols-[1fr_auto]">
                <div>
                  <div className="text-sm text-slate-100">{t(a.name)}</div>
                  <div className="text-[11.5px] text-slate-400">{a.kind}</div>
                </div>
                <div className="self-center text-[11px] text-amber-200/90">{a.status}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="grid gap-3 text-[12px] text-slate-300 md:grid-cols-3">
          {[
            ["Observed history", "Measurements, retrievals and reanalysis (what Explore and Trend Detective show today)."],
            ["Model projections", "Published scenario runs, shown with model spread — never mixed with observations on one unlabeled axis."],
            ["Experimental scenarios", "User-defined perturbations, only through adapters with a validity domain."],
          ].map(([t, d]) => (
            <div key={t} className="rounded border border-space-700 bg-space-900 p-3"><div className="mb-1 font-medium text-slate-100">{t}</div>{d}</div>
          ))}
        </div>
        <p className="text-[11px] text-slate-500">{t("Design details: docs/ARCHITECTURE.md §5F and docs/SCENARIO_LAB.md.")}</p>
      </div>
    </div>
  );
}
