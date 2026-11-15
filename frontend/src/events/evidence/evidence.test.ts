import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Ev } from "../model";
import { PACKS, adapterFor, bundleFromRecord } from "./adapters";
import { EVIDENCE, NMI_KM, destination, distanceKm, frameAt, isFrames, pointsBy, quadrantOutline, readout, stepIndex, tierOf, type Bundle } from "./types";

const PUBLIC = join(__dirname, "../../../public");
const pack = (id: string) => JSON.parse(readFileSync(join(PUBLIC, PACKS[id]), "utf8")) as Bundle;
const ev = (o: Partial<Ev>): Ev => ({ id: "EONET_1", catalog: "eonet", title: "Test record", cat: "wildfires", categoryTitle: "Wildfires", start: Date.UTC(2026, 9, 1), end: Date.UTC(2026, 9, 1), lon: 10, lat: 20,
  position: "reported_point", geometry: "point", sources: [{ id: "IRWIN", url: "https://example.org" }], link: "https://eonet.gsfc.nasa.gov/api/v3/events/EONET_1", ...o });

describe("evidence classes", () => {
  it("are exactly the six labels a layer may carry", () => {
    expect(Object.values(EVIDENCE).map((e) => e.label)).toEqual(["Observed", "Satellite-derived", "Model estimate", "Reported event boundary", "Historical context", "Hypothetical scenario"]);
  });
});

describe("prebuilt packs (real data written by science/events/build_evidence.py)", () => {
  for (const id of Object.keys(PACKS)) {
    it(`${id}: every layer carries its evidence class and provenance`, () => {
      const b = pack(id);
      expect(b.event_id).toBe(id);
      expect(b.summary.length).toBeGreaterThanOrEqual(2); expect(b.summary.length).toBeLessThanOrEqual(4);
      expect(b.association.length).toBeGreaterThan(40);
      for (const m of b.summary) { expect(EVIDENCE[m.evidence], m.label).toBeDefined(); expect(m.note.length).toBeGreaterThan(10); }
      for (const l of b.layers) {
        expect(EVIDENCE[l.evidence], l.id).toBeDefined();
        expect(l.source.url, l.id).toMatch(/^https:\/\//);
        for (const k of ["label", "short", "date", "resolution", "uncertainty", "note"] as const) expect(l[k].length, `${l.id}.${k}`).toBeGreaterThan(2);
        expect(l.legend.length > 0 || !!l.legend_image, `${l.id} legend`).toBe(true);
      }
      expect(b.steps.every((s, i) => i === 0 || s.t > b.steps[i - 1].t)).toBe(true);
      expect(b.layers.some((l) => l.evidence === "hypothetical")).toBe(false);
    });
  }

  it("wildfire: detections are dated, sorted, and all lie at the mapped perimeter (none attributed from elsewhere)", () => {
    const b = pack("EONET_9035");
    const per = b.layers.find((l) => l.id === "perimeter")!, th = b.layers.find((l) => l.id === "thermal")!.points!;
    expect(per.evidence).toBe("observed"); expect(b.layers.find((l) => l.id === "thermal")!.evidence).toBe("satellite");
    for (const poly of per.polygons!) for (const ring of poly) expect(ring[0]).toEqual(ring[ring.length - 1]);
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const poly of per.polygons!) for (const [lon, lat] of poly[0]) { w = Math.min(w, lon); e = Math.max(e, lon); s = Math.min(s, lat); n = Math.max(n, lat); }
    expect(th.lon.length).toBeGreaterThan(1000);
    expect(th.t_min!.length).toBe(th.lon.length); expect(th.lat.length).toBe(th.lon.length); expect(th.v!.length).toBe(th.lon.length);
    expect(th.t_min!.every((m, i) => i === 0 || m >= th.t_min![i - 1])).toBe(true);
    for (let i = 0; i < th.lon.length; i++) expect(th.lon[i] >= w - 0.011 && th.lon[i] <= e + 0.011 && th.lat[i] >= s - 0.011 && th.lat[i] <= n + 0.011).toBe(true);
    // The EONET point of the fire (39.818579 N, 121.802601 W) is inside the perimeter's box.
    expect(-121.802601 > w && -121.802601 < e && 39.818579 > s && 39.818579 < n).toBe(true);
    // Each playback step is a UTC day with detections, and the last step shows all of them.
    expect(pointsBy(th, b.steps[b.steps.length - 1].t)).toBe(th.lon.length);
    expect(pointsBy(th, b.steps[0].t)).toBeGreaterThan(0);
    expect(pointsBy(th, th.t0! - 1)).toBe(0);
    expect(b.unavailable.some((u) => /MCD64A1/.test(u.label))).toBe(true);
  });

  it("hurricane: best-track positions with wind and pressure; radii have four quadrants; no invented width", () => {
    const b = pack("EONET_11536");
    const tr = b.layers.find((l) => l.kind === "track")!, ra = b.layers.find((l) => l.kind === "radii")!;
    expect(tr.fixes!.length).toBe(b.steps.length); expect(ra.rows!.length).toBe(tr.fixes!.length);
    expect(tr.fixes!.every((f, i) => i === 0 || f.t > tr.fixes![i - 1].t)).toBe(true);
    for (const r of ra.rows!) for (const q of [r.r34, r.r50, r.r64]) expect(q.length).toBe(4);
    // Stronger winds never reach farther than weaker ones in the same quadrant.
    for (const r of ra.rows!) for (let q = 0; q < 4; q++) { expect((r.r50[q] ?? 0) <= (r.r34[q] ?? 0) || !r.r34[q]).toBe(true); expect((r.r64[q] ?? 0) <= (r.r50[q] ?? 0) || !r.r50[q]).toBe(true); }
    const peak = Math.max(...tr.fixes!.map((f) => f.wind ?? 0));
    expect(b.summary[0].value).toBe(String(peak));
    expect(ra.evidence).toBe("reported"); expect(ra.unit).toBe("n mi");
    expect(readout(b, { track: true }, tr.fixes![0].t)[0]).toContain(`${tr.fixes![0].wind} kt`);
  });

  it("flood: dated class maps exist as files, areas are stored per date, the outline is labelled as reported", () => {
    const b = pack("EONET_26367");
    const water = b.layers.find((l) => l.id === "water")!;
    expect(water.evidence).toBe("satellite"); expect(b.layers.find((l) => l.id === "outline")!.evidence).toBe("reported");
    expect(isFrames(water.raster!)).toBe(true);
    if (!isFrames(water.raster!)) return;
    for (const f of water.raster.frames) { expect(existsSync(join(PUBLIC, f.url)), f.url).toBe(true); expect(f.areas_km2!.flood).toBeGreaterThanOrEqual(0); expect(f.areas_km2!.insufficient).toBeLessThanOrEqual(f.areas_km2!.box); }
    expect(water.raster.frames.map((f) => f.label)).toEqual(b.steps.map((s) => s.label));
    expect(water.raster.frames.some((f) => f.label === b.compare!.before) && water.raster.frames.some((f) => f.label === b.compare!.after)).toBe(true);
    expect(frameAt(water.raster.frames, water.raster.frames[2].t + 1)!.label).toBe(water.raster.frames[2].label);
    expect(b.unavailable.some((u) => /depth/i.test(u.label))).toBe(true);
    expect(JSON.stringify(b)).not.toMatch(/depth_m|water_depth/);
  });
});

