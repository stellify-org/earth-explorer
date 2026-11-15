import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HM3, KM2, LAND_COVER_WATER, SECONDS_PER_DAY, Terrain, areaM2, damBarrier, flood, floodedByClass, levelFromStorage, simulate, storageM3, type BalanceInput, type NurekMeta } from "./model";

const dir = join(__dirname, "../../public/scenario");
const meta = JSON.parse(readFileSync(join(dir, "nurek.json"), "utf8")) as NurekMeta;
const law = meta.published.storage_law!;
const none = new Array(12).fill(0);
const base: BalanceInput = { startLevel: 880, inflowM3s: 0, outflowM3s: 0, precipitationMmPerDay: none, evaporationMmPerMonth: none, precipitationFactor: 1, evaporationFactor: 1, days: 30, startMonth: 0 };

describe("published storage law", () => {
  it("gives the storage of the report's formula in the right unit", () => {
    // V[hm³] = 2.41·(Z − 762.7)^1.64 → hand value at 910 m: 2.41·147.3^1.64
    expect(storageM3(law, 910) / HM3).toBeCloseTo(2.41 * Math.pow(147.3, 1.64), 6);
    expect((storageM3(law, 910) - storageM3(law, 857)) / 1e9).toBeCloseTo(4.5, 1); // km³, live storage of the same order as the surveys (3.06–4.50)
  });
  it("inverts exactly (stage ↔ storage)", () => {
    for (const z of [857, 864, 880.5, 900, 910]) expect(levelFromStorage(law, storageM3(law, z))).toBeCloseTo(z, 9);
  });
  it("has an area equal to dV/dZ, close to the published 98 km² at full level", () => {
    const numeric = (storageM3(law, 900.001) - storageM3(law, 899.999)) / 0.002;
    expect(areaM2(law, 900)).toBeCloseTo(numeric, -2);
    expect(areaM2(law, 910) / KM2).toBeGreaterThan(90);
    expect(areaM2(law, 910) / KM2).toBeLessThan(105);
  });
});

