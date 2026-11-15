// Earth Interior (X-Ray): the planetary cutaway opens and responds to its controls, a click on the
// opened planet selects a layer, Crust Explorer shows CRUST1.0 values that change with the place,
// and an A–B cross-section is produced. Needs frontend/public/crust1 (science/geo/build_crust1.py).
//   node tests/e2e/earth-interior.mjs http://localhost:8080/     (SHOTS=<dir> also saves screenshots)
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { homedir } from "node:os"; import { join } from "node:path";
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR ?? join(homedir(), ".claude/skills/gstack/browse"), "package.json"))("playwright");
const b = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
try {
  const p = await (await b.newContext({ viewport: { width: 1300, height: 800 }, serviceWorkers: "block" })).newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message.slice(0, 300))); p.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 300)); });
  const shot = async (name) => { if (process.env.SHOTS) await p.screenshot({ path: join(process.env.SHOTS, name + ".png"), clip: { x: 0, y: 50, width: 960, height: 680 } }); };
  const setRange = (label, v) => p.locator(`input[aria-label="${label}"]`).first().evaluate((el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, String(v)); el.dispatchEvent(new Event("input", { bubbles: true })); }, v);
  const tab = (name) => p.getByRole("button", { name, exact: true }).click();
  const scene = () => p.evaluate(() => { const s = window.__ee.viewer.scene; /* shown primitives only: the hidden country-label collection stays in the scene, the globe is not rebuilt */ let shown = 0; for (let i = 0; i < s.primitives.length; i++) if (s.primitives.get(i).show) shown++; return { prims: shown, clipped: !!s.globe.clippingPlanes?.enabled && s.globe.clippingPlanes.length > 0, union: !!s.globe.clippingPlanes?.unionClippingRegions }; });
  await p.goto(process.argv[2] ?? "http://localhost:8080/"); await p.waitForTimeout(6000);
  await p.click('[data-testid="nav-g-discover"]'); await p.click('[data-testid="nav-xray"]');
  await p.waitForTimeout(8000);

  // 1. Cutaway is the first thing shown: 5 layer primitives, globe clipped.
  const open = await scene();
  assert.equal(open.prims, 5); assert.equal(open.clipped, true);
  await shot("cutaway-90");
  await p.mouse.click(480, 390); await p.waitForTimeout(800);            // centre of the opening
  const picked = await p.locator('[data-testid="cutaway-selected"]').textContent();
  assert.equal(picked, "Inner core");
  await setRange("Opening angle", 200); await p.waitForTimeout(1500);
  assert.equal((await scene()).union, true, "an opening wider than 180° must use the union of the clip planes");
  const wide = await scene(); // the click above also added the place marker, so compare counts
  await p.locator('input[aria-label="Show layer"]').nth(3).uncheck(); await p.waitForTimeout(1200);
  assert.equal((await scene()).prims, wide.prims - 1, "hiding a layer removes its geometry");
  await shot("cutaway-200-no-outer-core");
  await p.getByRole("button", { name: "Reset to complete globe", exact: true }).click(); await p.waitForTimeout(3000);
  const closed = await scene();
  assert.equal(closed.clipped, false); assert.equal(closed.prims, wide.prims - 1, "complete globe: all layers back, the crust has no geometry of its own");

  // 2. Crust Explorer: click the globe, read the cell, click elsewhere, values change.
  await tab("Crust Explorer"); await p.waitForTimeout(1500);
  const read = async (x, y) => { await p.evaluate(() => window.__ee.viewer.camera.flyHome(0)); await p.waitForTimeout(1500); await p.mouse.click(x, y); await p.waitForTimeout(5000);
    return { cell: await p.locator('[data-testid="crust-cell"]').textContent(), summary: await p.locator('[data-testid="crust-summary"]').textContent(), rows: await p.locator('[data-testid="crust-table"] tbody tr').count() }; };
  const first = await read(480, 300); await shot("crust-column");
  const second = await read(380, 430);
  assert.notEqual(first.cell, second.cell); assert.notEqual(first.summary, second.summary);
  for (const r of [first, second]) { assert.match(r.summary, /Moho -?\d+\.\d\d km/); assert(r.rows >= 2 && r.rows <= 9); }
  await p.locator('[data-testid="crust-table"] tbody tr').first().click();
  assert.match(await p.locator('[data-testid="crust-details"]').innerText(), /Vp \d+\.\d\d km\/s/);

  // 3. Cross-section between two clicked points.
  await tab("Geological Cross-Section"); await p.waitForTimeout(1000);
  await p.evaluate(() => window.__ee.viewer.camera.flyHome(0)); await p.waitForTimeout(1500);
  await p.mouse.click(420, 330); await p.waitForTimeout(600); await p.getByRole("button", { name: "Set point A", exact: true }).click();
  await p.mouse.click(560, 380); await p.waitForTimeout(600); await p.getByRole("button", { name: "Set point B", exact: true }).click();
  await p.getByRole("button", { name: "Show geological profile", exact: true }).click(); await p.waitForTimeout(5000);
  const section = { a: await p.locator('[data-testid="section-a"]').textContent(), b: await p.locator('[data-testid="section-b"]').textContent(), summary: await p.locator('[data-testid="section-summary"]').textContent(), rects: await p.locator('[data-testid="section-profile"] rect').count() };
  assert.notEqual(section.a, section.b); assert.match(section.summary, /Length \d+ km · \d+ samples · \d+ model cells/); assert(section.rects > 20);
  await shot("cross-section");

  // 4. Leaving the feature restores the ordinary globe.
  await tab("Earthquakes"); await p.waitForTimeout(1500);
  await p.click('[data-testid="nav-g-explore"]'); await p.click('[data-testid="nav-explore"]'); await p.waitForTimeout(4000);
  const after = await p.evaluate(() => { const s = window.__ee.viewer.scene; return { clipped: !!s.globe.clippingPlanes?.enabled && s.globe.clippingPlanes.length > 0, translucent: s.globe.translucency.enabled, sky: s.skyAtmosphere.show }; });
  assert.deepEqual(after, { clipped: false, translucent: false, sky: true });
  assert.deepEqual(errs, []);
  console.log(JSON.stringify({ picked, first, second, section }));
  console.log("PASS");
} finally { await b.close(); }
