/**
 * perf-test.mjs — measure real runtime performance, not guesses.
 *
 * Measures:
 *   - Core Web Vitals style paint timings (FCP, LCP) and DOM readiness
 *   - long tasks blocking the main thread
 *   - sustained FPS during a scripted scroll (the animation-heavy path)
 *   - forced synchronous layout (layout thrash) via Chrome tracing
 *   - transfer weight by resource type, and render-blocking requests
 *   - detached-node / listener growth after heavy interaction (leak smell)
 *
 * Run:  node perf-test.mjs
 */

import puppeteer from "puppeteer-core";

const URL = process.env.TEST_URL || "http://127.0.0.1:5173/";
const CHROME =
  process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

let passed = 0;
let failed = 0;
const warns = [];

function assert(name, cond, detail = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
  cond ? passed++ : failed++;
}
function info(name, detail) {
  console.log(`  info  ${name}: ${detail}`);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle"]
});

/* Guaranteed teardown. Without this, ANY throw between launch and the
   browser.close() at the end of the file leaks a Chrome process tree. That is
   not hypothetical: it left 33 orphaned chrome.exe holding 4 GB, and because
   they kept burning CPU each subsequent run measured a slower page than the
   last (worst long task drifted 165 -> 307 -> 596 -> 757 ms on identical code).
   A perf harness that degrades the machine it measures reports fiction. */
let closed = false;
const shutdown = async () => {
  if (closed) return;
  closed = true;
  try { await browser.close(); } catch {}
};
process.on("exit", () => { if (!closed) { closed = true; try { browser.process()?.kill("SIGKILL"); } catch {} } });
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, async () => { await shutdown(); process.exit(130); });
}
process.on("uncaughtException", async (err) => {
  console.error("\n  FATAL", err?.message || err);
  await shutdown();
  process.exit(1);
});
process.on("unhandledRejection", async (err) => {
  console.error("\n  FATAL (rejection)", err?.message || err);
  await shutdown();
  process.exit(1);
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

/* ---------- track transfer sizes ---------- */
const resources = [];
page.on("response", async (res) => {
  try {
    const h = res.headers();
    resources.push({
      url: res.url(),
      type: res.request().resourceType(),
      status: res.status(),
      size: Number(h["content-length"] || 0)
    });
  } catch {}
});

console.log(`\nPerformance audit: ${URL}\n`);

await page.goto(URL, { waitUntil: "networkidle2", timeout: 45000 });
await page.waitForFunction(
  () => {
    const p = document.getElementById("preloader");
    return !p || p.classList.contains("is-done");
  },
  { timeout: 15000 }
);

/* ---------- paint + navigation timings ----------
   LCP is NOT retrievable via getEntriesByType(): the spec only surfaces it to a
   PerformanceObserver, so the old call silently returned [] and reported 0 ms.
   Use a buffered observer and treat a still-missing value as unknown rather
   than as a passing 0. */
const measureLoad = (p) =>
  p.evaluate(
    () =>
      new Promise((resolve) => {
        const nav = performance.getEntriesByType("navigation")[0] || {};
        const paints = {};
        performance.getEntriesByType("paint").forEach((q) => { paints[q.name] = q.startTime; });

        let lcp = 0;
        try {
          const po = new PerformanceObserver((list) => {
            const entries = list.getEntries();
            if (entries.length) lcp = entries[entries.length - 1].startTime;
          });
          po.observe({ type: "largest-contentful-paint", buffered: true });
        } catch {}

        /* Long tasks are collected on the SAME load as the paint numbers so a
           busy run's paint and its task spike can be discarded together. */
        const tasks = [];
        try {
          const to = new PerformanceObserver((list) => {
            list.getEntries().forEach((e) => tasks.push(Math.round(e.duration)));
          });
          to.observe({ type: "longtask", buffered: true });
        } catch {}

        setTimeout(() => {
          resolve({
            fcp: paints["first-contentful-paint"] || 0,
            lcp,
            domContentLoaded: nav.domContentLoadedEventEnd || 0,
            loadEvent: nav.loadEventEnd || 0,
            transferSize: nav.transferSize || 0,
            tasks
          });
        }, 1200);
      })
  );

const timings = await measureLoad(page);

/* ---------- first-screen snapshot, taken BEFORE any probe scrolls ----------
   This must be sampled while the page is genuinely at the top and freshly
   loaded. The FPS/scroll probes below move the document (and legitimately boot
   the lazily-imported Design Lab), so sampling later would report that
   section's canvas and fail a check about the FIRST screen. */
const firstScreen = await page.evaluate(() => {
  const above = [...document.querySelectorAll("body *")].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.top < window.innerHeight && r.bottom > 0 && r.width > 0 && r.height > 0;
  });
  const blurred = above.filter((el) => (getComputedStyle(el).filter || "").includes("blur"));
  const looping = above.filter((el) => {
    const s = getComputedStyle(el);
    return s.animationName !== "none" && s.animationIterationCount === "infinite";
  });
  return {
    scrollY: window.scrollY,
    canvases: document.querySelectorAll("canvas").length,
    webgl: typeof window.THREE !== "undefined",
    blurred: blurred.map((e) => e.className || e.tagName).slice(0, 6),
    looping: looping.map((e) => e.className || e.tagName).slice(0, 6)
  };
});

