// Earth Interior with no connection: after one online visit to Crust Explorer (which pins the
// CRUST1.0 file), the cutaway and the crust column must work after an offline reload.
//   node tests/e2e/earth-interior-offline.mjs http://localhost:8080/
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { homedir } from "node:os"; import { join } from "node:path";
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR ?? join(homedir(), ".claude/skills/gstack/browse"), "package.json"))("playwright");
const b = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
try {
  const ctx = await b.newContext({ viewport: { width: 1300, height: 800 } }); const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message.slice(0, 300)));
  const xray = async () => { await p.click('[data-testid="nav-g-discover"]'); await p.click('[data-testid="nav-xray"]'); await p.waitForTimeout(7000); };
  const crust = async () => { await p.getByRole("button", { name: "Crust Explorer", exact: true }).click(); await p.waitForTimeout(1500);
    await p.evaluate(() => window.__ee.viewer.camera.flyHome(0)); await p.waitForTimeout(1500); await p.mouse.click(480, 300); await p.waitForTimeout(5000);
    return p.locator('[data-testid="crust-summary"]').textContent(); };
  await p.goto(process.argv[2] ?? "http://localhost:8080/");
  await p.evaluate(async () => { await navigator.serviceWorker.ready; }); await p.waitForFunction(() => !!navigator.serviceWorker.controller);
  await p.waitForTimeout(5000); await xray();
  const online = await crust();
  assert.match(online, /Moho/);
  assert(await p.evaluate(async () => !!await (await caches.open("ee-geo-packs")).match("/crust1/crust1.bin")), "CRUST1.0 was not pinned");
  await ctx.setOffline(true);
  await p.reload(); await p.waitForFunction(() => !!window.__ee?.viewer?.scene?.globe); await p.waitForTimeout(4000);
  await xray();
  const cut = await p.evaluate(() => { const s = window.__ee.viewer.scene; return { prims: s.primitives.length, clipped: s.globe.clippingPlanes.enabled && s.globe.clippingPlanes.length > 0 }; });
  assert(cut.prims >= 5 && cut.clipped, "cutaway not drawn offline: " + JSON.stringify(cut));
  const offline = await crust();
  assert.equal(offline, online);
  assert.deepEqual(errs, []);
  console.log(JSON.stringify({ online, offline, cut })); console.log("PASS");
} finally { await b.close(); }
