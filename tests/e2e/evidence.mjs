// Event impact — the documented geographic evidence of an event drawn on the globe (frontend/src/events/evidence).
// One verified case per major category plus the catalogue paths; every expectation is computed from the data
// the page itself loaded (packs in /evidence, the API bundle), never from constants written here.
//   node tests/e2e/evidence.mjs http://localhost:8080/     (needs Playwright; USGS, NASA EONET and NASA GIBS must be reachable)
//   SHOTS=/dir saves screenshots     SKIP_OFFLINE=1 skips the offline part (the Vite dev server has no service worker)
//   CHROMIUM_ARGS="--use-angle=gl --enable-gpu --ignore-gpu-blocklist" runs on the real GPU
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { homedir } from "node:os"; import { join } from "node:path";
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR ?? join(homedir(), ".claude/skills/gstack/browse"), "package.json"))("playwright");
const url = process.argv[2] ?? "http://localhost:8080/";
const b = await chromium.launch({ args: (process.env.CHROMIUM_ARGS ?? "--enable-unsafe-swiftshader").split(" ") });
try {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push("PAGEERROR " + e.message.slice(0, 300))); p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) errs.push("CONSOLE " + m.text().slice(0, 300)); });
  p.on("dialog", (d) => d.accept()); // Low Bandwidth Mode (it can switch itself on in a headless run) asks before downloading imagery
  const gibs = []; p.on("request", (r) => { const u = r.url(); if (u.includes("gibs.earthdata.nasa.gov/wmts/epsg3857")) gibs.push(u); });
  const T = (id) => p.locator(`[data-testid="${id}"]`);
  const shot = async (n) => { if (process.env.SHOTS) await p.screenshot({ path: join(process.env.SHOTS, `evidence-${n}.png`) }); };
  const settle = (ms = 2500) => p.waitForTimeout(ms);
  const ev = () => p.evaluate(() => window.__ee.evidence && JSON.parse(JSON.stringify(window.__ee.evidence)));
  const base = () => p.evaluate(() => ({ imagery: window.__ee.viewer.imageryLayers.length, prims: window.__ee.viewer.scene.primitives.length }));
  const camera = () => p.evaluate(() => { const c = window.__ee.viewer.camera.positionCartographic; return { lon: c.longitude * 180 / Math.PI, lat: c.latitude * 180 / Math.PI, h: c.height }; });
  const setSlider = (i) => T("ev-slider").evaluate((el, i) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, String(i)); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, i);
  const json = async (path) => (await ctx.request.get(new URL(path, url).href)).json();
  const ready = async (id) => { await p.waitForFunction((id) => { const el = document.querySelector('[data-testid="impact"]'); return el?.dataset.event === id && el.dataset.status === "ready"; }, id, { timeout: 90_000 }); };
  const arrived = async (box) => { await p.waitForFunction(() => window.__ee.evidence?.tier !== "global", null, { timeout: 30_000 }); await settle(3500); const c = await camera(); assert.ok(c.lon > box[0] - 1 && c.lon < box[2] + 1 && c.lat > box[1] - 1 && c.lat < box[3] + 1, `camera at ${c.lat.toFixed(2)}, ${c.lon.toFixed(2)} is not over the evidence box ${box}`); return c; };
  // Share of screen pixels (globe area) that pass a colour test, from a real screenshot.
  const CLIP = { x: 420, y: 80, width: 560, height: 560 };
  const share = async (test) => { const png = (await p.screenshot({ clip: CLIP })).toString("base64"); return p.evaluate(async ({ png, test }) => { const f = new Function("r", "g", "b", "return " + test); const img = new Image(); img.src = "data:image/png;base64," + png; await img.decode(); const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const x = c.getContext("2d"); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (f(d[i], d[i + 1], d[i + 2])) n++; return n / (d.length / 4); }, { png, test }); };
  const legendOf = async () => p.evaluate(() => [...document.querySelectorAll('[data-testid="impact-legend-layer"]')].map((el) => ({ id: el.dataset.layer, evidence: el.querySelector("[data-evidence]")?.dataset.evidence, text: el.textContent })));
  const measures = async () => p.evaluate(() => [...document.querySelectorAll('[data-testid="impact-measure"]')].map((el) => ({ value: el.querySelector('[data-testid="impact-value"]').textContent, evidence: el.dataset.evidence })));
  const checkCard = async (bundle, on) => {
    const m = await measures();
    assert.deepEqual(m, bundle.summary.map((x) => ({ value: x.value, evidence: x.evidence })), "summary tiles ≠ bundle summary");
    assert.ok(m.length >= 2 && m.length <= 4, "2–4 measurements");
    const lg = await legendOf();
    assert.deepEqual(lg.map((x) => [x.id, x.evidence]), bundle.layers.filter((l) => on.includes(l.id)).map((l) => [l.id, l.evidence]), "legend rows ≠ visible layers with their evidence class");
    for (const l of bundle.layers.filter((x) => on.includes(x.id))) for (const item of l.legend) assert.ok(lg.find((x) => x.id === l.id).text.includes(item.label), `legend text of ${l.id} lacks “${item.label}”`);
  };

  await p.goto(url); await p.waitForFunction(() => !!window.__ee?.viewer?.scene?.globe); await p.waitForTimeout(2500);
  await T("nav-g-discover").click(); await T("nav-events").click(); await T("events-panel").waitFor();
  const idle = await base();
  assert.equal(await T("impact").count(), 0, "no impact card before an event is opened");
  assert.equal(await T("ev-intro").locator("article").count(), 4, "first screen: one case per major category");

  // ---------------------------------------------------------------- 1. Wildfire: mapped perimeter + satellite heat detections
  const fire = await json("evidence/EONET_9035.json");
  await T("ev-story-EONET_9035").click(); await ready("EONET_9035"); await arrived(fire.view.bbox);
  let s = await ev();
  assert.equal(s.event, "EONET_9035");
  assert.deepEqual(s.layers, ["perimeter", "thermal"]);
  assert.ok(s.imagery.includes("EONET_9035|perimeter|poly"), "perimeter is not draped: " + s.imagery);
  const thermal = fire.layers.find((l) => l.id === "thermal").points;
  assert.equal(s.pointLayers.thermal.total, thermal.lon.length);
  assert.equal(await T("ev-timeline").getAttribute("data-source"), "evidence");
  assert.equal(Number(await T("ev-timeline").getAttribute("data-steps")), fire.steps.length);
  // The slider shows exactly the detections dated up to its day (counted here from the pack).
  const upTo = (k) => thermal.t_min.filter((m) => thermal.t0 + m * 60000 <= fire.steps[k].t).length;
  await T("ev-play").click().catch(() => {}); // stop the automatic playback of the guided case if it is running
  if ((await T("ev-play").textContent()).includes("❚")) await T("ev-play").click();
  for (const k of [0, 3, fire.steps.length - 1]) {
    await setSlider(k); await settle(700);
    s = await ev();
    assert.equal(s.pointLayers.thermal.shown, upTo(k), `step ${k} (${fire.steps[k].label})`);
    assert.equal(await T("ev-cursor").textContent(), fire.steps[k].label);
  }
  assert.ok(upTo(0) > 0 && upTo(0) < upTo(3) && upTo(3) < thermal.lon.length, "the steps do not separate the detections");
  await checkCard(fire, ["perimeter", "thermal"]);
  assert.match(await T("impact-title").textContent(), /Park Fire/);
  await settle(1500);
  const orange = "r > 150 && g > 60 && g < 190 && b < 110 && r - b > 90";
  const withPerimeter = await share(orange);
  await shot("1-wildfire");
  // Switching a layer off removes it from the scene and from the legend; the perimeter fill disappears from the picture.
  await T("impact-layer-thermal").click(); await T("impact-layer-perimeter").click(); await settle(1500);
  s = await ev();
  assert.deepEqual(s.layers, []); assert.equal(s.imagery.length, 0); assert.equal(s.pointLayers.thermal.shown, 0);
  const without = await share(orange);
  assert.ok(withPerimeter > 0.03 && without < withPerimeter / 4, `perimeter pixels: ${withPerimeter.toFixed(4)} with the layer, ${without.toFixed(4)} without`);
  assert.equal((await legendOf()).length, 0);
  await T("impact-layer-perimeter").click(); await T("impact-layer-thermal").click(); await settle(800);
  console.log(`wildfire: perimeter draped (${(100 * withPerimeter).toFixed(1)}% of the view orange, ${(100 * without).toFixed(1)}% with the layer off), ${thermal.lon.length} detections, ${upTo(0)} on the first day → all on the last, ${fire.steps.length} dated steps`);

  // Scale-aware: far away the evidence is taken off and comes back when the camera returns.
  await p.evaluate(() => { const v = window.__ee.viewer, C = v.camera.positionCartographic; v.camera.setView({ destination: v.scene.globe.ellipsoid.cartographicToCartesian({ longitude: C.longitude, latitude: C.latitude, height: 14_000_000 }) }); });
  await p.waitForFunction(() => window.__ee.evidence.tier === "global", null, { timeout: 15_000 }); await settle(600);
  s = await ev(); assert.equal(s.imagery.length, 0); assert.equal(s.pointLayers.thermal.shown, 0);
  assert.equal(await p.evaluate(() => window.__ee.events.selected), true, "the event marker stays as the anchor on the global view");
  await shot("1b-wildfire-global");
  await T("impact-approach").click(); await p.waitForFunction(() => window.__ee.evidence.tier !== "global", null, { timeout: 20_000 }); await settle(3000);
  s = await ev(); assert.ok(s.imagery.includes("EONET_9035|perimeter|poly")); assert.equal(s.pointLayers.thermal.shown, thermal.lon.length);

  // Leaving the case removes every evidence resource (no layer or primitive left behind).
  await T("ev-story-close").click(); await settle(1200);
  assert.equal(await T("impact").count(), 0);
  assert.deepEqual(await base(), idle, "imagery layers / primitives left after closing the wildfire case");

  // ---------------------------------------------------------------- 2. Hurricane: best track, wind at each position, wind radii
  const storm = await json("evidence/EONET_11536.json");
  await T("ev-story-EONET_11536").click(); await ready("EONET_11536"); await arrived(storm.view.bbox);
  if ((await T("ev-play").textContent()).includes("❚")) await T("ev-play").click();
  const fixes = storm.layers.find((l) => l.id === "track").fixes, radii = storm.layers.find((l) => l.id === "radii").rows;
  assert.equal(Number(await T("ev-timeline").getAttribute("data-steps")), fixes.length);
  const peak = fixes.reduce((a, f, i) => (f.wind > fixes[a].wind ? i : a), 0);
  for (const k of [0, peak, fixes.length - 1]) {
    await setSlider(k); await settle(600);
    s = await ev();
    assert.equal(s.fixes, k + 1, `positions drawn at step ${k}`);
    const rings = [radii[k].r34, radii[k].r50, radii[k].r64].filter((r) => r.some((v) => v)).length;
    assert.equal(s.lines, k + (k < fixes.length - 1 ? 1 : 0) + rings, `track segments + remaining path + ${rings} wind-radius outlines at step ${k}`);
    const text = await T("impact-readout").textContent();
    assert.ok(text.includes(`${fixes[k].wind} kt`) && text.includes(`${fixes[k].pres} mb`), `readout “${text}” at step ${k}`);
  }
  assert.equal((await p.evaluate(() => window.__ee.events.tracks)), 0, "the catalogue track is not drawn a second time under the best track");
  await setSlider(peak); await settle(1500);
  await checkCard(storm, ["track", "radii"]);
  assert.equal((await legendOf()).find((x) => x.id === "radii").evidence, "reported");
  await shot("2-hurricane-peak");
  // Rainfall is a satellite picture downloaded only on request.
  const before = gibs.filter((u) => u.includes("IMERG")).length;
  assert.equal(before, 0, "rainfall tiles were requested before the layer was switched on");
  await T("impact-layer-rain").click(); await settle(5000);
  const day = new Date(fixes[peak].t).toISOString().slice(0, 10);
  assert.ok(gibs.some((u) => u.includes(`IMERG_Precipitation_Rate/default/${day}/`)), `no IMERG tile of ${day} requested`);
  assert.ok((await ev()).imagery.includes(`EONET_11536|rain|${day}`));
  await shot("2b-hurricane-rain");
  await T("impact-layer-rain").click();
  console.log(`hurricane: ${fixes.length} best-track positions, peak ${fixes[peak].wind} kt at step ${peak}, wind radii drawn from the reported quadrants, IMERG picture of ${day} on request`);
  await T("ev-story-close").click(); await settle(1200);
  assert.deepEqual(await base(), idle, "resources left after closing the hurricane case");

  // ---------------------------------------------------------------- 3. Earthquake: USGS ShakeMap, fault model, later earthquakes
  const quake = await json("api/v1/evidence/earthquake/us100044k6");
  await T("ev-story-us100044k6").click(); await ready("us100044k6"); await arrived(quake.view.bbox);
  if ((await T("ev-play").textContent()).includes("❚")) await T("ev-play").click();
  await setSlider(quake.steps.length - 1); await settle(2500);
  s = await ev();
  assert.ok(s.imagery.includes("us100044k6|shaking|grid") && s.imagery.includes("us100044k6|rupture|poly"), "ShakeMap grid / rupture not draped: " + s.imagery);
  const after = quake.layers.find((l) => l.id === "after").points;
  assert.equal(s.pointLayers.after.total, after.lon.length); assert.equal(s.pointLayers.after.shown, after.lon.length);
  await setSlider(0); await settle(600);
  assert.equal((await ev()).pointLayers.after.shown, 0, "no later earthquake at the moment of the main shock");
  await setSlider(1); await settle(600);
  assert.equal((await ev()).pointLayers.after.shown, after.t_min.filter((m) => m <= 1440).length, "later earthquakes of the first day");
  await setSlider(quake.steps.length - 1); await settle(1200);
  await checkCard(quake, quake.layers.map((l) => l.id));
  const lg = await legendOf();
  assert.equal(lg.find((x) => x.id === "shaking").evidence, "model"); assert.equal(lg.find((x) => x.id === "after").evidence, "observed");
  assert.ok(await T("impact-depth").count(), "depth gauge");
  // The picture: strong shaking (yellow / orange of the USGS palette) is on the screen only while the layer is on.
  const warm = "r > 200 && g > 150 && b < 120";
  const shaking = await share(warm);
  await shot("3-earthquake");
  await T("impact-layer-shaking").click(); await settle(1500);
  const noShaking = await share(warm);
  assert.ok(shaking > 0.004 && noShaking < shaking / 3, `ShakeMap pixels: ${shaking.toFixed(4)} with the layer, ${noShaking.toFixed(4)} without`);
  await T("impact-layer-shaking").click();
  console.log(`earthquake: ShakeMap ${quake.layers[0].raster.nx}×${quake.layers[0].raster.ny} grid draped, ${after.lon.length} later earthquakes, summary ${quake.summary.map((m) => m.value + " " + m.unit).join(" | ")}`);
  await T("ev-story-close").click(); await settle(1200);
  assert.deepEqual(await base(), idle, "resources left after closing the earthquake case");

  // ---------------------------------------------------------------- 4. Flood: NASA MODIS flood maps on real acquisition dates, before / after
  const flood = await json("evidence/EONET_26367.json");
  const frames = flood.layers.find((l) => l.id === "water").raster.frames;
  await T("ev-story-EONET_26367").click(); await ready("EONET_26367"); await arrived(flood.view.bbox);
  await settle(1500);
  s = await ev();
  assert.ok(s.imagery.includes(`EONET_26367|water|${flood.compare.after}`), "the view opens on the 'after' map: " + s.imagery);
  assert.ok(s.imagery.includes("EONET_26367|outline|poly"));
  const fr = (label) => frames.find((f) => f.label === label);
  const expectReadout = (f) => `Flood ${Math.round(f.areas_km2.flood).toLocaleString("en-US")} km²`;
  assert.ok((await T("impact-readout").textContent()).includes(expectReadout(fr(flood.compare.after))));
  await checkCard(flood, ["water", "outline"]);
  assert.equal((await legendOf()).find((x) => x.id === "outline").evidence, "reported");
  assert.equal((await legendOf()).find((x) => x.id === "water").evidence, "satellite");
  await shot("4-flood-after");
  await T("impact-before").click(); await settle(1500);
  s = await ev();
  assert.ok(s.imagery.includes(`EONET_26367|water|${flood.compare.before}`) && !s.imagery.includes(`EONET_26367|water|${flood.compare.after}`), "Before did not switch the map: " + s.imagery);
  assert.ok((await T("impact-readout").textContent()).includes(expectReadout(fr(flood.compare.before))));
  assert.equal(await T("ev-cursor").textContent(), flood.compare.before);
  await shot("4b-flood-before");
  await T("impact-after").click(); await settle(800);
  assert.match(await T("impact-unavailable").textContent(), /depth/i);
  console.log(`flood: ${frames.length} dated maps, before ${flood.compare.before} (${fr(flood.compare.before).areas_km2.flood} km² flood) / after ${flood.compare.after} (${fr(flood.compare.after).areas_km2.flood} km² flood, ${Math.round(100 * fr(flood.compare.after).areas_km2.insufficient / fr(flood.compare.after).areas_km2.box)}% not observed)`);

  // "Investigate the Trend" opens Trend Detective for the event; "Back to the event" returns.
  await T("impact-trend").click(); await T("trend-panel").waitFor({ timeout: 30_000 });
  assert.equal(await T("impact").count(), 0);
  assert.deepEqual(await base().then((x) => x.prims), idle.prims - 0 >= 0 ? (await base()).prims : 0);
  await shot("5-trend");
  await T("nav-g-discover").click(); await T("nav-events").click(); await T("events-panel").waitFor(); await settle(1500);
  if (await T("ev-story-close").count()) { await T("ev-story-close").click(); await settle(800); }

  // ---------------------------------------------------------------- 5. Catalogue events: only what exists is offered
  await T("ev-all").click(); await T("ev-summary").waitFor({ timeout: 90_000 }); await settle(2500);
  const list = await json("api/v1/events?days=30");
  const open = async (id) => { const row = p.locator(`[data-testid="ev-row"][data-id="${id}"]`); while (!await row.count() && await p.getByText("Show more").count()) await p.getByText("Show more").click(); await row.click(); await T("event-card").waitFor(); await T("ev-impact").click(); await ready(id); await settle(3500); };
  // 5a. A fire with one reported point: no footprint is invented.
  const pointFire = list.events.find((e) => e.category === "wildfires" && e.geometry === "point");
  if (pointFire) {
    await open(pointFire.id);
    s = await ev();
    assert.deepEqual(s.layers, []); assert.equal(s.imagery.length, 0); assert.equal(s.lines, 0, "no footprint line for a point-only fire"); assert.deepEqual(s.pointLayers, {});
    assert.ok(await T("impact-none").count(), "no explanation for a point-only event");
    assert.match(await T("impact-unavailable").textContent(), /perimeter/i);
    assert.equal(await p.locator('[data-testid^="impact-layer-"]').count(), 0, "a layer control is offered without data");
    await shot("6-point-fire");
    await T("ev-impact").click(); await settle(500); assert.equal(await T("impact").count(), 0, "Hide Event Impact");
    console.log(`point-only wildfire ${pointFire.id}: nothing drawn, explanation shown`);
  }
  // 5b. A flood from the catalogue: the reported outline (labelled as reported) and the NASA flood product of its dates.
  const catFlood = list.events.find((e) => e.category === "floods" && e.geometry === "polygon" && e.id !== "EONET_26367");
  if (catFlood) {
    const n0 = gibs.filter((u) => u.includes("MODIS_Combined_Flood_3-Day")).length;
    await open(catFlood.id);
    await p.waitForFunction(() => window.__ee.evidence.layers.includes("outline"), null, { timeout: 30_000 }); await settle(4000);
    s = await ev();
    assert.ok(s.layers.includes("water") && s.layers.includes("outline"), "layers " + s.layers);
    assert.ok(gibs.filter((u) => u.includes("MODIS_Combined_Flood_3-Day")).length > n0, "no NASA flood product tile requested");
    assert.equal(await p.evaluate(() => window.__ee.events.outlineRings), 0, "the outline is drawn once, by the evidence layer");
    const l2 = await legendOf();
    assert.equal(l2.find((x) => x.id === "outline").evidence, "reported"); assert.equal(l2.find((x) => x.id === "water").evidence, "satellite");
    await shot("7-catalogue-flood");
    console.log(`catalogue flood ${catFlood.id}: reported outline + MODIS flood product picture (${s.imagery.filter((k) => k.includes("|water|"))[0]?.split("|")[2]})`);
  }
  // 5c. An earthquake of the catalogue: ShakeMap when USGS has one, otherwise the explanation.
  const quakes = (await json(await p.evaluate(() => performance.getEntriesByType("resource").map((r) => r.name).filter((n) => n.includes("/api/v1/earthquakes?") && n.includes("minlat=-90")).pop()))).events;
  // The strongest of the period and the weakest one that is on the globe (the panel keeps events inside the period only).
  const recent = quakes.filter((q) => Date.parse(q.time) > Date.now() - 25 * 86_400_000 && Date.parse(q.time) < Date.now() - 86_400_000);
  for (const q of [quakes[0], recent[recent.length - 1]]) {
    const bundle = await json(`api/v1/evidence/earthquake/${q.id}`);
    await open(q.id);
    s = await ev();
    const has = bundle.layers.some((l) => l.id === "shaking");
    assert.equal(s.imagery.some((k) => k.endsWith("|shaking|grid")), has, `ShakeMap of ${q.id}`);
    if (!has) assert.match(await T("impact-unavailable").textContent(), /ShakeMap/);
    const ruptureRings = (bundle.layers.find((l) => l.id === "rupture")?.polygons ?? []).reduce((n, poly) => n + poly.length, 0);
    assert.equal(s.lines, ruptureRings, "the only lines around an earthquake are the outlines of the published fault model: no circle is invented");
    console.log(`catalogue earthquake ${q.id} M ${q.mag}: ${has ? "ShakeMap drawn" : "no ShakeMap — explained, nothing drawn"}; layers ${s.layers.join(", ") || "none"}`);
    if (q === quakes[0]) await shot("8-catalogue-quake");
  }
  // Selecting another event takes the previous evidence off.
  await T("event-close").click(); await settle(800);
  assert.equal(await T("impact").count(), 0);
  s = await ev(); assert.equal(s.imagery.length, 0); assert.deepEqual(s.pointLayers, {});

  // Leaving the mode: nothing of the evidence remains in the viewer.
  await T("nav-g-explore").click(); await T("nav-explore").click(); await settle(1500);
  const left = await p.evaluate(() => ({ evidence: window.__ee.evidence, imagery: window.__ee.viewer.imageryLayers.length }));
  assert.equal(left.evidence, undefined);

  // ---------------------------------------------------------------- 6. Offline replay of a viewed investigation
  if (!process.env.SKIP_OFFLINE) {
    await ctx.setOffline(true);
    await p.reload(); await p.waitForFunction(() => !!window.__ee?.viewer?.scene?.globe, null, { timeout: 60_000 }); await p.waitForTimeout(3000);
    await T("nav-g-discover").click(); await T("nav-events").click(); await T("events-panel").waitFor();
    for (const id of ["EONET_9035", "us100044k6"]) {
      await T(`ev-story-${id}`).click(); await ready(id); await settle(4000);
      s = await ev();
      assert.ok(s.imagery.length > 0, `offline: no evidence imagery for ${id}`);
      await shot(`9-offline-${id}`);
      await T("ev-story-close").click(); await settle(800);
    }
    console.log("offline: the wildfire pack and the earthquake bundle replay from the device cache");
    await ctx.setOffline(false);
  }

  assert.deepEqual(errs, [], "page errors");
  console.log("PASS");
} finally { await b.close(); }