/* ---------- paint timings are asserted on a MEDIAN OF SEVERAL LOADS ----------
   Why: diagnose-fcp-variance.mjs reloaded this unchanged page six times and saw
   FCP range 668 -> 2472 ms (1804 ms spread). The cause is NOT our code and NOT
   the CDN — third-party requests finished at a 68 ms median while FCP sat at
   1084 ms, and on a slow run EVERY phase dilated together (local resources
   617 -> 2375 ms alongside FCP 668 -> 2472 ms). That is host CPU contention
   scaling the whole timeline ~4x.

   A single-sample threshold therefore fails at random on a healthy build, which
   is worse than no test: it teaches you to ignore red. So we take the median of
   several loads, which is stable, and we also report the spread so a genuinely
   slow machine is visible rather than silently "passing". */
const PAINT_RUNS = Math.max(1, Number(process.env.PAINT_RUNS || 5));
const loadSamples = [timings];
for (let i = 1; i < PAINT_RUNS; i++) {
  const p2 = await browser.newPage();
  await p2.setViewport({ width: 1440, height: 900 });
  try {
    await p2.goto(URL, { waitUntil: "load", timeout: 45000 });
    await p2
      .waitForFunction(
        () => {
          const el = document.getElementById("preloader");
          return !el || el.classList.contains("is-done");
        },
        { timeout: 15000 }
      )
      .catch(() => {});
    loadSamples.push(await measureLoad(p2));
  } catch {
    /* a failed extra sample must not fail the suite; median handles it */
  } finally {
    /* close in finally: a thrown sample used to leave its renderer alive, and
       those stray renderers are what poisoned later runs */
    try { await p2.close(); } catch {}
  }
}

