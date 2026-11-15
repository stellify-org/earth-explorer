import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cacheStorage } from "./cache.test-utils";

const source = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
function worker() {
  const caches = cacheStorage();
  const fetch = vi.fn(async (_r: Request) => new Response("network"));
  type Event = { request?: Request; waitUntil: (p: Promise<unknown>) => void; respondWith: (p: Promise<Response>) => void };
  const listeners = new Map<string, (e: Event) => void>();
  runInNewContext(source, {
    self: { location: { origin: "https://earth.test" }, addEventListener: (n: string, fn: (e: Event) => void) => listeners.set(n, fn), clients: { claim: async () => {} } },
    caches, fetch, URL, Response, Headers, setTimeout, clearTimeout,
  });
  const dispatch = (type: string, url = "/") => {
    const jobs: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    listeners.get(type)!({ request: new Request(new URL(url, "https://earth.test")), waitUntil: (p) => { jobs.push(p); }, respondWith: (p) => { response = p; } });
    return { response, done: async () => { while (jobs.length) await Promise.all(jobs.splice(0)); } };
  };
  const request = async (url: string) => { const e = dispatch("fetch", url); const r = await e.response!; await e.done(); return r; };
  return { caches, fetch, dispatch, request };
}
afterEach(() => vi.useRealTimers());

describe("service worker offline retention", () => {
  it("migrates analyses and manifests, keeping downloaded packs across upgrades", async () => {
    const w = worker(); const old = await w.caches.open("ee-api");
    await old.put("/api/v1/packs?id=tajikistan-native", new Response("manifest"));
    await old.put("/api/v1/trends?lat=38", new Response("analysis"));
    await old.put("/api/v1/vis/grid?v=1", new Response("grid"));
    await w.caches.open("ee-geo-packs"); await w.caches.open("ee-tile-packs"); await w.caches.open("ee-static-old");
    await w.dispatch("activate").done();
    expect(await (await (await w.caches.open("ee-metadata")).match("/api/v1/packs?id=tajikistan-native"))!.text()).toBe("manifest");
    expect(await (await w.caches.open("ee-results")).match("/api/v1/trends?lat=38")).toBeDefined();
    expect(old.entries.size).toBe(1);
    expect(await w.caches.keys()).toContain("ee-geo-packs");
    expect(await w.caches.keys()).toContain("ee-tile-packs");
    expect(await w.caches.keys()).not.toContain("ee-static-old");
  });
  it("keeps a legacy copy when migration hits quota", async () => {
    const w = worker(); const old = await w.caches.open("ee-api");
    await old.put("/api/v1/layers", new Response("layers"));
    (await w.caches.open("ee-metadata")).failWrites = true;
    await w.dispatch("activate").done();
    expect(await old.match("/api/v1/layers")).toBeDefined();
  });
  it.each(["/api/v1/layers", "/api/v1/packs?id=tajikistan-native", "/api/v1/earthquakes?minmag=5"])("falls back on 503 for %s", async (url) => {
    const w = worker(); await w.request(url);
    w.fetch.mockImplementation(async () => new Response("unavailable", { status: 503 }));
    const r = await w.request(url);
    expect(r.status).toBe(200); expect(r.headers.get("X-EE-SW-Cache")).toBeTruthy(); expect(await r.text()).toBe("network");
  });
  it("does not conceal client errors with stale metadata", async () => {
    const w = worker(); await w.request("/api/v1/packs?id=gone");
    w.fetch.mockImplementation(async () => new Response("removed", { status: 404 }));
    expect((await w.request("/api/v1/packs?id=gone")).status).toBe(404);
  });
  it("uses a cached copy after 3 seconds and safely finishes a late failing refresh", async () => {
    vi.useFakeTimers(); const w = worker(); await w.request("/api/v1/layers");
    let finish!: (r: Response) => void;
    w.fetch.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const e = w.dispatch("fetch", "/api/v1/layers");
    await vi.advanceTimersByTimeAsync(3000);
    const r = await e.response!;
    expect(r.headers.get("X-EE-SW-Cache")).toBeTruthy(); expect(await r.text()).toBe("network");
    finish(new Response("down", { status: 502 })); await e.done();
  });
  it("returns successful downloads even when cache writes fail", async () => {
    const w = worker(); (await w.caches.open("ee-api")).failWrites = true;
    expect(await (await w.request("/api/v1/vis/grid?v=1")).text()).toBe("network");
  });
  it("marks cached versioned frames and avoids repeat network traffic", async () => {
    const w = worker(); await w.request("/api/v1/vis/grid?v=1");
    expect((await w.request("/api/v1/vis/grid?v=1")).headers.get("X-EE-SW-Cache")).toBeTruthy();
    expect(w.fetch).toHaveBeenCalledTimes(1);
  });
  it("trims frame storage without evicting metadata or analyses", async () => {
    const w = worker(); await w.request("/api/v1/layers"); await w.request("/api/v1/trends?lat=38");
    const frames = await w.caches.open("ee-api");
    for (let i = 0; i < 1501; i++) await frames.put(`/api/v1/vis/grid?v=1&month=${i}`, new Response("frame"));
    await w.request("/api/v1/vis/grid?v=1&month=new");
    expect(frames.entries.size).toBeLessThanOrEqual(1500);
    expect(await (await w.caches.open("ee-metadata")).match("/api/v1/layers")).toBeDefined();
    expect(await (await w.caches.open("ee-results")).match("/api/v1/trends?lat=38")).toBeDefined();
  });
  it("scans tile keys twice for 128 writes, rather than after every write", async () => {
    const w = worker();
    for (let i = 0; i < 128; i++) await w.request(`https://s3.amazonaws.com/terrarium/${i}.png`);
    expect((await w.caches.open("ee-tiles")).scans).toBe(2);
  });
  it.each(["/geo/lod1.json#pack", "/api/v1/vis/grid?v=1#pack", "https://s3.amazonaws.com/terrarium/0.png#pack"])("does not duplicate pack downloads: %s", (url) => {
    const w = worker(); expect(w.dispatch("fetch", url).response).toBeUndefined(); expect(w.fetch).not.toHaveBeenCalled();
  });
});
