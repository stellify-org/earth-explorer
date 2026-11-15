// Captures real screenshots from the deployed Earth Explorer for the presentation.
//   node submission/build/capture.mjs [url] [outDir]
import { createRequire } from "node:module"; import { homedir } from "node:os"; import { join } from "node:path";
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR ?? join(homedir(), ".claude/skills/gstack/browse"), "package.json"))("playwright");
const url = process.argv[2] ?? "https://stellify.myspaceproject.app/";
const out = process.argv[3] ?? "submission/presentation_screenshots/original";
const only = (process.env.ONLY ?? "").split(",").filter(Boolean);
const b = await chromium.launch({ args: (process.env.CHROMIUM_ARGS ?? "--enable-unsafe-swiftshader").split(" ") });
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2, serviceWorkers: "block" });
const p = await ctx.newPage();
p.on("dialog", (d) => d.accept());
p.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 200)));
const T = (id) => p.locator(`[data-testid="${id}"]`);
const shot = async (n) => { await p.screenshot({ path: join(out, n + ".png") }); console.log("shot", n); };
const setInput = (sel, v) => p.locator(sel).first().evaluate((el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, String(v)); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, v);
const load = async () => { await p.goto(url); await p.waitForFunction(() => !!window.__ee?.viewer?.scene?.globe, null, { timeout: 90000 }); await p.waitForTimeout(7000); };
const stage = async (name, fn) => { if (only.length && !only.includes(name)) return; try { await load(); await fn(); } catch (e) { console.log("STAGE FAILED", name, String(e).slice(0, 400)); try { await shot("FAILED-" + name); } catch {} } };

await stage("home", async () => {
  await T("home").waitFor(); await shot("01-home");
  await T("home-explore").click(); await p.waitForTimeout(6000); await shot("02-globe");
});
await stage("trend", async () => {
  await T("start-investigating").click(); await T("investigate").waitFor(); await shot("03-investigate-empty");
  await T("inv-step-1").locator("button").first().click();
  await T("investigate").getByRole("button", { name: "Dushanbe", exact: true }).click(); await p.waitForTimeout(6000);
  console.log("inv testids:", await p.evaluate(() => [...document.querySelectorAll('[data-testid]')].map((e) => e.dataset.testid).join(" ")));
  await T("inv-var-t2m").click(); await T("period-full").click(); await p.waitForTimeout(1500); await shot("04-investigate-dushanbe");
  await T("analyze-changes").click(); await T("trend-plain").waitFor({ timeout: 120000 }); await p.waitForTimeout(4000); await shot("05-trend-result");
  console.log("TREND PANEL TEXT:\n" + (await T("trend-panel").innerText()));
  await T("trend-panel").screenshot({ path: join(out, "05b-trend-panel.png") });
  await T("trend-details").locator("summary").first().click(); await p.getByText("Statistical evidence").waitFor(); await p.waitForTimeout(1500); await shot("06-trend-details");
  await T("trend-panel").screenshot({ path: join(out, "06b-trend-panel-details.png") });
  console.log("TREND DETAILS TEXT:\n" + (await T("trend-details").innerText()));
});
await stage("events", async () => {
  await T("nav-g-discover").click(); await T("nav-events").click(); await T("events-panel").waitFor(); await p.waitForTimeout(6000); await shot("07-events-overview");
  const ids = await p.evaluate(() => [...document.querySelectorAll('[data-testid^="ev-story-"]')].map((e) => e.dataset.testid));
  console.log("stories:", ids.join(" "));
  console.log("EVENTS PANEL TEXT:\n" + (await T("events-panel").innerText()).slice(0, 1500));
  for (const id of ids) {
    try {
      await T(id).click(); const ev = id.replace("ev-story-", "");
      await p.waitForFunction((ev) => { const el = document.querySelector('[data-testid="impact"]'); return el?.dataset.event === ev && el.dataset.status === "ready"; }, ev, { timeout: 90000 });
      await p.waitForTimeout(12000); await shot("08-event-" + ev);
      console.log("IMPACT " + ev + ":\n" + (await T("impact").innerText()).slice(0, 1200));
      const back = p.getByRole("button", { name: /back|all events|close/i }).first(); if (await back.count()) await back.click(); await p.waitForTimeout(1500);
      if (!(await T(id).count())) { await load(); await T("nav-g-discover").click(); await T("nav-events").click(); await T("events-panel").waitFor(); await p.waitForTimeout(3000); }
    } catch (e) { console.log("event failed", id, String(e).slice(0, 200)); await shot("FAILED-" + id); await load(); await T("nav-g-discover").click(); await T("nav-events").click(); await T("events-panel").waitFor(); await p.waitForTimeout(3000); }
  }
});
await stage("scenario", async () => {
  await T("nav-lab").click(); await p.waitForTimeout(1500); await shot("09-lab-cards");
  await T("lab-card-nurek").click(); await T("scenario-panel").waitFor({ timeout: 60000 });
  await p.waitForFunction(() => window.__ee?.scenario?.renderedLevel() !== undefined, null, { timeout: 60000 }); await p.waitForTimeout(10000); await shot("10-nurek-baseline");
  await setInput('input[aria-label="Water level"]', 900); await p.waitForTimeout(6000); await shot("11-nurek-900");
  console.log("SCENARIO PANEL TEXT:\n" + (await T("scenario-panel").innerText()).slice(0, 2500));
});
await stage("interior", async () => {
  await T("nav-g-discover").click(); await T("nav-xray").click(); await p.waitForTimeout(12000); await shot("12-inside-earth");
  console.log("INTERIOR TEXT:\n" + (await p.locator("aside").first().innerText().catch(() => "")).slice(0, 1500));
});
await b.close(); console.log("DONE");
