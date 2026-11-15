import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HM3, KM2, SECONDS_PER_DAY, Terrain, flood, simulate, storageFromTable, storageOf, type NurekMeta } from "./model";
import { LOCATIONS } from "./locations";
import { categories, type AralMeta, type AralPack } from "./AralPanel";

const dir = join(__dirname, "../../public/scenario");
const load = (id: string) => {
  const meta = JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8")) as NurekMeta;
  const buf = readFileSync(join(dir, `${id}.bin`));
  const t = new Terrain(new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2), meta.grid);
  const m = meta.masks ? new Uint8Array(readFileSync(join(dir, meta.masks.file))) : undefined;
  const barrier = m ? Uint8Array.from(m, (x) => (x >> 1) & 1) : undefined, outline = m ? Uint8Array.from(m, (x) => x & 1) : undefined;
  return { meta, t, barrier, outline, bytes: buf.byteLength };
};

describe("location registry", () => {
  it("has unique ids, a question, an experiment and an installed data pack for every place", () => {
    expect(new Set(LOCATIONS.map((l) => l.id)).size).toBe(LOCATIONS.length);
    for (const l of LOCATIONS) {
      expect(l.question.endsWith("?"), l.id).toBe(true); expect(l.experiment.length, l.id).toBeGreaterThan(10); expect(l.how.length, l.id).toBeGreaterThan(1);
      for (const f of l.pack) expect(existsSync(join(dir, f)), f).toBe(true);
      if (l.kind === "history") continue; // observed maps, no terrain pack (checked in its own tests below)
      const { meta, t } = load(l.id);
      // the registry's box and the pack's grid describe the same rectangle (to a cell)
      expect(Math.abs(t.lon(0) - l.bbox[0])).toBeLessThan(0.01); expect(Math.abs(t.lon(t.w) - l.bbox[1])).toBeLessThan(0.01);
      expect(Math.abs(t.lat(t.h) - l.bbox[2])).toBeLessThan(0.01); expect(Math.abs(t.lat(0) - l.bbox[3])).toBeLessThan(0.01);
      expect(l.lon > l.bbox[0] && l.lon < l.bbox[1] && l.lat > l.bbox[2] && l.lat < l.bbox[3], l.id).toBe(true);
      // a water balance is offered only where the sources give a level–storage relation
      expect(l.features.balance ? !!storageOf(meta.published) : true, l.id).toBe(true);
      if (l.kind === "lake") expect(storageOf(meta.published)).toBeUndefined();
    }
  });
});

describe("storage table (piecewise linear between published rows)", () => {
  const s = storageFromTable({ levels_masl: [100, 110, 115], volumes_hm3: [0, 50, 100], where: "", note: "" });
  it("interpolates volume, inverts it exactly and takes the area from the slope", () => {
    expect(s.volume(105)).toBeCloseTo(25 * HM3, 3); expect(s.volume(112.5)).toBeCloseTo(75 * HM3, 3);
    for (const z of [100, 103.3, 110, 114.9, 115]) expect(s.level(s.volume(z))).toBeCloseTo(z, 9);
    expect(s.area(105)).toBeCloseTo(5 * HM3, 3);      // 50 hm³ over 10 m = 5 km² (5·10⁶ m²)
    expect(s.area(112)).toBeCloseTo(10 * HM3, 3);
    expect(s.min).toBe(100); expect(s.max).toBe(115);
  });
  it("uses a published area column when there is one, and rejects tables that do not increase", () => {
    const a = storageFromTable({ levels_masl: [100, 110], volumes_hm3: [0, 50], areas_km2: [2, 8], where: "", note: "" });
    expect(a.area(105)).toBeCloseTo(5 * KM2, 3);
    expect(() => storageFromTable({ levels_masl: [100, 99], volumes_hm3: [0, 1], where: "", note: "" })).toThrow();
    expect(() => storageFromTable({ levels_masl: [100], volumes_hm3: [0], where: "", note: "" })).toThrow();
  });
});

