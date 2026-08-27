/**
 * diagnose-paint.mjs — find what costs frame time during a REAL scroll.
 *
 * Now that scripted scrolling actually moves the page (behavior:"instant"),
 * scroll FPS sits at ~55% of the host ceiling while scroll-handler JS costs
 * only 0.01 ms/event. So the cost is paint/compositing, not scripting.
 *
 * Earlier single-pass A/B was worthless: five no-op runs of the SAME page
 * ranged 18-31 fps. This INTERLEAVES conditions across several rounds and
 * compares medians, so a real effect can be separated from drift.
 *
 * Reuses ONE page (reload per sample) — spawning a fresh target per sample
 * overwhelmed the dev server and timed the run out.
 *
 * Run:  node diagnose-paint.mjs
 */

import puppeteer from "puppeteer-core";

const URL = process.env.TEST_URL || "http://127.0.0.1:5173/";
const CHROME =
  process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ROUNDS = Number(process.env.ROUNDS || 3);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle"]
});

const MEASURE = `
  new Promise((resolve) => {
    window.scrollTo({ top: 0, behavior: "instant" });
    setTimeout(() => {
      const frames = [];
      let last = performance.now();
      const start = last;
      const DUR = 1800;
      let raf;
      const step = (now) => {
        frames.push(now - last);
        last = now;
        if (now - start < DUR) raf = requestAnimationFrame(step);
        else {
          cancelAnimationFrame(raf);
          resolve({
            avgFps: 1000 / (frames.reduce((a,b)=>a+b,0)/frames.length),
            travelled: window.scrollY
          });
        }
      };
      raf = requestAnimationFrame(step);
      let y = 0;
      const iv = setInterval(() => {
        y += 90;
        window.scrollTo({ top: y, behavior: "instant" });
        if (y > document.documentElement.scrollHeight) y = 0;
      }, 32);
      setTimeout(() => clearInterval(iv), DUR);
    }, 200);
  })
`;

/* Each condition removes ONE suspect so its cost can be attributed. */
const CONDITIONS = {
  "as shipped": null,

  "backdrop noise off": () => {
    const n = document.querySelector(".backdrop__noise");
    if (n) n.style.display = "none";
  },

  "gradient wash off": () => {
    const w = document.querySelector(".backdrop__wash");
    if (w) w.style.display = "none";
  },

  "backdrop grid off": () => {
    const g = document.querySelector(".backdrop__grid");
    if (g) g.style.display = "none";
  },

  "whole backdrop off": () => {
    const b = document.querySelector(".backdrop");
    if (b) b.style.display = "none";
  },

  "hero ::before/::after off": () => {
    const s = document.createElement("style");
    s.textContent = ".hero::before,.hero::after{display:none !important}";
    document.head.appendChild(s);
  },

  "backdrop-filter off": () => {
    const s = document.createElement("style");
    s.textContent = "*{backdrop-filter:none !important;-webkit-backdrop-filter:none !important}";
    document.head.appendChild(s);
  },

  "mix-blend-mode off": () => {
    const s = document.createElement("style");
    s.textContent = "*{mix-blend-mode:normal !important}";
    document.head.appendChild(s);
  }
};

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

async function measure(setup, attempt = 0) {
  try {
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(
      () => {
        const p = document.getElementById("preloader");
        return !p || p.classList.contains("is-done");
      },
      { timeout: 20000 }
    );
    await page.evaluate(() => new Promise((r) => setTimeout(r, 400)));
    if (setup) await page.evaluate(setup);
    return await page.evaluate(MEASURE);
  } catch (err) {
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 1500));
      return measure(setup, attempt + 1);
    }
    throw err;
  }
}

const median = (a) => {
  const s = a.slice().sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const samples = {};
for (const name of Object.keys(CONDITIONS)) samples[name] = [];

const lines = [];
const say = (s) => { console.log(s); lines.push(s); };

say(`\nInterleaved paint attribution - ${ROUNDS} rounds per condition\n`);

for (let round = 1; round <= ROUNDS; round++) {
  const marks = [];
  for (const [name, setup] of Object.entries(CONDITIONS)) {
    const r = await measure(setup);
    samples[name].push(r.avgFps);
    marks.push(r.travelled < 500 ? "!" : ".");
  }
  say(`  round ${round}: ${marks.join("")}`);
}

const base = median(samples["as shipped"]);
const baseSpread = Math.max(...samples["as shipped"]) - Math.min(...samples["as shipped"]);

say("\n  condition                      median fps   delta vs shipped   spread");
say("  " + "-".repeat(70));
for (const [name, vals] of Object.entries(samples)) {
  const m = median(vals);
  const d = m - base;
  const spread = Math.max(...vals) - Math.min(...vals);
  const real = Math.abs(d) > baseSpread ? "  <== REAL" : "";
  say(
    `  ${name.padEnd(30)} ${m.toFixed(1).padStart(6)}   ` +
      `${(d >= 0 ? "+" : "") + d.toFixed(1)}`.padStart(8) +
      `        ${spread.toFixed(1).padStart(5)}${real}`
  );
}

say(`\n  Noise floor ("as shipped" spread): ${baseSpread.toFixed(1)} fps.`);
say("  Only deltas larger than that are real effects.\n");

await browser.close();
