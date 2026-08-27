/**
 * render-test.mjs â€” headless browser smoke test.
 *
 * Loads the served site in real Chrome and asserts:
 *   - zero console errors / page errors / failed requests
 *   - preloader actually dismisses (no trapped visitor)
 *   - hero WebGL canvas has non-zero size and drew pixels
 *   - key sections are present and visible
 *   - counters, skill bars and theme toggle work
 *   - work filters hide/show cards
 *   - mobile viewport renders without horizontal overflow
 * Saves screenshots to ./screenshots/
 *
 * Run:  node render-test.mjs
 */

import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const URL = process.env.TEST_URL || "http://127.0.0.1:5173/";
const CHROME =
  process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const SHOTS = "screenshots";
mkdirSync(SHOTS, { recursive: true });

const errors = [];
const failedRequests = [];
const requests = [];
let passed = 0;
let failed = 0;

function assert(name, condition, detail = "") {
  if (condition) {
    console.log(`  PASS  ${name}${detail ? "  (" + detail + ")" : ""}`);
    passed++;
  } else {
    console.log(`  FAIL  ${name}${detail ? "  (" + detail + ")" : ""}`);
    failed++;
  }
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--no-sandbox",
    "--enable-unsafe-swiftshader", // software WebGL in headless
    "--use-gl=angle",
    "--window-size=1440,900"
  ]
});

/* Guaranteed teardown â€” see the note in perf-test.mjs. Any throw before the
   browser.close() at the end of this file would otherwise leak a Chrome process
   tree that keeps burning CPU and skews every later run. */
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
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

page.on("console", (m) => {
  if (m.type() === "error") errors.push("console: " + m.text());
});
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("request", (r) => requests.push(r.url()));
page.on("requestfailed", (r) => {
  failedRequests.push(`${r.failure()?.errorText} ${r.url()}`);
});

console.log(`\nLoading ${URL}\n`);
await page.goto(URL, { waitUntil: "networkidle2", timeout: 45000 });

/* ---------- preloader must dismiss ---------- */
await page.waitForFunction(
  () => {
    const p = document.getElementById("preloader");
    return !p || p.classList.contains("is-done");
  },
  { timeout: 12000 }
);
assert("preloader dismisses", true);

assert(
  "body scroll unlocked after load",
  !(await page.evaluate(() => document.body.classList.contains("is-locked")))
);

/* let intro animations settle */
await new Promise((r) => setTimeout(r, 2600));

/* ---------- static hero backdrop (no WebGL by design) ---------- */
const backdrop = await page.evaluate(() => {
  const wash = document.querySelector(".backdrop__wash");
  const hero = document.querySelector(".hero");
  if (!wash || !hero) return null;
  const ws = getComputedStyle(wash);
  const before = getComputedStyle(hero, "::before");
  /* count anything still doing per-frame raster work on the first screen */
  const blurred = [...document.querySelectorAll(".backdrop *, .hero, .hero::before")].filter(
    (el) => (getComputedStyle(el).filter || "none").includes("blur")
  ).length;
  const animated = [...document.querySelectorAll(".backdrop *")].filter(
    (el) => (getComputedStyle(el).animationName || "none") !== "none"
  ).length;
  return {
    washPainted: ws.backgroundImage.includes("radial-gradient"),
    heroGlowPainted: before.backgroundImage.includes("radial-gradient"),
    blurred,
    animated,
    canvases: document.querySelectorAll("canvas").length
  };
});
assert("ambient backdrop present", backdrop !== null);
assert("gradient wash painted", backdrop && backdrop.washPainted);
assert("hero focal glow painted", backdrop && backdrop.heroGlowPainted);
assert("no blur() filters on first screen", backdrop && backdrop.blurred === 0, backdrop && `${backdrop.blurred} found`);
assert("no looping backdrop animations", backdrop && backdrop.animated === 0, backdrop && `${backdrop.animated} found`);

