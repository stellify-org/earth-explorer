// Earth Explorer performance / offline measurement harness.
//
//   node tests/perf/measure.mjs <url> [--throttle] [--offline-check] [--label name] [--out file.json]
//
// Requires the Playwright package; set PLAYWRIGHT_DIR to a directory containing
// node_modules/playwright (defaults to the gstack browse install on the dev machine).
// Headless Chromium renders WebGL in software (SwiftShader), so FPS numbers are a
// lower bound for a laptop GPU, not a prediction of it.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--")) ?? "http://localhost:8088/";
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const label = opt("--label", "run");
const pwDir = process.env.PLAYWRIGHT_DIR ?? join(homedir(), ".claude/skills/gstack/browse");
const { chromium } = createRequire(join(pwDir, "package.json"))("playwright");

const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: flag("--no-sw") ? "block" : "allow" });
await context.addInitScript(() => localStorage.setItem("ee.advanced", "1")); // Advanced Tools: the full panels this script drives
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("Network.enable");
await cdp.send("Performance.enable");
const mbps = Number(opt("--mbps", flag("--throttle") ? "1" : "0"));
if (mbps > 0) {
  // Throttled link: mbps down, half of it up, 150 ms RTT (CDP emulation).
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (mbps * 1e6) / 8, uploadThroughput: (mbps * 1e6) / 16 });
}