describe("Bahri Tojik (Kayrakkum) pack", () => {
  const { meta, t, barrier, outline, bytes } = load("kayrakkum"), L0 = meta.dem_water.level_m, pub = meta.published, S = storageOf(pub)!;
  it("has the declared size, a water surface at the declared level and the published levels of one document", () => {
    expect(bytes).toBe(meta.grid.bytes); expect(t.z[meta.dem_water.seed[0] * t.w + meta.dem_water.seed[1]]).toBe(L0);
    expect(L0).toBe(345);
    expect(S.kind).toBe("table"); expect([S.min, S.max]).toEqual([340.6, 347.5]);
    expect(pub.minimum_operating_level_masl!.value).toBe(S.min); expect(pub.full_supply_level_masl!.value).toBe(S.max);
    expect((S.volume(S.max) - S.volume(S.min)) / HM3).toBeCloseTo(2300, 6);   // the 2009 survey's active storage, nothing else
    expect(L0 >= S.min && L0 <= S.max).toBe(true);
  });
  it("stays behind the dam and inside the grid up to the full level; leaks without the barrier", () => {
    const base = flood(t, meta.dem_water.seed, L0, L0, barrier), full = flood(t, meta.dem_water.seed, L0, 347.5, barrier, base.mask);
    expect(base.touchesEdge).toBe(false); expect(full.touchesEdge).toBe(false);
    expect(flood(t, meta.dem_water.seed, L0, L0).touchesEdge).toBe(true);
    let onDam = 0; for (let c = 0; c < barrier!.length; c++) if (barrier![c] && full.mask[c]) onDam++;
    expect(onDam).toBe(0);
    // the recorded water (418 km² at 345 m) agrees with the independent OpenStreetMap outline (422 km²) within 5%
    const demKm2 = base.baselineAreaM2 / KM2;
    expect(demKm2).toBeCloseTo(meta.dem_water.area_km2!, 0);
    expect(Math.abs(demKm2 - meta.masks!.osm_lake_area_km2) / demKm2).toBeLessThan(0.05);
    let both = 0, lake = 0; for (let c = 0; c < outline!.length; c++) { if (base.mask[c]) { lake++; if (outline![c]) both++; } }
    expect(both / lake).toBeGreaterThan(0.9); // and they are the same place
    // at the full level the elevation data give less than the published 513 km² (levels in a different height system; whole-metre heights)
    const fullKm2 = (full.baselineAreaM2 + full.newAreaM2) / KM2;
    expect(fullKm2).toBeGreaterThan(440); expect(fullKm2).toBeLessThan(513);
    console.log(JSON.stringify({ kayrakkum: { baseKm2: +demKm2.toFixed(1), fullKm2: +fullKm2.toFixed(1), newKm2: +(full.newAreaM2 / KM2).toFixed(1), demVolHm3: +(full.volumeAboveBaselineM3 / HM3).toFixed(0), lineHm3: +((S.volume(347.5) - S.volume(L0)) / HM3).toFixed(0) } }));
  });
  it("conserves water in the balance, with spill at the full level and shortfall at the lowest level", () => {
    const base = { startLevel: L0, precipitationMmPerDay: meta.precipitation_mm_per_day, evaporationMmPerMonth: new Array(12).fill(0), precipitationFactor: 0, evaporationFactor: 1, startMonth: 3 };
    // 100 m³/s less inflow than outflow for 60 days = 518.4 million m³ → 518.4 / 333.33 = 1.555 m lower
    const dry = simulate(S, { ...base, inflowM3s: 420, outflowM3s: 520, days: 60 });
    expect((dry.endStorageM3 - dry.startStorageM3) / HM3).toBeCloseTo(-100 * SECONDS_PER_DAY * 60 / HM3, 6);
    expect(dry.endLevel).toBeCloseTo(L0 - 518.4 / (2300 / 6.9), 6); expect(Math.abs(dry.closureM3)).toBeLessThan(1);
    const wet = simulate(S, { ...base, inflowM3s: 2000, outflowM3s: 520, days: 90 });
    expect(wet.endLevel).toBe(347.5); expect(wet.spillM3).toBeGreaterThan(0); expect(Math.abs(wet.closureM3)).toBeLessThan(1);
    expect((wet.endStorageM3 - wet.startStorageM3 + wet.spillM3) / HM3).toBeCloseTo(1480 * SECONDS_PER_DAY * 90 / HM3, 3);
    const drain = simulate(S, { ...base, inflowM3s: 0, outflowM3s: 1000, days: 90 });
    expect(drain.endLevel).toBe(340.6); expect(drain.outflowShortfallM3).toBeGreaterThan(0); expect(Math.abs(drain.closureM3)).toBeLessThan(1);
    // rain and a user-set evaporation depth act on the lake area of the straight line (333 km²)
    const pe = simulate(S, { ...base, inflowM3s: 520, outflowM3s: 520, days: 30, precipitationFactor: 1, evaporationMmPerMonth: [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31].map((d) => (1000 * d) / 365) });
    expect(pe.evaporationM3 / HM3).toBeCloseTo((1000 / 365) * 30 / 1000 * (2300 / 6.9), 3);
    expect(Math.abs(pe.closureM3)).toBeLessThan(1);
  });
});