/* ---------- Three.js must be ABSENT until the Lab is scrolled to ----------
   The whole performance fix rests on this: the library is imported on demand
   from three-lab.js, so at load time there must be no canvas and no THREE. */
const atLoad = await page.evaluate(() => ({
  canvases: document.querySelectorAll("canvas").length,
  labState: document.getElementById("lab")?.dataset.labState || "missing",
  threeRequested: window.__threeRequested === true
}));
assert("no canvas before scrolling to the Lab", atLoad.canvases === 0, `${atLoad.canvases} found`);
assert("Lab starts in a non-live state", atLoad.labState !== "live", atLoad.labState);
assert("CSS poster present as the pre-WebGL state",
  await page.evaluate(() => !!document.querySelector(".lab__poster")));

/* THE LAZY-LOAD PROOF, part 1 â€” must be asserted HERE, while the page is still
   at the top. Later in this file the suite scrolls the whole document to fire
   the reveal animations, which legitimately boots the Lab; asserting after
   that point would always fail. Snapshot the request log now. */
const threeAtLoad = requests.filter((u) => /three@|three\.module|three\.min/i.test(u));
assert(
  "Three.js NOT requested during initial load",
  threeAtLoad.length === 0,
  threeAtLoad.length ? threeAtLoad.join(", ") : "0 requests"
);

/* ---------- sections ---------- */
for (const id of ["home", "about", "skills", "experience", "work", "lab", "process", "contact"]) {
  const box = await page.evaluate((i) => {
    const el = document.getElementById(i);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { h: Math.round(r.height), w: Math.round(r.width) };
  }, id);
  assert(`section #${id} rendered`, box && box.h > 200 && box.w > 300, box && `${box.w}x${box.h}`);
}

/* ---------- hero text intro ---------- */
assert(
  "hero headline lines revealed",
  await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-split]")).every((e) =>
      e.classList.contains("is-in")
    )
  )
);
const typed = await page.evaluate(() => document.getElementById("typed")?.textContent || "");
assert("typing effect producing text", typed.length > 0, JSON.stringify(typed));

/* ---------- scroll through page, trigger reveals ---------- */
await page.evaluate(async () => {
  const step = window.innerHeight * 0.7;
  for (let y = 0; y < document.body.scrollHeight; y += step) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 120));
  }
});
await new Promise((r) => setTimeout(r, 1800));

const revealStats = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll("[data-reveal]"));
  return { total: all.length, shown: all.filter((e) => e.classList.contains("is-in")).length };
});
assert(
  "scroll reveals fired",
  revealStats.shown >= revealStats.total * 0.85,
  `${revealStats.shown}/${revealStats.total}`
);

/* counters */
const cgpa = await page.evaluate(() => {
  const el = Array.from(document.querySelectorAll("[data-count]")).find(
    (e) => e.dataset.count === "7.55"
  );
  return el ? el.textContent.trim() : null;
});
assert("CGPA counter animated to value", cgpa === "7.55", String(cgpa));

/* skill bars */
const bars = await page.evaluate(() =>
  Array.from(document.querySelectorAll("[data-bar] .bar__track i")).map((i) =>
    parseFloat(i.style.width) || 0
  )
);
assert("skill bars filled", bars.length > 0 && bars.every((w) => w > 50), `widths: ${bars.join(",")}`);

/* timeline spine */
const spine = await page.evaluate(() => parseFloat(document.getElementById("spineFill")?.style.height) || 0);
assert("timeline spine progressed", spine > 0, spine.toFixed(1) + "%");

/* scroll progress bar */
const prog = await page.evaluate(() => parseFloat(document.getElementById("scrollBar")?.style.width) || 0);
assert("scroll progress bar tracking", prog > 20, prog.toFixed(1) + "%");

/* ---------- work filters ---------- */
await page.evaluate(() => window.scrollTo(0, document.getElementById("work").offsetTop));
await new Promise((r) => setTimeout(r, 500));