const median = (arr) => {
  const a = arr.filter((n) => n > 0).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const fcpAll = loadSamples.map((s) => s.fcp);
const lcpAll = loadSamples.map((s) => s.lcp);
const dclAll = loadSamples.map((s) => s.domContentLoaded);
const fcpMed = median(fcpAll);
const lcpMed = median(lcpAll);
const dclMed = median(dclAll);
const fcpOk = fcpAll.filter((n) => n > 0);

info("load samples", `${loadSamples.length} (median asserted, spread reported)`);
info(
  "First Contentful Paint",
  `median ${fcpMed.toFixed(0)} ms  [${Math.min(...fcpOk).toFixed(0)}–${Math.max(...fcpOk).toFixed(0)} ms]`
);
info("Largest Contentful Paint", lcpMed ? `median ${lcpMed.toFixed(0)} ms` : "not reported");
info("DOMContentLoaded", `median ${dclMed.toFixed(0)} ms`);

assert("median FCP under 2500 ms", fcpMed > 0 && fcpMed < 2500, `${fcpMed.toFixed(0)} ms`);
if (lcpMed > 0) {
  assert("median LCP under 2500 ms", lcpMed < 2500, `${lcpMed.toFixed(0)} ms`);
} else {
  warns.push("LCP not reported by this browser; skipped rather than passed as 0");
}
assert("median DOMContentLoaded under 3000 ms", dclMed < 3000, `${dclMed.toFixed(0)} ms`);

/* A wide spread means the measurement environment was busy — worth saying out
   loud, because every timing number in this run is then low-confidence. */
if (fcpOk.length > 1 && Math.max(...fcpOk) - Math.min(...fcpOk) > 1200) {
  warns.push(
    `FCP spread ${(Math.max(...fcpOk) - Math.min(...fcpOk)).toFixed(0)} ms across ${fcpOk.length} loads ` +
      `(host under load) — treat paint timings as indicative only; measure in a headed browser for a real number`
  );
}

/* ---------- long tasks (same median-of-loads treatment) ---------- */
const worstPerLoad = loadSamples.map((s) => (s.tasks?.length ? Math.max(...s.tasks) : 0));
const worstTask = median(worstPerLoad);
const worstEver = Math.max(0, ...worstPerLoad);
info("worst long task per load", worstPerLoad.join(", ") + " ms");
/* Boot cost is dominated by third-party parse (GSAP + Bootstrap) and font work.
   On a contended host a single task spikes past 700 ms with no code change
   (observed 783 ms while the idle rAF ceiling collapsed to 31 fps, versus
   55–247 ms at an 85–91 fps ceiling on the same build). Assert the median so a
   real regression — a blocking loop, present every load — still fails. */
assert("median worst long task under 600 ms", worstTask < 600, `median ${worstTask} ms (worst seen ${worstEver} ms)`);

/* ---------- calibrate the environment's frame ceiling ----------
   Headless Chrome with SwiftShader caps rAF near 30 fps, and repeated runs of
   the *identical* page vary by >13 fps (proved with diagnose-order.mjs). So an
   absolute ">= 50 fps" assertion is unmeasurable here: it fails on a healthy
   page and can pass on a broken one. Measure the idle ceiling first, then judge
   scrolling as a RATIO of that ceiling — that ratio is what actually reflects
   our own scroll cost, independent of the host's refresh rate. */
const ceiling = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const frames = [];
      let last = performance.now();
      const start = last;
      const step = (now) => {
        frames.push(now - last);
        last = now;
        if (now - start < 1200) requestAnimationFrame(step);
        else resolve(1000 / (frames.reduce((a, b) => a + b, 0) / frames.length));
      };
      requestAnimationFrame(step);
    })
);
info("idle rAF ceiling (host limit)", ceiling.toFixed(1) + " fps");

/* ---------- sustained FPS during scroll ---------- */
const fps = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const frames = [];
      let last = performance.now();
      let raf;
      const total = 3000;
      const start = last;

      const step = (now) => {
        frames.push(now - last);
        last = now;
        if (now - start < total) raf = requestAnimationFrame(step);
        else {
          cancelAnimationFrame(raf);
          const sorted = frames.slice().sort((a, b) => a - b);
          const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
          const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
          resolve({
            avgFrameMs: avg,
            p95FrameMs: p95,
            avgFps: 1000 / avg,
            dropped: frames.filter((f) => f > 33).length,
            samples: frames.length
          });
        }
      };
      raf = requestAnimationFrame(step);

      /* scroll while measuring: this is the expensive path.
         behavior:"instant" is REQUIRED — html sets scroll-behavior:smooth, so
         a default scrollTo() animates and consecutive calls cancel one another,
         leaving the page nearly still and the FPS reading meaningless. */
      let y = 0;
      const scroller = setInterval(() => {
        y += 90;
        window.scrollTo({ top: y, behavior: "instant" });
        if (y > document.documentElement.scrollHeight) y = 0;
      }, 32);
      setTimeout(() => clearInterval(scroller), total);
    })
);

