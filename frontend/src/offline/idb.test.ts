import { afterEach, expect, it, vi } from "vitest";

async function pendingWrite() {
  vi.resetModules();
  const request = { result: "chunk", error: null, onsuccess: null as (() => void) | null, onerror: null as (() => void) | null };
  const transaction = {
    error: null as DOMException | null,
    oncomplete: null as (() => void) | null, onabort: null as (() => void) | null, onerror: null as (() => void) | null,
    objectStore: () => ({ put: () => request }),
  };
  const db = { transaction: vi.fn(() => transaction), close: vi.fn() };
  vi.stubGlobal("indexedDB", { open: () => {
    const open = { result: db, onsuccess: null as (() => void) | null };
    queueMicrotask(() => open.onsuccess!()); return open;
  } });
  const { idb } = await import("./idb");
  const promise = idb.put("frames", "chunk", new ArrayBuffer(1));
  await vi.waitFor(() => expect(db.transaction).toHaveBeenCalled());
  return { request, transaction, promise };
}
afterEach(() => vi.unstubAllGlobals());

it("does not report a stored chunk until its transaction commits", async () => {
  const { request, transaction, promise } = await pendingWrite();
  const done = vi.fn(); void promise.then(done);
  request.onsuccess?.();
  await Promise.resolve(); await Promise.resolve();
  expect(done).not.toHaveBeenCalled();
  transaction.oncomplete!();
  await expect(promise).resolves.toBe("chunk");
});

it("rejects a rolled-back chunk even if its individual request succeeded", async () => {
  const { request, transaction, promise } = await pendingWrite();
  const rejected = expect(promise).rejects.toThrow("quota");
  request.onsuccess?.();
  transaction.error = new DOMException("quota", "QuotaExceededError");
  transaction.onabort!();
  await rejected;
});