describe("geometry helpers", () => {
  it("destination and distance agree", () => {
    for (const [lon, lat, km, az] of [[-90, 25, 185.2, 45], [72.8, 38.2, 100, 200], [179.5, -10, 300, 90]]) {
      const [lo, la] = destination(lon, lat, km, az);
      expect(distanceKm(lon, lat, lo, la)).toBeCloseTo(km, 1);
    }
  });
  it("a wind-radius outline uses each quadrant's own value and nothing else", () => {
    const all = quadrantOutline(-85, 25, [100, 100, 100, 100])!;
    for (const [lo, la] of all) expect(distanceKm(-85, 25, lo, la)).toBeCloseTo(100 * NMI_KM, 0);
    const ne = quadrantOutline(-85, 25, [120, null, 0, 60])!;
    const d = ne.map(([lo, la]) => Math.round(distanceKm(-85, 25, lo, la)));
    expect(new Set(d)).toEqual(new Set([Math.round(120 * NMI_KM), 0, Math.round(60 * NMI_KM)]));
    // North-east quadrant points lie north and east of the centre.
    for (const [lo, la] of ne.slice(0, 16)) { expect(lo).toBeGreaterThanOrEqual(-85 - 1e-9); expect(la).toBeGreaterThanOrEqual(25 - 0.05); } // a great circle due east dips slightly south
    expect(quadrantOutline(-85, 25, [0, null, 0, 0])).toBeUndefined();
  });
  it("scale tiers follow the camera distance and the size of the evidence", () => {
    const fire: [number, number, number, number] = [-122.1, 39.7, -121.4, 40.4]; // about 100 km across
    expect(tierOf(fire, 14_000)).toBe("global"); expect(tierOf(fire, 3_000)).toBe("regional"); expect(tierOf(fire, 150)).toBe("local");
    const storm: [number, number, number, number] = [-95.5, 20, -60, 31]; // thousands of km
    expect(tierOf(storm, 9_000)).toBe("regional");
    expect(tierOf(undefined, 20_000)).toBe("regional");
  });
  it("step and point lookups", () => {
    expect(stepIndex([{ t: 10 }, { t: 20 }, { t: 30 }], 5)).toBe(0); expect(stepIndex([{ t: 10 }, { t: 20 }, { t: 30 }], 25)).toBe(1);
    const p = { t0: 0, t_min: [0, 1, 1, 5], lon: [0, 0, 0, 0], lat: [0, 0, 0, 0] };
    expect(pointsBy(p, -1)).toBe(0); expect(pointsBy(p, 60_000)).toBe(3); expect(pointsBy(p, 600_000)).toBe(4);
    expect(pointsBy({ lon: [1, 2], lat: [1, 2] }, 0)).toBe(2);
  });
});

