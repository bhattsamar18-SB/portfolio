/**
 * diagnose-anchor.mjs — two things diagnose-scroller.mjs left ambiguous:
 *
 *   1. Why did window.scrollTo() read back 0? (smooth scroll still animating
 *      when we read synchronously, vs genuinely not scrolling)
 *   2. Is anchor navigation actually broken? #contact landed 1120px short.
 *      Suspicion: main.js measures the target with getBoundingClientRect()
 *      BEFORE the smooth scroll, but scroll-triggered reveal animations change
 *      element heights during the scroll, so the precomputed offset goes stale.
 *
 * Run:  node diagnose-anchor.mjs
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
await page.waitForFunction(
  () => {
    const p = document.getElementById("preloader");
    return !p || p.classList.contains("is-done");
  },
  { timeout: 15000 }
);
await new Promise((r) => setTimeout(r, 800));

/* ---------- 1. is scrollTo instant or animated? ---------- */
console.log("\n1. scrollTo() behaviour\n");
const reduced = await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
const behavior = await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior);
console.log(`  prefers-reduced-motion       : ${reduced}`);
console.log(`  computed html scroll-behavior : ${behavior}`);

const instant = await page.evaluate(async () => {
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 300));
  window.scrollTo(0, 1500);
  const immediate = window.scrollY;
  await new Promise((r) => setTimeout(r, 700));
  return { immediate, settled: window.scrollY };
});
console.log(`  scrollY immediately after    : ${instant.immediate}`);
console.log(`  scrollY after 700ms settle   : ${instant.settled}`);
console.log(
  instant.immediate === 0 && instant.settled > 1000
    ? "  => scrollTo IS animated (smooth). Reading synchronously is the harness bug."
    : instant.settled > 1000
      ? "  => scrollTo is instant and works."
      : "  => scrollTo genuinely does not scroll. Real bug."
);

/* ---------- 2. anchor accuracy, per link, fully settled ---------- */
console.log("\n2. anchor navigation accuracy (waiting for scroll to settle)\n");

const targets = ["about", "skills", "experience", "work", "process", "contact"];
const results = [];

for (const id of targets) {
  const r = await page.evaluate(async (target) => {
    window.scrollTo(0, 0);
    await new Promise((res) => setTimeout(res, 500));

    const link = document.querySelector(`a[href="#${target}"]`);
    if (!link) return { target, missing: true };

    const predicted =
      document.getElementById(target).getBoundingClientRect().top + window.scrollY - 70;

    link.click();

    /* wait until scrollY stops changing — never assume a fixed duration */
    let last = -1;
    let stable = 0;
    for (let i = 0; i < 80; i++) {
      await new Promise((res) => requestAnimationFrame(res));
      if (Math.abs(window.scrollY - last) < 0.5) stable++;
      else stable = 0;
      last = window.scrollY;
      if (stable > 8) break;
    }
    await new Promise((res) => setTimeout(res, 250));

    const el = document.getElementById(target);
    return {
      target,
      predicted: Math.round(predicted),
      landedAt: Math.round(window.scrollY),
      offsetFromTop: Math.round(el.getBoundingClientRect().top),
      docHeight: document.documentElement.scrollHeight
    };
  }, id);
  results.push(r);
}

let bad = 0;
for (const r of results) {
  if (r.missing) { console.log(`  #${r.target.padEnd(11)} no link found`); continue; }
  /* a correct landing puts the section heading just under the 70px nav offset */
  const ok = Math.abs(r.offsetFromTop - 70) < 90;
  if (!ok) bad++;
  console.log(
    `  #${r.target.padEnd(11)} predicted ${String(r.predicted).padStart(5)}  landed ${String(r.landedAt).padStart(5)}` +
    `  section top ${String(r.offsetFromTop).padStart(5)}px  ${ok ? "OK" : "OFF"}`
  );
}

console.log(
  bad === 0
    ? "\n  => all anchors land correctly."
    : `\n  => ${bad}/${results.length} anchors land in the wrong place.`
);

/* does the document height change during a scroll? that's what staleness the offset */
const heightDrift = await page.evaluate(async () => {
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 400));
  const before = document.documentElement.scrollHeight;
  window.scrollTo(0, document.documentElement.scrollHeight);
  await new Promise((r) => setTimeout(r, 1500));
  const after = document.documentElement.scrollHeight;
  return { before, after, delta: after - before };
});
console.log(`\n  document height before scroll: ${heightDrift.before}px`);
console.log(`  document height after scroll : ${heightDrift.after}px`);
console.log(`  drift                        : ${heightDrift.delta}px`);
if (Math.abs(heightDrift.delta) > 40) {
  console.log("  => layout height CHANGES as you scroll, so any offset computed");
  console.log("     before a smooth scroll is stale by the time it arrives.");
}

await browser.close();
