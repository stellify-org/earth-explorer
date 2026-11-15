export type IndicatorType = "anomaly" | "trend" | "observedChange";

export type Direction = "up" | "down" | "neutral" | "missing";
export type Tone = "warm" | "cool" | "wet" | "dry" | "neutral";
export type IndicatorIcon =
  | "thermoUp" | "thermoDown" | "thermo" | "rain" | "dry" | "drop" | "dropUp" | "dropDown"
  | "soilWet" | "soilDry" | "soil" | "windStrong" | "windWeak" | "wind" | "sunUp" | "sunDown" | "sun"
  | "arrowUp" | "arrowDown" | "equal" | "trendUp" | "trendDown" | "trendFlat" | "unknown";

export interface IndicatorSpec {

  friendly: string;
  unit: string;
  icon: { up: IndicatorIcon; down: IndicatorIcon; neutral: IndicatorIcon };
  tone: { up: Tone; down: Tone };
  anomaly: { up: string; down: string; neutral: string };

  trend: { up: string; down: string };

  digits: { anomaly: number; trend: number };

  limitation: string;
}

const GENERIC: IndicatorSpec = {
  friendly: "",
  unit: "",
  icon: { up: "arrowUp", down: "arrowDown", neutral: "equal" },
  tone: { up: "neutral", down: "neutral" },
  anomaly: { up: "Higher than normal", down: "Lower than normal", neutral: "Near the historical average" },
  trend: { up: "{0}: the values are rising.", down: "{0}: the values are falling." },
  digits: { anomaly: 2, trend: 2 },
  limitation: "A value for one model grid cell. It describes what changed, not why.",
};

export const INDICATORS: Record<string, IndicatorSpec> = {
  t2m: {
    friendly: "Temperature", unit: "°C",
    icon: { up: "thermoUp", down: "thermoDown", neutral: "thermo" },
    tone: { up: "warm", down: "cool" },
    anomaly: { up: "Warmer than normal", down: "Colder than normal", neutral: "Near the historical average" },
    trend: { up: "{0} is getting warmer.", down: "{0} is getting colder." },
    digits: { anomaly: 1, trend: 2 },
    limitation: "Air temperature 2 m above the ground from a reanalysis grid cell about 50 km wide: not a thermometer reading at one address. One warm or cold month is weather, not a climate trend.",
  },
  precip: {
    friendly: "Rain and snow", unit: "mm/day",
    icon: { up: "rain", down: "dry", neutral: "drop" },
    tone: { up: "wet", down: "dry" },
    anomaly: { up: "Wetter than normal", down: "Drier than normal", neutral: "Near the historical average" },
    trend: { up: "{0} is getting more rain and snow.", down: "{0} is getting less rain and snow." },
    digits: { anomaly: 2, trend: 2 },
    limitation: "A wet month is not a flood and a dry month is not a drought: those need a drought or flood index, a period and a method that this indicator does not have. Precipitation in reanalysis is model-based and uncertain in mountains.",
  },
  rh2m: {
    friendly: "Humidity", unit: "%",
    icon: { up: "dropUp", down: "dropDown", neutral: "drop" },
    tone: { up: "wet", down: "dry" },
    anomaly: { up: "Higher than normal humidity", down: "Lower than normal humidity", neutral: "Near normal humidity" },
    trend: { up: "The air in {0} is getting more humid.", down: "The air in {0} is getting drier." },
    digits: { anomaly: 1, trend: 2 },
    limitation: "Relative humidity, in percent of saturation: it also falls when the air warms, even with the same amount of water vapour.",
  },
  qv2m: {
    friendly: "Water vapour in the air", unit: "g/kg",
    icon: { up: "dropUp", down: "dropDown", neutral: "drop" },
    tone: { up: "wet", down: "dry" },
    anomaly: { up: "Higher than normal humidity", down: "Lower than normal humidity", neutral: "Near normal humidity" },
    trend: { up: "The air in {0} holds more water vapour.", down: "The air in {0} holds less water vapour." },
    digits: { anomaly: 2, trend: 2 },
    limitation: "Specific humidity, in grams of water vapour per kilogram of air: a different quantity from relative humidity (%).",
  },
  soilwet: {
    friendly: "Soil moisture", unit: "",
    icon: { up: "soilWet", down: "soilDry", neutral: "soil" },
    tone: { up: "wet", down: "dry" },
    anomaly: { up: "Wetter soil than normal", down: "Drier soil than normal", neutral: "Near normal soil moisture" },
    trend: { up: "The soil in {0} is getting wetter.", down: "The soil in {0} is getting drier." },
    digits: { anomaly: 2, trend: 2 },
    limitation: "Soil wetness is modeled for a coarse grid cell, not measured in the ground at this place. It is not a drought classification.",
  },
  ws2m: {
    friendly: "Wind", unit: "m/s",
    icon: { up: "windStrong", down: "windWeak", neutral: "wind" },
    tone: { up: "neutral", down: "neutral" },
    anomaly: { up: "Stronger than normal winds", down: "Weaker than normal winds", neutral: "Near normal wind speeds" },
    trend: { up: "Winds in {0} are getting stronger.", down: "Winds in {0} are getting weaker." },
    digits: { anomaly: 2, trend: 2 },
    limitation: "Wind speed only: it says nothing about the wind direction, so no arrow is drawn.",
  },
  sw_down: {
    friendly: "Sunlight", unit: "MJ/m²/day",
    icon: { up: "sunUp", down: "sunDown", neutral: "sun" },
    tone: { up: "warm", down: "neutral" },
    anomaly: { up: "More sunlight than normal", down: "Less sunlight than normal", neutral: "Near normal sunlight" },
    trend: { up: "{0} is getting more sunlight at the ground.", down: "{0} is getting less sunlight at the ground." },
    digits: { anomaly: 2, trend: 2 },
    limitation: "Solar energy reaching the ground, from satellite-based estimates on a 1° grid. It depends on cloud and haze, not on the Sun getting brighter.",
  },
};

