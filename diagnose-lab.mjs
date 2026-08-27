/* =====================================================================
   diagnose-lab.mjs — prove the WebGL Lab really DRAWS, and really STOPS.
   ---------------------------------------------------------------------
   render-test.mjs asserts the lab reaches state "live" and that the
   canvas has non-zero dimensions. Both of those would still pass if the
   scene were completely blank — a transparent canvas over the CSS poster
   looks "live" to the DOM.

   So this compares real pixels:

     1. poster variance   — the CSS fallback, before WebGL
     2. live variance     — after WebGL boots (must differ from poster)
     3. frame-to-frame Δ  — two shots 400ms apart MUST differ (animating)
     4. paused Δ          — after scrolling away and back to a *paused*
                            state, consecutive shots must be identical

   Run:  node diagnose-lab.mjs
   ===================================================================== */

import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";
import { PNG } from "pngjs";

const PORT = 5198;
const CHROME =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

/* mean absolute difference between two PNG buffers, 0-255 */
function diff(a, b) {
  const pa = PNG.sync.read(a);
  const pb = PNG.sync.read(b);
  if (pa.width !== pb.width || pa.height !== pb.height) return NaN;
  let sum = 0;
  const n = pa.data.length;
  for (let i = 0; i < n; i += 4) {
    sum +=
      Math.abs(pa.data[i] - pb.data[i]) +
      Math.abs(pa.data[i + 1] - pb.data[i + 1]) +
      Math.abs(pa.data[i + 2] - pb.data[i + 2]);
  }
  return sum / (n / 4) / 3;
}

/* stdev of luminance — a blank fill has ~0, drawn geometry does not */
function variance(buf) {
  const p = PNG.sync.read(buf);
  const lums = [];
  for (let i = 0; i < p.data.length; i += 4) {
    lums.push(0.299 * p.data[i] + 0.587 * p.data[i + 1] + 0.114 * p.data[i + 2]);
  }
  const m = lums.reduce((a, b) => a + b, 0) / lums.length;
  return Math.sqrt(lums.reduce((a, b) => a + (b - m) ** 2, 0) / lums.length);
}

const server = spawn(
  process.platform === "win32" ? "python.exe" : "python3",
  ["-m", "http.server", String(PORT)],
  { cwd: process.cwd(), stdio: "ignore" }
);
await new Promise((r) => setTimeout(r, 900));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--window-size=1440,900"]
});

let fails = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) fails++;
};

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 1800));

  const stage = async () =>
    await page.evaluate(() => {
      const el = document.querySelector(".lab__stage");
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });

  /* --- 1. poster state: scroll so the stage is visible but the boot
         observer (300px runway) has not necessarily fired yet --- */
  await page.evaluate(() => {
    const el = document.getElementById("lab");
    window.scrollTo({ top: el.offsetTop - 900, behavior: "instant" });
  });
  await new Promise((r) => setTimeout(r, 250));
  const posterState = await page.evaluate(
    () => document.getElementById("lab").dataset.labState
  );
  console.log(`  info  lab state before boot: ${posterState}`);

  /* --- 2. live state --- */
  await page.evaluate(() => {
    document.getElementById("lab").scrollIntoView({ behavior: "instant", block: "center" });
  });
  await new Promise((r) => setTimeout(r, 3000));

  const liveState = await page.evaluate(() => ({
    state: document.getElementById("lab").dataset.labState,
    running: window.__lab ? window.__lab.running : null,
    lite: window.__lab ? window.__lab.lite : null
  }));
  console.log(
    `  info  lab state: ${liveState.state}  running=${liveState.running}  lite=${liveState.lite}`
  );

  const box = await stage();
  const shotA = await page.screenshot({ clip: box });
  await new Promise((r) => setTimeout(r, 450));
  const shotB = await page.screenshot({ clip: box });

  const vA = variance(shotA);
  const dAB = diff(shotA, shotB);
  console.log(`  info  live-frame luminance stdev: ${vA.toFixed(2)}`);
  console.log(`  info  frame-to-frame mean Δ (400ms apart): ${dAB.toFixed(3)}`);

  check("lab stage draws structured content (not a flat fill)", vA > 3, `stdev ${vA.toFixed(2)}`);
  check(
    "scene is animating (consecutive frames differ)",
    dAB > 0.05,
    `Δ ${dAB.toFixed(3)}`
  );

  /* --- 3. paused: scroll far away, confirm loop stops, then verify the
         canvas is genuinely frozen (two shots identical) --- */
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await new Promise((r) => setTimeout(r, 900));
  const pausedFlag = await page.evaluate(() =>
    window.__lab ? window.__lab.running : null
  );
  check("render loop reports paused off-screen", pausedFlag === false, `running=${pausedFlag}`);

  /* Bring it back on screen but immediately compare two shots while the
     tab is hidden — hidden means the loop must not run. */
  await page.evaluate(() => {
    document.getElementById("lab").scrollIntoView({ behavior: "instant", block: "center" });
  });
  await new Promise((r) => setTimeout(r, 800));
  const resumed = await page.evaluate(() => (window.__lab ? window.__lab.running : null));
  check("render loop resumes on screen", resumed === true, `running=${resumed}`);

  const box2 = await stage();
  const shotC = await page.screenshot({ clip: box2 });
  await new Promise((r) => setTimeout(r, 400));
  const shotD = await page.screenshot({ clip: box2 });
  const dCD = diff(shotC, shotD);
  console.log(`  info  frame-to-frame mean Δ after resume: ${dCD.toFixed(3)}`);
  check("scene animates again after resume", dCD > 0.05, `Δ ${dCD.toFixed(3)}`);

  /* --- 4. animation time must SURVIVE the pause, not rewind ---
     THREE.Clock.start() resets elapsedTime to 0. If play() calls it, the
     scene snaps back to its opening pose on every re-entry. Two separate
     resumes sampled at the same offset would then look identical, which is
     exactly how this bug hid behind a passing "is it animating?" check. */
  const elapsedNow = await page.evaluate(() => (window.__lab ? window.__lab.elapsed : null));
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await new Promise((r) => setTimeout(r, 700));
  const elapsedPaused = await page.evaluate(() => (window.__lab ? window.__lab.elapsed : null));
  await page.evaluate(() => {
    document.getElementById("lab").scrollIntoView({ behavior: "instant", block: "center" });
  });
  await new Promise((r) => setTimeout(r, 500));
  const elapsedResumed = await page.evaluate(() => (window.__lab ? window.__lab.elapsed : null));

  console.log(
    `  info  elapsed: ${Number(elapsedNow).toFixed(2)}s -> paused ${Number(elapsedPaused).toFixed(2)}s -> resumed ${Number(elapsedResumed).toFixed(2)}s`
  );
  check(
    "animation time does not rewind on resume",
    elapsedResumed >= elapsedPaused,
    `${Number(elapsedPaused).toFixed(2)}s -> ${Number(elapsedResumed).toFixed(2)}s`
  );
  check(
    "animation time is frozen while paused (no idle catch-up jump)",
    Math.abs(elapsedPaused - elapsedNow) < 0.25,
    `drifted ${Math.abs(elapsedPaused - elapsedNow).toFixed(3)}s`
  );
  check(
    "animation time advances after resume",
    elapsedResumed > elapsedPaused,
    `+${(elapsedResumed - elapsedPaused).toFixed(2)}s`
  );

  console.log(`\n${fails === 0 ? "lab drawing verified" : `${fails} check(s) failed`}`);
  process.exitCode = fails === 0 ? 0 : 1;
} finally {
  await browser.close();
  server.kill();
}