describe("evidence from the catalogue record alone", () => {
  it("a fire reported as one point gets no footprint, only an explanation", () => {
    const b = bundleFromRecord(ev({}));
    expect(b.layers).toEqual([]); expect(b.steps).toEqual([]);
    expect(b.unavailable[0].label).toMatch(/perimeter/i);
  });
  it("a storm track becomes a track layer with the reported winds and dated steps; its width is declared unknown", () => {
    const t0 = Date.UTC(2026, 9, 1);
    const b = bundleFromRecord(ev({ cat: "severeStorms", geometry: "track", magUnit: "kts", magMax: 90, end: t0 + 2 * 86_400_000,
      track: [{ lon: 130, lat: 15, t: t0, mag: 35, unit: "kts" }, { lon: 128, lat: 16, t: t0 + 86_400_000, mag: 90, unit: "kts" }, { lon: 126, lat: 18, t: t0 + 2 * 86_400_000, mag: 60, unit: "kts" }] }));
    const tr = b.layers.find((l) => l.id === "track")!;
    expect(tr.kind).toBe("track"); expect(tr.fixes!.map((f) => f.wind)).toEqual([35, 90, 60]); expect(tr.wind_unit).toBe("kt");
    expect(b.steps.map((s) => s.t)).toEqual([t0, t0 + 86_400_000, t0 + 2 * 86_400_000]);
    expect(b.layers.some((l) => l.kind === "radii")).toBe(false);
    expect(b.unavailable.some((u) => /radii/i.test(u.label))).toBe(true);
    const rain = b.layers.find((l) => l.id === "rain")!;
    expect(rain.on).toBe(false); expect(rain.evidence).toBe("satellite"); expect(rain.gibs!.dates).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
  });
  it("a flood outline stays a reported boundary; satellite water is a separate satellite layer; depth is never offered", () => {
    const ring = [[100, 15], [101, 15], [101, 16], [100, 16], [100, 15]];
    const b = bundleFromRecord(ev({ cat: "floods", geometry: "polygon", position: "polygon_bbox_centre", polygons: [[ring]], polygonCount: 1, polygonVertices: 5, start: Date.UTC(2026, 10, 5), end: Date.UTC(2026, 10, 5) }));
    expect(b.layers.find((l) => l.id === "outline")!.evidence).toBe("reported"); expect(b.layers.find((l) => l.id === "outline")!.fill).toBe(false);
    const water = b.layers.find((l) => l.id === "water")!;
    expect(water.kind).toBe("gibs"); expect(water.evidence).toBe("satellite"); expect(water.gibs!.layer).toBe("MODIS_Combined_Flood_3-Day");
    expect(water.gibs!.dates[0]).toBe("2026-11-03");
    expect(b.unavailable.some((u) => /depth/i.test(u.label))).toBe(true);
    expect(b.steps.length).toBe(water.gibs!.dates.length);
  });
  it("a flood from before the NASA flood product says the map does not exist", () => {
    const b = bundleFromRecord(ev({ cat: "floods", geometry: "polygon", start: Date.UTC(2017, 7, 14), end: Date.UTC(2017, 7, 14) }));
    expect(b.layers.some((l) => l.id === "water")).toBe(false);
    expect(b.unavailable.some((u) => /starts in December 2021/.test(u.reason))).toBe(true);
  });
  it("adapters: packs first, USGS earthquakes through ShakeMap, everything else from the record", () => {
    expect(adapterFor(ev({ id: "EONET_9035" })).id).toBe("pack");
    expect(adapterFor(ev({ id: "us100044k6", catalog: "usgs", cat: "earthquakes" })).id).toBe("shakemap");
    expect(adapterFor(ev({ cat: "volcanoes" })).id).toBe("record");
  });
});
