import { describe, expect, it } from "vitest";
import { classify, formatChange, friendlyName, indicatorFor, INDICATORS, latestAnomaly, nearNormalBand, trendEvidence, trendHeadline, trendLabel, type SeriesPoint } from "./registry";

describe("formatChange", () => {
  it("prints a sign, fixed decimals and a typographic minus", () => {
    expect(formatChange(2.44, 1)).toBe("+2.4");
    expect(formatChange(-1.66, 1)).toBe("−1.7");
    expect(formatChange(0.352, 2)).toBe("+0.35");
  });
  it("never uses scientific notation and prints a rounded zero without a sign (audit T-03)", () => {
    expect(formatChange(-2.7e-4, 2)).toBe("0.00");
    expect(formatChange(0, 1)).toBe("0.0");
  });
  it("keeps missing values apart from zero", () => {
    expect(formatChange(null, 1)).toBe("no data");
    expect(formatChange(undefined, 1)).toBe("no data");
    expect(formatChange(NaN, 1)).toBe("no data");
  });
});

describe("classify", () => {
  it("separates positive, negative, neutral and missing", () => {
    expect(classify(2.4, 1)).toBe("up");
    expect(classify(-1.7, 1)).toBe("down");
    expect(classify(0.04, 1)).toBe("neutral");
    expect(classify(null, 1)).toBe("missing");
    expect(classify(NaN, 1)).toBe("missing");
  });
  it("uses the near-normal band when one is given", () => {
    expect(classify(0.3, 1, 0.5)).toBe("neutral");
    expect(classify(-0.5, 1, 0.5)).toBe("neutral");
    expect(classify(0.6, 1, 0.5)).toBe("up");
    expect(classify(-0.6, 1, 0.5)).toBe("down");
  });
});

const series = (anoms: (number | null)[], month = 7): SeriesPoint[] => anoms.map((a, i) => ({ date: `${1990 + i}-${String(month).padStart(2, "0")}`, value: a === null ? null : 20 + a, anomaly: a }));

describe("latestAnomaly", () => {
  it("returns the last month that has a value and skips missing months", () => {
    const pts = [...series([0.2, -0.4, 1.1]), { date: "1993-07", value: null, anomaly: null }];
    expect(latestAnomaly(pts)).toEqual({ date: "1992-07", year: 1992, month: 7, anomaly: 1.1, value: 21.1 });
  });
  it("returns nothing for an all-missing series instead of zero", () => {
    expect(latestAnomaly(series([null, null]))).toBeUndefined();
    expect(latestAnomaly([])).toBeUndefined();
  });
});

describe("nearNormalBand", () => {
  it("is half the sample standard deviation of the same calendar month", () => {
    const xs = [-2, -1, 0, 1, 2, -2, -1, 0, 1, 2]; // mean 0, sample variance 20/9
    expect(nearNormalBand(series(xs), 7)).toBeCloseTo(0.5 * Math.sqrt(20 / 9), 12);
  });
  it("ignores other months and missing values, and needs at least ten years", () => {
    const pts = [...series([-2, -1, 0, 1, 2, -2, -1, 0, 1, 2], 7), ...series([50, -50, 50], 1), ...series([null], 7)];
    expect(nearNormalBand(pts, 7)).toBeCloseTo(0.5 * Math.sqrt(20 / 9), 12);
    expect(nearNormalBand(pts, 1)).toBeUndefined();
  });
});

describe("registry", () => {
  it("defines icon, colour meaning, three anomaly labels, two trend headlines, number format and a limitation for every variable", () => {
    for (const [id, s] of Object.entries(INDICATORS)) {
      expect(s.friendly.length, id).toBeGreaterThan(2);
      expect(new Set([s.anomaly.up, s.anomaly.down, s.anomaly.neutral]).size, id).toBe(3);
      expect(s.icon.up, id).not.toBe(s.icon.down);
      expect(s.trend.up, id).toContain("{0}"); expect(s.trend.down, id).toContain("{0}"); expect(s.trend.up, id).not.toBe(s.trend.down);
      expect(s.digits.anomaly, id).toBeGreaterThanOrEqual(0);
      expect(s.limitation.length, id).toBeGreaterThan(20);
    }
  });
  it("covers the variables the trend API serves", () => {
    for (const id of ["t2m", "precip", "rh2m", "qv2m", "ws2m", "sw_down"]) expect(INDICATORS[id], id).toBeDefined();
  });
  it("gives temperature warm / cool meanings and precipitation wet / dry ones", () => {
    expect(INDICATORS.t2m.tone).toEqual({ up: "warm", down: "cool" });
    expect(INDICATORS.precip.tone).toEqual({ up: "wet", down: "dry" });
    expect(INDICATORS.t2m.anomaly.up).toBe("Warmer than normal");
    expect(INDICATORS.precip.anomaly.down).toBe("Drier than normal");
  });
  it("never calls a precipitation anomaly a flood or a drought, and draws no wind direction", () => {
    const p = INDICATORS.precip;
    for (const label of [p.anomaly.up, p.anomaly.down, p.anomaly.neutral, p.trend.up, p.trend.down]) expect(label).not.toMatch(/flood|drought/i);
    expect(INDICATORS.ws2m.limitation).toMatch(/direction/);
    expect([INDICATORS.ws2m.icon.up, INDICATORS.ws2m.icon.down]).not.toContain("arrowUp");
  });
  it("falls back to a generic indicator and the dataset name for an unknown variable", () => {
    expect(indicatorFor("u10m").anomaly.up).toBe("Higher than normal");
    expect(friendlyName("u10m", "Eastward wind at 10 m")).toBe("Eastward wind at 10 m");
    expect(friendlyName("t2m", "Near-surface air temperature")).toBe("Temperature");
  });
});

describe("trend wording follows the server verdict, not the slope", () => {
  it("names a trend only when it was detected", () => {
    expect(trendHeadline("t2m", "significant_increase", 0.35, "Dushanbe")).toBe("Dushanbe is getting warmer.");
    expect(trendHeadline("t2m", "significant_decrease", -0.2, "Dushanbe")).toBe("Dushanbe is getting colder.");
    expect(trendHeadline("t2m", "not_detected", 0.35, "Dushanbe")).toBe("No clear long-term change detected.");
    expect(trendHeadline("t2m", "methods_disagree", 0.35, "Dushanbe")).toBe("The evidence is inconclusive.");
    expect(trendHeadline("precip", "suggestive", -0.01, "Dushanbe")).toMatch(/weak/);
    expect(trendHeadline("t2m", "insufficient_data", null, "Dushanbe")).toMatch(/not enough data/);
  });
  it("labels the indicator the same way", () => {
    expect(trendLabel("significant_increase", 0.3)).toBe("Rising trend detected");
    expect(trendLabel("significant_decrease", -0.3)).toBe("Falling trend detected");
    expect(trendLabel("not_detected", 0.3)).toBe("No clear long-term change detected");
    expect(trendLabel("unreliable", 0.3)).toBe("Not enough data for a trend");
    expect(trendEvidence("suggestive")).toBe("weak");
  });
});
