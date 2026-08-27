/**
 * diagnose-fcp-variance.mjs — WHY does FCP swing 1.4s -> 5.5s on an unchanged page?
 *
 * Hypothesis: first paint is gated on third-party CDN latency (Google Fonts,
 * cdnjs GSAP, jsdelivr Bootstrap), not on our own code. If true, the number the
 * perf suite asserts on is mostly a measurement of someone else's network, and
 * an absolute FCP threshold will fail at random.
 *
 * Method: reload N times in ONE browser, and for each load record FCP plus the
 * duration and blocking time of every third-party request that finished before
 * first paint. Then correlate.
 */

import puppeteer from "puppeteer-core";

const URL = process.env.TEST_URL || "http://127.0.0.1:5173/";
const CHROME =
  process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const RUNS = Number(process.env.RUNS || 6);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle"]
});

console.log(`\nFCP variance diagnosis: ${URL}  (${RUNS} loads)\n`);

const rows = [];

for (let i = 0; i < RUNS; i++) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(URL, { waitUntil: "load", timeout: 45000 });

  const data = await page.evaluate(
    () =>
      new Promise((resolve) => {
        setTimeout(() => {
          const paints = {};
          performance.getEntriesByType("paint").forEach((p) => {
            paints[p.name] = p.startTime;
          });
          const fcp = paints["first-contentful-paint"] || 0;

          const res = performance.getEntriesByType("resource").map((r) => ({
            name: r.name,
            start: r.startTime,
            dur: r.duration,
            end: r.responseEnd,
            type: r.initiatorType,
            thirdParty: !r.name.includes("127.0.0.1"),
            cached: r.transferSize === 0 && r.decodedBodySize > 0
          }));

          // what finished before first paint, i.e. what FCP actually waited on
          const beforePaint = res.filter((r) => r.end <= fcp + 1);
          const blockers = beforePaint
            .filter((r) => r.thirdParty)
            .sort((a, b) => b.dur - a.dur)
            .slice(0, 4)
            .map((r) => ({
              host: new URL(r.name).host,
              file: r.name.split("/").pop().slice(0, 28),
              dur: Math.round(r.dur),
              end: Math.round(r.end),
              cached: r.cached
            }));

          const thirdPartyEnd = Math.max(
            0,
            ...beforePaint.filter((r) => r.thirdParty).map((r) => r.end)
          );
          const localEnd = Math.max(
            0,
            ...beforePaint.filter((r) => !r.thirdParty).map((r) => r.end)
          );

          resolve({
            fcp,
            thirdPartyEnd,
            localEnd,
            blockers,
            counts: {
              total: res.length,
              cached: res.filter((r) => r.cached).length
            }
          });
        }, 600);
      })
  );

  rows.push(data);
  console.log(
    `run ${i + 1}: FCP ${data.fcp.toFixed(0).padStart(5)} ms | ` +
      `last 3rd-party before paint ${data.thirdPartyEnd.toFixed(0).padStart(5)} ms | ` +
      `last local ${data.localEnd.toFixed(0).padStart(5)} ms | ` +
      `cached ${data.counts.cached}/${data.counts.total}`
  );
  for (const b of data.blockers) {
    console.log(
      `         - ${b.host} ${b.file} ${b.dur} ms (ended ${b.end} ms)${b.cached ? " [cached]" : ""}`
    );
  }

  await page.close();
}

const fcps = rows.map((r) => r.fcp);
const tp = rows.map((r) => r.thirdPartyEnd);
const lo = rows.map((r) => r.localEnd);
const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];

// Pearson correlation between FCP and third-party completion
function corr(a, b) {
  const ma = a.reduce((x, y) => x + y, 0) / a.length;
  const mb = b.reduce((x, y) => x + y, 0) / b.length;
  let num = 0,
    da = 0,
    db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db || 1);
}

console.log("\n--- SUMMARY ---");
console.log(`FCP           min ${Math.min(...fcps).toFixed(0)}  median ${med(fcps).toFixed(0)}  max ${Math.max(...fcps).toFixed(0)}  spread ${(Math.max(...fcps) - Math.min(...fcps)).toFixed(0)} ms`);
console.log(`3rd-party end min ${Math.min(...tp).toFixed(0)}  median ${med(tp).toFixed(0)}  max ${Math.max(...tp).toFixed(0)}`);
console.log(`local end     min ${Math.min(...lo).toFixed(0)}  median ${med(lo).toFixed(0)}  max ${Math.max(...lo).toFixed(0)}`);
console.log(`corr(FCP, third-party completion) = ${corr(fcps, tp).toFixed(3)}`);
console.log(`corr(FCP, local completion)       = ${corr(fcps, lo).toFixed(3)}`);
console.log(
  `\nVERDICT: ${
    corr(fcps, tp) > 0.7
      ? "FCP tracks THIRD-PARTY latency -> absolute FCP threshold is measuring the CDN, not the page."
      : "FCP does not track third-party latency; look elsewhere (CPU/host)."
  }`
);

await browser.close();
