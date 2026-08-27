/**
 * diagnose-contrast.mjs — print axe's ACTUAL computed contrast data
 * (foreground, background, ratio, required threshold) for every
 * colour-contrast violation, in both themes.
 *
 * Run: node diagnose-contrast.mjs
 */

import puppeteer from "puppeteer-core";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const URL = process.env.TEST_URL || "http://127.0.0.1:5173/";
const CHROME =
  process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle"]
});
const page = await browser.newPage();

async function audit(label, { mobile = false, light = false, openMenu = false } = {}) {
  await page.setViewport(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.goto(URL, { waitUntil: "networkidle2" });
  await page.waitForFunction(() => {
    const p = document.getElementById("preloader");
    return !p || p.classList.contains("is-done");
  }, { timeout: 15000 });

  const theme = await page.evaluate((wantLight) => {
    const cur = document.documentElement.getAttribute("data-theme");
    if (wantLight && cur !== "light") document.getElementById("themeToggle").click();
    if (!wantLight && cur !== "dark") document.getElementById("themeToggle").click();
    return document.documentElement.getAttribute("data-theme");
  }, light);

  if (openMenu) {
    await page.evaluate(() => document.getElementById("burger").click());
    await page.evaluate(() => new Promise((r) => setTimeout(r, 900)));
  }
  await page.evaluate(() => new Promise((r) => setTimeout(r, 500)));

  await page.evaluate(AXE);
  const rows = await page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: ["color-contrast"] });
    const out = [];
    for (const v of r.violations) {
      for (const n of v.nodes) {
        for (const c of [...(n.any || []), ...(n.all || [])]) {
          if (!c.data) continue;
          out.push({
            html: n.html.slice(0, 90),
            target: n.target.join(" "),
            fg: c.data.fgColor,
            bg: c.data.bgColor,
            ratio: c.data.contrastRatio,
            expected: c.data.expectedContrastRatio,
            fontSize: c.data.fontSize,
            fontWeight: c.data.fontWeight
          });
        }
      }
    }
    return out;
  });

  console.log(`\n=== ${label}  (theme=${theme}) — ${rows.length} contrast issue(s) ===`);
  for (const r of rows) {
    console.log(`  ${r.target}`);
    console.log(`     ${r.html}`);
    console.log(`     fg=${r.fg} bg=${r.bg}  ratio=${r.ratio} (need ${r.expected})  ${r.fontSize} ${r.fontWeight}`);
  }
  return rows;
}

await audit("DESKTOP dark");
await audit("DESKTOP light", { light: true });
await audit("MOBILE dark + menu open", { mobile: true, openMenu: true });
await audit("MOBILE light + menu open", { mobile: true, light: true, openMenu: true });

await browser.close();
