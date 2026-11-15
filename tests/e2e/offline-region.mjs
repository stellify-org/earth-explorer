// Regional offline pack: with the grid API unreachable, a stored regional pack frame must still be shown.
//   node tests/e2e/offline-region.mjs http://localhost:8080/   (needs Playwright; PLAYWRIGHT_DIR like tests/perf)
// Stores ONE verified chunk of the Tajikistan pack (the latest t2m month) in IndexedDB, blocks
// /api/v1/vis/grid, opens the numeric temperature layer over Tajikistan and checks what is drawn.
// PACK=tajikistan-anomalies checks the derived anomaly pack the same way (the Anomaly button is pressed).
import { createRequire } from "node:module"; import { homedir } from "node:os"; import { join } from "node:path";
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR ?? join(homedir(), ".claude/skills/gstack/browse"), "package.json"))("playwright");
const b = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" }); await ctx.addInitScript(() => localStorage.setItem("ee.advanced", "1")); // Advanced Tools: the full panels this check drives
const p = await ctx.newPage();
const PACK = process.env.PACK ?? "tajikistan-native", ANOMALY = PACK.includes("anomal");
const errs = []; p.on("pageerror", (e) => errs.push("PAGEERROR " + e.stack));
await p.goto(process.argv[2] ?? "http://localhost:8080/"); await p.waitForTimeout(6000);
await p.waitForSelector('[aria-label="Visualisation variable"] option[value="t2m"]', { state: "attached" });

const stored = await p.evaluate(async (PACK) => {
  const { packs } = await (await fetch("/api/v1/packs")).json();
  if (!packs.some((x) => x.id === PACK)) return { error: "no such pack in /api/v1/packs: " + PACK + "" };
  const { pack } = await (await fetch("/api/v1/packs?id=" + PACK)).json(); // large manifests are served per pack
  const chunk = pack.chunks.filter((c) => c.url.includes("var=t2m&")).at(-1);
  const buf = await (await fetch(chunk.url)).arrayBuffer();
  const sum = [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map((x) => x.toString(16).padStart(2, "0")).join("");
  if (sum !== chunk.sha256) return { error: "checksum mismatch" };
  const db = await new Promise((res, rej) => { const r = indexedDB.open("earth-explorer", 1); r.onupgradeneeded = () => { for (const n of ["frames", "packs"]) if (!r.result.objectStoreNames.contains(n)) r.result.createObjectStore(n); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  await new Promise((res, rej) => {
    const t = db.transaction(["frames", "packs"], "readwrite");
    t.objectStore("frames").put(buf, chunk.url);
    t.objectStore("packs").put({ id: pack.id, version: pack.version, done: 1, total: pack.chunks.length, bytes: chunk.bytes, complete: false, updated: new Date().toISOString(), bbox: pack.bbox }, pack.id);
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
  return { url: chunk.url, bbox: pack.bbox, chunks: pack.chunks.length, bytes: pack.bytes };
}, PACK);
console.log("stored", JSON.stringify(stored));
if (stored.error) { console.error("FAILED"); await b.close(); process.exit(1); }

await ctx.route("**/api/v1/vis/grid**", (r) => r.abort());            // "offline" for numeric frames
await p.reload(); await p.waitForTimeout(6000);
await p.waitForSelector('[aria-label="Visualisation variable"] option[value="t2m"]', { state: "attached" });
await p.selectOption('[aria-label="Visualisation variable"]', "t2m");
if (ANOMALY) await p.getByRole("button", { name: "Anomaly", exact: true }).click();
// Camera 1,200 km above 71°E, 38.8°N (ECEF, spherical approximation is enough for a view position).
const R = 6371000 + 1200000, la = 38.8 * Math.PI / 180, lo = 71 * Math.PI / 180;
await p.evaluate((d) => window.__ee.viewer.camera.setView({ destination: d }), { x: R * Math.cos(la) * Math.cos(lo), y: R * Math.cos(la) * Math.sin(lo), z: R * Math.sin(la) });
// Wait for the regional frame instead of a fixed pause: under load it took longer than 5 s (2026-11-14).
await p.waitForFunction(() => !!window.__ee?.vis?.frames?.region || !!window.__ee?.vis?.frames?.error, null, { timeout: 30_000 }).catch(() => {});
await p.waitForTimeout(1500);
const got = await p.evaluate(() => {
  const f = window.__ee?.vis?.frames;
  return { planet: !!f?.planet, region: f?.region ? { source: f.region.source, lod: f.region.h.lod, time: f.region.h.time, kind: f.region.h.kind ?? null, nlat: f.region.h.nlat, nlon: f.region.h.nlon, valid: f.region.h.stats.valid } : null,
    error: f?.error ?? null, notice: /Showing only the downloaded regional pack/.test(document.body.innerText), failed: document.body.innerText.match(/view failed: [^\n]*/)?.[0] ?? null };
});
console.log("shown ", JSON.stringify(got));
await p.screenshot({ path: process.env.SHOT ?? "/dev/null" }).catch(() => {});
await b.close();
const ok = !got.planet && got.region?.source === "pack" && got.region.lod === "native subset" && got.region.valid > 0 && (!ANOMALY || got.region.kind === "anomaly") && got.notice && !got.failed && !errs.length;
for (const e of errs.slice(0, 3)) console.log(e.slice(0, 600));
if (!ok) { console.error("FAILED"); process.exit(1); } else console.log("PASS");
