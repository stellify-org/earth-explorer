import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Terrain, damBarrier, flood, type NurekMeta } from "./model";
import { Cartesian3, Cartographic, IntersectionTests, Ray } from "@cesium/core";
import { STEP } from "./scene";
import { drawnSurfaceZ } from "./buildings";
import { INTERSECTS, NEAR, NEAR_BUFFER_M, OUTSIDE, METRES_PER_LEVEL, PLACEHOLDER_HEIGHT_M, buildingCells, buildingId, classify, drawnHeightM, parseBuildings, polygonRectDistance, type Building, type BuildingsMeta } from "./buildings";

const dir = join(__dirname, "../../public/scenario");

describe("footprint against a grid cell (plane geometry, metres)", () => {
  const square: [number, number][][] = [[[0, 0], [10, 0], [10, 10], [0, 10]]];
  it("is 0 for overlap, touching, a cell inside the footprint and a footprint inside the cell", () => {
    expect(polygonRectDistance(square, 5, 5, 20, 20)).toBe(0);      // partial overlap
    expect(polygonRectDistance(square, 10, 0, 20, 10)).toBe(0);     // shared edge
    expect(polygonRectDistance(square, 4, 4, 6, 6)).toBe(0);        // cell inside footprint
    expect(polygonRectDistance(square, -50, -50, 50, 50)).toBe(0);  // footprint inside cell
    expect(polygonRectDistance(square, -5, 3, 15, 7)).toBe(0);      // cell crosses the footprint, no vertex of either inside the other
  });
  it("is the gap between the outlines otherwise", () => {
    expect(polygonRectDistance(square, 13, 0, 20, 10)).toBeCloseTo(3, 9);        // side by side
    expect(polygonRectDistance(square, 13, 14, 20, 20)).toBeCloseTo(5, 9);       // corner to corner: 3-4-5
  });
  it("treats a courtyard (hole) as outside the footprint", () => {
    const ring: [number, number][][] = [[[0, 0], [30, 0], [30, 30], [0, 30]], [[10, 10], [20, 10], [20, 20], [10, 20]]];
    expect(polygonRectDistance(ring, 14, 14, 16, 16)).toBeCloseTo(4, 9); // a cell in the courtyard, 4 m from its walls
    expect(polygonRectDistance(ring, 2, 2, 4, 4)).toBe(0);
  });
});

describe("classification on a synthetic grid", () => {
  // One row of cells (76 m at the equator, zoom 11): lake(10) | lake | shore 12 | 20 | 20 | 20 | 20 | 20.
  const grid = { zoom: 11, x0: 262144, y0: 262144, width: 8, height: 1 };
  const t = new Terrain(Int16Array.from([10, 10, 12, 20, 20, 20, 20, 20]), grid);
  const cellDeg = t.lon(1) - t.lon(0), cellM = Math.sqrt(t.rowArea[0]), midLat = t.lat(0.5);
  /** A 6 m × 6 m footprint centred at fractional column x. */
  const box = (index: number, x: number): Building => {
    const d = 3 / 111_320, lon = t.lon(x);
    return { index, idKind: 1, source: 0, kind: 0, heightSource: "none", rings: [[[lon - d, midLat - d], [lon + d, midLat - d], [lon + d, midLat + d], [lon - d, midLat + d]]], lon, lat: midLat };
  };
  // b0 on the shore cell; b1 in cell 3, 40 m from the shore cell (so 40 m + one cell from the lake); b2 in the middle of cell 5; b3 across the edge of cells 2 and 3
  const buildings = [box(0, 2.5), box(1, 3 + (40 + 3) / cellM), box(2, 5.5), box(3, 3)];
  const bc = buildingCells(t, buildings);
  it("finds the cells under each footprint and its ground elevation", () => {
    expect(bc.groundMin[0]).toBe(12); expect(bc.groundMin[1]).toBe(20); expect(bc.groundMin[3]).toBe(12); // lowest of the two cells it straddles
    expect(bc.offGrid).toBe(0);
    expect(cellM).toBeGreaterThan(76); expect(cellM).toBeLessThan(77); expect(cellDeg).toBeGreaterThan(0);
  });
  it("is grey / yellow / red by overlap and by the stated buffer, and follows the water level", () => {
    // 11 m: water only on the two lake cells. b0 is half a cell − 3 m from the lake (inside the 100 m buffer), b1 116 m (outside).
    const low = classify(t, bc, flood(t, [0, 0], 10, 11));
    expect(Array.from(low.cls)).toEqual([NEAR, OUTSIDE, OUTSIDE, NEAR]);
    expect(low.distanceM[0]).toBeCloseTo(cellM / 2 - 3, 0);
    // 15 m: the shore cell floods. b0 and b3 intersect, b1 is 40 m away, b2 is two and a half cells away (> 100 m).
    const mid = classify(t, bc, flood(t, [0, 0], 10, 15));
    expect(Array.from(mid.cls)).toEqual([INTERSECTS, NEAR, OUTSIDE, INTERSECTS]);
    expect(mid.distanceM[1]).toBeCloseTo(40, 0);
    expect([mid.outside, mid.near, mid.intersects]).toEqual([1, 1, 2]);
    expect(mid.depthM[0]).toBeCloseTo(3, 6);          // 15 m − ground 12 m
    expect(mid.depthM[3]).toBeCloseTo(3, 6);          // only the flooded one of its two cells counts
    expect(Number.isNaN(mid.depthM[1])).toBe(true);
    // 25 m: everything is under water.
    const high = classify(t, bc, flood(t, [0, 0], 10, 25));
    expect(Array.from(high.cls)).toEqual([INTERSECTS, INTERSECTS, INTERSECTS, INTERSECTS]);
    expect(high.depthM[2]).toBeCloseTo(5, 6);
    expect(NEAR_BUFFER_M).toBe(100);
  });
  it("gives no depth where the ground is not known (water in the elevation data itself)", () => {
    const onLake = [box(0, 0.5)], c = classify(t, buildingCells(t, onLake), flood(t, [0, 0], 10, 15));
    expect(c.cls[0]).toBe(INTERSECTS); expect(Number.isNaN(c.depthM[0])).toBe(true);
  });
});

