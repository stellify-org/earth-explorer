// Scenario Lab — "Show Buildings": real footprints must appear in the 3D scene near the camera, be coloured from
// the same flood mask the water is drawn from, change class with the water level, be inspectable by a click,
// and work with the network switched off.
//   node tests/e2e/scenario-buildings.mjs http://localhost:8080/     (needs Playwright)   SHOTS=/dir saves screenshots
//   SKIP_OFFLINE=1 skips the offline reload (for the Vite dev server, which has no service worker)
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { homedir } from "node:os"; import { join } from "node:path";
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR ?? join(homedir(), ".claude/skills/gstack/browse"), "package.json"))("playwright");
const url = process.argv[2] ?? "http://localhost:8080/";
const b = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
try {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push("PAGEERROR " + e.message.slice(0, 300)));
  const shot = async (n) => { if (process.env.SHOTS) await p.screenshot({ path: join(process.env.SHOTS, `buildings-${n}.png`) }); };
  const T = (id) => p.locator(`[data-testid="${id}"]`);
  const num = async (id) => Number((await T(id).innerText()).replace(/,/g, ""));
  const setInput = (sel, v) => p.locator(sel).first().evaluate((el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, String(v)); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, v);
  const open = async () => { await p.goto(url); await p.waitForFunction(() => !!window.__ee?.viewer?.scene?.globe); await p.waitForTimeout(3000); await T("nav-lab").click(); await T("lab-card-nurek").click(); await T("scenario-panel").waitFor({ timeout: 60_000 }); await p.waitForFunction(() => window.__ee?.scenario?.renderedLevel() !== undefined); await p.waitForTimeout(4000); };
  const primitives = () => p.evaluate(() => { let n = 0; const pr = window.__ee.viewer.scene.primitives; for (let i = 0; i < pr.length; i++) if (pr.get(i).show) n++; return n; });
  // Counts recomputed in the page from the flood mask of the scene (the cells the water mesh is built from).
  const fromMask = () => p.evaluate(() => { const L = window.__ee.buildings, mask = window.__ee.scenario.current.mask, c = L.cells; let red = 0, yellow = 0;
    for (let k = 0; k < c.offsets.length - 1; k++) { let over = false, near = false; for (let i = c.offsets[k]; i < c.offsets[k + 1]; i++) if (mask[c.cell[i]]) { if (c.dist[i] === 0) over = true; else near = true; } if (over) red++; else if (near) yellow++; }
    return { red, yellow, total: c.offsets.length - 1, level: window.__ee.scenario.current.level, shownTiles: L.tilesShown(), shown: L.buildingsShown(), drawn: L.drawnCounts(), tiles: L.tiles.length }; });
  const flying = () => p.waitForTimeout(3500);
  // Red pixels of the "overlaps" colour in a screenshot of the globe area (right of the legend, which has a red swatch).
  const redPixels = async () => { const png = (await p.screenshot({ clip: { x: 280, y: 60, width: 810, height: 760 } })).toString("base64");
    return p.evaluate(async (png) => { const img = new Image(); img.src = "data:image/png;base64," + png; await img.decode(); const g = document.createElement("canvas"); g.width = img.width; g.height = img.height; const x = g.getContext("2d"); x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, g.width, g.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 110 && d[i + 2] < 110) n++; return n; }, png); };

  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem("t")) { localStorage.removeItem("ee.lab.buildings"); sessionStorage.setItem("t", "1"); } } catch { /* ignore */ } });
  await open();
  const meta = await (await ctx.request.get(new URL("scenario/nurek_buildings.json", url).href)).json();
  const before = await primitives();

  // 1. Off by default: nothing is downloaded or drawn. On: the summary shows the pack's numbers.
  assert.equal(await T("buildings-summary").count(), 0); assert.equal(await p.evaluate(() => !!window.__ee.buildings), false);
  await T("buildings-toggle").check(); await T("buildings-summary").waitFor({ timeout: 60_000 }); await p.waitForTimeout(1500);
  assert.equal(await num("buildings-total"), meta.count); assert.equal(await num("buildings-noheight"), meta.height_tags.none);
  let m = await fromMask();
  assert.equal(m.total, meta.count); assert.equal(m.level, 864);
  assert.equal(await num("buildings-intersect"), m.red); assert.equal(await num("buildings-near"), m.yellow);
  assert.equal(await num("buildings-outside"), meta.count - m.red - m.yellow);
  const base = { red: m.red, yellow: m.yellow };
  // From the overview (about 52 km away) no building tile is close enough to be drawn.
  assert.equal(m.shown, 0, "no tiles drawn from the overview: " + JSON.stringify(m)); await T("buildings-legend").waitFor(); await shot("1-overview");

  // 2. Camera: fly to the densest group — tiles near the camera are drawn, far ones are not.
  await T("buildings-fly-dense").click(); await flying();
  m = await fromMask();
  assert.ok(m.shownTiles > 0 && m.shownTiles < m.tiles, `only tiles near the camera are drawn: ${m.shownTiles} of ${m.tiles}`);
  assert.ok(m.shown > 500 && m.shown < meta.count, "buildings drawn near the camera: " + m.shown);
  assert.equal(m.drawn[0] + m.drawn[1] + m.drawn[2], m.shown); await shot("2-dense");
  const denseShown = m.shown;

  // 3. Raise the water to 910 m: classes change, numbers equal the recount from the scene's flood mask.
  await setInput('input[aria-label="Water level"]', 910); await p.waitForTimeout(2500);
  m = await fromMask();
  assert.equal(m.level, 910);
  assert.equal(await num("buildings-intersect"), m.red); assert.equal(await num("buildings-near"), m.yellow);
  assert.ok(m.red > base.red, `more footprints overlap the water at 910 m (${base.red} → ${m.red})`);
  // The pack of 2026-11-14 (sha256 870a… may differ after a rebuild): 0 / 4 at the baseline, 12 / 27 at 910 m.
  if (meta.count === 33553) { assert.deepEqual(base, { red: 0, yellow: 4 }); assert.deepEqual({ red: m.red, yellow: m.yellow }, { red: 12, yellow: 27 }); }

  // 4. Go to a building at the water: it is drawn red, a click on it opens the inspector.
  await T("buildings-fly-water").click(); await flying();
  await T("building-info").waitFor(); assert.equal(await T("building-class").getAttribute("data-class"), "2");
  const picked = await p.evaluate(() => window.__ee.buildings.selected);
  m = await fromMask();
  assert.ok(m.drawn[2] >= 1, "a red building is in a drawn tile: " + JSON.stringify(m.drawn));
  assert.notEqual(m.shown, denseShown, "another set of tiles is drawn after the camera moved");
  assert.match(await T("building-depth").innerText(), /≈ \d+ m|not available/);
  assert.match(await T("building-height").innerText(), /not mapped|m/);
  await p.waitForFunction(() => document.querySelector('[data-testid="building-id"]')?.textContent !== "—", null, { timeout: 30_000 });
  assert.match(await T("building-id").innerText(), /^(way|relation)\/\d+$|^[0-9a-f-]{36}$/);
  const withSelection = await redPixels(); await shot("3-red-selected");
  // Click away is not possible on the globe, so close the card, then click the building itself.
  await T("building-info").locator("button").first().click(); await p.waitForTimeout(800);
  assert.equal(await T("building-info").count(), 0);
  const red = await redPixels();
  assert.ok(red > 20, `red is visible in the picture (${red} px; ${withSelection} with the building selected)`);
  const pos = await p.evaluate((i) => { const w = window.__ee.buildings.windowPosition(i), r = window.__ee.viewer.scene.canvas.getBoundingClientRect(); return w && { x: w.x + r.left, y: w.y + r.top }; }, picked);
  assert.ok(pos, "the building is on screen");
  await p.mouse.click(pos.x, pos.y); await T("building-info").waitFor({ timeout: 10_000 });
  assert.equal(await p.evaluate(() => window.__ee.buildings.selected), picked, "the click picked the building under the cursor");

  // 5. Back to the baseline: the same building is no longer red, and the picture follows.
  await setInput('input[aria-label="Water level"]', 864); await p.waitForTimeout(2500);
  assert.notEqual(await T("building-class").getAttribute("data-class"), "2");
  m = await fromMask();
  assert.equal(await num("buildings-intersect"), base.red); assert.equal(m.red, base.red); assert.equal(m.drawn[2], 0, "nothing is drawn red at the baseline");
  await T("building-info").locator("button").first().click(); await p.waitForTimeout(800);
  if (base.red === 0) assert.ok((await redPixels()) < 20, "no red left in the picture");
  await shot("4-baseline-again");

  // 6. Before / After: the picture shows the baseline water, the numbers stay the scenario's.
  await setInput('input[aria-label="Water level"]', 910); await p.waitForTimeout(2500);
  const at910 = await num("buildings-intersect");
  await T("scenario-before").click(); await p.waitForTimeout(2000);
  assert.equal(await num("buildings-intersect"), at910); assert.equal(await p.evaluate(() => window.__ee.buildings.current.intersects), base.red);
  await T("scenario-after").click(); await p.waitForTimeout(2000);
  assert.equal(await p.evaluate(() => window.__ee.buildings.current.intersects), at910);
  await p.getByText("not an estimate of damage, casualties or financial loss", { exact: false }).waitFor();

  // 7. Offline: reload with the network off; the switch is remembered and the pack comes from local storage.
  if (!process.env.SKIP_OFFLINE) {
    await p.waitForTimeout(3000); await ctx.setOffline(true);
    await open(); await T("buildings-summary").waitFor({ timeout: 60_000 });
    assert.equal(await num("buildings-total"), meta.count);
    await setInput('input[aria-label="Water level"]', 910); await p.waitForTimeout(2500);
    assert.equal(await num("buildings-intersect"), at910); await shot("5-offline");
    await ctx.setOffline(false);
  }

  // 8. Off again: every building primitive leaves the scene; the rest of the lab is untouched.
  await T("buildings-toggle").uncheck(); await p.waitForTimeout(1500);
  assert.equal(await p.evaluate(() => !!window.__ee.buildings), false);
  await T("scenario-tab-water").click(); await T("scenario-reset").click(); await p.waitForTimeout(2500);
  assert.equal(await primitives(), before, "the scene has the same primitives as before the buildings were shown");
  console.log(JSON.stringify({ total: meta.count, baseline: base, at910: { red: at910 }, tiles: m.tiles, shownNearDenseGroup: denseShown, redPixels: red }));
  console.log("errors:", errs.length); for (const e of errs.slice(0, 4)) console.log(e);
  assert.equal(errs.length, 0); console.log("PASS");
} finally { await b.close(); }