describe("water balance", () => {
  it("does not change storage when all fluxes balance", () => {
    const r = simulate(law, { ...base, inflowM3s: 665, outflowM3s: 665 });
    expect(r.endStorageM3).toBe(r.startStorageM3);
    expect(r.endLevel).toBeCloseTo(880, 9);
  });
  it("converts m³/s to m³ per day: 1 m³/s for 1 day is 86 400 m³", () => {
    const r = simulate(law, { ...base, inflowM3s: 1, days: 1 });
    expect(r.endStorageM3 - r.startStorageM3).toBeCloseTo(SECONDS_PER_DAY, 0);
  });
  it("converts mm of rain on the lake to volume: 10 mm/day over A for one day is 0.01·A m³", () => {
    const r = simulate(law, { ...base, precipitationMmPerDay: new Array(12).fill(10), days: 1 });
    expect(r.precipitationM3).toBeCloseTo(0.01 * areaM2(law, 880), 3);
  });
  it("spreads monthly evaporation over the days of the month", () => {
    const r = simulate(law, { ...base, evaporationMmPerMonth: new Array(12).fill(31), days: 1, startMonth: 0 }); // 31 mm in January = 1 mm/day
    expect(r.evaporationM3).toBeCloseTo(0.001 * areaM2(law, 880), 3);
  });
  it("raises storage and level with a positive net inflow, lowers them with a negative one", () => {
    const up = simulate(law, { ...base, inflowM3s: 700, outflowM3s: 600 }), down = simulate(law, { ...base, inflowM3s: 600, outflowM3s: 700 });
    expect(up.endStorageM3).toBeGreaterThan(up.startStorageM3); expect(up.endLevel).toBeGreaterThan(880);
    expect(down.endStorageM3).toBeLessThan(down.startStorageM3); expect(down.endLevel).toBeLessThan(880);
  });
  it("conserves volume: the storage change equals the sum of the terms", () => {
    const r = simulate(law, { ...base, inflowM3s: 702.5, outflowM3s: 640, precipitationMmPerDay: meta.precipitation_mm_per_day, evaporationMmPerMonth: meta.published.evaporation_mm_per_month!.values, precipitationFactor: 1.3, evaporationFactor: 0.8, days: 200, startMonth: 3 });
    expect(r.spillM3).toBe(0); expect(r.outflowShortfallM3).toBe(0);
    const sum = r.inflowM3 - r.outflowDeliveredM3 + r.precipitationM3 - r.evaporationM3;
    expect(Math.abs(r.endStorageM3 - r.startStorageM3 - sum)).toBeLessThan(1); // < 1 m³ out of ~3·10⁹
    expect(Math.abs(r.closureM3)).toBeLessThan(1);
    expect(storageM3(law, r.endLevel)).toBeCloseTo(r.endStorageM3, -1);
  });
  it("accounts for every m³ when the reservoir fills: 5000 in, 666 out, 90 days (the case from the audit)", () => {
    const r = simulate(law, { ...base, startLevel: 864, inflowM3s: 5000, outflowM3s: 666, days: 90 });
    const net = (5000 - 666) * SECONDS_PER_DAY * 90;                       // 33.70 km³ arrives net
    expect(net / 1e9).toBeCloseTo(33.70, 2);
    const room = storageM3(law, 910) - storageM3(law, 864);                // 3.98 km³ fits below full supply level
    expect(room / 1e9).toBeCloseTo(3.98, 2);
    expect(r.days).toBe(90);                                               // the whole period is simulated
    expect(r.endLevel).toBeCloseTo(910, 6);
    expect(r.endStorageM3 - r.startStorageM3).toBeCloseTo(room, -1);
    expect(r.spillM3 / 1e9).toBeCloseTo(33.70 - 3.98, 2);                  // 29.72 km³ leaves as spill
    expect(Math.abs(net - (r.endStorageM3 - r.startStorageM3) - r.spillM3)).toBeLessThan(1);
    expect(Math.abs(r.closureM3)).toBeLessThan(1);
    expect(r.daysAtFull).toBeGreaterThan(75);
  });
  it("cuts the release instead of going below the minimum level, and reports the shortfall", () => {
    const r = simulate(law, { ...base, startLevel: 860, inflowM3s: 100, outflowM3s: 2000, days: 120 });
    expect(r.endLevel).toBeCloseTo(857, 6); expect(r.endStorageM3).toBeCloseTo(storageM3(law, 857), -1);
    expect(r.outflowShortfallM3).toBeGreaterThan(0);
    expect(r.outflowDeliveredM3 + r.outflowShortfallM3).toBeCloseTo(r.outflowRequestedM3, -1);
    // delivered = inflow + the storage that was available above 857 m
    expect(r.outflowDeliveredM3).toBeCloseTo(r.inflowM3 + storageM3(law, 860) - storageM3(law, 857), -1);
    expect(Math.abs(r.closureM3)).toBeLessThan(1); expect(r.unplacedLossM3).toBe(0);
  });
  it("keeps storage and level inside the valid range on every reported day, and rejects impossible inputs", () => {
    for (const [qi, qo] of [[5000, 0], [0, 5000], [900, 300], [300, 900]]) {
      const r = simulate(law, { ...base, startLevel: 880, inflowM3s: qi, outflowM3s: qo, precipitationMmPerDay: meta.precipitation_mm_per_day, evaporationMmPerMonth: meta.published.evaporation_mm_per_month!.values, days: 365 });
      for (const p of r.series) { expect(p.level).toBeGreaterThanOrEqual(857 - 1e-9); expect(p.level).toBeLessThanOrEqual(910 + 1e-9); }
      expect(r.endStorageM3).toBeGreaterThan(0); expect(Math.abs(r.closureM3)).toBeLessThan(1);
    }
    expect(() => simulate(law, { ...base, startLevel: 950 })).toThrow();
    expect(() => simulate(law, { ...base, inflowM3s: -1 })).toThrow();
  });
  it("adds degree-day snowmelt with the right units and only above the threshold", () => {
    // 4 mm/°C/day × 5 °C × 1000 km² = 20 mm/day over 10⁹ m² = 2·10⁷ m³/day
    const r = simulate(law, { ...base, days: 1, snowmelt: { areaKm2: 1000, degreeDayFactorMmPerCDay: 4, temperatureC: 5 } });
    expect(r.snowmeltM3).toBeCloseTo(2e7, 3); expect(r.endStorageM3 - r.startStorageM3).toBeCloseTo(2e7, 0);
    expect(simulate(law, { ...base, days: 30, snowmelt: { areaKm2: 1000, degreeDayFactorMmPerCDay: 4, temperatureC: -3 } }).snowmeltM3).toBe(0);
  });
});