describe("Nurek buildings pack", () => {
  const meta = JSON.parse(readFileSync(join(dir, "nurek_buildings.json"), "utf8")) as BuildingsMeta;
  const nurek = JSON.parse(readFileSync(join(dir, "nurek.json"), "utf8")) as NurekMeta;
  const raw = readFileSync(join(dir, "nurek_buildings.bin")), ids = readFileSync(join(dir, meta.ids.file));
  const buildings = parseBuildings(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer, meta);
  const dem = readFileSync(join(dir, "nurek.bin"));
  const t = new Terrain(new Int16Array(dem.buffer, dem.byteOffset, dem.byteLength / 2), nurek.grid);
  const barrier = damBarrier(t, nurek.dam), L0 = nurek.dem_water.level_m;
  const base = flood(t, nurek.dem_water.seed, L0, L0, barrier);
  const bc = buildingCells(t, buildings);
  const at = (level: number) => { const f = flood(t, nurek.dem_water.seed, L0, level, barrier, base.mask); return { f, c: classify(t, bc, f) }; };

  it("parses to the declared number of footprints, all inside the elevation grid's rectangle", () => {
    expect(buildings.length).toBe(meta.count);
    expect(meta.sources.reduce((s, x) => s + x.count, 0)).toBe(meta.count);
    for (const b of buildings) {
      expect(b.rings[0].length).toBeGreaterThanOrEqual(3);
      expect(b.lon > meta.bbox.west && b.lon < meta.bbox.east && b.lat > meta.bbox.south && b.lat < meta.bbox.north, String(b.index)).toBe(true);
    }
    for (const s of meta.sources) { expect(s.licence).toMatch(/ODbL/); expect(s.attribution.length).toBeGreaterThan(5); }
  });
  it("keeps heights honest: only mapped tags count, the rest is unknown and drawn with the placeholder", () => {
    const tagged = buildings.filter((b) => b.heightSource !== "none");
    expect(tagged.length).toBe(meta.height_tags.height + meta.height_tags.levels);
    expect(buildings.length - tagged.length).toBe(meta.height_tags.none);
    for (const b of tagged) if (b.heightSource === "levels") expect(b.heightM).toBe(b.levels! * METRES_PER_LEVEL);
    const untagged = buildings.find((b) => b.heightSource === "none")!;
    expect(untagged.heightM).toBeUndefined(); expect(drawnHeightM(untagged)).toBe(PLACEHOLDER_HEIGHT_M);
  });
  it("reads ids from the id file (OSM way/relation numbers and Overture GERS ids)", () => {
    expect(ids.byteLength).toBe(meta.ids.bytes); expect(ids.byteLength).toBe(16 * buildings.length);
    const buf = ids.buffer.slice(ids.byteOffset, ids.byteOffset + ids.byteLength) as ArrayBuffer;
    const osm = buildings.find((b) => b.source === 0)!, ov = buildings.find((b) => b.source === 1)!;
    expect(buildingId(buf, osm)).toMatch(/^(way|relation)\/\d+$/);
    expect(buildingId(buf, ov)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
  it("classifies against the same mask the water is drawn from, checked building by building with a second method", () => {
    // Second method: sample the footprint densely (every ~5 m inside its bounding box) and look the samples up in the mask.
    const inside = (b: Building, lon: number, lat: number) => { let c = false; for (const r of b.rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      if (r[i][1] > lat !== r[j][1] > lat && lon < ((r[j][0] - r[i][0]) * (lat - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; } return c; };
    for (const level of [L0, 890, 910]) {
      const { f, c } = at(level);
      let checked = 0;
      for (const b of buildings) {
        const lons = b.rings[0].map((p) => p[0]), lats = b.rings[0].map((p) => p[1]);
        const w = Math.min(...lons), e = Math.max(...lons), s = Math.min(...lats), n = Math.max(...lats);
        // only buildings close to the water are worth sampling: the rest is covered by the count checks below
        if (c.cls[b.index] === OUTSIDE && b.index % 50 !== 0) continue;
        let wet = false;
        const stepLon = 5 / 87_000, stepLat = 5 / 111_320;
        for (let lat = s; lat <= n && !wet; lat += stepLat) for (let lon = w; lon <= e; lon += stepLon) {
          if (!inside(b, lon, lat)) continue;
          const i = t.row(lat), j = t.col(lon);
          if (i >= 0 && j >= 0 && i < t.h && j < t.w && f.mask[i * t.w + j]) { wet = true; break; }
        }
        // sampling can only miss an overlap (thin slivers), never invent one
        if (wet) expect(c.cls[b.index], `building ${b.index} at ${level} m`).toBe(INTERSECTS);
        if (c.cls[b.index] !== INTERSECTS) expect(wet, `building ${b.index} at ${level} m`).toBe(false);
        checked++;
      }
      expect(checked).toBeGreaterThan(600);
      expect(c.outside + c.near + c.intersects).toBe(buildings.length);
    }
  });
  it("never loses a building from a class when the water rises, and reports depths only on flooded land", () => {
    let prev = at(L0).c;
    for (const level of [870, 880, 890, 900, 910]) {
      const { f, c } = at(level);
      for (let b = 0; b < buildings.length; b++) expect(c.cls[b]).toBeGreaterThanOrEqual(prev.cls[b]);
      for (let b = 0; b < buildings.length; b++) if (!Number.isNaN(c.depthM[b])) {
        expect(c.cls[b]).toBe(INTERSECTS); expect(c.depthM[b]).toBeGreaterThanOrEqual(0); expect(c.depthM[b]).toBeLessThanOrEqual(level - L0);
      }
      expect(f.touchesEdge).toBe(false);
      prev = c;
    }
    const below = at(858).c, base0 = at(L0).c;
    expect(Array.from(below.cls)).toEqual(Array.from(base0.cls)); // below the baseline the drawn outline is the baseline one
    expect(below.depthM.every((d) => Number.isNaN(d))).toBe(true);
  });
  it("places buildings on the terrain mesh as it is drawn (checked against the mesh triangles in 3D)", () => {
    // Rebuild the triangles around a point exactly as ScenarioScene.buildTerrain does (vertex = centre of every
    // STEP-th cell, quad split a-b-c / a-c-d) and drop a vertical ray on them; no exaggeration, no lift.
    const vert = (r: number, q: number) => Cartesian3.fromDegrees(t.lon(q * STEP + 0.5), t.lat(r * STEP + 0.5), t.z[r * STEP * t.w + q * STEP]);
    let worst = 0, n = 0;
    for (let k = 0; k < buildings.length; k += 97) {
      const b = buildings[k], q = Math.floor((t.col(b.lon) + (b.lon - t.lon(t.col(b.lon))) / (t.lon(1) - t.lon(0)) - 0.5) / STEP);
      const fy = (lat: number) => { const i = t.row(lat); return i + (t.lat(i) - lat) / (t.lat(i) - t.lat(i + 1)); };
      const r = Math.floor((fy(b.lat) - 0.5) / STEP);
      if (q < 0 || r < 0 || (q + 1) * STEP >= t.w || (r + 1) * STEP >= t.h) continue;
      const A = vert(r, q), B = vert(r, q + 1), C = vert(r + 1, q + 1), D = vert(r + 1, q);
      const from = Cartesian3.fromDegrees(b.lon, b.lat, 9000), down = Cartesian3.normalize(Cartesian3.negate(from, new Cartesian3()), new Cartesian3());
      // geodetic "down" at the point (not towards the Earth's centre)
      const up = Cartesian3.subtract(Cartesian3.fromDegrees(b.lon, b.lat, 9001), from, new Cartesian3());
      const ray = new Ray(from, Cartesian3.negate(up, down));
      const hit = IntersectionTests.rayTriangle(ray, A, B, C, false) ?? IntersectionTests.rayTriangle(ray, A, C, D, false);
      expect(hit, `building ${k}`).toBeDefined();
      const d = Math.abs(Cartographic.fromCartesian(hit!).height - drawnSurfaceZ(t, STEP, b.lon, b.lat));
      if (d > worst) worst = d; n++;
    }
    expect(n).toBeGreaterThan(300);
    expect(worst).toBeLessThan(0.05); // metres
  });
  it("prints the counts used in the documentation", () => {
    const rows = [L0, 870, 880, 890, 900, 910].map((level) => { const { c } = at(level); const d = Array.from(c.depthM).filter((x) => !Number.isNaN(x));
      return { level, intersects: c.intersects, near: c.near, outside: c.outside, withDepth: d.length, maxDepth: d.length ? Math.max(...d) : null }; });
    const top = at(910).c, red = buildings.filter((b) => top.cls[b.index] === INTERSECTS);
    const at910 = { osm: red.filter((b) => b.source === 0).length, overture: red.filter((b) => b.source === 1).length, kinds: red.map((b) => meta.kinds[b.kind] || "-").sort().join(",") };
    console.log(JSON.stringify({ total: buildings.length, offGrid: bc.offGrid, rows, at910 }));
    expect(rows[rows.length - 1].intersects).toBeGreaterThanOrEqual(rows[0].intersects);
  });
});