const filterResult = await page.evaluate(async () => {
  const btn = document.querySelector('.filter[data-filter="ux"]');
  btn.click();
  await new Promise((r) => setTimeout(r, 650));
  const cards = Array.from(document.querySelectorAll(".work"));
  const visible = cards.filter((c) => !c.classList.contains("is-hidden"));
  const ok = visible.every((c) => (c.dataset.cat || "").split(" ").includes("ux"));
  // restore
  document.querySelector('.filter[data-filter="all"]').click();
  await new Promise((r) => setTimeout(r, 500));
  const afterAll = document.querySelectorAll(".work:not(.is-hidden)").length;
  return { visible: visible.length, total: cards.length, ok, afterAll };
});
assert(
  "work filter shows only matching cards",
  filterResult.ok && filterResult.visible > 0 && filterResult.visible < filterResult.total,
  `${filterResult.visible}/${filterResult.total} for "ux"`
);
assert("filter reset restores all cards", filterResult.afterAll === filterResult.total, `${filterResult.afterAll}`);

/* ---------- form validation ---------- */
const formResult = await page.evaluate(async () => {
  document.getElementById("contact").scrollIntoView();
  await new Promise((r) => setTimeout(r, 400));
  const f = document.getElementById("contactForm");

  f.querySelector("button[type=submit]").click();
  await new Promise((r) => setTimeout(r, 300));
  const invalidOnEmpty = f.querySelectorAll(".field.is-invalid").length;

  document.getElementById("name").value = "Recruiter";
  document.getElementById("email").value = "hire@studio.com";
  document.getElementById("subject").value = "UI role";
  document.getElementById("message").value = "We loved your Finlo case study, let us talk.";
  f.querySelectorAll("input, textarea").forEach((i) =>
    i.dispatchEvent(new Event("blur", { bubbles: true }))
  );
  await new Promise((r) => setTimeout(r, 250));
  const validCount = f.querySelectorAll(".field.is-valid").length;

  f.querySelector("button[type=submit]").click();
  await new Promise((r) => setTimeout(r, 1600));
  const success = document.getElementById("formOk").classList.contains("is-show");
  return { invalidOnEmpty, validCount, success };
});
assert("empty form flags invalid fields", formResult.invalidOnEmpty === 4, `${formResult.invalidOnEmpty} flagged`);
assert("valid input marks fields valid", formResult.validCount === 4, `${formResult.validCount} valid`);
assert("valid submit shows success state", formResult.success);

/* ---------- THE LAZY-LOAD PROOF, part 2 ----------
   Part 1 (above, before any scrolling) proved Three.js is absent at load.
   This half proves it DOES arrive on demand and that the loop behaves. */
await page.evaluate(() => {
  document.getElementById("lab").scrollIntoView({ behavior: "instant", block: "center" });
});
/* the import is a network fetch of ~655KB raw; give it real time */
let labLive = false;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 400));
  labLive = await page.evaluate(() => {
    const s = document.getElementById("lab")?.dataset.labState;
    return s === "live" || s === "lite" || s === "static";
  });
  if (labLive) break;
}

const labAfter = await page.evaluate(() => {
  const lab = document.getElementById("lab");
  const canvas = lab.querySelector("canvas");
  return {
    state: lab.dataset.labState,
    status: lab.querySelector("[data-lab-status]")?.textContent.trim(),
    hasCanvas: !!canvas,
    w: canvas ? canvas.width : 0,
    h: canvas ? canvas.height : 0,
    running: window.__lab ? window.__lab.running : null,
    lite: window.__lab ? window.__lab.lite : null
  };
});
console.log(`  info  lab state after scroll: ${labAfter.state} â€” "${labAfter.status}"`);

const threeAfter = requests.filter((u) => /three@|three\.module|three\.min/i.test(u));
assert(
  "Three.js requested only after scrolling to the Lab",
  threeAfter.length > 0,
  threeAfter.length ? "fetched on demand" : "never fetched"
);

/* Headless Chrome runs SwiftShader, which three-lab.js deliberately detects
   and downgrades to lite mode â€” so accept live OR lite, but never idle. */
