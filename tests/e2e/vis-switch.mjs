// Regression test for audit finding V-01: in "Travel in Time", after another variable is chosen or after
// "Difference from normal" -> "Measured values", the numeric layer on the globe must show the NEW data,
// not one flat colour. The picture is checked in real screenshots (the WebGL canvas cannot be read back):
//   1. stale  — the picture must not change when one more frame is forced (scene.requestRender());
//               a change means the first picture was drawn from an out-of-date texture;
//   2. flat   — the share of the most frequent colour inside the globe disc must stay below FLAT_SHARE.
//   node tests/e2e/vis-switch.mjs http://localhost:8088/     (needs Playwright; PLAYWRIGHT_DIR like the other tests)
//   SHOTS=/dir saves the screenshots; CHROMIUM_ARGS="--use-angle=gl ..." replaces the launch arguments.
import { createRequire } from "node:module"; import { homedir } from "node:os"; import { join } from "node:path";
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR ?? join(homedir(), ".claude/skills/gstack/browse"), "package.json"))("playwright");
const url = process.argv[2] ?? "http://localhost:8088/";
const FLAT_SHARE = 0.9, STALE_SHARE = 0.02;
const CLIP = { x: 570, y: 280, width: 300, height: 300 }; // inside the globe disc at 1440x900 (home view)
const b = await chromium.launch({ args: process.env.CHROMIUM_ARGS ? process.env.CHROMIUM_ARGS.split(" ") : ["--enable-unsafe-swiftshader"] });
let fails = 0;
try {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push("PAGEERROR " + e.message.slice(0, 300)));
  const T = (id) => p.locator(`[data-testid="${id}"]`);
  const btn = (t) => T("time-card").getByRole("button", { name: t, exact: true }).click();
  let n = 0;
  const grab = async (name) => {
    const buf = await p.screenshot({ clip: CLIP });
    if (process.env.SHOTS) await p.screenshot({ path: join(process.env.SHOTS, `vis-switch-${String(++n).padStart(2, "0")}-${name}.png`) });
    return buf.toString("base64");
  };
  // Colour statistics of one screenshot and the share of pixels that differ from a second one.
  const stats = (a, c) => p.evaluate(async ([a, c]) => {
    const px = async (png) => { const img = new Image(); img.src = "data:image/png;base64," + png; await img.decode(); const g = document.createElement("canvas"); g.width = img.width; g.height = img.height; const x = g.getContext("2d"); x.drawImage(img, 0, 0); return x.getImageData(0, 0, g.width, g.height).data; };
    const d = await px(a), e = await px(c);
    const count = new Map(); let diff = 0;
    for (let i = 0; i < d.length; i += 4) {
      const k = (d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3); // 5 bits per channel
      count.set(k, (count.get(k) ?? 0) + 1);
      if (Math.abs(d[i] - e[i]) + Math.abs(d[i + 1] - e[i + 1]) + Math.abs(d[i + 2] - e[i + 2]) > 24) diff++;
    }
    const total = d.length / 4;
    return { colours: count.size, top: Math.max(...count.values()) / total, changed: diff / total };
  }, [a, c]);
  // Wait until the frame in memory is the requested one, then let the scene settle.
  const loaded = async (variable, kind) => {
    await p.waitForFunction(([variable, kind]) => { const f = window.__ee?.vis?.frames; const h = f?.planet?.h; return !!h && !f.loading && h.variable === variable && (h.kind ?? "value") === kind; }, [variable, kind], { timeout: 60_000 });
    await p.waitForTimeout(4000);
  };
  const check = async (name, variable, kind) => {
    await loaded(variable, kind);
    const first = await grab(name);
    await p.evaluate(() => window.__ee.viewer.scene.requestRender()); await p.waitForTimeout(700);
    await p.evaluate(() => window.__ee.viewer.scene.requestRender()); await p.waitForTimeout(700);
    const s = await stats(first, await grab(name + "-forced"));
    const bad = [s.changed > STALE_SHARE && "STALE picture (changes when a frame is forced)", s.top > FLAT_SHARE && "FLAT colour"].filter(Boolean);
    if (bad.length) fails++;
    console.log(`${bad.length ? "FAIL" : "ok  "} ${name.padEnd(34)} colours=${String(s.colours).padStart(4)} top=${(s.top * 100).toFixed(1).padStart(5)}% changed-after-forced-frame=${(s.changed * 100).toFixed(1).padStart(5)}%  ${bad.join("; ")}`);
  };

  await p.goto(url);
  await p.waitForFunction(() => !!window.__ee?.viewer?.scene?.globe);
  console.log("renderer:", await p.evaluate(() => { const g = document.createElement("canvas").getContext("webgl2"); const x = g?.getExtension("WEBGL_debug_renderer_info"); return x ? g.getParameter(x.UNMASKED_RENDERER_WEBGL) : "unknown"; }));
  await T("nav-g-explore").click(); await T("nav-time").click(); await T("time-card").waitFor({ timeout: 60_000 });
  const pick = (v) => T("time-card").locator("select").first().selectOption(v);
  await p.waitForTimeout(6000); // imagery and the first frame
  await check("fresh page: temperature", "t2m", "value");
  await pick("precip"); await check("-> precipitation", "precip", "value");
  await pick("t2m"); await check("-> temperature", "t2m", "value");
  await btn("Difference from normal"); await check("-> difference from normal", "t2m", "anomaly");
  await btn("Measured values"); await check("-> measured values", "t2m", "value");
  await pick("precip"); await check("-> precipitation (after anomaly)", "precip", "value");
  for (const e of errs) { console.log(e); fails++; }
} catch (e) { console.log("ERROR " + (e.stack ?? e)); fails++; } finally { await b.close(); }
console.log(fails ? `FAIL vis-switch (${fails})` : "PASS vis-switch");
process.exit(fails ? 1 : 0);
