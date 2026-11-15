// Event Detective — events are drawn on the globe: markers per kind, fire clusters far away, storm tracks,
// flood outlines from the source, time slider and playback, click → investigation card, curated cases,
// "Analyze this region" → Trend Detective. Expectations are computed from the live API answers.
//   node tests/e2e/events.mjs http://localhost:8080/     (needs Playwright; NASA EONET and USGS must be reachable)
//   SHOTS=/dir saves screenshots     SKIP_OFFLINE=1 skips the offline part (the Vite dev server has no service worker)
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { homedir } from "node:os"; import { join } from "node:path";
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR ?? join(homedir(), ".claude/skills/gstack/browse"), "package.json"))("playwright");
const url = process.argv[2] ?? "http://localhost:8080/";
const b = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
try {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push("PAGEERROR " + e.message.slice(0, 300)));
  const detailRequests = []; p.on("request", (r) => { const m = new URL(r.url()).pathname.match(/\/api\/v1\/events\/(EONET_\d+)$/); if (m) detailRequests.push(m[1]); });
  const shot = async (n) => { if (process.env.SHOTS) await p.screenshot({ path: join(process.env.SHOTS, `events-${n}.png`) }); };
  const T = (id) => p.locator(`[data-testid="${id}"]`);
  const stats = () => p.evaluate(() => ({ ...window.__ee.events }));
  const onGlobe = async () => Number((await T("ev-summary").textContent()).match(/^\d+/)[0]);
  const count = async (cat) => await T(`ev-cat-${cat}`).count() ? Number(await T(`ev-cat-${cat}`).getAttribute("data-count")) : 0;
  const setSlider = (i) => T("ev-slider").evaluate((el, i) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, String(i)); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, i);
  const camera = () => p.evaluate(() => { const c = window.__ee.viewer.camera.positionCartographic; return { lon: c.longitude * 180 / Math.PI, lat: c.latitude * 180 / Math.PI, h: c.height }; });
  const settle = (ms = 3500) => p.waitForTimeout(ms);
  // Every drawn fire is either its own marker or a member of a cluster: nothing is lost or doubled.
  const consistent = async (what) => { const s = await stats(), n = await onGlobe(); assert.equal(s.markers + s.clustered, n, `${what}: ${s.markers} markers + ${s.clustered} clustered ≠ ${n} listed`); return s; };

  const api = await (await ctx.request.get(new URL("api/v1/events?days=30", url).href)).json();
  const perCat = Object.fromEntries(api.categories.map((c) => [c.id, c.count]));
  console.log("EONET 30 days:", api.count, JSON.stringify(perCat), "stale:", api.stale);
  assert.ok(api.count > 0, "EONET returned no events");

  // 1. Opening the mode loads the period and draws markers.
  await p.goto(url); await p.waitForFunction(() => !!window.__ee?.viewer?.scene?.globe); await p.waitForTimeout(3000);
  await T("nav-g-discover").click(); await T("nav-events").click(); await T("ev-all").click(); await T("events-panel").waitFor();
  await T("ev-summary").waitFor({ timeout: 90_000 }); await settle();
  for (const cat of ["wildfires", "severeStorms", "floods"]) assert.equal(await count(cat), perCat[cat] ?? 0, `${cat} chip count`);
  const quakes = await count("earthquakes");
  assert.ok(quakes > 0, "no earthquakes loaded from USGS");
  const total = await onGlobe();
  const other = Object.entries(perCat).filter(([k]) => !["wildfires", "severeStorms", "floods", "landslides", "volcanoes", "earthquakes"].includes(k)).reduce((n, [, v]) => n + v, 0);
  assert.equal(await count("other"), other, "other chip count");
  assert.equal(total, api.count + quakes, "everything loaded is on the globe at the end of the period");
  let s = await consistent("start");
  assert.ok(s.markers > 0, "no markers drawn");
  if ((perCat.wildfires ?? 0) > 50) { assert.ok(s.clusters > 0 && s.cell > 0, "fires are not clustered on the whole-globe view"); assert.ok(s.clustered <= perCat.wildfires); }
  console.log(`drawn: ${s.markers} markers, ${s.clusters} clusters holding ${s.clustered} fires, ${s.tracks} tracks (${s.trackPoints} earlier positions); earthquakes ${quakes}`);
  await shot("1-globe");

  // 2. Filter by kind.
  await T("ev-cat-wildfires").click(); await settle(800);
  s = await consistent("fires off");
  assert.equal(await onGlobe(), total - (perCat.wildfires ?? 0)); assert.equal(s.clusters, 0);
  await T("ev-cat-earthquakes").click(); await settle(800);
  assert.equal(await onGlobe(), total - (perCat.wildfires ?? 0) - quakes);
  await T("ev-cat-earthquakes").click(); await T("ev-cat-wildfires").click(); await settle(800);
  assert.equal(await onGlobe(), total);
  // Magnitude filter only removes earthquakes.
  await T("ev-minmag").selectOption("6"); await settle(800);
  const strong = await onGlobe() - api.count;
  assert.ok(strong >= 0 && strong < quakes, `M ≥ 6: ${strong} of ${quakes}`);
  await consistent("M ≥ 6"); await T("ev-minmag").selectOption("4.5"); await settle(800);

  // 3. Time: fewer events at the start of the period, playback adds them and stops at the end.
  const steps = Number(await T("ev-slider").getAttribute("max"));
  await setSlider(0); await settle(800);
  const atStart = await onGlobe();
  await consistent("slider at start");
  assert.ok(atStart < total, `slider at the start shows ${atStart}, the whole period ${total}`);
  await shot("2-time-start");
  await T("ev-play").click();
  const seen = [];
  for (let i = 0; i < 80; i++) { await p.waitForTimeout(500); seen.push(await onGlobe()); if ((await T("ev-play").textContent()).includes("▶")) break; }
  assert.ok(seen.every((n, i) => i === 0 || n >= seen[i - 1]), "events disappeared during playback: " + seen.join(","));
  assert.equal(seen[seen.length - 1], total, "playback did not end with the whole period");
  assert.equal(Number(await T("ev-slider").inputValue()), steps, "slider not at the end after playback");
  console.log(`time: ${atStart} events at the start → ${total} at the end, ${steps + 1} positions, playback stopped by itself`);

  // 4. Click interaction. A list row selects and flies; a click on the marker in the scene selects too.
  const strongest = await p.evaluate(async () => (await (await fetch(performance.getEntriesByType("resource").map((r) => r.name).find((n) => n.includes("/api/v1/earthquakes?")))).json()).events[0]);
  await T(`ev-row`).filter({ hasText: strongest.place }).first().scrollIntoViewIfNeeded().catch(() => {});
  const row = p.locator(`[data-testid="ev-row"][data-id="${strongest.id}"]`);
  if (!await row.count()) while (await p.getByText("Show more").count() && !await row.count()) await p.getByText("Show more").click();
  await row.click(); await T("event-card").waitFor(); await settle(4500);
  assert.equal(await T("event-card").getAttribute("data-id"), strongest.id);
  assert.equal(await T("event-mag").textContent(), strongest.mag.toFixed(1));
  let cam = await camera();
  assert.ok(Math.abs(cam.lat - strongest.lat) < 1 && Math.abs(((cam.lon - strongest.lon + 540) % 360) - 180) < 1, `camera at ${cam.lat.toFixed(2)}, ${cam.lon.toFixed(2)}; event at ${strongest.lat}, ${strongest.lon}`);
  s = await stats();
  assert.equal(s.selected, true, "selected event is not highlighted");
  assert.equal(s.cell, 0, "fires still clustered at 1,500 km"); assert.equal(s.clusters, 0);
  assert.match(await T("event-geometry-note").textContent(), /epicentre/);
  await shot("3-selected-quake");
  await T("event-close").click(); await settle(500);
  assert.equal((await stats()).selected, false);
  const at = await p.evaluate((id) => window.__eeEvents.screenOf(id), strongest.id);
  const box = await p.locator("canvas").first().boundingBox();
  await p.mouse.click(box.x + at.x, box.y + at.y); await T("event-card").waitFor({ timeout: 5000 });
  const pickedTitle = await T("event-title").textContent();
  console.log(`clicked the marker of ${strongest.id} in the scene → card “${pickedTitle}” (${await T("event-card").getAttribute("data-id")})`);
  assert.equal((await stats()).selected, true);

  // 5. Storm track (when the period has one): positions appear with time.
  const storm = api.events.find((e) => e.category === "severeStorms" && e.track?.length > 3);
  if (storm) {
    while (!await p.locator(`[data-testid="ev-row"][data-id="${storm.id}"]`).count() && await p.getByText("Show more").count()) await p.getByText("Show more").click();
    await p.locator(`[data-testid="ev-row"][data-id="${storm.id}"]`).click(); await settle(4000);
    assert.equal(await T("event-fixes").textContent(), `${storm.track.length} / ${storm.track.length}`);
    assert.ok((await stats()).tracks >= 1, "no track line drawn");
    assert.match(await T("event-geometry-note").textContent(), /dated positions/);
    await shot("4-storm-track");
  } else console.log("no storm with a track in this period — track checked in the curated case only");

  // 6. Flood outline: fetched only when the flood is selected, drawn ring by ring.
  const flood = api.events.find((e) => e.geometry === "polygon");
  if (flood) {
    assert.equal(detailRequests.length, 0, "polygons were requested before any flood was selected");
    while (!await p.locator(`[data-testid="ev-row"][data-id="${flood.id}"]`).count() && await p.getByText("Show more").count()) await p.getByText("Show more").click();
    await p.locator(`[data-testid="ev-row"][data-id="${flood.id}"]`).click();
    await p.waitForFunction(() => window.__ee.events.outlineRings > 0, null, { timeout: 30_000 }); await settle(4000);
    const detail = await (await ctx.request.get(new URL(`api/v1/events/${flood.id}`, url).href)).json();
    const rings = detail.event.polygons.reduce((n, poly) => n + poly.length, 0);
    assert.equal((await stats()).outlineRings, rings, "drawn rings ≠ rings in the source record");
    assert.deepEqual(detailRequests, [flood.id]);
    assert.match(await T("event-outline").textContent(), new RegExp(`^${flood.polygon_vertices} `));
    console.log(`flood ${flood.id}: ${rings} ring(s), ${flood.polygon_vertices} vertices drawn as published`);
    await shot("5-flood-outline");
  } else console.log("no flood polygon in this period");

  // 7. Curated case: hurricane track plays position by position.
  await T("ev-story-EONET_11536").click(); await T("ev-story").waitFor();
  // A guided case now opens the impact view (tests/e2e/evidence.mjs). Hiding it gives the catalogue record back:
  // the reported positions and their line are drawn again and the slider returns to the record's own dates.
  await T("impact-close").click({ timeout: 60_000 }); await settle(800);
  if ((await T("ev-play").textContent()).includes("❚")) await T("ev-play").click();
  await setSlider(0); await settle(400); await T("ev-play").click();
  await p.waitForFunction(() => document.querySelector('[data-testid="event-fixes"]')?.textContent.endsWith("/ 22"), null, { timeout: 60_000 });
  s = await stats(); assert.equal(s.markers, 1, "a curated case shows its record alone");
  await p.waitForFunction(() => document.querySelector('[data-testid="event-fixes"]')?.textContent === "22 / 22", null, { timeout: 40_000 });
  s = await stats(); assert.equal(s.tracks, 1); assert.equal(s.trackPoints, 21); assert.equal(s.selected, true);
  assert.match(await T("event-title").textContent(), /Milton/);
  await settle(1500); await shot("6-story-hurricane");
  await T("ev-story-close").click(); await settle(800);
  assert.equal(await onGlobe(), total, "leaving the case did not restore the period");
  // Earthquake case: a USGS record found by its id.
  await T("ev-story-us100044k6").click(); await T("event-card").waitFor({ timeout: 60_000 }); await settle(4000);
  assert.equal(await T("event-mag").textContent(), "7.2"); assert.match(await T("event-title").textContent(), /Murghob, Tajikistan/);
  // The impact view frames the ShakeMap beside its card, so the camera centre lies west of the epicentre: the epicentre must be on the screen.
  cam = await camera(); assert.ok(Math.abs(cam.lat - 38.21) < 2 && Math.abs(cam.lon - 72.78) < 5, `camera not over the Pamir: ${cam.lat.toFixed(2)}, ${cam.lon.toFixed(2)}`);
  const epi = await p.evaluate(() => window.__eeEvents.screenOf("us100044k6"));
  assert.ok(epi && epi.x > 400 && epi.x < 1100 && epi.y > 0 && epi.y < 790, `epicentre not in the free part of the globe view: ${JSON.stringify(epi)}`);
  await shot("7-story-quake");
  // Terrain on and the camera low: the marker is placed on the terrain surface (the Pamir here), not on the ellipsoid.
  assert.ok(Math.abs((await stats()).selectedHeight - 400) < 1, "without terrain the marker is 400 m above the ellipsoid");
  await T("ev-terrain").click();
  await p.evaluate(() => { const v = window.__ee.viewer; v.camera.setView({ destination: v.scene.globe.ellipsoid.cartographicToCartesian({ longitude: 72.7797 * Math.PI / 180, latitude: 38.2107 * Math.PI / 180, height: 120_000 }) }); });
  const lifted = await p.waitForFunction(() => window.__ee.events.selectedHeight > 1500, null, { timeout: 60_000 }).then(() => true, () => false);
  const onTerrain = (await stats()).selectedHeight;
  const ground = await p.evaluate(() => { const v = window.__ee.viewer; return v.scene.globe.getHeight(v.scene.globe.ellipsoid.cartesianToCartographic(v.scene.globe.ellipsoid.cartographicToCartesian({ longitude: 72.7797 * Math.PI / 180, latitude: 38.2107 * Math.PI / 180, height: 0 }))); });
  assert.ok(lifted, `marker stayed at ${onTerrain} m with terrain on`);
  assert.ok(Math.abs(onTerrain - ground - 60) < 2500, `marker at ${onTerrain.toFixed(0)} m, terrain there ${ground?.toFixed(0)} m`);
  console.log(`terrain on: marker at ${onTerrain.toFixed(0)} m, terrain surface there ${ground.toFixed(0)} m`);
  // The terrain gets finer as tiles arrive: once everything is loaded the marker must stand on the final surface.
  await p.waitForFunction(() => window.__ee.viewer.scene.globe.tilesLoaded, null, { timeout: 120_000 }); await settle(3000);
  const final = await p.evaluate(() => { const v = window.__ee.viewer; return { marker: window.__ee.events.selectedHeight, ground: v.scene.globe.getHeight(v.scene.globe.ellipsoid.cartesianToCartographic(v.scene.globe.ellipsoid.cartographicToCartesian({ longitude: 72.7797 * Math.PI / 180, latitude: 38.2107 * Math.PI / 180, height: 0 }))) }; });
  assert.ok(Math.abs(final.marker - final.ground - 60) < 5, `after loading: marker ${final.marker.toFixed(0)} m, terrain ${final.ground.toFixed(0)} m`);
  console.log(`all tiles loaded: marker at ${final.marker.toFixed(0)} m, terrain ${final.ground.toFixed(0)} m`);
  await shot("7b-quake-on-terrain");
  await T("ev-terrain").click(); await settle(1500);

  // 8. Analyze this region → Trend Detective for the event's point.
  await T("ev-analyze").click(); await T("trend-panel").waitFor({ timeout: 30_000 });
  const place = await p.evaluate(() => document.querySelector('[data-testid="trend-panel"]').textContent.slice(0, 400));
  assert.equal(await T("events-panel").count(), 0);
  assert.equal(await p.evaluate(() => "events" in window.__ee ? window.__ee.viewer.scene.primitives.length : -1) > 0, true);
  console.log("analyze → trend panel:", place.replace(/\s+/g, " ").slice(0, 120));
  await shot("8-analyze");

  // 9. Offline: the last list is still drawn (service worker cache).
  if (!process.env.SKIP_OFFLINE) {
    const off = await b.newContext({ viewport: { width: 1440, height: 900 } });
    const q = await off.newPage(); q.on("pageerror", (e) => errs.push("OFFLINE PAGEERROR " + e.message.slice(0, 300)));
    await q.goto(url); await q.waitForFunction(() => !!window.__ee?.viewer?.scene?.globe); await q.waitForTimeout(4000);
    await q.locator('[data-testid="nav-g-discover"]').click(); await q.locator('[data-testid="nav-events"]').click(); await q.locator('[data-testid="ev-all"]').click(); await q.locator('[data-testid="ev-summary"]').waitFor({ timeout: 90_000 }); await q.waitForTimeout(3000);
    const online = Number((await q.locator('[data-testid="ev-summary"]').textContent()).match(/^\d+/)[0]);
    await off.setOffline(true); await q.reload(); await q.waitForFunction(() => !!window.__ee?.viewer?.scene?.globe); await q.waitForTimeout(4000);
    await q.locator('[data-testid="nav-g-discover"]').click(); await q.locator('[data-testid="nav-events"]').click(); await q.locator('[data-testid="ev-all"]').click(); await q.locator('[data-testid="ev-summary"]').waitFor({ timeout: 60_000 }); await q.waitForTimeout(3000);
    const offline = Number((await q.locator('[data-testid="ev-summary"]').textContent()).match(/^\d+/)[0]);
    const os = await q.evaluate(() => ({ ...window.__ee.events }));
    assert.equal(offline, online, "offline list differs from the one loaded online");
    assert.equal(os.markers + os.clustered, offline);
    console.log(`offline reload: ${offline} events drawn from the cached lists`);
    if (process.env.SHOTS) await q.screenshot({ path: join(process.env.SHOTS, "events-9-offline.png") });
    await off.close();
  }

  console.log("page errors:", errs.length); for (const e of errs.slice(0, 6)) console.log(e);
  assert.equal(errs.length, 0);
  console.log("PASS");
} finally { await b.close(); }
