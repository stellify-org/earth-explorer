// Regression test: switching modes and visualisation types must never break a view.
//   node tests/e2e/mode-switch.mjs http://localhost:8080/   (needs Playwright; PLAYWRIGHT_DIR like tests/perf)
import { createRequire } from "node:module"; import { homedir } from "node:os"; import { join } from "node:path";
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR ?? join(homedir(), ".claude/skills/gstack/browse"), "package.json"))("playwright");
const b = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" }); await ctx.addInitScript(() => localStorage.setItem("ee.advanced", "1")); // Advanced Tools: the full panels this check drives
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push("PAGEERROR " + e.stack)); p.on("console", (m) => { if (m.type() === "error") errs.push("CONSOLE " + m.text()); });
await p.goto(process.argv[2] ?? "http://localhost:8080/"); await p.waitForTimeout(6000);
// Header: Explore (Explore Earth, Travel in Time) · Investigate · Discover (Event Detective, Inside Earth) · What If?; Compare is in the "More" menu.
const NAV = ["explore", "compare", "xray", "lab"];
const GROUP = { explore: "nav-g-explore", xray: "nav-g-discover", compare: "more-menu" }; // Explore / Discover open a two-item menu; What If? is direct
const nav = async (i) => { const sel = `[data-testid="nav-${NAV[i]}"]`; if (GROUP[NAV[i]]) await p.click(`[data-testid="${GROUP[NAV[i]]}"]`); await p.click(sel); };
const click = (t) => p.evaluate((t) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === t)?.click(), t);
const failed = () => p.evaluate(() => document.body.innerText.match(/view failed: [^\n]*/)?.[0] ?? "fine");
let fails = 0;
const step = async (name, fn, ms = 4000) => { await fn(); await p.waitForTimeout(ms); const f = await failed(); if (f !== "fine") fails++; console.log(name.padEnd(28), f); };
await p.waitForSelector('[aria-label="Visualisation variable"] option[value="t2m"]', { state: "attached" });
await step("vis t2m surface", () => p.selectOption('[aria-label="Visualisation variable"]', "t2m"));
await step("-> compare", () => nav(1), 5000);
await step("-> explore", () => nav(0), 6000);
await step("shell", () => click("Atmospheric shell"));
await step("extrude", () => click("Extruded cells"), 6000);
await step("surface", () => click("Surface heatmap"));
await step("-> x-ray", () => nav(2));
await step("-> explore", () => nav(0), 6000);
await step("wind flow", () => p.selectOption('[aria-label="Visualisation variable"]', "wind10m"));
await step("-> scenario lab", () => nav(3));
await step("-> compare", () => nav(1), 5000);
await step("-> explore", () => nav(0), 6000);
await step("-> travel in time", () => p.click('[data-testid="nav-g-explore"]').then(() => p.click('[data-testid="nav-time"]')), 5000);
await step("-> event detective", () => p.click('[data-testid="nav-g-discover"]').then(() => p.click('[data-testid="nav-events"]')), 8000);
await step("-> inside earth", () => nav(2));
await step("-> event detective", () => p.click('[data-testid="nav-g-discover"]').then(() => p.click('[data-testid="nav-events"]')), 4000);
await step("-> explore", () => nav(0), 5000);
await step("-> explore", () => nav(0), 5000);
await step("vis off", () => p.selectOption('[aria-label="Visualisation variable"]', ""));
console.log("errors:", errs.length); for (const e of errs.slice(0, 4)) console.log(e.slice(0, 700), "\n---");
await b.close();
if (errs.length || fails) { console.error("FAILED"); process.exit(1); } else console.log("PASS");