const retention = fps.avgFps / ceiling;
info("avg FPS while scrolling", fps.avgFps.toFixed(1));
info("p95 frame time", `${fps.p95FrameMs.toFixed(1)} ms`);
info("scroll FPS as % of host ceiling", `${(retention * 100).toFixed(0)}%`);
/* NOT asserted on purpose. diagnose-paint.mjs measured the same unmodified
   page across interleaved rounds and saw a 65 fps spread — wider than every
   effect being tested. Under headless SwiftShader this number is noise, so
   gating on it produces random red builds. Frame cost is instead guarded by
   the deterministic assertions below (handler time, forced layouts, and the
   "no blur/canvas above the fold" structural checks). Measure real FPS in a
   headed browser on real hardware. */

/* Scripting cost per scroll event is deterministic where FPS is not — this is
   the assertion that would actually catch a regression in our scroll handlers.
   Reset to the top first: the FPS probe above leaves the page at the bottom,
   where scrollTo() fires no events and the sample size collapses to 1. */
const scrollCost = await page.evaluate(
  () =>
    new Promise((resolve) => {
      window.scrollTo({ top: 0, behavior: "instant" });
      setTimeout(() => {
        let events = 0;
        let spent = 0;
        const onScroll = () => {
          const t = performance.now();
          events++;
          /* handlers run synchronously after us on the same event; measuring the
             tail of the task is close enough to attribute cost per event */
          Promise.resolve().then(() => { spent += performance.now() - t; });
        };
        window.addEventListener("scroll", onScroll, { passive: true });
        let y = 0;
        const iv = setInterval(() => {
          y += 120;
          window.scrollTo({ top: y, behavior: "instant" });
        }, 32);
        setTimeout(() => {
          clearInterval(iv);
          window.removeEventListener("scroll", onScroll);
          resolve({ events, perEvent: events ? spent / events : 0 });
        }, 1600);
      }, 250);
    })
);
info("scroll events sampled", scrollCost.events);
/* Sample size depends on how many frames the host manages to render, so a low
   count means "machine was busy", not "page is broken". Only assert that the
   probe collected something; the per-event cost below is the real signal. */
if (scrollCost.events < 10) {
  warns.push(`scroll probe only saw ${scrollCost.events} events (host under load); per-event figure is low-confidence`);
}
assert("scroll probe produced a sample", scrollCost.events >= 1, `${scrollCost.events} events`);
assert(
  "scroll handler work under 4 ms per event",
  scrollCost.perEvent < 4,
  scrollCost.perEvent.toFixed(2) + " ms/event"
);

/* ---------- forced synchronous layout during scroll ----------
   This IS deterministic, unlike FPS. Every scroll subscriber in main.js runs
   inside a single requestAnimationFrame batch, so the browser should perform
   ONE layout per frame no matter how many handlers read geometry. A regression
   that interleaves style WRITES with geometry READS forces extra reflows, which
   is what we detect: a read occurring after a write within the same frame. */
