// Scenario Lab (Nurek Reservoir): the level slider and the water balance must move the water GEOMETRY,
// the numbers shown must match the model, and the scenario must work with the network switched off.
//   node tests/e2e/scenario-lab.mjs http://localhost:8080/     (needs Playwright)   SHOTS=/dir saves screenshots
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { homedir } from "node:os"; import { join } from "node:path";
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR ?? join(homedir(), ".claude/skills/gstack/browse"), "package.json"))("playwright");
const url = process.argv[2] ?? "http://localhost:8080/";
const b = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
try {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); // service worker allowed: the offline part needs it
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push("PAGEERROR " + e.message.slice(0, 300)));
  const shot = async (n) => { if (process.env.SHOTS) await p.screenshot({ path: join(process.env.SHOTS, `scenario-${n}.png`) }); };
  const T = (id) => p.locator(`[data-testid="${id}"]`);
  const setInput = (sel, v) => p.locator(sel).first().evaluate((el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, String(v)); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, v);
  const scene = () => p.evaluate(() => { const s = window.__ee.scenario; return { rendered: s.renderedLevel(), level: s.current.level, newKm2: s.current.newAreaM2 / 1e6, waterPrims: s.waterPrimitiveCount(), below: s.current.belowData, edge: s.current.touchesEdge }; });
  const shownLevel = async () => Number((await T("scenario-level").innerText()).replace(" m", ""));
  const open = async () => { await p.goto(url); await p.waitForFunction(() => !!window.__ee?.viewer?.scene?.globe); await p.waitForTimeout(3000); await T("nav-lab").click(); await T("lab-card-nurek").click(); await T("scenario-panel").waitFor({ timeout: 60_000 }); await p.waitForFunction(() => window.__ee?.scenario?.renderedLevel() !== undefined); await p.waitForTimeout(4000); };
  // Count light-blue ("flooded land") pixels in a real screenshot of the globe area.
  const pixels = async () => { const png = (await p.screenshot({ clip: { x: 0, y: 60, width: 1090, height: 800 } })).toString("base64");
    return p.evaluate(async (png) => { const img = new Image(); img.src = "data:image/png;base64," + png; await img.decode(); const g = document.createElement("canvas"); g.width = img.width; g.height = img.height; const x = g.getContext("2d"); x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, g.width, g.height).data; let light = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 2] > 190 && d[i + 1] > 170 && d[i] < 110) light++; return light; }, png); };

  await open();
  // 1. Baseline: the water is drawn at the level recorded in the elevation data.
  let s = await scene();
  assert.equal(await shownLevel(), 864); assert.ok(Math.abs(s.rendered - 864) < 0.01, "baseline geometry at " + s.rendered);
  assert.equal(s.newKm2, 0); await shot("1-baseline");
  const lightBefore = await pixels();

  // 2. Raise to 900 m: geometry moves, land is flooded, numbers follow the published law.
  await setInput('input[aria-label="Water level"]', 900); await p.waitForTimeout(1500);
  s = await scene();
  assert.ok(Math.abs(s.rendered - 900) < 0.01, "raised geometry at " + s.rendered);
  assert.equal(s.waterPrims, 2, "baseline water and flooded land are two meshes");
  assert.ok(s.newKm2 > 30 && s.newKm2 < 80, "flooded land " + s.newKm2); assert.equal(s.edge, false);
  assert.equal(Number((await T("scenario-newarea").innerText()).replace(" km²", "")).toFixed(1), s.newKm2.toFixed(1), "the area shown is the area drawn");
  const law = (z) => 2.41 * Math.pow(z - 762.7, 1.64); // hm³, the published law, written out again here on purpose
  assert.match(await T("scenario-dv").innerText(), new RegExp("\\+" + Math.round(law(900) - law(864)) + " "), "storage change follows the law");
  const lightAfter = await pixels(); await shot("2-raised-900");
  assert.ok(lightAfter > lightBefore + 200, `flooded land must be visible in the picture (${lightBefore} → ${lightAfter} light-blue pixels)`);

  // 3. Lower to 858 m: water goes down, nothing new is flooded, the missing bed is said plainly.
  await setInput('input[aria-label="Water level"]', 858); await p.waitForTimeout(1500);
  s = await scene();
  assert.ok(Math.abs(s.rendered - 858) < 0.01, "lowered geometry at " + s.rendered); assert.equal(s.below, true); assert.equal(s.newKm2, 0);
  await p.getByText("the lake bed is not in the elevation data", { exact: false }).waitFor(); await shot("3-lowered-858");

  // 4. Reset.
  await T("scenario-reset").click(); await p.waitForTimeout(1500);
  assert.ok(Math.abs((await scene()).rendered - 864) < 0.01); assert.equal(await shownLevel(), 864);

  // 4b. Labels, legend, water-level lines and Before / After.
  await T("scenario-legend").waitFor();
  await setInput('input[aria-label="Water level"]', 890); await p.waitForTimeout(1500);
  const lines = await p.evaluate(() => window.__ee.scenario.shoreCells);
  assert.ok(lines.baseline > 500 && lines.scenario > 500, "both water-level lines are drawn: " + JSON.stringify(lines));
  await T("scenario-before").click(); await p.waitForTimeout(1500);
  assert.ok(Math.abs((await scene()).rendered - 864) < 0.01, "Before shows the baseline water"); assert.equal(await shownLevel(), 890, "the scenario itself is unchanged");
  await shot("3b-before");
  await T("scenario-after").click(); await p.waitForTimeout(1500);
  assert.ok(Math.abs((await scene()).rendered - 890) < 0.01, "After shows the scenario water");
  await T("scenario-tab-compare").click(); assert.match(await T("scenario-compare").innerText(), /864 m\s+890\.0 m/); await shot("3c-compare");
  // Land cover (optional data): the classes of the newly flooded cells add up to the flooded area; most were water in 2021.
  const cover = async () => T("scenario-landcover").locator("tr").evaluateAll((rows) => rows.map((r) => ({ code: Number(r.dataset.class), km2: parseFloat(r.children[1].textContent) })));
  let lc = await cover(); s = await scene();
  assert.ok(lc.length >= 2 && lc[0].code === 80, "largest class of the flooded cells is 'already water in 2021': " + JSON.stringify(lc));
  assert.ok(Math.abs(lc.reduce((a, r) => a + r.km2, 0) - s.newKm2) < 0.005 * lc.length + 0.01, "land-cover rows add up to the flooded area " + s.newKm2);
  await p.getByText("not a forecast of vegetation loss", { exact: false }).waitFor();
  await T("scenario-tab-water").click(); await T("scenario-reset").click(); await p.waitForTimeout(1500);

  // 5. Climate & Water drives the same geometry. Balanced fluxes with no rain/evaporation → no change.
  await T("scenario-tab-climate").click(); await T("scenario-advanced").locator("summary").click();
  await setInput('input[aria-label="Rain on the lake, ×"]', 0); await setInput('input[aria-label="Evaporation, ×"]', 0); await p.waitForTimeout(1200);
  assert.equal(await T("scenario-balance-dv").innerText(), "0.0"); assert.ok(Math.abs((await scene()).rendered - 864) < 0.01);
  // +100 m³/s for 90 days = 100 × 86 400 × 90 m³ = 777.6 million m³; level from the inverse law.
  const inflow = Number(await p.locator('input[aria-label="Inflow, m³/s"]').inputValue());
  await setInput('input[aria-label="Inflow, m³/s"]', inflow + 100); await p.waitForTimeout(1500);
  assert.equal(await T("scenario-balance-dv").innerText(), "+777.6");
  const expected = 762.7 + Math.pow((law(864) + 777.6) / 2.41, 1 / 1.64);
  s = await scene();
  assert.ok(Math.abs(s.rendered - expected) < 0.01, `balance level ${s.rendered} vs ${expected}`); assert.ok(s.newKm2 > 0); await shot("4-balance");
  await setInput('input[aria-label="Inflow, m³/s"]', inflow - 30); await p.waitForTimeout(1500);
  assert.ok((await scene()).rendered < 864, "net outflow lowers the water");
  await p.getByText("Exploratory water-balance model, not an operational hydrological forecast.").waitFor();

  // 5b. Conservation audit: 5000 in, 666 out, 90 days. Net 33.70 km³ arrives, 3.98 km³ fits, the rest is spill.
  await setInput('input[aria-label="Inflow, m³/s"]', 5000); await setInput('input[aria-label="Outflow, m³/s"]', 666); await p.waitForTimeout(1500);
  const net = (5000 - 666) * 86400 * 90 / 1e6, room = law(910) - law(864);     // million m³
  assert.equal(await T("scenario-balance-dv").innerText(), "+" + room.toFixed(1));
  assert.equal(await T("scenario-spill").innerText(), "−" + (net - room).toFixed(1));
  assert.equal(await T("scenario-closure").innerText(), "0");
  s = await scene(); assert.ok(Math.abs(s.rendered - 910) < 0.01, "full reservoir drawn at 910 m, not above: " + s.rendered);
  await p.getByText("Water balance over 90 days", { exact: false }).waitFor(); await shot("4b-spill");
  // The other bound: a release the reservoir cannot sustain.
  await setInput('input[aria-label="Inflow, m³/s"]', 100); await setInput('input[aria-label="Outflow, m³/s"]', 2000); await p.waitForTimeout(1500);
  await T("scenario-shortfall").waitFor(); assert.equal(await T("scenario-closure").innerText(), "0");
  s = await scene(); assert.ok(Math.abs(s.rendered - 857) < 0.01, "never below the minimum operating level: " + s.rendered);

  // 6. Offline: reload with the network off and use the scenario again.
  await p.waitForTimeout(3000); await ctx.setOffline(true);
  await open();
  await setInput('input[aria-label="Water level"]', 910); await p.waitForTimeout(1500);
  s = await scene(); assert.ok(Math.abs(s.rendered - 910) < 0.01, "offline geometry at " + s.rendered);
  const total = await p.evaluate(() => (window.__ee.scenario.current.baselineAreaM2 + window.__ee.scenario.current.newAreaM2) / 1e6);
  await T("scenario-tab-compare").click(); lc = await cover(); await shot("5-offline-910");
  assert.ok(lc.length >= 2 && Math.abs(lc.reduce((a, r) => a + r.km2, 0) - (await scene()).newKm2) < 0.05, "land cover works offline");
  console.log(JSON.stringify({ areaAt910Km2: +total.toFixed(1), balanceLevel: +expected.toFixed(2), lightPixels: [lightBefore, lightAfter], spillMillionM3: +(net - room).toFixed(1), shoreCells: lines, landCoverAt910Km2: Object.fromEntries(lc.map((r) => [r.code, r.km2])) }));
  // Leaving the lab removes its geometry from the shared globe.
  await T("nav-g-explore").click(); await T("nav-explore").click(); await p.waitForTimeout(1500);
  assert.equal(await p.evaluate(() => { let n = 0; const pr = window.__ee.viewer.scene.primitives; for (let i = 0; i < pr.length; i++) if (pr.get(i).show) n++; return n; }), 1, "only the label collection remains");
  console.log("errors:", errs.length); for (const e of errs.slice(0, 4)) console.log(e);
  assert.equal(errs.length, 0); console.log("PASS");
} finally { await b.close(); }
