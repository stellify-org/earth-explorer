// Camera controls with mouse, touchpad and touch screen, and "the camera never ends up under the ground":
//   node tests/e2e/camera.mjs http://localhost:8080/        (needs Playwright; PLAYWRIGHT_DIR like tests/perf)
// Needs the network for terrain tiles (AWS Open Data). Headless Chromium renders in software: this checks
// behaviour, not smoothness.
//   SKIP=mouse,lab,touch   leave parts out;   SHOT=dir   screenshots.
import { createRequire } from "node:module"; import { homedir } from "node:os"; import { join } from "node:path";
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR ?? join(homedir(), ".claude/skills/gstack/browse"), "package.json"))("playwright");
const url = process.argv[2] ?? "http://localhost:8080/", skip = (process.env.SKIP ?? "").split(",");
const b = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
const errs = [], fails = [];
const check = (name, ok, detail) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail === undefined ? "" : " — " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`); if (!ok) fails.push(name); };
const deg = (r) => r * 180 / Math.PI;

async function open(options = {}) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, ...options });
  await ctx.addInitScript(() => localStorage.setItem("ee.advanced", "1"));
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push("PAGEERROR " + e.message)); p.on("dialog", (d) => d.accept());
  await p.goto(url); await p.waitForFunction(() => !!window.__ee?.viewer?.scene?.globe); await p.waitForTimeout(3000);
  await p.locator('[data-testid="home-explore"]').click().catch(() => {});
  await p.waitForTimeout(500);
  const box = await p.locator("canvas").first().boundingBox();
  return { ctx, p, box, cx: box.x + box.width * 0.55, cy: box.y + box.height * 0.5 };
}
// Camera state. `clear` = height above the globe surface under the camera; `block` = height above the Scenario Lab block.
const state = (p) => p.evaluate(() => {
  const v = window.__ee.viewer, c = v.camera.positionCartographic, g = v.scene.globe.getHeight(c), s = window.__ee.scenario;
  let block = null;
  if (s) { const i = s.t.row(c.latitude * 180 / Math.PI), j = s.t.col(c.longitude * 180 / Math.PI); if (i >= 0 && j >= 0 && i < s.t.h && j < s.t.w) block = c.height - s.height(s.t.z[i * s.t.w + j]); }
  return { h: c.height, lon: c.longitude * 180 / Math.PI, lat: c.latitude * 180 / Math.PI, clear: g === undefined ? null : c.height - g, block, heading: v.camera.heading, pitch: v.camera.pitch, roll: v.camera.roll, under: v.scene.cameraUnderground };
});
const setView = (p, lon, lat, h, pitch = -90, heading = 0) => p.evaluate(([lon, lat, h, pitch, heading]) => {
  const R = 6378137 + h, la = lat * Math.PI / 180, lo = lon * Math.PI / 180; // sphere of the equatorial radius: a few km off in height, the test reads the real height back
  window.__ee.viewer.camera.setView({ destination: { x: R * Math.cos(la) * Math.cos(lo), y: R * Math.cos(la) * Math.sin(lo), z: R * Math.sin(la) }, orientation: { heading: heading * Math.PI / 180, pitch: pitch * Math.PI / 180, roll: 0 } });
}, [lon, lat, h, pitch, heading]);
const flyHeight = (p, lon, lat, h, pitch = -90) => p.evaluate(([lon, lat, h, pitch]) => {
  const v = window.__ee.viewer, E = v.scene.globe.ellipsoid;
  v.camera.setView({ destination: E.cartographicToCartesian({ longitude: lon * Math.PI / 180, latitude: lat * Math.PI / 180, height: h }), orientation: { heading: 0, pitch: pitch * Math.PI / 180, roll: 0 } });
}, [lon, lat, h, pitch]);
const wheel = async (p, n, dy, ms = 60) => { for (let i = 0; i < n; i++) { await p.mouse.wheel(0, dy); await p.waitForTimeout(ms); } };
const rollOff = (r) => Math.min(Math.abs(deg(r)), Math.abs(360 - Math.abs(deg(r))));

// ---------------------------------------------------------------- mouse and touchpad
if (!skip.includes("mouse")) {
  const { ctx, p, box, cx, cy } = await open();
  await p.mouse.move(cx, cy);

  // Touchpad two-finger scroll: many small pixel deltas.
  await flyHeight(p, 71, 39, 3_000_000); await p.waitForTimeout(800);
  let a = await state(p); await wheel(p, 30, -8, 20); await p.waitForTimeout(1500); let z = await state(p);
  check("touchpad scroll zooms in", z.h < a.h * 0.9, `${Math.round(a.h / 1000)} → ${Math.round(z.h / 1000)} km`);

  // Touchpad pinch = Ctrl + wheel with small deltas. It must zoom the globe and must not zoom the page.
  a = z; await p.keyboard.down("Control"); await wheel(p, 20, 3, 20); await p.keyboard.up("Control"); await p.waitForTimeout(1500); z = await state(p);
  check("touchpad pinch (Ctrl + wheel) zooms out", z.h > a.h * 1.1, `${Math.round(a.h / 1000)} → ${Math.round(z.h / 1000)} km`);
  check("the page itself is not zoomed", await p.evaluate(() => visualViewport.scale === 1 && devicePixelRatio === 1));

  // One mouse notch moves a sensible amount (not a jump, not nothing).
  await flyHeight(p, 71, 39, 1_000_000); await p.waitForTimeout(800);
  a = await state(p); await p.mouse.wheel(0, -120); await p.waitForTimeout(2000); z = await state(p);
  check("one wheel notch zooms 5–40%", z.h < a.h * 0.95 && z.h > a.h * 0.6, `${Math.round(a.h / 1000)} → ${Math.round(z.h / 1000)} km`);
  // A free-spinning wheel (huge delta in one event) is limited.
  a = z; await p.mouse.wheel(0, -3000); await p.waitForTimeout(2000); z = await state(p);
  check("a huge wheel delta does not jump to the ground", z.h > a.h * 0.4, `${Math.round(a.h / 1000)} → ${Math.round(z.h / 1000)} km`);

  // Drag moves the map.
  a = z; await p.mouse.move(cx, cy); await p.mouse.down(); for (let i = 1; i <= 10; i++) { await p.mouse.move(cx - i * 15, cy); await p.waitForTimeout(20); } await p.mouse.up(); await p.waitForTimeout(1200); z = await state(p);
  check("left drag moves the map", Math.abs(z.lon - a.lon) > 0.2 && Math.abs(z.h - a.h) < a.h * 0.02, `lon ${a.lon.toFixed(2)} → ${z.lon.toFixed(2)}`);

  // Right drag tilts and turns; it does not zoom.
  await flyHeight(p, 71, 39, 300_000); await p.waitForTimeout(800);
  a = await state(p); await p.mouse.move(cx, cy); await p.mouse.down({ button: "right" }); for (let i = 1; i <= 12; i++) { await p.mouse.move(cx + i * 8, cy - i * 14); await p.waitForTimeout(25); } await p.mouse.up({ button: "right" }); await p.waitForTimeout(1200); z = await state(p);
  check("right drag tilts the view", deg(z.pitch) > deg(a.pitch) + 10, `pitch ${deg(a.pitch).toFixed(0)}° → ${deg(z.pitch).toFixed(0)}°`);
  check("the horizon stays level after tilting", rollOff(z.roll) < 1, `roll ${deg(z.roll).toFixed(1)}°`);

  // Shift + drag used to be "free look" and rolled the horizon by more than 100°.
  await p.keyboard.down("Shift"); await p.mouse.move(cx, cy); await p.mouse.down(); for (let i = 1; i <= 20; i++) { await p.mouse.move(cx + i * 10, cy - i * 10); await p.waitForTimeout(25); } await p.mouse.up(); await p.keyboard.up("Shift"); await p.waitForTimeout(1200); z = await state(p);
  check("Shift + drag keeps the horizon level", rollOff(z.roll) < 1, `roll ${deg(z.roll).toFixed(1)}°`);

  // Buttons.
  await p.locator('[data-testid="cam-north"]').click(); await p.waitForTimeout(1500); z = await state(p);
  check("North up button", Math.min(deg(z.heading), 360 - deg(z.heading)) < 1 && rollOff(z.roll) < 1, `heading ${deg(z.heading).toFixed(1)}°`);
  const tilt = p.locator('[data-testid="cam-tilt"]');
  if (deg(z.pitch) > -80) { await tilt.click(); await p.waitForTimeout(1500); }
  z = await state(p); check("tilt button: straight down", deg(z.pitch) < -88, `pitch ${deg(z.pitch).toFixed(1)}°`);
  await tilt.click(); await p.waitForTimeout(1500); z = await state(p);
  check("tilt button: 45° view", Math.abs(deg(z.pitch) + 45) < 2, `pitch ${deg(z.pitch).toFixed(1)}°`);
  await flyHeight(p, 71, 39, 300_000); await p.waitForTimeout(800);
  a = await state(p); await p.locator('[data-testid="cam-zoom-in"]').click(); await p.waitForTimeout(1200); z = await state(p);
  check("zoom-in button halves the distance", Math.abs(z.h / a.h - 0.5) < 0.05, `${Math.round(a.h / 1000)} → ${Math.round(z.h / 1000)} km`);
  a = z; await p.locator('[data-testid="cam-zoom-out"]').click(); await p.waitForTimeout(1200); z = await state(p);
  check("zoom-out button doubles the distance", Math.abs(z.h / a.h - 2) < 0.2, `${Math.round(a.h / 1000)} → ${Math.round(z.h / 1000)} km`);
  // Zooming out stops while the Earth still fills a good part of the screen.
  await p.mouse.move(cx, cy); await flyHeight(p, 71, 39, 20_000_000); await p.waitForTimeout(800); await wheel(p, 40, 240, 40); await p.waitForTimeout(2500); z = await state(p);
  check("zoom-out limit", z.h > 25_000_000 && z.h <= 32_100_000, `${Math.round(z.h / 1000)} km`);

  // ------------------------------------------------------------ terrain: never under the ground
  // Camera low over the flat ellipsoid, then the terrain is switched on: the Pamir is 4–5 km above it.
  await flyHeight(p, 72.9, 38.6, 200, -30); await p.waitForTimeout(1000);
  await p.evaluate(() => [...document.querySelectorAll("button,label")].find((x) => x.textContent.trim() === "Terrain (3D relief)")?.click());
  let low = Infinity, seen = 0;
  const sample = async () => { const s = await state(p); if (s.clear !== null) { low = Math.min(low, s.clear); seen++; } return s; };
  for (let i = 0; i < 10; i++) { await p.waitForTimeout(1500); z = await sample(); }
  check("terrain switched on under a low camera: camera is lifted above it", z.clear !== null && z.clear >= 24 && z.h > 2000, { height: Math.round(z.h), aboveGround: z.clear && Math.round(z.clear) });
  // Zoom into the mountains from a tilted view with the cursor in three places. Judged on every frame that is
  // drawn: between two frames a terrain tile that has just arrived in more detail can be above the camera for a
  // moment (seen once: 845 m), what counts is that no frame is drawn from under the ground.
  await flyHeight(p, 72.9, 38.6, 12_000, -30); await p.waitForTimeout(12_000);
  await p.evaluate(() => { const v = window.__ee.viewer, f = (window.__frames = { n: 0, measured: 0, low: Infinity, under: 0 });
    v.scene.postRender.addEventListener(() => { const c = v.camera.positionCartographic, g = v.scene.globe.getHeight(c); f.n++; if (g === undefined) return; f.measured++; f.low = Math.min(f.low, c.height - g); if (c.height - g < 24) f.under++; }); });
  for (const [x, y] of [[cx, cy], [cx, box.y + box.height * 0.22], [cx + 200, box.y + box.height * 0.85]]) {
    await p.mouse.move(x, y); await wheel(p, 36, -200, 50); await p.waitForTimeout(1500);
  }
  // Tilt towards the horizon near the ground and push on.
  await p.mouse.move(cx, cy); await p.mouse.down({ button: "right" }); for (let i = 1; i <= 15; i++) { await p.mouse.move(cx, cy - i * 12); await p.waitForTimeout(25); } await p.mouse.up({ button: "right" });
  await wheel(p, 36, -240, 50); await p.waitForTimeout(3000); z = await state(p);
  const fr = await p.evaluate(() => window.__frames);
  check("zooming into mountains: no frame is drawn from under the terrain", fr.measured > 50 && fr.under === 0 && !z.under, { frames: fr.n, measured: fr.measured, lowestAboveGround: Math.round(fr.low), final: Math.round(z.clear ?? -1) });
  check("horizon level after all of it", rollOff(z.roll) < 1, `roll ${deg(z.roll).toFixed(1)}°`);
  if (process.env.SHOT) await p.screenshot({ path: join(process.env.SHOT, "camera-terrain.png") });
  await ctx.close();
}

// ---------------------------------------------------------------- Scenario Lab block
if (!skip.includes("lab")) {
  const { ctx, p, cx, cy } = await open();
  await p.locator('[data-testid="nav-lab"]').click(); await p.locator('[data-testid="lab-card-nurek"]').click();
  await p.locator('[data-testid="scenario-panel"]').waitFor({ timeout: 60_000 });
  await p.waitForFunction(() => window.__ee?.scenario?.renderedLevel() !== undefined); await p.waitForTimeout(5000);
  const box = await p.locator("canvas").first().boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
  let low = Infinity, seen = 0, z;
  const sample = async () => { const s = await state(p); if (s.block !== null) { low = Math.min(low, s.block); seen++; } return s; };
  await p.mouse.move(x, y);
  for (let i = 0; i < 14; i++) { await wheel(p, 6, -240, 50); await sample(); }
  await p.waitForTimeout(2000); z = await sample();
  check("lab: zooming into the terrain block stops above it", seen > 5 && low >= 20, { lowestAboveBlock: Math.round(low), samples: seen, cameraHeight: Math.round(z.h) });
  // Put the camera inside the block (as a flight or an old link could): it must come out on top.
  await p.evaluate(() => { const v = window.__ee.viewer, c = v.camera.positionCartographic.clone(); c.height = 80; v.camera.setView({ destination: v.scene.globe.ellipsoid.cartographicToCartesian(c), orientation: { heading: v.camera.heading, pitch: v.camera.pitch, roll: 0 } }); });
  await p.waitForTimeout(1500); z = await state(p);
  check("lab: a camera placed inside the block is lifted out", z.block !== null && z.block >= 20, { aboveBlock: z.block && Math.round(z.block), cameraHeight: Math.round(z.h) });
  if (process.env.SHOT) await p.screenshot({ path: join(process.env.SHOT, "camera-lab.png") });
  await ctx.close();
}

// ---------------------------------------------------------------- touch screen
if (!skip.includes("touch")) {
  const { ctx, p, cx, cy } = await open({ hasTouch: true });
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  await flyHeight(p, 71, 39, 3_000_000); await p.waitForTimeout(800);
  // one finger: move
  let a = await state(p);
  await touch("touchStart", [[cx, cy]]); for (let i = 1; i <= 10; i++) { await touch("touchMove", [[cx - i * 15, cy]]); await p.waitForTimeout(25); } await touch("touchEnd", []);
  await p.waitForTimeout(1500); let z = await state(p);
  check("touch: one finger moves the map", Math.abs(z.lon - a.lon) > 0.5 && Math.abs(z.h - a.h) < a.h * 0.02, `lon ${a.lon.toFixed(2)} → ${z.lon.toFixed(2)}`);
  // two fingers apart: zoom in
  a = z;
  await touch("touchStart", [[cx - 40, cy], [cx + 40, cy]]); for (let i = 1; i <= 12; i++) { await touch("touchMove", [[cx - 40 - i * 12, cy], [cx + 40 + i * 12, cy]]); await p.waitForTimeout(25); } await touch("touchEnd", []);
  await p.waitForTimeout(1500); z = await state(p);
  check("touch: pinch out zooms in", z.h < a.h * 0.8, `${Math.round(a.h / 1000)} → ${Math.round(z.h / 1000)} km`);
  // two fingers together: zoom out
  a = z;
  await touch("touchStart", [[cx - 200, cy], [cx + 200, cy]]); for (let i = 1; i <= 12; i++) { await touch("touchMove", [[cx - 200 + i * 12, cy], [cx + 200 - i * 12, cy]]); await p.waitForTimeout(25); } await touch("touchEnd", []);
  await p.waitForTimeout(1500); z = await state(p);
  check("touch: pinch in zooms out", z.h > a.h * 1.2, `${Math.round(a.h / 1000)} → ${Math.round(z.h / 1000)} km`);
  // two fingers moved up together: tilt
  await flyHeight(p, 71, 39, 300_000); await p.waitForTimeout(800); a = await state(p);
  await touch("touchStart", [[cx - 40, cy + 100], [cx + 40, cy + 100]]); for (let i = 1; i <= 12; i++) { await touch("touchMove", [[cx - 40, cy + 100 - i * 14], [cx + 40, cy + 100 - i * 14]]); await p.waitForTimeout(25); } await touch("touchEnd", []);
  await p.waitForTimeout(1500); z = await state(p);
  check("touch: two fingers moved together tilt the view", Math.abs(deg(z.pitch) - deg(a.pitch)) > 5 && rollOff(z.roll) < 1, `pitch ${deg(a.pitch).toFixed(0)}° → ${deg(z.pitch).toFixed(0)}°`);
  check("touch: the page itself is not zoomed or scrolled", await p.evaluate(() => visualViewport.scale === 1 && scrollY === 0));
  // tap on a button
  a = z; await p.locator('[data-testid="cam-zoom-in"]').tap(); await p.waitForTimeout(1200); z = await state(p);
  check("touch: tap on the zoom-in button", z.h < a.h * 0.9, `${Math.round(a.h / 1000)} → ${Math.round(z.h / 1000)} km`);
  await ctx.close();
}

await b.close();
for (const e of errs.slice(0, 5)) console.log(e.slice(0, 400));
if (fails.length || errs.length) { console.error(`FAILED: ${fails.length} checks, ${errs.length} page errors`); process.exit(1); } else console.log("PASS");