describe("Lake Sarez pack", () => {
  const { meta, t, barrier, bytes } = load("sarez"), L0 = meta.dem_water.level_m;
  it("has the declared size, one flat lake surface and no storage relation", () => {
    expect(bytes).toBe(meta.grid.bytes); expect(L0).toBe(3264);
    expect(storageOf(meta.published)).toBeUndefined();
    expect(meta.published.storage_law).toBeUndefined(); expect(meta.published.storage_table).toBeUndefined();
    const base = flood(t, meta.dem_water.seed, L0, L0, barrier);
    expect(base.baselineAreaM2 / KM2).toBeCloseTo(meta.dem_water.area_km2!, 0);
    expect(base.touchesEdge).toBe(false);
  });
  it("floods more land for a higher level, never the dam, never the edge, within the offered +20 m", () => {
    const base = flood(t, meta.dem_water.seed, L0, L0, barrier);
    let prev = 0;
    for (const dz of [5, 10, 20]) {
      const f = flood(t, meta.dem_water.seed, L0, L0 + dz, barrier, base.mask);
      expect(f.touchesEdge).toBe(false); expect(f.newAreaM2).toBeGreaterThan(prev); prev = f.newAreaM2;
      let onDam = 0; for (let c = 0; c < barrier!.length; c++) if (barrier![c] && f.mask[c]) onDam++;
      expect(onDam).toBe(0);
      expect(f.volumeAboveBaselineM3).toBeGreaterThan(base.baselineAreaM2 * dz); expect(f.volumeAboveBaselineM3).toBeLessThan((base.baselineAreaM2 + f.newAreaM2) * dz);
    }
  });
  it("carries the two magnitude-7 earthquakes of the USGS catalog inside the scene, at the catalog positions", () => {
    const q = meta.earthquakes!; expect(q.events.length).toBe(48); expect(q.url).toMatch(/^https:\/\/earthquake\.usgs\.gov\//);
    const big = q.events.filter((e) => e.mag >= 7).map((e) => e.id);
    expect(big).toEqual(["iscgem16958134", "us100044k6"]);
    const labels = meta.labels!.filter((l) => l.kind === "quake");
    expect(labels.length).toBe(2);
    for (const l of labels) { const e = q.events.find((x) => x.lat === l.lat && x.lon === l.lon)!; expect(e.mag).toBeGreaterThanOrEqual(7); expect(t.col(l.lon) >= 0 && t.col(l.lon) < t.w && t.row(l.lat) >= 0 && t.row(l.lat) < t.h).toBe(true); }
    // the 1911 epicentre lies within a few kilometres of the natural dam it created
    const d = meta.labels!.find((l) => l.kind === "dam")!, e = q.events.find((x) => x.id === "iscgem16958134")!;
    expect(Math.hypot((e.lat - d.lat) * 111.32, (e.lon - d.lon) * 111.32 * Math.cos(38.27 * Math.PI / 180))).toBeLessThan(5);
  });
});

describe("Aral Sea pack (observed yearly water maps)", () => {
  const meta = JSON.parse(readFileSync(join(dir, "aral.json"), "utf8")) as AralMeta & { source: { classes: Record<string, string> } };
  const buf = new Uint8Array(readFileSync(join(dir, "aral.bin"))), n = meta.grid.width * meta.grid.height;
  const pack: AralPack = { meta, water: buf.subarray(0, n), nodata: buf.subarray(n, 2 * n), region: buf.subarray(2 * n) };
  it("has three planes of the declared size, at most eight years, none later than the data set's last year", () => {
    expect(buf.length).toBe(meta.grid.bytes); expect(buf.length).toBe(3 * n);
    expect(meta.years.length).toBe(meta.areas.length); expect(meta.years.length).toBeLessThanOrEqual(8);
    expect(Math.max(...meta.years)).toBe(2021); expect(Math.min(...meta.years)).toBeGreaterThanOrEqual(1984);
    expect(meta.source.citation).toMatch(/Pekel/); expect(meta.source.licence).toMatch(/free of charge/);
    for (let c = 0; c < n; c++) if (!pack.region[c] && pack.water[c]) throw new Error("water outside the sea region at cell " + c);
  });
  it("draws what it reports: the blocks drawn as water add up to the full-resolution area within 2%", () => {
    const g = meta.grid, a = 6378137, e2 = 0.00669437999014;
    meta.years.forEach((year, k) => {
      let km2 = 0;
      for (let i = 0; i < g.height; i++) {
        const phi = ((g.north - (i + 0.5) * g.cell_deg) * Math.PI) / 180, s2 = Math.sin(phi) ** 2;
        const cell = (a * (1 - e2)) / (1 - e2 * s2) ** 1.5 * ((g.cell_deg * Math.PI) / 180) * (a / Math.sqrt(1 - e2 * s2)) * Math.cos(phi) * ((g.cell_deg * Math.PI) / 180) / 1e6;
        for (let j = 0; j < g.width; j++) if (pack.water[i * g.width + j] & (1 << k)) km2 += cell;
      }
      const reported = meta.areas[k].all.permanent_km2;
      expect(meta.areas[k].year).toBe(year);
      expect(Math.abs(km2 - meta.areas[k].drawn_km2) / km2, String(year)).toBeLessThan(0.001);  // same picture as the builder's
      expect(Math.abs(km2 - reported) / reported, String(year)).toBeLessThan(0.02);              // and close to the 30 m sum
    });
  });
  it("is physically consistent: the sea shrinks from year to year, north + south = whole, no-data is small", () => {
    for (let k = 0; k < meta.areas.length; k++) {
      const r = meta.areas[k];
      if (k > 0) expect(r.all.permanent_km2, String(r.year)).toBeLessThan(meta.areas[k - 1].all.permanent_km2);
      expect(r.all.permanent_km2 + r.all.seasonal_km2).toBeLessThan(meta.region.area_km2);
      expect(r.all.no_data_km2 / meta.region.area_km2).toBeLessThan(0.01);
      if (!r.joined) { expect(r.north!.permanent_km2 + r.south!.permanent_km2).toBeCloseTo(r.all.permanent_km2, 0); expect(r.north!.permanent_km2).toBeGreaterThan(2500); expect(r.north!.permanent_km2).toBeLessThan(3600); }
    }
    const first = meta.areas[0], last = meta.areas[meta.areas.length - 1];
    expect(first.all.permanent_km2).toBeGreaterThan(38000); expect(last.all.permanent_km2).toBeLessThan(7000);
    expect(last.south!.permanent_km2 / first.south!.permanent_km2).toBeLessThan(0.1); // the South Aral lost more than 90% of its 1987 area
  });
  it("classifies blocks for the picture: water now, water only in the reference year, new water", () => {
    const last = meta.years.length - 1, cat = categories(pack, last, 0), count = [0, 0, 0, 0, 0];
    for (const c of cat) count[c]++;
    let now = 0, then = 0; for (let c = 0; c < n; c++) { if (pack.water[c] & (1 << last)) now++; if (pack.water[c] & 1) then++; }
    expect(count[1] + count[4]).toBe(now);                // every water block of the year is drawn as water
    expect(count[2]).toBeGreaterThan(count[1] * 4);       // far more dried sea bed than water
    expect(count[1] + count[2]).toBeLessThanOrEqual(then);
    const same = categories(pack, 0, 0); let dry = 0; for (const c of same) if (c === 2 || c === 4) dry++;
    expect(dry).toBe(0);                                  // a year compared with itself shows no change
  });
});
