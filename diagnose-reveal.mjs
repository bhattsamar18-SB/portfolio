/**
 * diagnose-reveal.mjs — pinpoint which [data-reveal] elements never fire
 * and why the skill bars stay at 0 width.
 *
 * Run: node diagnose-reveal.mjs
 */

import puppeteer from "puppeteer-core";

const URL = process.env.TEST_URL || "http://127.0.0.1:5173/";
const CHROME =
  process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle"]
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(URL, { waitUntil: "networkidle2" });
await page.waitForFunction(() => {
  const p = document.getElementById("preloader");
  return !p || p.classList.contains("is-done");
}, { timeout: 15000 });

// same scroll sweep the render test uses
await page.evaluate(async () => {
  const step = window.innerHeight * 0.7;
  for (let y = 0; y < document.body.scrollHeight; y += step) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 120));
  }
});
await new Promise((r) => setTimeout(r, 1800));

const report = await page.evaluate(() => {
  const desc = (el) => {
    const cls = (el.className || "").toString().split(" ").slice(0, 3).join(".");
    const sec = el.closest("section")?.id || el.closest("footer") ? "footer" : "?";
    return {
      tag: el.tagName.toLowerCase(),
      cls,
      section: el.closest("section")?.id || (el.closest("footer") ? "footer" : "none"),
      text: (el.textContent || "").trim().slice(0, 40).replace(/\s+/g, " "),
      display: getComputedStyle(el).display,
      visibility: getComputedStyle(el).visibility,
      offsetParentNull: el.offsetParent === null,
      rectH: Math.round(el.getBoundingClientRect().height),
      rectW: Math.round(el.getBoundingClientRect().width)
    };
  };

  const all = Array.from(document.querySelectorAll("[data-reveal]"));
  const missed = all.filter((e) => !e.classList.contains("is-in")).map(desc);

  const bars = Array.from(document.querySelectorAll("[data-bar]")).map((b) => {
    const fill = b.querySelector(".bar__track i");
    const r = b.getBoundingClientRect();
    return {
      target: b.dataset.bar,
      fillWidth: fill ? fill.style.width || "(empty)" : "NO FILL EL",
      computedW: fill ? getComputedStyle(fill).width : "-",
      trackW: b.querySelector(".bar__track")
        ? getComputedStyle(b.querySelector(".bar__track")).width
        : "-",
      inDoc: !!fill,
      rect: `${Math.round(r.width)}x${Math.round(r.height)}`,
      offsetParentNull: b.offsetParent === null,
      panelDisplay: b.closest(".skill-panel")
        ? getComputedStyle(b.closest(".skill-panel")).display
        : "-"
    };
  });

  return {
    totalReveal: all.length,
    shown: all.filter((e) => e.classList.contains("is-in")).length,
    missed,
    bars,
    scrollY: window.scrollY,
    docH: document.body.scrollHeight,
    innerH: window.innerHeight
  };
});

console.log("\n=== REVEAL ===");
console.log(`shown ${report.shown}/${report.totalReveal}`);
console.log(`scrollY=${report.scrollY} docH=${report.docH} innerH=${report.innerH}`);
console.log("\nMISSED ELEMENTS:");
for (const m of report.missed) {
  console.log(
    `  [${m.section}] ${m.tag}.${m.cls}  ${m.rectW}x${m.rectH}  display=${m.display} vis=${m.visibility} offsetParentNull=${m.offsetParentNull}`
  );
  console.log(`      "${m.text}"`);
}

console.log("\n=== SKILL BARS ===");
for (const b of report.bars) {
  console.log(
    `  target=${b.target}%  inline=${b.fillWidth}  computed=${b.computedW}  track=${b.trackW}  rect=${b.rect}  offsetParentNull=${b.offsetParentNull}  panel=${b.panelDisplay}`
  );
}

await browser.close();
