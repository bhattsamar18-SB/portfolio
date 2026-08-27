/* =====================================================================
   diagnose-fcp.mjs — find WHAT delays first paint, across repeated runs.
   ---------------------------------------------------------------------
   perf-test.mjs showed LCP == FCP on every run, and one run in ten
   spiking to 2564 ms. When LCP equals FCP the largest element is painted
   at first paint, so the spike is not an image or a font swap arriving
   late — it is first paint itself being blocked.

   Everything in <head> that blocks render is third-party CSS:
     - fonts.googleapis.com  (font CSS)
     - cdn.jsdelivr.net      (bootstrap.min.css, bootstrap-icons.min.css)
   This prints, per run, the duration of each render-blocking request plus
   the connection setup time, so the blame is measured rather than guessed.

   Run:  node diagnose-fcp.mjs [runs]
   ===================================================================== */

import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";

const RUNS = Number(process.argv[2] || 6);
const PORT = 5196;
const CHROME =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const server = spawn(
  process.platform === "win32" ? "python.exe" : "python3",
  ["-m", "http.server", String(PORT)],
  { cwd: process.cwd(), stdio: "ignore" }
);
await new Promise((r) => setTimeout(r, 900));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox"]
});

const rows = [];

try {
  for (let i = 0; i < RUNS; i++) {
    const page = await browser.newPage();
    await page.setCacheEnabled(false);
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });
    await new Promise((r) => setTimeout(r, 1200));

    const data = await page.evaluate(() => {
      const fcp = performance
        .getEntriesByType("paint")
        .find((e) => e.name === "first-contentful-paint");
      const blocking = performance
        .getEntriesByType("resource")
        .filter((r) => r.initiatorType === "link" || r.initiatorType === "css")
        .map((r) => ({
          url: r.name.replace(/^https?:\/\//, "").slice(0, 58),
          start: Math.round(r.startTime),
          dur: Math.round(r.duration),
          connect: Math.round(r.connectEnd - r.domainLookupStart),
          wait: Math.round(r.responseStart - r.requestStart)
        }))
        .sort((a, b) => b.dur - a.dur);
      return { fcp: fcp ? Math.round(fcp.startTime) : null, blocking };
    });

    rows.push(data);
    console.log(`\n--- run ${i + 1}: FCP ${data.fcp} ms ---`);
    for (const b of data.blocking.slice(0, 6)) {
      console.log(
        `   ${String(b.dur).padStart(5)}ms  connect ${String(b.connect).padStart(4)}ms  wait ${String(b.wait).padStart(4)}ms  @${String(b.start).padStart(4)}ms  ${b.url}`
      );
    }
    await page.close();
  }

  const fcps = rows.map((r) => r.fcp).filter((n) => n != null);
  fcps.sort((a, b) => a - b);
  console.log(
    `\nFCP across ${fcps.length} runs: min ${fcps[0]} / median ${fcps[Math.floor(fcps.length / 2)]} / max ${fcps[fcps.length - 1]} ms`
  );

  /* which resource correlates with the worst run? */
  const worst = rows.reduce((a, b) => (b.fcp > a.fcp ? b : a), rows[0]);
  console.log(`worst run's slowest blocking resource:`);
  const w = worst.blocking[0];
  if (w) console.log(`   ${w.dur}ms  ${w.url}  (connect ${w.connect}ms, wait ${w.wait}ms)`);
} finally {
  await browser.close();
  server.kill();
}