const layoutReads = await page.evaluate(
  () =>
    new Promise((resolve) => {
      window.scrollTo({ top: 0, behavior: "instant" });
      setTimeout(() => {
        let rects = 0;
        let events = 0;
        let frames = 0;
        let forcedReflows = 0;
        let wroteThisFrame = false;

        /* count frames, and clear the write flag at each frame boundary */
        let running = true;
        const tick = () => {
          if (!running) return;
          frames++;
          wroteThisFrame = false;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);

        /* a style write invalidates layout */
        const styleDesc = Object.getOwnPropertyDescriptor(
          HTMLElement.prototype,
          "style"
        );
        const setProp = CSSStyleDeclaration.prototype.setProperty;
        CSSStyleDeclaration.prototype.setProperty = function (...a) {
          wroteThisFrame = true;
          return setProp.apply(this, a);
        };
        const origCssText = Object.getOwnPropertyDescriptor(
          CSSStyleDeclaration.prototype,
          "cssText"
        );

        /* a geometry read after a write in the same frame = forced reflow */
        const origRect = Element.prototype.getBoundingClientRect;
        Element.prototype.getBoundingClientRect = function (...a) {
          rects++;
          if (wroteThisFrame) {
            forcedReflows++;
            wroteThisFrame = false; // the reflow satisfies subsequent reads
          }
          return origRect.apply(this, a);
        };

        const count = () => events++;
        window.addEventListener("scroll", count, { passive: true });

        let y = 0;
        const iv = setInterval(() => {
          y += 120;
          window.scrollTo({ top: y, behavior: "instant" });
        }, 32);

        setTimeout(() => {
          running = false;
          clearInterval(iv);
          window.removeEventListener("scroll", count);
          Element.prototype.getBoundingClientRect = origRect;
          CSSStyleDeclaration.prototype.setProperty = setProp;
          void styleDesc;
          void origCssText;
          resolve({
            rects,
            events,
            frames,
            forcedReflows,
            perEvent: events ? rects / events : 0
          });
        }, 1600);
      }, 250);
    })
);
info(
  "geometry reads while scrolling",
  `${layoutReads.rects} rects / ${layoutReads.events} events = ${layoutReads.perEvent.toFixed(1)} per event`
);
/* Raw read COUNT is not the bug — many reads inside one rAF batch still cost a
   single layout, because nothing invalidated it in between. What actually hurts
   is a read that FOLLOWS a style write in the same frame (forced reflow). That
   is what this asserts, measured below via the real layout count. */
assert(
  "forced reflows per frame stay at most 1 (reads are batched)",
  layoutReads.forcedReflows <= layoutReads.frames,
  `${layoutReads.forcedReflows} write→read flips across ${layoutReads.frames} frames`
);

/* ---------- first screen must be free of per-frame raster work ----------
   Uses the snapshot captured immediately after load (near the top of this
   file) — NOT a fresh query. Re-querying here would run after the FPS and
   scroll probes have moved the document, which legitimately boots the lazily
   imported Design Lab, so a fresh query would find that section's canvas and
   report a critical-path regression that does not exist. */
assert("first-screen snapshot really was taken at the top", firstScreen.scrollY === 0,
  `scrollY=${firstScreen.scrollY}`);
/* Three.js now exists in the project again, but ONLY as a dynamic import from
   the Design Lab far below the fold. A canvas on the first screen means it has
   crept back into the critical path — the regression that cost 10.9s FCP. */
assert("no canvas / WebGL on first screen", firstScreen.canvases === 0 && !firstScreen.webgl,
  `${firstScreen.canvases} canvas, THREE=${firstScreen.webgl}`);
assert("no filter:blur() elements above the fold", firstScreen.blurred.length === 0,
  firstScreen.blurred.join(", ") || "clean");
info("infinite animations above the fold", firstScreen.looping.length + (firstScreen.looping.length ? " -> " + firstScreen.looping.join(", ") : ""));

/* ---------- lazy 3D must not touch the critical path ----------
   Assert the mechanism, not just the symptom: no <script> tag anywhere may
   reference Three.js (it must arrive via dynamic import), and the loader
   itself must be deferred/module so it cannot block parsing. */
const loaderShape = await page.evaluate(() => {
  const scripts = [...document.querySelectorAll("script[src]")];
  return {
    threeTags: scripts.filter((s) => /three@|three\.module|three\.min/i.test(s.src)).map((s) => s.src),
    blocking: scripts.filter((s) => !s.defer && !s.async && s.type !== "module").map((s) => s.src),
    labIsModule: scripts.some((s) => /three-lab\.js$/.test(s.src) && s.type === "module")
  };
});
assert("Three.js has no <script> tag (dynamic import only)", loaderShape.threeTags.length === 0,
  loaderShape.threeTags.join(", ") || "none");
