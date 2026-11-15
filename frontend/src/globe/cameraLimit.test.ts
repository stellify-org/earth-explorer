import { describe, expect, it } from "vitest";
import { groundRange, maxOffNadir } from "./cameraLimit";

const R = 6_371_000;
const deg = (r: number | undefined) => (r === undefined ? undefined : (r * 180) / Math.PI);

describe("camera limit that keeps the Earth in view", () => {
  it("leaves low cameras free (Surface view at 34 km, X-Ray, horizon views)", () => {
    expect(maxOffNadir(R + 34_000)).toBeUndefined();
    expect(maxOffNadir(R + 1_000_000)).toBeUndefined();
  });
  it("starts at the limb angle, so nothing jumps when the limit switches on", () => {
    const limbAt1000km = (Math.asin(R / (R + 1_000_000)) * 180) / Math.PI; // 59.8°
    expect(deg(maxOffNadir(R + 1_000_001))).toBeCloseTo(limbAt1000km, 3);
  });
  it("is always inside the limb and shrinks to nadir by 10,000 km", () => {
    let prev = Infinity;
    for (let h = 1.1e6; h <= 3e7; h += 2.5e5) {
      const a = maxOffNadir(R + h)!;
      expect(a).toBeLessThanOrEqual(Math.asin(R / (R + h)));
      expect(a).toBeLessThanOrEqual(prev);
      prev = a;
    }
    expect(maxOffNadir(R + 10_000_000)).toBe(0);
    expect(maxOffNadir(R + 17_000_000)).toBe(0); // the reported black screen: 55° off nadir at ~17,000 km
  });
  it("finds the ground point at the centre of the screen, or none past the limb", () => {
    expect(groundRange(R + 2_000_000, 0)).toBeCloseTo(2_000_000, 3); // straight down: range = height
    const d = R + 5_000_000, limb = Math.asin(R / d);
    expect(groundRange(d, limb * 0.999)).toBeGreaterThan(5_000_000);
    expect(groundRange(d, limb * 1.001)).toBeUndefined();
    expect(groundRange(d, Math.PI * 0.75)).toBeUndefined(); // looking away from the Earth
  });
});
