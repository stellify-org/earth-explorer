import { describe, expect, it } from "vitest";
import { liftedHeight, MAX_WHEEL, wheelPixels } from "./controls";

describe("wheelPixels", () => {
  it("passes a mouse notch and a touchpad scroll through unchanged", () => {
    expect(wheelPixels(100, 0, false)).toBe(100);
    expect(wheelPixels(-3, 0, false)).toBe(-3);
  });
  it("converts line and page modes to pixels", () => {
    expect(wheelPixels(3, 1, false)).toBe(120);
    expect(wheelPixels(-1, 2, false)).toBe(-120);
  });
  it("amplifies a touchpad pinch (Ctrl + wheel, small deltas)", () => {
    expect(wheelPixels(2, 0, true)).toBe(20);
    expect(wheelPixels(-0.5, 0, true)).toBe(-5);
  });
  it("never jumps further than MAX_WHEEL: free-spinning wheels, Ctrl + mouse wheel", () => {
    expect(wheelPixels(900, 0, false)).toBe(MAX_WHEEL);
    expect(wheelPixels(-100, 0, true)).toBe(-MAX_WHEEL);
  });
  it("ignores broken values", () => {
    expect(wheelPixels(NaN, 0, false)).toBe(0);
  });
});

describe("liftedHeight", () => {
  it("leaves a camera with enough clearance alone", () => {
    expect(liftedHeight(4700, 4600, 50)).toBeUndefined();
    expect(liftedHeight(4650, 4600, 50)).toBeUndefined(); // exactly Cesium's own limit
    expect(liftedHeight(4626, 4600, 50)).toBeUndefined();
  });
  it("lifts a camera that is under the surface or nearly touching it", () => {
    expect(liftedHeight(100, 4600, 50)).toBe(4650);
    expect(liftedHeight(4610, 4600, 50)).toBe(4650);
  });
});
