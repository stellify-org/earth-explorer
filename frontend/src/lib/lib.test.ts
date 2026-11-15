import { describe, expect, it } from "vitest";
import { addDays, dayIndex, diffDays, fromDayIndex, parseISODate } from "./dates";
import { fmt, fmtP, fmtSigned, parseLatLon } from "./format";

describe("dates", () => {
  it("rejects invalid calendar dates", () => {
    expect(parseISODate("2021-02-30")).toBeNull();
    expect(parseISODate("2021-2-3")).toBeNull();
    expect(parseISODate("2020-02-29")).not.toBeNull();
  });
  it("round-trips the slider index", () => {
    for (const d of ["1980-01-01", "2000-02-24", "2024-12-31"]) expect(fromDayIndex(dayIndex(d))).toBe(d);
  });
  it("adds and diffs days across month ends", () => {
    expect(addDays("2024-02-28", 2)).toBe("2024-03-01");
    expect(diffDays("1985-07-15", "1985-07-01")).toBe(-14);
  });
});

describe("format", () => {
  it("formats numbers and p-values", () => {
    expect(fmt(null)).toBe("n/a");
    expect(fmt(0.35219)).toBe("0.352");
    expect(fmtSigned(-0.348)).toBe("−0.348");
    expect(fmtP(0.0004)).toBe("< 0.001");
    expect(fmtP(0.0312)).toBe("0.031");
  });
  it("parses coordinates and validates ranges", () => {
    expect(parseLatLon("38.56, 68.78")).toEqual({ lat: 38.56, lon: 68.78 });
    expect(parseLatLon("-3 -60")).toEqual({ lat: -3, lon: -60 });
    expect(parseLatLon("91, 0")).toBeNull();
    expect(parseLatLon("abc")).toBeNull();
  });
});
