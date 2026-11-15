// Scenario Lab — Aral Sea: observed yearly water maps (no model). The year control must change the map that is
// drawn, the areas shown must be the pack's, two years can be compared, and it works offline after the first visit.
//   node tests/e2e/scenario-aral.mjs http://localhost:8088/     (needs Playwright)   SHOTS=/dir   SKIP_OFFLINE=1
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { homedir } from "node:os"; import { join } from "node:path";
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR ?? join(homedir(), ".claude/skills/gstack/browse"), "package.json"))("playwright");
const url = process.argv[2] ?? "http://localhost:8088/";
const b = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
try {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push("PAGEERROR " + e.message.slice(0, 300)));
  const shot = async (n) => { if (process.env.SHOTS) await p.screenshot({ path: join(process.env.SHOTS, `aral-${n}.png`) }); };
  const T = (id) => p.locator(`[data-testid="${id}"]`);
  const num = async (id) => Number((await T(id).innerText()).replace(/,/g, "").replace(/ km².*/, ""));
  const setInput = (sel, v) => p.locator(sel).first().evaluate((el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, String(v)); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, v);
  const open = async () => { await p.goto(url); await p.waitForFunction(() => !!window.__ee?.viewer?.scene?.globe); await p.waitForTimeout(3000); await T("nav-lab").click(); await T("lab-card-aral").click(); await T("aral-panel").waitFor({ timeout: 60_000 }); await p.waitForFunction(() => !!window.__ee?.aral?.year); await p.waitForTimeout(4500); };
  const drawn = () => p.evaluate(() => ({ year: window.__ee.aral.year, ref: window.__ee.aral.ref, ...window.__ee.aral.drawn }));
  const lookAt = () => p.evaluate(() => { const v = window.__ee.viewer, c = v.scene.canvas, pos = v.camera.pickEllipsoid({ x: c.clientWidth / 2, y: c.clientHeight / 2 }); if (!pos) return null; const g = v.scene.globe.ellipsoid.cartesianToCartographic(pos); return { lat: g.latitude * 180 / Math.PI, lon: g.longitude * 180 / Math.PI }; });
  // Pixels of the "dry since the reference year" sand colour and of the water blue in the globe area.
  const pixels = async () => { const png = (await p.screenshot({ clip: { x: 0, y: 60, width: 1090, height: 800 } })).toString("base64");
    return p.evaluate(async (png) => { const img = new Image(); img.src = "data:image/png;base64," + png; await img.decode(); const g = document.createElement("canvas"); g.width = img.width; g.height = img.height; const x = g.getContext("2d"); x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, g.width, g.height).data; let blue = 0, sand = 0; for (let i = 0; i < d.length; i += 4) { if (Math.abs(d[i] - 37) < 12 && Math.abs(d[i + 1] - 99) < 12 && Math.abs(d[i + 2] - 235) < 12) blue++; if (Math.abs(d[i] - 222) < 12 && Math.abs(d[i + 1] - 184) < 12 && Math.abs(d[i + 2] - 135) < 12) sand++; } return { blue, sand }; }, png); };

  await open();
  const meta = await (await ctx.request.get(new URL("scenario/aral.json", url).href)).json();
  const Y = meta.years, last = Y.length - 1;
  const g = await lookAt(); assert.ok(g && g.lon > 57.5 && g.lon < 62.5 && g.lat > 43 && g.lat < 47.5, "camera looks at the Aral Sea: " + JSON.stringify(g));
  // 1. First year: the map of that year, its area from the pack, nothing "dried" yet.
  let d = await drawn();
  assert.equal(d.year, Y[0]); assert.equal(await T("aral-year").innerText(), String(Y[0]));
  assert.equal(await num("aral-area"), Math.round(meta.areas[0].all.permanent_km2)); assert.equal(d[2], 0);
  const first = await pixels(); assert.ok(first.blue > 5000, "the sea is visible: " + JSON.stringify(first)); await shot("1-first-year");
  // 2. Last year compared with the first: far less water drawn, the dried sea bed appears, numbers are the pack's.
  await setInput('input[aria-label="Year"]', last); await p.waitForTimeout(1500);
  const d2 = await drawn();
  assert.equal(d2.year, Y[last]); assert.ok(d2[1] + d2[4] < d[1] / 4, `less water drawn (${d[1]} → ${d2[1] + d2[4]} blocks)`); assert.ok(d2[2] > d2[1] * 3, "dried sea bed drawn: " + JSON.stringify(d2));
  assert.equal(await num("aral-all"), Math.round(meta.areas[last].all.permanent_km2));
  assert.equal(await num("aral-north"), Math.round(meta.areas[last].north.permanent_km2)); assert.equal(await num("aral-south"), Math.round(meta.areas[last].south.permanent_km2));
  const change = Math.round(Math.abs(meta.areas[last].all.permanent_km2 - meta.areas[0].all.permanent_km2)).toLocaleString("en-US");
  assert.ok((await T("aral-change").innerText()).includes("−" + change + " km²"), "change " + (await T("aral-change").innerText()));
  const lastPx = await pixels(); assert.ok(lastPx.blue < first.blue / 3 && lastPx.sand > lastPx.blue * 2, "picture follows: " + JSON.stringify(lastPx)); await shot("2-last-year");
  // 3. Compare two chosen years.
  await T("aral-ref").selectOption(String(3)); await p.waitForTimeout(1200);
  const d3 = await drawn(); assert.equal(d3.ref, Y[3]); assert.ok(d3[2] < d2[2], "a later reference year leaves less dried area");
  assert.ok((await T("aral-table").innerText()).includes(String(Y[3])));
  // 4. Play runs through the years and stops at the last one.
  await T("aral-ref").selectOption("0"); await setInput('input[aria-label="Year"]', last - 2); await T("aral-play").click();
  await p.waitForFunction((y) => window.__ee.aral.year === y, Y[last], { timeout: 15_000 }); await p.waitForTimeout(1500);
  assert.equal(await T("aral-year").innerText(), String(Y[last]));
  // 5. Honest limits: no forecast, no water balance, last year named.
  const limits = await T("aral-limits").innerText();
  assert.ok(limits.includes("2021") && limits.includes("No water-balance experiment"), limits.slice(0, 200));
  assert.equal(await p.locator('input[aria-label="Water level"]').count(), 0, "no level control where there is no level data");
  await p.getByText("Pekel", { exact: false }).first().waitFor({ state: "attached" });
  // 6. Offline.
  if (!process.env.SKIP_OFFLINE) {
    await p.waitForTimeout(3000); await ctx.setOffline(true); await open();
    await setInput('input[aria-label="Year"]', last); await p.waitForTimeout(1500);
    assert.equal(await num("aral-all"), Math.round(meta.areas[last].all.permanent_km2)); assert.equal((await drawn()).year, Y[last]); await shot("3-offline");
    await ctx.setOffline(false);
  }
  await T("lab-back").click(); await T("lab-home").waitFor(); assert.equal(await p.evaluate(() => !!window.__ee.aral), false);
  console.log(JSON.stringify({ years: Y, km2: meta.areas.map((a) => Math.round(a.all.permanent_km2)), blocksFirst: d[1], blocksLast: d2[1] + d2[4], pixels: [first, lastPx] }));
  console.log("errors:", errs.length); for (const e of errs.slice(0, 4)) console.log(e);
  assert.equal(errs.length, 0); console.log("PASS");
} finally { await b.close(); }
