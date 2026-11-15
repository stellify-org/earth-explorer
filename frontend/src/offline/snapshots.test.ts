import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cacheStorage } from "./cache.test-utils";
import { deleteSnapshot, listSnapshots, readSnapshot, saveSnapshot, SNAPSHOTS } from "./snapshots";
import { api } from "../api/client";

const params = { variable: "T2M", lat: 38.56, lon: 68.77, start: 1981, end: 2025 };
const data = { provenance: { retrieved_at: "2026-11-05T10:00:00Z" }, series: [1.123456789, 2.5] };
let caches: ReturnType<typeof cacheStorage>;
beforeEach(() => { caches = cacheStorage(); vi.stubGlobal("caches", caches); });
afterEach(() => vi.unstubAllGlobals());

it("stores the exact response under the URL the API client requests", async () => {
  const record = await saveSnapshot("/trends", params, data, "Temperature", "trend");
  expect(record.url).toBe("/api/v1/trends?variable=T2M&lat=38.56&lon=68.77&start=1981&end=2025");
  expect(await (await readSnapshot(record.url))!.json()).toEqual(data);
  expect(await listSnapshots()).toEqual([record]);
  await deleteSnapshot(record.url);
  expect(await readSnapshot(record.url)).toBeUndefined();
});

it("refuses a snapshot whose body no longer matches its checksum", async () => {
  const record = await saveSnapshot("/trends", params, data, "Temperature", "trend");
  const stored = (await (await caches.open(SNAPSHOTS)).match(record.url))!;
  await (await caches.open(SNAPSHOTS)).put(record.url, new Response('{"series":[9]}', { headers: stored.headers }));
  expect(await readSnapshot(record.url)).toBeUndefined();
});

it("serves the snapshot when the network fails or the server answers 5xx, but prefers a live answer", async () => {
  await saveSnapshot("/trends", params, data, "Temperature", "trend");
  vi.stubGlobal("navigator", { onLine: true });
  const call = () => api.trends({ ...params } as never);

  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
  expect(await call()).toEqual(data);

  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 504 })));
  expect(await call()).toEqual(data);

  const live = { ...data, series: [3] };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(live), { status: 200 })));
  expect(await call()).toEqual(live);

  const offlineFetch = vi.fn();
  vi.stubGlobal("navigator", { onLine: false }); vi.stubGlobal("fetch", offlineFetch);
  expect(await call()).toEqual(data);
  expect(offlineFetch).not.toHaveBeenCalled();
});
