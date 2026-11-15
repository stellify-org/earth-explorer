import { existsSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { Crust1, PLANET_LAYERS, EARTH_RADIUS_KM, drawnFraction, samplePath } from "./model";

it("planet layers are contiguous from the surface to the centre", () => {
  expect(PLANET_LAYERS[0].top).toBe(0);
  for (let i = 1; i < PLANET_LAYERS.length; i++) expect(PLANET_LAYERS[i].top).toBe(PLANET_LAYERS[i - 1].bottom);
  expect(PLANET_LAYERS.at(-1)!.bottom).toBe(EARTH_RADIUS_KM);
});

it("exaggerates only the crust when drawing", () => {
  expect(drawnFraction(0, 5)).toBe(1);
  expect(drawnFraction(24.4, 5)).toBeCloseTo(1 - 122 / 6371, 10);
  expect(drawnFraction(670, 5)).toBeCloseTo(1 - 670 / 6371, 10);
  expect(drawnFraction(2891, 5)).toBeCloseTo(1 - 2891 / 6371, 10);
});

// The converted model is not in git (see science/geo/build_crust1.py); the checks below compare
// it with the first line of each original file, quoted here from the downloaded archive.
const file = new URL("../../public/crust1/crust1.bin", import.meta.url);
it.skipIf(!existsSync(file))("reads CRUST1.0 cells exactly as in the model files", () => {
  const b = readFileSync(file);
  const model = new Crust1(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  const c = model.cell(89.9, -179.9); // first cell: 89.5N, 179.5W
  expect([c.lat, c.lon]).toEqual([89.5, -179.5]);
  expect(c.bounds).toEqual([0, -3.69, -3.69, -4.99, -4.99, -4.99, -5.67, -7.15, -11.75]);
  // Ice and the middle and lower sediments have zero thickness here and must not be invented.
  expect(c.layers.map((l) => l.id)).toEqual(["water", "sed_upper", "crust_upper", "crust_middle", "crust_lower"]);
  expect(c.layers.map((l) => l.thickness)).toEqual([3.69, 1.3, 0.68, 1.48, 4.6]);
  expect(c.layers.map((l) => l.vp)).toEqual([1.5, 2, 5, 6.5, 7.1]);
  expect(c.mantle.vp).toBe(8.11);
  expect(c.crustThickness).toBe(8.06);
  // Every cell: boundaries never increase downwards, and the Moho lies below the surface.
  for (let lat = -89.5; lat < 90; lat += 7) for (let lon = -179.5; lon < 180; lon += 7) {
    const x = model.cell(lat, lon);
    for (let i = 0; i < 8; i++) expect(x.bounds[i]).toBeGreaterThanOrEqual(x.bounds[i + 1]);
    expect(x.moho).toBeLessThan(x.surface);
  }
  // Continental crust under the Pamir is far thicker than oceanic crust in the central Pacific.
  expect(model.cell(38.5, 73).crustThickness).toBeGreaterThan(model.cell(0, -150).crustThickness * 3);
  const path = samplePath(model, { lat: 38.56, lon: 68.78 }, { lat: 38.5, lon: 73 });
  expect(path.lengthKm).toBeGreaterThan(350); expect(path.lengthKm).toBeLessThan(380);
  expect(path.samples[0].km).toBe(0); expect(path.samples.at(-1)!.km).toBeCloseTo(path.lengthKm, 6);
});