describe("inundation on a synthetic grid", () => {
  // 1 row × 7 columns at the equator-ish origin: lake(10) | shore 12 | ridge 30 | hollow 11 (disconnected) ...
  const grid = { zoom: 11, x0: 262144, y0: 262144, width: 7, height: 1 };
  const t = new Terrain(Int16Array.from([10, 10, 12, 30, 11, 11, 40]), grid);
  it("floods only cells that water can reach", () => {
    const f = flood(t, [0, 0], 10, 15);
    expect(Array.from(f.mask)).toEqual([1, 1, 2, 0, 0, 0, 0]); // the hollow behind the ridge stays dry at 15 m
    expect(f.newAreaM2).toBeCloseTo(t.rowArea[0], 6);
    // volume: 2 lake cells × 5 m + shore cell × (15 − 12) m
    expect(f.volumeAboveBaselineM3).toBeCloseTo(t.rowArea[0] * (2 * 5 + 3), 3);
    expect(Array.from(flood(t, [0, 0], 10, 31).mask)).toEqual([1, 1, 2, 2, 2, 2, 0]); // over the ridge at 31 m
  });
  it("is stopped by the dam barrier, and floods nothing new below the recorded surface", () => {
    expect(Array.from(flood(t, [0, 0], 10, 31, Uint8Array.from([0, 0, 0, 1, 0, 0, 0])).mask)).toEqual([1, 1, 2, 0, 0, 0, 0]);
    const low = flood(t, [0, 0], 10, 8);
    expect(low.belowData).toBe(true); expect(low.newAreaM2).toBe(0); expect(low.volumeAboveBaselineM3).toBe(0);
    expect(Array.from(low.mask)).toEqual([1, 1, 0, 0, 0, 0, 0]);
  });
  it("sums the newly flooded area per land-cover class and ignores baseline water and dry cells", () => {
    const f = flood(t, [0, 0], 10, 31); // mask 1 1 2 2 2 2 0
    const by = floodedByClass(t, f.mask, Uint8Array.from([80, 80, 80, 30, 30, 10, 10]));
    expect(by.map((x) => x.code)).toEqual([30, 10, 80]); // largest first (two cells of 30); equal areas in class-code order
    expect(by[0].areaM2).toBeCloseTo(2 * t.rowArea[0], 6);
    expect(by.reduce((s, x) => s + x.areaM2, 0)).toBeCloseTo(f.newAreaM2, 6);
    expect(() => floodedByClass(t, f.mask, new Uint8Array(3))).toThrow();
  });
});

describe("Nurek data pack", () => {
  const buf = readFileSync(join(dir, "nurek.bin"));
  const t = new Terrain(new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2), meta.grid);
  const barrier = damBarrier(t, meta.dam), L0 = meta.dem_water.level_m;
  it("has the declared size and a water surface at the declared level", () => {
    expect(buf.byteLength).toBe(meta.grid.bytes);
    expect(t.z[meta.dem_water.seed[0] * t.w + meta.dem_water.seed[1]]).toBe(L0);
  });
  it("at full supply level stays behind the dam and inside the grid, with an area near the published 98 km²", () => {
    const f = flood(t, meta.dem_water.seed, L0, 910, barrier);
    expect(f.touchesEdge).toBe(false);
    const total = (f.baselineAreaM2 + f.newAreaM2) / KM2;
    expect(total).toBeGreaterThan(93); expect(total).toBeLessThan(103);
    // the dam body itself is never flooded
    let onDam = 0; for (let c = 0; c < barrier.length; c++) if (barrier[c] && f.mask[c]) onDam++;
    expect(onDam).toBe(0);
  });
  it("agrees with the published law on the volume between the DEM surface and full level within 15%", () => {
    const dem = flood(t, meta.dem_water.seed, L0, 910, barrier).volumeAboveBaselineM3, published = storageM3(law, 910) - storageM3(law, L0);
    expect(Math.abs(dem - published) / published).toBeLessThan(0.15);
  });
  it("carries a land-cover grid whose classes on the flooded cells add up to the flooded area", () => {
    expect(meta.land_cover).toBeDefined();
    const lc = new Uint8Array(readFileSync(join(dir, meta.land_cover!.file)));
    expect(lc.length).toBe(t.w * t.h); expect(lc.length).toBe(meta.land_cover!.bytes);
    for (const code of new Set(lc)) expect(meta.land_cover!.classes[String(code)]).toBeDefined();
    // every cell that is water in the elevation data (February 2000) is water in the 2021 map too
    const base = flood(t, meta.dem_water.seed, L0, L0, barrier);
    for (let c = 0; c < lc.length; c++) if (base.mask[c] === 1 && lc[c] !== LAND_COVER_WATER) throw new Error("baseline water cell " + c + " is class " + lc[c]);
    // as in the scene: "baseline water" is the lake connected at 864 m, everything else reached at 910 m is newly flooded
    const f = flood(t, meta.dem_water.seed, L0, 910, barrier, base.mask), by = floodedByClass(t, f.mask, lc);
    expect(by.reduce((s, x) => s + x.areaM2, 0)).toBeCloseTo(f.newAreaM2, 3);
    // values from an independent NumPy implementation (2026-11-14): 51.84 km² flooded, of it 44.83 water and 5.81 grassland in 2021
    expect(f.newAreaM2 / KM2).toBeCloseTo(51.84, 1);
    expect(by[0].code).toBe(LAND_COVER_WATER); expect(by[0].areaM2 / KM2).toBeCloseTo(44.83, 1);
    expect(by.find((x) => x.code === 30)!.areaM2 / KM2).toBeCloseTo(5.81, 1);
  });
  it("would leak through the smoothed dam crest without the barrier (why the barrier exists)", () => {
    const leak = flood(t, meta.dem_water.seed, L0, 910);
    expect(leak.touchesEdge).toBe(true);
    expect((leak.baselineAreaM2 + leak.newAreaM2) / KM2).toBeGreaterThan(130); // water running down the valley below the dam
  });
});
