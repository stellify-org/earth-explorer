// Production service-worker regression: pin warm geography, avoid duplicate science frames,
// retain full pack manifests/metadata and reopen the downloaded data with no connection.
// node tests/e2e/offline-storage.mjs http://localhost:8088/
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR ?? join(homedir(), ".claude/skills/gstack/browse"), "package.json"))("playwright");
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage(); const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.argv[2] ?? "http://localhost:8088/");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  // Warm runtime geography: downloading the pack must still create durable copies.
  await page.evaluate(async () => { for (const u of ["/geo/lod1.json", "/geo/countries.json"]) { const r = await fetch(u); if (!r.ok) throw Error(u); await r.arrayBuffer(); } });
  await page.click('[data-testid="more-menu"]');
  await page.getByRole("button", { name: "Offline data", exact: true }).click();
  const geo = page.locator("li", { hasText: "Geography detail 1:50m + country names" });
  await geo.getByRole("button", { name: "Download", exact: true }).click();
  await geo.getByText("Available offline").waitFor({ timeout: 60_000 });
  const sci = page.locator("li", { hasText: "Global temperature — annual means 1981–2025" });
  await sci.getByRole("button", { name: "Download", exact: true }).click();
  await sci.getByText("Available offline").waitFor({ timeout: 120_000 });
  // Large pack manifests must be kept outside the disposable frame cache too.
  await page.evaluate(async () => { const r = await fetch("/api/v1/packs?id=tajikistan-native"); if (!r.ok) throw Error("manifest unavailable"); await r.json(); });
  await page.waitForFunction(async () => !!await (await caches.open("ee-metadata")).match("/api/v1/packs?id=tajikistan-native", { ignoreVary: true }));
  const stored = await page.evaluate(async () => {
    const geo = await caches.open("ee-geo-packs");
    const keys = await (await caches.open("ee-api")).keys();
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open("earth-explorer", 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const frames = await new Promise((resolve, reject) => { const r = db.transaction("frames").objectStore("frames").getAllKeys(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    db.close();
    // Evict viewed detail from runtime caches (as an app update would); keep the app shell.
    for (const name of await caches.keys()) {
      if (name === "ee-geo-packs") continue;
      const cache = await caches.open(name);
      for (const url of ["/geo/lod1.json", "/geo/countries.json"]) await cache.delete(url);
    }
    return { pinnedGeo: (await geo.keys()).map((r) => new URL(r.url).pathname), frames: frames.length, duplicates: keys.filter((k) => frames.includes(k.url.replace(location.origin, ""))).length };
  });
  assert.equal(stored.frames, 45); assert.equal(stored.duplicates, 0);
  assert.deepEqual(stored.pinnedGeo.sort(), ["/geo/countries.json", "/geo/lod1.json"]);
  await ctx.setOffline(true);
  const offline = await page.evaluate(async () => {
    const urls = ["/geo/lod1.json", "/geo/countries.json", "/api/v1/layers", "/api/v1/packs", "/api/v1/packs?id=tajikistan-native"];
    return Promise.all(urls.map(async (url) => { const r = await fetch(url); await r.arrayBuffer(); return { url, status: r.status }; }));
  });
  assert(offline.every((r) => r.status === 200), JSON.stringify(offline));
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await page.waitForFunction(() => !!window.__ee?.viewer?.scene?.globe);
  await page.click('[data-testid="more-menu"]');
  await page.getByRole("button", { name: "Offline data", exact: true }).click();
  await page.locator("li", { hasText: "Global temperature — annual means 1981–2025" }).getByText("Available offline").waitFor();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ stored, offline }));
  console.log("PASS");
} finally { await browser.close(); }
