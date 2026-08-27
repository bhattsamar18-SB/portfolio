/**
 * diagnose-overflow.mjs — finds elements that ACTUALLY extend the document
 * scroll width on mobile (ignores anything clipped by an overflow ancestor).
 *
 * Run:  node diagnose-overflow.mjs
 */
import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = process.env.TEST_URL || "http://127.0.0.1:5173/";
const WIDTH = Number(process.env.W || 390);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--enable-unsafe-swiftshader"]
});
const page = await browser.newPage();
await page.setViewport({ width: WIDTH, height: 844, isMobile: true, hasTouch: true });
await page.goto(URL, { waitUntil: "networkidle2" });
await page.waitForFunction(() => {
  const p = document.getElementById("preloader");
  return !p || p.classList.contains("is-done");
}, { timeout: 12000 });
await new Promise((r) => setTimeout(r, 1500));

const report = await page.evaluate(() => {
  const vw = document.documentElement.clientWidth;

  function isClipped(el) {
    let p = el.parentElement;
    while (p && p !== document.body && p !== document.documentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX === "hidden" || cs.overflowX === "clip" ||
          cs.overflow === "hidden" || cs.overflow === "clip") return true;
      if (cs.position === "fixed") return true; // fixed layers don't extend doc scroll
      p = p.parentElement;
    }
    return false;
  }

  const out = [];
  document.querySelectorAll("body *").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    if (r.right <= vw + 1 && r.left >= -1) return;
    if (isClipped(el)) return;

    const cs = getComputedStyle(el);
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.className || "").toString().slice(0, 55),
      left: Math.round(r.left),
      right: Math.round(r.right),
      width: Math.round(r.width),
      pos: cs.position,
      parent: el.parentElement
        ? el.parentElement.tagName.toLowerCase() + "." +
          (el.parentElement.className || "").toString().slice(0, 40)
        : "-"
    });
  });

  return {
    vw,
    scrollW: document.documentElement.scrollWidth,
    offenders: out.sort((a, b) => b.right - a.right).slice(0, 20)
  };
});

console.log(`viewport=${report.vw}  documentScrollWidth=${report.scrollW}  overflow=${report.scrollW - report.vw}px\n`);
console.log("UNCLIPPED elements crossing the viewport edge:\n");
for (const o of report.offenders) {
  console.log(`  ${o.tag}.${o.cls}`);
  console.log(`     left=${o.left} right=${o.right} w=${o.width} pos=${o.pos}`);
  console.log(`     parent: ${o.parent}\n`);
}
if (!report.offenders.length) console.log("  none — overflow comes from a clipped/fixed layer\n");

await browser.close();