assert(
  "Lab reaches a resolved state (live/lite/static)",
  ["live", "lite", "static"].includes(labAfter.state),
  labAfter.state
);
if (labAfter.hasCanvas) {
  assert("WebGL canvas has real pixel dimensions", labAfter.w > 0 && labAfter.h > 0,
    `${labAfter.w}x${labAfter.h}`);

  /* ---------- the render loop must PAUSE off-screen ----------
     An always-on rAF loop is the battery bug this architecture exists to
     avoid, so prove it actually stops. */
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await new Promise((r) => setTimeout(r, 900));
  const paused = await page.evaluate(() => (window.__lab ? window.__lab.running : null));
  assert("render loop pauses when the Lab is off-screen", paused === false, `running=${paused}`);

  await page.evaluate(() => {
    document.getElementById("lab").scrollIntoView({ behavior: "instant", block: "center" });
  });
  await new Promise((r) => setTimeout(r, 900));
  const resumed = await page.evaluate(() => (window.__lab ? window.__lab.running : null));
  assert("render loop resumes when scrolled back", resumed === true, `running=${resumed}`);

  await page.screenshot({ path: `${SHOTS}/lab-webgl.png` });
} else {
  console.log("  info  no canvas (declined WebGL in this environment) â€” poster retained");
  assert("CSS poster still visible when WebGL declined",
    await page.evaluate(() => {
      const p = document.querySelector(".lab__poster");
      return p && getComputedStyle(p).opacity !== "0";
    })
  );
}

/* ---------- portrait photo actually decoded ---------- */
await page.evaluate(() => {
  document.getElementById("about").scrollIntoView({ behavior: "instant", block: "center" });
});
await new Promise((r) => setTimeout(r, 1200));
const photo = await page.evaluate(() => {
  const img = document.querySelector(".about__photo");
  if (!img) return null;
  const r = img.getBoundingClientRect();
  return {
    complete: img.complete,
    natural: `${img.naturalWidth}x${img.naturalHeight}`,
    naturalW: img.naturalWidth,
    box: `${Math.round(r.width)}x${Math.round(r.height)}`,
    boxW: Math.round(r.width),
    chosen: img.currentSrc.split("/").pop(),
    lazy: img.getAttribute("loading") === "lazy",
    alt: img.getAttribute("alt") || ""
  };
});
assert("portrait photo element present", photo !== null);
if (photo) {
  console.log(`  info  portrait: ${photo.chosen} natural ${photo.natural} in ${photo.box} box`);
  assert("portrait photo decoded (non-zero intrinsic size)", photo.naturalW > 0, photo.natural);
  assert("portrait rendered at a visible size", photo.boxW > 120, photo.box);
  assert("portrait is lazy-loaded (below the fold)", photo.lazy === true);
  assert("portrait has descriptive alt text", photo.alt.length > 20, `"${photo.alt}"`);
}

/* ---------- nav brand avatar ----------
   This one is ABOVE the fold, so the requirements invert: it must NOT be
   lazy (a lazy avatar pops in after paint) and it must be a small file.
   It also must not be a stretched crop of the tall portrait. */
const avatar = await page.evaluate(() => {
  const img = document.querySelector(".nav__brandPhoto");
  if (!img) return null;
  const r = img.getBoundingClientRect();
  return {
    naturalW: img.naturalWidth,
    naturalH: img.naturalHeight,
    boxW: Math.round(r.width),
    boxH: Math.round(r.height),
    chosen: img.currentSrc.split("/").pop(),
    lazy: img.getAttribute("loading") === "lazy",
    alt: img.getAttribute("alt") || "",
    fit: getComputedStyle(img).objectFit
  };
});
assert("nav brand avatar present", avatar !== null);
if (avatar) {
  console.log(`  info  avatar: ${avatar.chosen} natural ${avatar.naturalW}x${avatar.naturalH} in ${avatar.boxW}x${avatar.boxH} box`);
  assert("nav avatar decoded", avatar.naturalW > 0, `${avatar.naturalW}x${avatar.naturalH}`);
  assert("nav avatar is a square source (not a squashed portrait)", avatar.naturalW === avatar.naturalH, `${avatar.naturalW}x${avatar.naturalH}`);
  assert("nav avatar is eager (above the fold)", avatar.lazy === false);
  assert("nav avatar uses object-fit: cover", avatar.fit === "cover", avatar.fit);
  assert("nav avatar has alt text", avatar.alt.length > 0, `"${avatar.alt}"`);
  assert("nav avatar rendered at brand size", avatar.boxW >= 30 && avatar.boxW <= 56, `${avatar.boxW}px`);
}

