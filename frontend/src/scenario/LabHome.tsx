import { t } from "../i18n";
import { LOCATIONS, useLabPlace } from "./locations";

export default function LabHome() {
  const set = useLabPlace((s) => s.set);
  return (
    <div className="absolute inset-0 z-10 overflow-y-auto bg-black/45 p-3 sm:p-6" data-testid="lab-home">
      <div className="mx-auto max-w-4xl">
        <h2 className="text-lg font-semibold text-slate-50 sm:text-xl">{t("What can I discover here?")}</h2>
        <p className="mt-1 max-w-2xl text-[13px] leading-snug text-slate-300">{t("Choose a real place. Each one has its own experiment — they do not all support the same simulation — and says plainly what is not known.")}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {LOCATIONS.map((l) => (
            <button key={l.id} data-testid={`lab-card-${l.id}`} onClick={() => set(l.id)}
              className="card flex flex-col gap-1.5 p-3 text-left transition-colors hover:border-accent focus-visible:border-accent">
              <span className="text-[11.5px] text-slate-400">{t(l.name)} · {t(l.country)}</span>
              <span className="text-[15.5px] leading-snug font-semibold text-slate-50">{t(l.question)}</span>
              <span className="text-[12px] leading-snug text-slate-200"><span className="label mr-1">{t("Experiment")}</span>{t(l.experiment)}</span>
              <span className="text-[11.5px] leading-snug text-slate-400"><span className="label mr-1">{t("Data")}</span>{t(l.data)}</span>
              <span className="mt-1 text-[13px] font-medium text-warm">{t("Open the experiment")} →</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-snug text-slate-400">{t("Exploratory tools for learning. None of them forecasts a lake, a river, the climate or a hazard.")}</p>
      </div>
    </div>
  );
}
