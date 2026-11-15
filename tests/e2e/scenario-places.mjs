// Scenario Lab — several places from one engine. For every place: the selector card opens it, the camera goes to the
// right spot, the terrain is that place's, the controls move the water geometry, numbers are consistent with the
// place's own data pack, missing data are said plainly, and it works offline after the first visit.
//   node tests/e2e/scenario-places.mjs http://localhost:8080/     (needs Playwright)   SHOTS=/dir saves screenshots
//   SKIP_OFFLINE=1 skips the offline part (Vite dev server has no service worker)
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { homedir } from "node:os"; import { join } from "node:path";
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR ?? join(homedir(), ".claude/skills/gstack/browse"), "package.json"))("playwright");
const url = process.argv[2] ?? "http://localhost:8080/";
const b = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
try {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push("PAGEERROR " + e.message.slice(0, 300)));
  const requested = []; p.on("request", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/scenario/")) requested.push(u.pathname.slice(10)); });
  const shot = async (n) => { if (process.env.SHOTS) await p.screenshot({ path: join(process.env.SHOTS, `places-${n}.png`) }); };
  const T = (id) => p.locator(`[data-testid="${id}"]`);
  const setInput = (sel, v) => p.locator(sel).first().evaluate((el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, String(v)); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, v);
  const scene = () => p.evaluate(() => { const s = window.__ee.scenario; return { rendered: s.renderedLevel(), level: s.current.level, newKm2: s.current.newAreaM2 / 1e6, baseKm2: s.current.baselineAreaM2 / 1e6, volHm3: s.current.volumeAboveBaselineM3 / 1e6, below: s.current.belowData, edge: s.current.touchesEdge, outline: s.outlineCells, exaggeration: s.exaggeration, w: s.t.w, h: s.t.h }; });
  // Where the camera looks: the ground point under the screen centre of the globe, on the ellipsoid.
  const lookAt = () => p.evaluate(() => { const v = window.__ee.viewer, c = v.scene.canvas, pos = v.camera.pickEllipsoid({ x: c.clientWidth / 2, y: c.clientHeight / 2 }); if (!pos) return null; const g = v.scene.globe.ellipsoid.cartesianToCartographic(pos); return { lat: g.latitude * 180 / Math.PI, lon: g.longitude * 180 / Math.PI, camKm: v.camera.positionCartographic.height / 1000 }; });
  const start = async () => { await p.goto(url); await p.waitForFunction(() => !!window.__ee?.viewer?.scene?.globe); await p.waitForTimeout(3000); await T("nav-lab").click(); await T("lab-home").waitFor(); };
  const openPlace = async (id) => { await T(`lab-card-${id}`).click(); await T("scenario-panel").waitFor({ timeout: 60_000 }); await p.waitForFunction(() => window.__ee?.scenario?.renderedLevel() !== undefined); await p.waitForTimeout(5000); };
  const pack = async (id) => (await ctx.request.get(new URL(`scenario/${id}.json`, url).href)).json();
  const inBox = (g, m, tile = 256) => { const n = 2 ** m.grid.zoom * tile, lon = (x) => x / n * 360 - 180, lat = (y) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
    return g && g.lon > lon(m.grid.x0) && g.lon < lon(m.grid.x0 + m.grid.width) && g.lat > lat(m.grid.y0 + m.grid.height) && g.lat < lat(m.grid.y0); };

  // 0. The selector: three cards, nothing of any place downloaded yet.
  await start();
  for (const id of ["nurek", "kayrakkum", "sarez"]) await T(`lab-card-${id}`).waitFor();
  assert.equal(await p.evaluate(() => !!window.__ee.scenario), false);
  assert.deepEqual(requested, [], "no data pack is requested before a place is chosen"); await shot("0-selector");
  await p.getByText("What happens when less water enters a reservoir?").waitFor();

  // ---------------------------------------------------------------- A. Bahri Tojik (Kayrakkum)
  const K = await pack("kayrakkum"); requested.length = 0;
  await openPlace("kayrakkum");
  assert.ok(requested.every((f) => f.startsWith("kayrakkum")), "only this place's files are loaded: " + requested.join(","));
  let s = await scene(), g = await lookAt();
  assert.ok(inBox(g, K), "camera looks at the reservoir: " + JSON.stringify(g));
  assert.equal(s.w, K.grid.width); assert.equal(s.h, K.grid.height);
  assert.ok(Math.abs(s.rendered - 345) < 0.01, "baseline water at the level recorded in the elevation data: " + s.rendered);
  assert.ok(Math.abs(s.baseKm2 - K.dem_water.area_km2) < 0.5, `water area ${s.baseKm2} vs pack ${K.dem_water.area_km2}`);
  assert.ok(s.outline > 500, "OpenStreetMap outline drawn: " + s.outline); await shot("A1-kayrakkum");
  // raise to the full level: geometry follows, land floods, the straight-line storage change is 2300 × 2.5 / 6.9
  await setInput('input[aria-label="Water level"]', 347.5); await p.waitForTimeout(2000);
  s = await scene();
  assert.ok(Math.abs(s.rendered - 347.5) < 0.01); assert.ok(s.newKm2 > 20 && s.newKm2 < 80, "newly flooded " + s.newKm2); assert.equal(s.edge, false);
  const line = 2300 * 2.5 / 6.9;
  assert.match(await T("scenario-dv").innerText(), new RegExp("≈ \\+" + Math.round(line) + " "), "approximate storage change " + (await T("scenario-dv").innerText()));
  assert.equal(Number((await T("scenario-newarea").innerText()).replace(" km²", "")).toFixed(1), s.newKm2.toFixed(1));
  await p.getByText("No level–volume curve was found for this reservoir", { exact: false }).waitFor(); await shot("A2-full");
  // lower: no shoreline is invented below the recorded surface
  await setInput('input[aria-label="Water level"]', 341); await p.waitForTimeout(2000);
  s = await scene(); assert.ok(Math.abs(s.rendered - 341) < 0.01); assert.equal(s.below, true); assert.equal(s.newKm2, 0);
  await p.getByText("the land that would fall dry cannot be drawn", { exact: false }).waitFor(); await shot("A3-low");
  await T("scenario-reset").click(); await p.waitForTimeout(1500);
  // drought experiment: 100 m³/s less inflow than outflow for 60 days, no rain, no evaporation → −518.4 million m³, −1.555 m
  await T("scenario-tab-climate").click(); await T("scenario-advanced").locator("summary").click();
  await setInput('input[aria-label="Rain on the lake, ×"]', 0);
  assert.equal(await p.locator('input[aria-label="Evaporation, mm per year"]').inputValue(), "0", "evaporation is a user input that starts at 0");
  const inflow = Number(await p.locator('input[aria-label="Inflow, m³/s"]').inputValue()); assert.equal(inflow, K.published.mean_inflow_m3s.value);
  await setInput('input[aria-label="Duration, days"]', 60); await setInput('input[aria-label="Inflow, m³/s"]', inflow - 100); await p.waitForTimeout(2000);
  assert.equal(await T("scenario-balance-dv").innerText(), "−518.4"); assert.equal(await T("scenario-closure").innerText(), "0");
  s = await scene(); const expectLow = 345 - 518.4 / (2300 / 6.9);
  assert.ok(Math.abs(s.rendered - expectLow) < 0.01, `water drawn at ${s.rendered}, expected ${expectLow}`); await shot("A4-drought");
  // evaporation of 1000 mm per year for 60 days over 333.3 km²: 1000 × 60/365 mm × 333.3 km² = 54.8 million m³ more
  await setInput('input[aria-label="Evaporation, mm per year"]', 1000); await p.waitForTimeout(1500);
  const dv = Number((await T("scenario-balance-dv").innerText()).replace("−", "-"));
  assert.ok(Math.abs(dv - (-518.4 - 1000 * 60 / 365 / 1000 * (2300 / 6.9))) < 0.6, "evaporation input changes the balance: " + dv);
  // Before / After and the compare table
  await T("scenario-before").click(); await p.waitForTimeout(1500); assert.ok(Math.abs((await scene()).rendered - 345) < 0.01);
  await T("scenario-after").click(); await p.waitForTimeout(1500);
  await T("scenario-tab-compare").click(); assert.match(await T("scenario-compare").innerText(), /345 m/);
  assert.equal(await T("buildings-toggle").count(), 0, "no building control where there is no building pack");
  assert.ok((await T("scenario-facts").innerText()).includes("2009"), "published figures with their survey year");
  const kOut = { baseKm2: +(K.dem_water.area_km2).toFixed(1) };

  // ---------------------------------------------------------------- B. Lake Sarez
  const Z = await pack("sarez"); requested.length = 0;
  await T("lab-back").click(); await T("lab-home").waitFor();
  assert.equal(await p.evaluate(() => !!window.__ee.scenario), false, "the previous place's scene is removed");
  await openPlace("sarez");
  assert.ok(requested.every((f) => f.startsWith("sarez")), "only this place's files are loaded: " + requested.join(","));
  s = await scene(); g = await lookAt();
  assert.ok(inBox(g, Z), "camera looks at the lake: " + JSON.stringify(g));
  assert.ok(Math.abs(s.rendered - 3264) < 0.01, "lake at the level recorded in the elevation data: " + s.rendered);
  assert.equal(await T("scenario-tab-climate").count(), 0, "no water-balance tab without a storage relation");
  assert.equal(await p.locator('input[aria-label="Water level"]').getAttribute("min"), "3264", "lowering is not offered");
  assert.equal(await p.locator('input[aria-label="Water level"]').getAttribute("max"), "3284");
  assert.ok((await T("scenario-story").innerText()).includes("1911")); assert.match(await T("scenario-quakes").innerText(), /^48 /);
  await p.getByText("does not simulate a failure of the dam", { exact: false }).waitFor({ state: "attached" });
  const quakeDots = await p.evaluate(() => { const pr = window.__ee.viewer.scene.primitives; let n = 0; for (let i = 0; i < pr.length; i++) { const x = pr.get(i); if (x.constructor.name.includes("PointPrimitiveCollection") || (x.length === 2 && x.get && x.get(0)?.pixelSize === 13)) n += x.length; } return n; });
  assert.equal(quakeDots, 2, "the two magnitude-7 earthquakes are marked in the scene"); await shot("B1-sarez");
  await setInput('input[aria-label="Water level"]', 3274); await p.waitForTimeout(2000);
  s = await scene();
  assert.ok(Math.abs(s.rendered - 3274) < 0.01); assert.ok(s.newKm2 > 3 && s.newKm2 < 30, "shore moves: " + s.newKm2); assert.equal(s.edge, false);
  assert.match(await T("scenario-dv").innerText(), new RegExp("\\+" + Math.round(s.volHm3) + " "), "added water is the DEM layer: " + (await T("scenario-dv").innerText()));
  assert.ok(s.volHm3 > s.baseKm2 * 10 && s.volHm3 < (s.baseKm2 + s.newKm2) * 10, "layer volume lies between area × rise bounds");
  await shot("B2-sarez-raised");
  await T("scenario-before").click(); await p.waitForTimeout(1500); assert.ok(Math.abs((await scene()).rendered - 3264) < 0.01); await T("scenario-after").click();

  // ---------------------------------------------------------------- C. Nurek still works after switching places
  await T("lab-back").click(); await openPlace("nurek");
  s = await scene(); assert.ok(Math.abs(s.rendered - 864) < 0.01); assert.equal(s.exaggeration, 2); assert.equal(await T("buildings-toggle").count(), 1);
  await setInput('input[aria-label="Water level"]', 900); await p.waitForTimeout(2000);
  assert.equal(((await scene()).newKm2).toFixed(1), "45.0"); assert.match(await T("scenario-dv").innerText(), /^\+3033 /);

  // ---------------------------------------------------------------- D. Offline: every place opened once works without the network
  if (!process.env.SKIP_OFFLINE) {
    await p.waitForTimeout(3000); await ctx.setOffline(true);
    await start(); await openPlace("kayrakkum");
    await setInput('input[aria-label="Water level"]', 347.5); await p.waitForTimeout(2000);
    assert.ok(Math.abs((await scene()).rendered - 347.5) < 0.01, "Bahri Tojik offline");
    await T("lab-back").click(); await openPlace("sarez");
    assert.ok(Math.abs((await scene()).rendered - 3264) < 0.01, "Lake Sarez offline"); assert.match(await T("scenario-quakes").innerText(), /^48 /); await shot("D-offline-sarez");
    await ctx.setOffline(false);
  }
  await T("nav-g-explore").click(); await T("nav-explore").click(); await p.waitForTimeout(1500);
  assert.equal(await p.evaluate(() => { let n = 0; const pr = window.__ee.viewer.scene.primitives; for (let i = 0; i < pr.length; i++) if (pr.get(i).show) n++; return n; }) <= 1, true, "nothing of the lab is left in the scene (at most the country-label collection)");
  console.log(JSON.stringify({ kayrakkum: { ...kOut, droughtLevel: +expectLow.toFixed(3), lineHm3At347_5: +line.toFixed(1) }, sarez: { baseKm2: +Z.dem_water.area_km2, newKm2At3274: +s.newKm2.toFixed(1) } }));
  console.log("errors:", errs.length); for (const e of errs.slice(0, 4)) console.log(e);
  assert.equal(errs.length, 0); console.log("PASS");
} finally { await b.close(); }
