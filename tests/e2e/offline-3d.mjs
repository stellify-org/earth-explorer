// Tajikistan 3D tile pack, end to end with the real service worker:
//   node tests/e2e/offline-3d.mjs http://localhost:8080/   (needs Playwright; PLAYWRIGHT_DIR like tests/perf)
// Downloads the pack through the UI (969 tiles, ~66 MB from AWS Open Data / NASA GIBS), goes fully offline,
// reloads, turns the terrain on above the Pamir at a zoom deeper than the pack and checks that the relief
// has real heights (coarser-tile fallback) and that a Blue Marble tile is served from the pack.
import { createRequire } from "node:module"; import { homedir } from "node:os"; import { join } from "node:path";
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR ?? join(homedir(), ".claude/skills/gstack/browse"), "package.json"))("playwright");
const b = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); await ctx.addInitScript(() => localStorage.setItem("ee.advanced", "1")); // Advanced Tools: the full panels this check drives
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push("PAGEERROR " + e.stack));
p.on("dialog", (d) => d.accept());
const url = process.argv[2] ?? "http://localhost:8080/";
await p.goto(url); await p.waitForTimeout(8000);
await p.reload(); await p.waitForTimeout(6000);                       // now controlled by the service worker
const controlled = await p.evaluate(() => !!navigator.serviceWorker.controller);
console.log("service worker controls the page:", controlled);

const click = (t) => p.evaluate((t) => [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === t)?.click(), t);
await p.click('[data-testid="more-menu"]'); await click("Offline data"); await p.waitForTimeout(3000);
const row = p.locator("li", { hasText: "Tajikistan 3D" });
console.log("pack row:", (await row.locator(".font-mono").first().textContent().catch(() => null)) ?? "NOT LISTED");
await row.getByRole("button", { name: /Download|Resume/ }).click();
const t0 = Date.now();
await row.getByText("Available offline").waitFor({ timeout: 15 * 60_000 });
const stored = await p.evaluate(async () => {
  const c = await caches.open("ee-tile-packs"); const keys = await c.keys(); let bytes = 0;
  for (const k of keys) bytes += (await (await c.match(k)).arrayBuffer()).byteLength;
  const dup = (await (await caches.open("ee-tiles")).keys()).length;
  return { tiles: keys.length, bytes, alsoInTileCache: dup, bm: keys.map((k) => k.url).filter((u) => u.includes("BlueMarble")).at(-1) };
});
console.log(`downloaded in ${Math.round((Date.now() - t0) / 1000)} s:`, JSON.stringify(stored));

await ctx.setOffline(true);
await p.reload(); await p.waitForTimeout(8000);
const bmOffline = await p.evaluate((u) => fetch(u).then((r) => r.ok, () => false), stored.bm);
await click("Terrain (3D relief)"); await p.waitForTimeout(1500);
// 25 km above 72.9°E, 38.6°N (Pamir), looking down at an angle: Cesium asks for DEM zooms beyond 10 here.
const R = 6371000 + 25000, la = 38.6 * Math.PI / 180, lo = 72.9 * Math.PI / 180;
await p.evaluate((d) => window.__ee.viewer.camera.setView({ destination: d, orientation: { heading: 0, pitch: -0.9, roll: 0 } }), { x: R * Math.cos(la) * Math.cos(lo), y: R * Math.cos(la) * Math.sin(lo), z: R * Math.sin(la) });
let got;
for (let i = 0; i < 12; i++) {
  await p.waitForTimeout(5000);
  got = await p.evaluate(() => {
    const v = window.__ee.viewer, pts = [[72.9, 38.6], [72.95, 38.75], [72.8, 38.9], [73.1, 38.8]];
    const hs = pts.map(([lon, lat]) => v.scene.globe.getHeight({ longitude: lon * Math.PI / 180, latitude: lat * Math.PI / 180, height: 0 }));
    return { heights: hs.map((h) => (h === undefined ? null : Math.round(h))), tilesLoaded: v.scene.globe.tilesLoaded, terrainLabel: document.body.innerText.match(/terrain (on|off)[^\n]*/)?.[0] ?? null,
      flat: /Terrain tiles unavailable/.test(document.body.innerText), failed: document.body.innerText.match(/view failed: [^\n]*/)?.[0] ?? null };
  });
  if (got.tilesLoaded) break;
}
console.log("offline:", JSON.stringify({ blueMarbleTileFromPack: bmOffline, ...got }));
await p.screenshot({ path: process.env.SHOT ?? "/dev/null" }).catch(() => {});
await b.close();
for (const e of errs.slice(0, 3)) console.log(e.slice(0, 600));
const hs = (got.heights ?? []).filter((h) => h !== null);
// MERRA/SRTM-independent sanity bound: this part of the Pamir lies well above 2,000 m; and real relief is not flat.
const ok = controlled && stored.tiles === 969 && bmOffline && hs.length >= 3 && Math.min(...hs) > 2000 && Math.max(...hs) - Math.min(...hs) > 50 && !got.flat && !got.failed && !errs.length;
if (!ok) { console.error("FAILED"); process.exit(1); } else console.log("PASS");