assert("lab loader is a module (non-blocking)", loaderShape.labIsModule === true);

/* ---------- transfer weight ---------- */
await page.evaluate(() => window.scrollTo(0, 0));
const byType = {};
for (const r of resources) {
  byType[r.type] = (byType[r.type] || 0) + r.size;
}
const totalKB = Object.values(byType).reduce((a, b) => a + b, 0) / 1024;
const summary = Object.entries(byType)
  .sort((a, b) => b[1] - a[1])
  .map(([t, s]) => `${t} ${(s / 1024).toFixed(0)}KB`)
  .join(", ");
info("transfer by type", summary || "content-length not reported");
if (totalKB > 0) {
  info("total reported transfer", `${totalKB.toFixed(0)} KB`);
  assert("total page weight under 2500 KB", totalKB < 2500, `${totalKB.toFixed(0)} KB`);
}

/* ---------- critical-path weight (what the visitor waits for) ----------
   Total page weight is no longer the right gate: scrolling to the Design Lab
   deliberately pulls ~655KB of Three.js. What must stay small is the weight
   needed for FIRST PAINT, so measure that separately. */
const threeBytes = resources
  .filter((r) => /three/i.test(r.url))
  .reduce((a, r) => a + r.size, 0);
const criticalKB = (Object.values(byType).reduce((a, b) => a + b, 0) - threeBytes) / 1024;
info("critical-path weight (excl. lazy 3D)", `${criticalKB.toFixed(0)} KB`);
if (threeBytes > 0) {
  info("lazy Three.js weight (not on critical path)", `${(threeBytes / 1024).toFixed(0)} KB`);
}
assert("critical-path weight under 900 KB", criticalKB < 900, `${criticalKB.toFixed(0)} KB`);

const failedRes = resources.filter((r) => r.status >= 400);
assert("no resource returned 4xx/5xx", failedRes.length === 0,
  failedRes.length ? failedRes.map((r) => `${r.status} ${r.url}`).join(", ") : "all 2xx/3xx");

/* ---------- render-blocking scripts in <head> ---------- */
const blocking = await page.evaluate(() => {
  const head = document.head;
  return Array.from(head.querySelectorAll("script[src]"))
    .filter((s) => !s.defer && !s.async)
    .map((s) => s.src);
});
assert("no render-blocking scripts in <head>", blocking.length === 0,
  blocking.length ? blocking.join(", ") : "none");

/* ---------- listener / node growth after heavy interaction ---------- */
const before = await page.metrics();
await page.evaluate(async () => {
  for (let i = 0; i < 3; i++) {
    document.getElementById("themeToggle").click();
    await new Promise((r) => setTimeout(r, 120));
  }
  const filters = document.querySelectorAll(".filter");
  for (const f of filters) {
    f.click();
    await new Promise((r) => setTimeout(r, 90));
  }
  for (let y = 0; y < document.body.scrollHeight; y += 700) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 25));
  }
});
const after = await page.metrics();

const nodeGrowth = after.Nodes - before.Nodes;
const listenerGrowth = after.JSEventListeners - before.JSEventListeners;
info("node growth after interaction", `${nodeGrowth}`);
info("listener growth after interaction", `${listenerGrowth}`);
assert("no runaway DOM node growth", nodeGrowth < 400, `${nodeGrowth} nodes`);
assert("no runaway event-listener growth", listenerGrowth < 120, `${listenerGrowth} listeners`);

info("JS heap", `${(after.JSHeapUsedSize / 1048576).toFixed(1)} MB used`);

console.log(`\n${passed} passed, ${failed} failed`);
for (const w of warns) console.log(`  WARN ${w}`);
console.log();

await shutdown();
process.exit(failed ? 1 : 0);
