// The four user journeys of the simple interface, on a desktop and a phone viewport.
//   node tests/e2e/journeys.mjs http://localhost:8080/     (needs Playwright; NASA POWER must be reachable for the trend)
//   SHOTS=/some/dir saves a screenshot of every stage.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { homedir } from "node:os"; import { join } from "node:path";
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR ?? join(homedir(), ".claude/skills/gstack/browse"), "package.json"))("playwright");
const url = process.argv[2] ?? "http://localhost:8080/";
const b = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
const errs = [];
try {
  for (const [name, viewport] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 390, height: 780 }]]) {
    const ctx = await b.newContext({ viewport, serviceWorkers: "block", hasTouch: name === "mobile" });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errs.push(`${name} PAGEERROR ${e.message.slice(0, 300)}`)); p.on("console", (m) => { if (m.type() === "error") errs.push(`${name} CONSOLE ${m.text().slice(0, 300)}`); });
    const shot = async (stage) => { if (process.env.SHOTS) await p.screenshot({ path: join(process.env.SHOTS, `${name}-${stage}.png`) }); };
    const T = (id) => p.locator(`[data-testid="${id}"]`);
    const overflow = () => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    await p.goto(url); await p.waitForFunction(() => !!window.__ee?.viewer?.scene?.globe); await p.waitForTimeout(5000);
    await p.evaluate(() => { window.__v0 = window.__ee.viewer; });

    // Journey 1 — first visit: the planet, three choices, a place, something to read, back home.
    await T("home").waitFor(); await shot("1-home");
    assert.equal(await p.locator("nav button").count(), 4, "four header entries: Explore, Investigate, Discover, What If?");
    assert.equal(await T("start-investigating").count(), 1, "one primary action on the first screen");
    assert.equal(await p.locator("aside").count(), 0, "no side panel on launch");
    assert.equal(await overflow(), false, "home overflows horizontally");
    await T("home-explore").click();
    assert.equal(await T("home").count(), 0);
    const box = await p.locator("canvas").first().boundingBox();
    await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2); // centre of the globe
    await T("place-card").waitFor(); await shot("2-place");
    await T("analyze").click();
    await T("trend-plain").waitFor({ timeout: 120_000 }); await p.waitForTimeout(1500); await shot("3-trend");
    const plain = await T("trend-plain").innerText();
    assert.match(plain, /getting|No clear long-term change|inconclusive|evidence is weak|not enough data|not reliable/, "plain-language result: " + plain);
    // The trend and the anomaly are two separate indicators with a number, a unit and a reference.
    const trendInd = await T("ind-trend").innerText(), anomInd = await T("ind-anomaly").innerText();
    assert.match(trendInd, /Long-term trend[\s\S]*([+−]?\d+\.\d+[\s\S]*per decade|No data)/, "trend indicator: " + trendInd);
    assert.match(anomInd, /Anomaly[\s\S]*(Compared with the \d{4}–\d{4} average for|No data)/, "anomaly indicator: " + anomInd);
    assert.equal(await T("anomaly-vs-trend").count(), 1, "the difference between an anomaly and a trend is stated");
    // The period is chosen in the panel itself (audit T-01), not in Advanced tools.
    await T("period-last30").click(); await p.waitForTimeout(1500);
    await p.waitForFunction((y) => document.querySelector('[data-testid="ind-trend"]')?.innerText.includes(String(y)), new Date().getUTCFullYear() - 30, { timeout: 120_000 });
    await T("period-full").click(); await p.waitForTimeout(1500);

    // Journey 3 — the investigator expands Advanced Tools for the statistics.
    assert.equal(await T("trend-details").evaluate((d) => d.open), false, "technical details start closed");
    await T("trend-details").locator("summary").first().click();
    await p.getByText("Statistical evidence").waitFor(); await shot("4-trend-details");
    await T("trend-close").click();
    assert.equal(await T("trend-panel").count(), 0);

    // Journey 2 — time traveller: variable, period, visible change, chart.
    await T("nav-g-explore").click(); await T("nav-time").click(); await T("time-card").waitFor();
    await p.waitForSelector('[aria-label="What to show"] option[value="precip"]', { state: "attached", timeout: 60_000 });
    await p.selectOption('[aria-label="What to show"]', "precip"); await p.waitForTimeout(4000);
    await p.locator('input[aria-label="Date"]').fill("2000-07-01"); await p.waitForTimeout(5000);
    assert.match(await T("time-card").innerText(), /2000-07/, "the map shows the chosen month");
    await shot("5-time");
    await T("time-card").getByRole("button", { name: "Analyze this change" }).click();
    await T("trend-plain").waitFor({ timeout: 120_000 }); await shot("6-time-chart");
    assert.equal(await T("trend-panel").locator(".recharts-wrapper, svg").count() > 0, true, "a chart is drawn");
    await T("trend-close").click();

    // Journey 4 — inside Earth: cutaway drawn, a layer can be selected and read.
    await T("nav-g-discover").click(); await T("nav-xray").click(); await p.waitForTimeout(8000);
    assert.equal(await p.evaluate(() => window.__ee.viewer.scene.primitives.length >= 5), true, "cutaway layers are drawn");
    await shot("7-inside");
    assert.equal(await p.getByRole("button", { name: "Planetary Cutaway", exact: true }).count(), 1);

    // Same globe all the way: switching experiences must not rebuild the viewer.
    await T("nav-g-explore").click(); await T("nav-explore").click(); await p.waitForTimeout(3000);
    assert.equal(await p.evaluate(() => window.__v0 === window.__ee.viewer && !window.__v0.isDestroyed()), true, "the globe was rebuilt by navigation");

    // Home again, then two guided discoveries.
    await T("home-link").click(); await T("home").waitFor();
    await T("more-questions").click(); await T("guide-past").click(); await T("guide-card").waitFor(); await T("time-card").waitFor(); await p.waitForTimeout(5000);
    assert.match(await T("time-card").innerText(), new RegExp(String(new Date().getUTCFullYear() - 31)), "30 years back");
    await shot("8-guide-past");
    await T("home-link").click(); await T("more-questions").click(); await T("guide-quakes").click(); await T("guide-card").waitFor();
    // In Low Bandwidth Mode (detected automatically on a slow link) the catalogue loads only on request.
    const lowBandwidth = await p.getByText("Low bandwidth", { exact: true }).count() > 0;
    if (lowBandwidth) { console.log(name, "low bandwidth detected: loading earthquakes with the button"); await p.getByRole("button", { name: "Load earthquakes", exact: true }).click(); }
    await p.getByText("Catalogue extract").waitFor({ timeout: 90_000 }); await p.waitForTimeout(3000); await shot("9-guide-quakes");
    assert.equal(await overflow(), false, "page overflows horizontally");
    // Journey 5 — the guided investigation from the first screen: place, question, period, Analyze Changes.
    await T("home-link").click(); await T("start-investigating").click(); await T("investigate").waitFor();
    assert.equal(await T("analyze-changes").isDisabled(), false, "a place chosen earlier is kept"); await shot("10-investigate");
    await T("inv-step-1").locator("button").first().click();
    await T("investigate").getByRole("button", { name: "Dushanbe", exact: true }).click(); await p.waitForTimeout(2500);
    await T("inv-var-precip").click();
    await T("period-last30").click();
    await T("analyze-changes").click();
    await T("trend-plain").waitFor({ timeout: 120_000 }); await p.waitForTimeout(1500); await shot("11-investigation-result");
    assert.match(await T("trend-panel").innerText(), /Dushanbe/);
    assert.match(await T("ind-trend").innerText(), /mm\/day per decade|No data/);
    assert.equal(await overflow(), false, "page overflows horizontally");
    await T("trend-close").click();
    console.log(name.padEnd(8), "journeys ok ·", plain.replace(/\s+/g, " ").slice(0, 150));
    await ctx.close();
  }
  console.log("errors:", errs.length); for (const e of errs.slice(0, 6)) console.log(e);
  assert.equal(errs.length, 0);
  console.log("PASS");
} finally { await b.close(); }
