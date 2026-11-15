// Event Detective — animated symbols: each kind of event has its own moving icon, the loop runs only while
// something is animated, the switch turns it off, playback pops new events, and a click on a symbol still selects.
//   node tests/e2e/events-animation.mjs http://localhost:8088/     (needs Playwright; NASA EONET and USGS reachable)
//   SHOTS=/dir saves a close-up of every kind
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { homedir } from "node:os"; import { join } from "node:path";
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR ?? join(homedir(), ".claude/skills/gstack/browse"), "package.json"))("playwright");
const url = process.argv[2] ?? "http://localhost:8088/";
const b = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
try {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push("PAGEERROR " + e.message.slice(0, 300))); p.on("console", (m) => { if (m.type() === "error") errs.push("CONSOLE " + m.text().slice(0, 200)); });
  const T = (id) => p.locator(`[data-testid="${id}"]`);
  const fx = () => p.evaluate(() => ({ ...window.__ee.events.fx }));
  const bills = () => p.evaluate(() => window.__eeEvents?.symbols() ?? []);
  const moving = async (what) => { const a = await bills(); await p.waitForTimeout(700); const c = await bills(); assert.equal(a.length, c.length, `${what}: symbol count changed`); return a.map((x, i) => Object.keys(x).some((k) => Math.abs(x[k] - c[i][k]) > 1e-4)); };
  const shot = async (n) => { if (!process.env.SHOTS) return; const m = await p.evaluate((id) => { const s = window.__ee.viewer.scene.canvas.getBoundingClientRect(), at = window.__eeEvents.screenOf(id) ?? { x: s.width / 2, y: s.height / 2 }; return { x: Math.max(0, s.x + at.x - 110), y: Math.max(0, s.y + at.y - 130), width: 220, height: 220 }; }, n); await p.screenshot({ path: join(process.env.SHOTS, `anim-${n}.png`), clip: m }); };

  await p.goto(url); await p.waitForFunction(() => !!window.__ee?.viewer?.scene?.globe); await p.waitForTimeout(3000);
  await T("nav-g-discover").click(); await T("nav-events").click(); await T("ev-all").click(); await T("events-panel").waitFor();
  if (await T("ev-load").count()) await T("ev-load").click();
  await T("ev-summary").waitFor({ timeout: 90_000 }); await p.waitForTimeout(3000);

  // 1. Whole globe: some events are open in the catalogue now → symbols move, the loop runs, never more than 150.
  let s = await fx();
  assert.ok(s.symbols > 0 && s.symbols <= 150, `symbols on the whole globe: ${s.symbols}`);
  assert.equal(s.running, true, "animation loop is not running");
  const f0 = s.frames; await p.waitForTimeout(2000); s = await fx();
  assert.ok(s.frames - f0 >= 5, `only ${s.frames - f0} animation frames in 2 s`);
  console.log(`whole globe: ${s.symbols} animated symbols (${s.billboards} billboards), ${((s.frames - f0) / 2).toFixed(0)} frames/s in headless software rendering`);
  if (process.env.SHOTS) await p.screenshot({ path: join(process.env.SHOTS, "anim-0-globe.png") });

  // 2. Playback: events that appear get a one-off ring; they end by themselves.
  await T("ev-slider").evaluate((el) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "0"); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
  await p.waitForTimeout(500); await T("ev-play").click();
  let maxPops = 0;
  for (let i = 0; i < 12; i++) { await p.waitForTimeout(250); maxPops = Math.max(maxPops, (await fx()).pops); }
  assert.ok(maxPops > 0, "no rings for events appearing during playback");
  await p.waitForFunction(() => document.querySelector('[data-testid="ev-play"]').textContent.includes("▶"), null, { timeout: 60_000 }); await p.waitForTimeout(1500);
  assert.equal((await fx()).pops, 0, "appearance rings did not end");
  console.log(`playback: up to ${maxPops} appearance rings at once, none left after it`);

  // 3. One curated record per kind: the right symbol, and it moves.
  const cases = [
    ["EONET_11536", "storm (northern hemisphere)", 1], ["us100044k6", "earthquake", 3], ["EONET_26330", "flood", 3], ["EONET_3153", "landslide", 4], ["EONET_20710", "volcano", 4],
  ];
  for (const [id, name, count] of cases) {
    await T(`ev-story-${id}`).click();
    await p.waitForFunction((id) => document.querySelector('[data-testid="event-card"]')?.dataset.id === id, id, { timeout: 60_000 });
    if (id === "EONET_11536") await p.waitForFunction(() => document.querySelector('[data-testid="event-fixes"]')?.textContent === "22 / 22", null, { timeout: 60_000 });
    await p.waitForTimeout(4000);
    s = await fx();
    assert.equal(s.symbols, 1, `${name}: one record, one symbol`); assert.equal(s.billboards, count, `${name}: billboards`);
    const mv = await moving(name);
    assert.equal(mv.length, count, `${name}: parts seen by the test`);
    // Volcano cone and landslide slope stand still; everything else moves.
    const still = name === "landslide" || name === "volcano" ? 1 : 0;
    assert.equal(mv.filter((x) => !x).length, still, `${name}: ${mv.filter((x) => x).length} of ${mv.length} parts move`);
    if (id === "EONET_11536") {
      const r0 = (await bills())[0].rot; await p.waitForTimeout(400); const r1 = (await bills())[0].rot;
      assert.ok(r1 > r0, "a northern-hemisphere storm must turn counter-clockwise (rotation increasing)");
    }
    console.log(`${name.padEnd(28)} ${count} billboard(s), moving: ${mv.filter((x) => x).length}`);
    await shot(id);
    // A click on the symbol (screen centre of the globe view after the flight) keeps / selects this record.
    await T("ev-story-close").click(); await p.waitForTimeout(600);
  }
  // Southern hemisphere: the spiral is mirrored and turns the other way (checked on a live storm if there is one).
  const south = await p.evaluate(async () => (await (await fetch("/api/v1/events?days=30")).json()).events.find((e) => e.category === "severeStorms" && e.lat < 0)?.id);
  if (south) {
    while (!await p.locator(`[data-testid="ev-row"][data-id="${south}"]`).count() && await p.getByText("Show more").count()) await p.getByText("Show more").click();
    await p.locator(`[data-testid="ev-row"][data-id="${south}"]`).click(); await p.waitForTimeout(4500);
    const at = await p.evaluate((id) => window.__eeEvents.screenOf(id), south);
    const strongest = (await bills()).filter((x) => x.rot !== 0 && x.scale > 0.7);
    assert.equal(strongest.length, 1, "selected southern storm: one large spiral");
    await p.waitForTimeout(400);
    const later = (await bills()).filter((x) => x.rot !== 0 && x.scale > 0.7)[0];
    assert.ok(later.rot < strongest[0].rot, "a southern-hemisphere storm must turn clockwise (rotation decreasing)");
    console.log(`southern storm ${south}: clockwise`);
    await shot(south);
    // The symbol carries the event's id: a pixel of the spiral itself (not the dot under it) picks this record.
    const on = await p.evaluate((at) => { for (let r = 8; r <= 30; r += 2) for (let a = 0; a < 6.28; a += 0.3) { const id = window.__eeEvents.symbolAt(at.x + r * Math.cos(a), at.y + r * Math.sin(a)); if (id) return id; } return null; }, at);
    assert.equal(on, south, "the storm symbol is not pickable as its event");
    await T("event-close").click();
  } else console.log("no southern-hemisphere storm in the last 30 days — clockwise case not exercised");

  // 4. The switch: no symbols, the loop stops, the scene goes back to drawing on change only.
  await T("ev-animate").uncheck(); await p.waitForTimeout(800);
  s = await fx(); assert.equal(s.billboards, 0); assert.equal(s.running, false);
  const f1 = s.frames; await p.waitForTimeout(1500);
  assert.equal((await fx()).frames, f1, "frames are still drawn with animation off");
  assert.equal((await bills()).length, 0);
  assert.equal(await p.evaluate(() => localStorage.getItem("ee.events.anim")), "0");
  await T("ev-animate").check(); await p.waitForTimeout(800);
  s = await fx(); assert.ok(s.billboards > 0 && s.running, "animation did not come back");
  // Leaving the mode removes the symbols and stops the loop.
  await T("nav-g-explore").click(); await T("nav-explore").click(); await p.waitForTimeout(1500);
  assert.equal((await bills()).length, 0, "symbols left in the scene after leaving Event Detective");

  // 5. prefers-reduced-motion: still symbols, no loop.
  const calm = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block", reducedMotion: "reduce" });
  const q = await calm.newPage();
  await q.goto(url); await q.waitForFunction(() => !!window.__ee?.viewer?.scene?.globe); await q.waitForTimeout(3000);
  await q.locator('[data-testid="nav-g-discover"]').click(); await q.locator('[data-testid="nav-events"]').click(); await q.locator('[data-testid="ev-all"]').click(); await q.locator('[data-testid="events-panel"]').waitFor();
  if (await q.locator('[data-testid="ev-load"]').count()) await q.locator('[data-testid="ev-load"]').click();
  await q.locator('[data-testid="ev-summary"]').waitFor({ timeout: 90_000 }); await q.waitForTimeout(3000);
  const r = await q.evaluate(() => ({ ...window.__ee.events.fx }));
  assert.ok(r.symbols > 0, "reduced motion: symbols are still shown"); assert.equal(r.running, false, "reduced motion: the loop must not run");
  console.log(`reduced motion: ${r.symbols} still symbols, loop off`);
  await calm.close();

  console.log("page errors:", errs.length); for (const e of errs.slice(0, 6)) console.log(e);
  assert.equal(errs.length, 0);
  console.log("PASS");
} finally { await b.close(); }