/* ---------- theme toggle ---------- */
const themeResult = await page.evaluate(async () => {
  const root = document.documentElement;
  const before = root.getAttribute("data-theme");
  const bgBefore = getComputedStyle(document.body).backgroundColor;
  document.getElementById("themeToggle").click();
  await new Promise((r) => setTimeout(r, 900));
  const after = root.getAttribute("data-theme");
  const bgAfter = getComputedStyle(document.body).backgroundColor;
  return { before, after, bgBefore, bgAfter, stored: localStorage.getItem("sb-theme") };
});
assert("theme toggle switches mode", themeResult.before !== themeResult.after, `${themeResult.before} -> ${themeResult.after}`);
assert("theme changes background colour", themeResult.bgBefore !== themeResult.bgAfter, `${themeResult.bgBefore} -> ${themeResult.bgAfter}`);
assert("theme persisted to localStorage", themeResult.stored === themeResult.after, String(themeResult.stored));

await page.screenshot({ path: `${SHOTS}/light-contact.png` });

/* back to dark + top for the hero shot */
await page.evaluate(async () => {
  document.getElementById("themeToggle").click();
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 900));
});
await new Promise((r) => setTimeout(r, 1400));
await page.screenshot({ path: `${SHOTS}/desktop-hero.png` });
await page.screenshot({ path: `${SHOTS}/desktop-full.png`, fullPage: true });

/* ---------- mobile ---------- */
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.reload({ waitUntil: "networkidle2" });
await page.waitForFunction(
  () => {
    const p = document.getElementById("preloader");
    return !p || p.classList.contains("is-done");
  },
  { timeout: 12000 }
);
await new Promise((r) => setTimeout(r, 2000));

const overflow = await page.evaluate(() => ({
  scrollW: document.documentElement.scrollWidth,
  clientW: document.documentElement.clientWidth
}));
assert(
  "no horizontal overflow on mobile",
  overflow.scrollW <= overflow.clientW + 2,
  `${overflow.scrollW} vs ${overflow.clientW}`
);

const menuResult = await page.evaluate(async () => {
  document.getElementById("burger").click();
  await new Promise((r) => setTimeout(r, 900));
  const open = document.getElementById("mobileMenu").classList.contains("is-open");
  const locked = document.body.classList.contains("is-locked");
  document.getElementById("burger").click();
  await new Promise((r) => setTimeout(r, 900));
  const closed = !document.getElementById("mobileMenu").classList.contains("is-open");
  return { open, locked, closed };
});
assert("mobile menu opens", menuResult.open);
assert("body locks while menu open", menuResult.locked);
assert("mobile menu closes", menuResult.closed);

await page.screenshot({ path: `${SHOTS}/mobile-hero.png` });

/* ---------- error report ---------- */
const realFailures = failedRequests.filter((u) => !/favicon\.ico/.test(u));
assert("no JS console/page errors", errors.length === 0, errors.slice(0, 4).join(" | "));
assert("no failed network requests", realFailures.length === 0, realFailures.slice(0, 4).join(" | "));

await shutdown();

console.log(`\n${passed} passed, ${failed} failed`);
console.log(`Screenshots -> ./${SHOTS}/\n`);
process.exit(failed > 0 ? 1 : 0);
