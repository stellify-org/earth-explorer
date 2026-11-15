import { t } from "../i18n";
import { useStore } from "../store";

export function LowBandwidthToggle() {
  const { lowBandwidthChoice: choice, lowBandwidthDetected: detected, setLowBandwidthChoice } = useStore();
  const on = choice ?? detected;
  const next = choice === null ? !detected : choice ? false : null;
  const label = choice === null ? `Low bandwidth: auto (${detected ? "on" : "off"})` : `Low bandwidth: ${choice ? "on" : "off"}`;
  return (
    <button className={`rounded-full border px-2.5 py-0.5 text-[11.5px] ${on ? "border-amber-400/60 text-amber-200" : "border-space-600 text-slate-300"}`}
      title={t("Low Bandwidth Mode: no satellite imagery by default, no prefetching, native detail only on request, one download at a time. Click to cycle auto → on → off.")}
      onClick={() => setLowBandwidthChoice(next)} aria-pressed={on}>
      {t(label)}
    </button>
  );
}
