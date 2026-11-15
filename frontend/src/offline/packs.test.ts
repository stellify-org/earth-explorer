import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { cacheStorage } from "./cache.test-utils";
import { downloadPack, type Pack } from "./packs";
import { idb } from "./idb";

vi.mock("./idb", () => ({ idb: { has: vi.fn(async () => false), put: vi.fn(async () => {}), del: vi.fn() }, invalidatePackRegions: vi.fn() }));
const body = '{"test":"geography fixture"}';
const chunk = { url: "/geo/lod1.json", bytes: body.length, sha256: createHash("sha256").update(body).digest("hex") };
const pack = { id: "test", version: "1", kind: "geography", chunks: [chunk] } as Pack;
const options = () => ({ concurrency: 1, signal: new AbortController().signal, onProgress: vi.fn() });
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

it("pins already viewed geography without fetching it again", async () => {
  const caches = cacheStorage(); const fetch = vi.fn();
  vi.stubGlobal("caches", caches); vi.stubGlobal("fetch", fetch);
  await (await caches.open("ee-geo-old")).put(chunk.url, new Response(body));
  await downloadPack(pack, options());
  await caches.delete("ee-geo-old");
  expect(fetch).not.toHaveBeenCalled();
  expect(await (await (await caches.open("ee-geo-packs")).match(chunk.url))!.text()).toBe(body);
});

it("rejects a stale runtime copy and fetches the checksummed pack version", async () => {
  const caches = cacheStorage(); const fetch = vi.fn(async () => new Response(body));
  vi.stubGlobal("caches", caches); vi.stubGlobal("fetch", fetch);
  await (await caches.open("ee-geo-old")).put(chunk.url, new Response("outdated geography"));
  await downloadPack(pack, options());
  expect(fetch).toHaveBeenCalledWith(`${chunk.url}#pack`, expect.anything());
  expect(await (await (await caches.open("ee-geo-packs")).match(chunk.url))!.text()).toBe(body);
});

it("downloads science through the bypass URL and stores the canonical URL in IndexedDB", async () => {
  const fetch = vi.fn(async () => new Response(body));
  vi.stubGlobal("caches", cacheStorage()); vi.stubGlobal("fetch", fetch);
  const url = "/api/v1/vis/grid?var=t2m&v=test";
  await downloadPack({ ...pack, kind: "science", chunks: [{ ...chunk, url }] }, options());
  expect(fetch).toHaveBeenCalledWith(`${url}#pack`, expect.anything());
  expect(idb.put).toHaveBeenCalledWith("frames", url, expect.any(ArrayBuffer));
});