export function indicatorFor(variableId: string | undefined): IndicatorSpec {
  return (variableId && INDICATORS[variableId]) || GENERIC;
}

export function friendlyName(variableId: string, datasetName: string): string {
  return INDICATORS[variableId]?.friendly || datasetName;
}

const finite = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);

export function formatChange(x: number | null | undefined, decimals: number): string {
  if (!finite(x)) return "no data";
  const r = Number(x.toFixed(decimals));
  if (r === 0) return (0).toFixed(decimals);
  return (r > 0 ? "+" : "−") + Math.abs(r).toFixed(decimals);
}

export function classify(x: number | null | undefined, decimals: number, band?: number): Direction {
  if (!finite(x)) return "missing";
  if (Number(x.toFixed(decimals)) === 0) return "neutral";
  if (band !== undefined && Number.isFinite(band) && Math.abs(x) <= band) return "neutral";
  return x > 0 ? "up" : "down";
}

export interface SeriesPoint { date: string; value: number | null; anomaly: number | null }

export function latestAnomaly(points: readonly SeriesPoint[]): { date: string; year: number; month: number; anomaly: number; value: number | null } | undefined {
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    if (finite(p.anomaly)) return { date: p.date, year: Number(p.date.slice(0, 4)), month: Number(p.date.slice(5, 7)), anomaly: p.anomaly, value: finite(p.value) ? p.value : null };
  }
  return undefined;
}

export const NEAR_NORMAL_SD = 0.5;

export const NEAR_NORMAL_MIN_YEARS = 10;

export function nearNormalBand(points: readonly SeriesPoint[], month: number): number | undefined {
  const xs: number[] = [];
  for (const p of points) if (finite(p.anomaly) && Number(p.date.slice(5, 7)) === month) xs.push(p.anomaly);
  if (xs.length < NEAR_NORMAL_MIN_YEARS) return undefined;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
  return NEAR_NORMAL_SD * sd;
}

export type TrendEvidence = "detected" | "weak" | "inconclusive" | "none" | "unknown";
export function trendEvidence(code: string | undefined): TrendEvidence {
  switch (code) {
    case "significant_increase": case "significant_decrease": return "detected";
    case "suggestive": return "weak";
    case "methods_disagree": return "inconclusive";
    case "not_detected": return "none";
    default: return "unknown";
  }
}

export function trendLabel(code: string | undefined, slope: number | null | undefined): string {
  const up = finite(slope) && slope >= 0;
  switch (trendEvidence(code)) {
    case "detected": return up ? "Rising trend detected" : "Falling trend detected";
    case "weak": return up ? "Possible rise, weak evidence" : "Possible fall, weak evidence";
    case "inconclusive": return "The evidence is inconclusive";
    case "none": return "No clear long-term change detected";
    default: return "Not enough data for a trend";
  }
}

export function trendHeadline(variableId: string, code: string | undefined, slope: number | null | undefined, place: string): string {
  const spec = indicatorFor(variableId), up = finite(slope) && slope >= 0;
  switch (trendEvidence(code)) {
    case "detected": return (up ? spec.trend.up : spec.trend.down).replace("{0}", place);
    case "weak": return up ? "There may be a rise, but the evidence is weak." : "There may be a fall, but the evidence is weak.";
    case "inconclusive": return "The evidence is inconclusive.";
    case "none": return "No clear long-term change detected.";
    default: return code === "insufficient_data" ? "There is not enough data to tell." : "The result here is not reliable enough to tell.";
  }
}