const reqs = new Map();
let phase = "load";
cdp.on("Network.requestWillBeSent", (e) => reqs.set(e.requestId, { url: e.request.url, phase, bytes: 0, status: 0, fromCache: false }));
cdp.on("Network.responseReceived", (e) => { const r = reqs.get(e.requestId); if (r) { r.status = e.response.status; r.fromCache = !!(e.response.fromDiskCache || e.response.fromServiceWorker); } });
cdp.on("Network.loadingFinished", (e) => { const r = reqs.get(e.requestId); if (r) r.bytes = e.encodedDataLength; });
cdp.on("Network.loadingFailed", (e) => { const r = reqs.get(e.requestId); if (r) { r.status = -1; r.error = e.errorText; } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

const host = (u) => { try { return new URL(u).host; } catch { return u.slice(0, 20); } };
function summarise(filter) {
  const list = [...reqs.values()].filter(filter);
  const byHost = {};
  for (const r of list) {
    const h = host(r.url);
    byHost[h] ??= { requests: 0, bytes: 0, failed: 0 };
    byHost[h].requests++; byHost[h].bytes += r.bytes; if (r.status < 0 || r.status >= 400) byHost[h].failed++;
  }
  return { requests: list.length, bytes: list.reduce((s, r) => s + r.bytes, 0), byHost };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitGlobe(timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await page.evaluate(() => window.__ee?.firstGlobeMs ?? null).catch(() => null);
    if (v) return v;
    await sleep(250);
  }
  return null;
}
async function heapMB() {
  const m = await cdp.send("Performance.getMetrics");
  const g = (n) => m.metrics.find((x) => x.name === n)?.value ?? 0;
  return { jsHeapUsedMB: +(g("JSHeapUsedSize") / 1e6).toFixed(1), jsHeapTotalMB: +(g("JSHeapTotalSize") / 1e6).toFixed(1) };
}

const result = { label, url, mbps: mbps || "unthrottled", date: new Date().toISOString() };
const tNav = Date.now();
await page.goto(url, { waitUntil: "load", timeout: 180_000 });
result.loadEventMs = Date.now() - tNav;
result.firstGlobeMs = await waitGlobe(flag("--throttle") ? 180_000 : 60_000);
await sleep(1500);
result.initial = summarise((r) => r.phase === "load");
result.initialJsBytes = [...reqs.values()].filter((r) => r.phase === "load" && /\.js(\?|$)/.test(r.url)).reduce((s, r) => s + r.bytes, 0);
result.memoryAfterLoad = await heapMB();

// Navigation: rotate and zoom for ~8 s, count frames and requests.
phase = "navigate";
const nav = await page.evaluate(async () => {
  const v = window.__ee?.viewer;
  if (!v) return { error: "no viewer hook" };
  let frames = 0;
  const off = v.scene.postRender.addEventListener(() => frames++);
  const t0 = performance.now();
  await new Promise((resolve) => {
    const step = () => {
      const t = performance.now() - t0;
      if (t > 8000) return resolve();
      v.camera.rotateRight(0.004);
      if (t < 4000) v.camera.zoomIn(v.camera.positionCartographic.height * 0.004);
      else v.camera.zoomOut(v.camera.positionCartographic.height * 0.004);
      v.scene.requestRender();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  off();
  return { frames, seconds: (performance.now() - t0) / 1000 };
});
await sleep(2000);
result.navigation = { ...nav, fps: nav.frames ? +(nav.frames / nav.seconds).toFixed(1) : null, ...summarise((r) => r.phase === "navigate") };
result.memoryAfterNavigate = await heapMB();

// Idle: nothing should be downloaded while the camera is still.
phase = "idle";
await sleep(5000);
result.idle = summarise((r) => r.phase === "idle");

if (flag("--vis-timing")) {
  // Time to render the numeric T2M layer: uncached (first request) and cached (revisit).
  phase = "vistiming";
  await page.waitForSelector('[aria-label="Visualisation variable"] option[value="t2m"]', { state: "attached", timeout: 180000 });
  const setDate = (d) => page.evaluate((d) => { const v = document.querySelector('[aria-label="Date"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(v, d); v.dispatchEvent(new Event("input", { bubbles: true })); }, d);
  const until = async (ym, maxMs) => {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      const ok = await page.evaluate((ym) => {
        const f = window.__ee?.vis?.frames;
        const v = window.__ee?.viewer;
        return !!f && !f.loading && f.planet?.h.time === ym && (!v || v.scene.globe.tilesLoaded);
      }, ym).catch(() => false);
      if (ok) return Date.now() - t0;
      await sleep(100);
    }
    return null;
  };
  await setDate("2010-07-15");
  await sleep(300);
  let t0 = Date.now();
  await page.selectOption('[aria-label="Visualisation variable"]', "t2m");
  const uncached = await until("2010-07", 180000);
  await setDate("2011-07-15");
  const uncached2 = await until("2011-07", 180000);
  t0 = Date.now();
  await setDate("2010-07-15");
  const cached = await until("2010-07", 60000);
  result.visTiming = { uncachedFirstMs: uncached, uncachedNextMonthMs: uncached2, cachedRevisitMs: cached,
    requests: summarise((r) => r.phase === "vistiming") };
}

if (flag("--vis")) {
  // Scientific visualisation engine: enable T2M surface heatmap, step through 24 months.
  phase = "vis";
  try {
    await page.waitForSelector('[aria-label="Visualisation variable"] option[value="t2m"]', { state: "attached", timeout: 120000 });
  } catch (e) {
    result.visError = `selector missing; page text: ${(await page.evaluate(() => document.body.innerText.slice(0, 400)))}`;
  }
  await page.selectOption('[aria-label="Visualisation variable"]', "t2m", { timeout: 5000 }).catch(() => {});
  const setDate = (d) => page.evaluate((d) => { const v = document.querySelector('[aria-label="Date"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(v, d); v.dispatchEvent(new Event("input", { bubbles: true })); }, d);
  // A month counts as shown when its numeric frame is decoded and on the globe (not just the label).
  const shownMonth = () => page.evaluate(() => { const f = window.__ee?.vis?.frames; const v = window.__ee?.viewer; return f && !f.loading && f.planet && (!v || v.scene.globe.tilesLoaded) ? f.planet.h.time : null; });
  const heap0 = await heapMB();
  const steps = [];
  for (let k = 0; k < 24; k++) {
    const y = 2000 + Math.floor(k / 12), m = (k % 12) + 1;
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    const t0 = Date.now();
    await setDate(`${ym}-15`);
    let ok = false;
    for (let i = 0; i < 200; i++) { if ((await shownMonth()) === ym) { ok = true; break; } await sleep(100); }
    steps.push({ month: ym, ms: Date.now() - t0, ok });
  }
  await sleep(1500);
  const visReqs = [...reqs.values()].filter((r) => r.phase === "vis" && r.url.includes("/vis/grid"));
  result.vis = {
    months: steps.length, allShown: steps.every((s) => s.ok),
    medianUpdateMs: steps.map((s) => s.ms).sort((a, b) => a - b)[12],
    gridRequests: visReqs.length, gridBytes: visReqs.reduce((a, r) => a + r.bytes, 0),
    bytesPerFrame: visReqs.length ? Math.round(visReqs.reduce((a, r) => a + r.bytes, 0) / visReqs.length) : null,
    heapBeforeMB: heap0.jsHeapUsedMB, heapAfterMB: (await heapMB()).jsHeapUsedMB,
  };
  // Same 24 months again: must come from caches (no new grid downloads).
  phase = "vis2";
  for (const s of steps) { await setDate(`${s.month}-15`); for (let i = 0; i < 100; i++) { if ((await shownMonth()) === s.month) break; await sleep(50); } }
  await sleep(1000);
  const again = [...reqs.values()].filter((r) => r.phase === "vis2" && r.url.includes("/vis/grid"));
  result.vis.repeatGridRequests = again.length;
  result.vis.repeatNetworkBytes = again.filter((r) => !r.fromCache).reduce((a, r) => a + r.bytes, 0);
  result.vis.heapAfterRepeatMB = (await heapMB()).jsHeapUsedMB;
}

if (flag("--flaky")) {
  // Intermittent connectivity: toggle the network every 3 s while flying to a region
  // and requesting a new analysis; the app must keep working and recover.
  phase = "flaky";
  const before = errors.length;
  const fly = page.evaluate(() => {
    const v = window.__ee?.viewer;
    v?.camera.flyTo({ destination: { x: 1972000, y: 5081000, z: 4346000 }, duration: 12 });
  }).catch(() => {});
  let off = false;
  for (let i = 0; i < 8; i++) { off = !off; await context.setOffline(off); await sleep(3000); }
  await context.setOffline(false);
  await fly;
  await sleep(4000);
  const after = await page.evaluate(async () => {
    const r = await fetch("/api/v1/trends?variable=precip&lat=38.56&lon=68.78&start=1981&end=2025").catch(() => null);
    const d = r ? await r.json().catch(() => null) : null;
    return { trendOk: !!d?.result?.trend, tilesLoaded: window.__ee?.viewer?.scene.globe.tilesLoaded ?? null, status: document.querySelector('[role="status"]')?.textContent ?? null };
  });
  result.flaky = { ...after, newConsoleErrors: errors.slice(before, before + 10), ...summarise((r) => r.phase === "flaky") };
}

const TREND = "/api/v1/trends?variable=t2m&lat=38.56&lon=68.78&start=1981&end=2025";
if (flag("--offline-check")) {
  // Online: retrieve one analysis (as a user would), and let the service worker finish installing.
  result.trendOnline = await page.evaluate(async (u) => { const r = await fetch(u); const d = await r.json(); return d.result?.trend?.primary?.slope_per_decade ?? null; }, TREND).catch((e) => String(e));
  result.serviceWorker = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return "unsupported";
    const t0 = performance.now();
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 60000))]);
    return reg ? { active: !!reg.active, controlled: !!navigator.serviceWorker.controller, waitedMs: Math.round(performance.now() - t0) } : "not registered";
  });
  if (result.serviceWorker && !result.serviceWorker.controlled) { await page.reload({ waitUntil: "load" }); await waitGlobe(60000); }
  // Give the precache time to complete.
  await sleep(mbps > 0 ? Math.min(330000, (12e6 * 8) / (mbps * 1e6) * 1000 + 10000) : 8000);
  phase = "offline";
  await context.setOffline(true);
  await page.evaluate(() => { if (window.__ee) delete window.__ee.firstGlobeMs; });
  const t1 = Date.now();
  let reloaded = true;
  try { await page.reload({ waitUntil: "load", timeout: 30_000 }); } catch (e) { reloaded = false; result.offlineReloadError = String(e).slice(0, 200); }
  const g = reloaded ? await waitGlobe(30_000) : null;
  const shot = opt("--shot", null);
  if (shot) await page.screenshot({ path: shot.replace(".png", "-offline.png") }).catch(() => {});
  result.offline = {
    reloaded, firstGlobeMs: g, ms: Date.now() - t1,
    appText: reloaded ? (await page.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => "")) : "",
    trendOffline: reloaded ? await page.evaluate(async (u) => { const r = await fetch(u); const d = await r.json(); return { slope: d.result?.trend?.primary?.slope_per_decade ?? null, swCache: r.headers.get("x-ee-sw-cache") }; }, TREND).catch((e) => String(e)) : null,
    status: reloaded ? await page.evaluate(() => document.querySelector('[role="status"]')?.textContent ?? null).catch(() => null) : null,
    visFrameOffline: reloaded && flag("--vis") ? await page.evaluate(async () => {
      const r = await fetch("/api/v1/vis/grid?var=t2m&month=2000-01&kind=value&lod=planet");
      const b = await r.arrayBuffer();
      return { status: r.status, bytes: b.byteLength, magic: String.fromCharCode(...new Uint8Array(b.slice(0, 4))) };
    }).catch((e) => String(e)) : undefined,
    ...summarise((r) => r.phase === "offline"),
  };
  await context.setOffline(false);
}
const shot = opt("--shot", null);
if (shot && !flag("--offline-check")) await page.screenshot({ path: shot }).catch(() => {});
result.storage = await page.evaluate(async () => { try { const e = await navigator.storage.estimate(); return { usageMB: +(e.usage / 1e6).toFixed(2), quotaMB: Math.round(e.quota / 1e6) }; } catch { return null; } }).catch(() => null);
result.consoleErrors = errors.slice(0, 15);
await browser.close();
const out = opt("--out", null);
if (out) writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
