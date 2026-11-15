import { describe, expect, it } from "vitest";
import { countryAt, decode, GeoStore } from "./store";

// A unit square "country" from (10,10) to (20,20) with a hole (14..16), delta-encoded at q=10.
const ring = (pts: number[][], q: number) => pts.flatMap((p, i) => (i === 0 ? [p[0] * q, p[1] * q] : [(p[0] - pts[i - 1][0]) * q, (p[1] - pts[i - 1][1]) * q]));
const raw = {
  v: 1, q: 10,
  layers: {
    countries: { k: "poly" as const, f: [{ b: [100, 100, 200, 200], n: "Square", lx: 12, ly: 12, lr: 2,
      g: [[ring([[10, 10], [20, 10], [20, 20], [10, 20], [10, 10]], 10), ring([[14, 14], [16, 14], [16, 16], [14, 16], [14, 14]], 10)]] }] },
    rivers: { k: "line" as const, f: [{ b: [0, 0, 50, 50], r: 3, g: [ring([[0, 0], [5, 5]], 10)] }] },
  },
};

describe("eegeo/1 decoding", () => {
  it("decodes delta-encoded coordinates to degrees", () => {
    const set = decode(raw);
    const outer = set.countries!.features[0].parts[0][0];
    expect(Array.from(outer.slice(0, 4))).toEqual([10, 10, 20, 10]);
    expect(set.countries!.features[0].bbox).toEqual([10, 10, 20, 20]);
    expect(set.rivers!.features[0].rank).toBe(3);
    expect(set.countries!.features[0].label).toEqual([12, 12]);
  });
  it("finds countries with even-odd holes", () => {
    const set = decode(raw);
    expect(countryAt(set, 11, 11)?.name).toBe("Square");
    expect(countryAt(set, 15, 15)).toBeUndefined(); // inside the hole
    expect(countryAt(set, 25, 15)).toBeUndefined();
  });
  it("rejects unknown format versions", () => {
    expect(() => decode({ ...raw, v: 2 })).toThrow();
  });
});

describe("chunk selection", () => {
  it("lists only chunks that exist and overlap the rectangle", async () => {
    const files: Record<string, unknown> = {
      "/geo/manifest.json": { chunk_degrees: 15, lod2_chunks: ["16_8", "17_8"], format: "eegeo/1", source: {}, bytes: {}, total_bytes: 0 },
      "/geo/lod0.json": { v: 1, q: 100, layers: {} },
    };
    const store = new GeoStore(async (u) => new Response(JSON.stringify(files[u]), { status: files[u] ? 200 : 404 }));
    await store.ready;
    // Dushanbe area (68-70E, 38-39N) lies in chunk x=(68+180)/15=16, y=(38+90)/15=8.
    expect(store.chunksFor(68, 38, 70, 39)).toEqual(["16_8"]);
    expect(store.chunksFor(60, 30, 80, 40)).toEqual(["16_8", "17_8"]);
    expect(store.chunksFor(-10, -10, 0, 0)).toEqual([]);
  });
});

