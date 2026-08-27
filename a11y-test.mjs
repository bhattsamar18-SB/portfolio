/**
 * a11y-test.mjs â€” real WCAG audit with axe-core, plus keyboard-navigation
 * and reduced-motion checks that axe cannot see.
 *
 * Audits the page in three states, because a SPA-ish page hides most of its
 * violations behind interaction:
 *   1. dark theme, top of page
 *   2. light theme (contrast is a different problem in each theme)
 *   3. mobile menu open (focus trapping / hidden-content semantics)
 *
 * Run:  node a11y-test.mjs
 */

import puppeteer from "puppeteer-core";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const URL = process.env.TEST_URL || "http://127.0.0.1:5173/";
const CHROME =
  process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

let failed = 0;
let passed = 0;

function assert(name, cond, detail = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
  cond ? passed++ : failed++;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle"]
});

/* Guaranteed teardown â€” see the note in perf-test.mjs. */
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

async function load() {
  await page.goto(URL, { waitUntil: "networkidle2" });
  await page.waitForFunction(
    () => {
      const p = document.getElementById("preloader");
      return !p || p.classList.contains("is-done");
    },
    { timeout: 15000 }
  );
  await page.evaluate(() => new Promise((r) => setTimeout(r, 400)));
}

async function runAxe(label) {
  await page.evaluate(AXE);
  const res = await page.evaluate(async () => {
    const r = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }
    });
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 4).map((n) => n.html.slice(0, 110))
    }));
  });

  const serious = res.filter((v) => v.impact === "critical" || v.impact === "serious");
  assert(`axe: no critical/serious violations [${label}]`, serious.length === 0,
    serious.length ? serious.map((v) => v.id).join(", ") : "clean");

  const minor = res.filter((v) => !serious.includes(v));
  if (minor.length) {
    console.log(`     note  minor/moderate: ${minor.map((v) => v.id).join(", ")}`);
  }
  for (const v of serious) {
    console.log(`     -> ${v.id} (${v.impact}): ${v.help}`);
    v.nodes.forEach((n) => console.log(`          ${n}`));
  }
  return res;
}

console.log(`\nAccessibility audit: ${URL}\n`);

/* ---------- 1. dark theme ---------- */
await load();
await runAxe("dark");

/* ---------- keyboard: skip link should be first stop ---------- */
await page.keyboard.press("Tab");
const focused = await page.evaluate(() => {
  const a = document.activeElement;
  return {
    tag: a.tagName.toLowerCase(),
    text: (a.textContent || "").trim().slice(0, 30),
    cls: (a.className || "").toString(),
    visible: a.getBoundingClientRect().top > -200
  };
});
assert("first Tab reaches a skip link", /skip/i.test(focused.text) || /skip/i.test(focused.cls),
  `${focused.tag} "${focused.text}"`);

/* The skip link slides in with a 0.22s transform transition, so let it
   settle before measuring â€” the element is still off-screen at t=0. */
await page.evaluate(() => new Promise((r) => setTimeout(r, 450)));
const skipVisible = await page.evaluate(() => {
  const el = document.querySelector(".skip-link");
  if (!el) return { found: false };
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  return {
    found: true,
    onScreen: r.top >= 0 && r.left >= 0 && r.height > 0,
    opacity: s.opacity,
    top: Math.round(r.top),
    focused: document.activeElement === el
  };
});
assert("skip link is visible on focus",
  skipVisible.found && skipVisible.onScreen && skipVisible.opacity !== "0",
  `top=${skipVisible.top} opacity=${skipVisible.opacity} focused=${skipVisible.focused}`);

/* skip link must actually move focus to <main> when activated */
await page.keyboard.press("Enter");
await page.evaluate(() => new Promise((r) => setTimeout(r, 400)));
const afterSkip = await page.evaluate(() => ({
  hash: location.hash,
  mainExists: !!document.getElementById("main")
}));
assert("skip link targets #main", afterSkip.hash === "#main" && afterSkip.mainExists,
  `hash=${afterSkip.hash}`);

/* ---------- focus ring must appear for REAL keyboard focus ----------
   Programmatic .focus() intentionally does not match :focus-visible, so
   this walks the page with Tab and inspects whatever the browser lands on. */
await load();
const ringReport = await (async () => {
  const out = [];
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press("Tab");
    const r = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return null;
      const s = getComputedStyle(a);
      const ring =
        (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) ||
        s.boxShadow !== "none";
      return {
        id: a.id || a.className.toString().split(" ")[0] || a.tagName.toLowerCase(),
        matchesFocusVisible: a.matches(":focus-visible"),
        ring
      };
    });
    if (r) out.push(r);
  }
  return out;
})();
const unringed = ringReport.filter((r) => r.matchesFocusVisible && !r.ring);
assert("every keyboard-focused control shows a focus ring", unringed.length === 0,
  unringed.length ? JSON.stringify(unringed) : `${ringReport.length} controls tabbed`);

/* the burger specifically â€” it is a bare button with no border of its own */
await page.setViewport({ width: 390, height: 844 });
await load();
const burgerRing = await (async () => {
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    const hit = await page.evaluate(() => {
      const a = document.activeElement;
      if (a.id !== "burger") return null;
      const s = getComputedStyle(a);
      return {
        outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`,
        visible:
          (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) ||
          s.boxShadow !== "none"
      };
    });
    if (hit) return hit;
  }
  return null;
})();
assert("burger shows a focus ring when tabbed to", burgerRing && burgerRing.visible,
  burgerRing ? burgerRing.outline : "never reached by Tab");

/* ---------- mobile menu semantics ---------- */
await page.evaluate(() => document.getElementById("burger").click());
/* clip-path is 0.8s and link fades carry delays up to ~0.49s + 0.6s;
   audit the SETTLED state, since transient animation frames are not a
   WCAG failure and would otherwise report false contrast violations. */
await page.evaluate(() => new Promise((r) => setTimeout(r, 1600)));

const menuState = await page.evaluate(() => {
  const menu = document.getElementById("mobileMenu");
  const burger = document.getElementById("burger");
  return {
    expanded: burger.getAttribute("aria-expanded"),
    ariaHidden: menu.getAttribute("aria-hidden"),
    role: menu.getAttribute("role"),
    modal: menu.getAttribute("aria-modal"),
    focusInside: menu.contains(document.activeElement),
    activeTag: document.activeElement.tagName.toLowerCase()
  };
});
assert("burger reports aria-expanded=true when open", menuState.expanded === "true", menuState.expanded);
assert("open menu is not aria-hidden", menuState.ariaHidden !== "true", String(menuState.ariaHidden));
assert("menu moves focus inside when opened", menuState.focusInside === true,
  `activeElement=${menuState.activeTag}`);

await runAxe("mobile menu open");

/* Escape closes and restores focus to the burger */
await page.keyboard.press("Escape");
await page.evaluate(() => new Promise((r) => setTimeout(r, 450)));
const afterEsc = await page.evaluate(() => ({
  open: document.getElementById("mobileMenu").classList.contains("is-open"),
  focusOnBurger: document.activeElement.id === "burger",
  hidden: document.getElementById("mobileMenu").getAttribute("aria-hidden")
}));
assert("Escape closes the menu", afterEsc.open === false);
assert("focus returns to the burger after close", afterEsc.focusOnBurger === true,
  String(afterEsc.focusOnBurger));
assert("closed menu is aria-hidden", afterEsc.hidden === "true", String(afterEsc.hidden));

/* ---------- closed menu must not be keyboard reachable ---------- */
const hiddenReachable = await page.evaluate(() => {
  const menu = document.getElementById("mobileMenu");
  const links = Array.from(menu.querySelectorAll("a"));
  // an element is unreachable if aria-hidden container or negative tabindex
  return links.filter((a) => a.tabIndex >= 0 && menu.getAttribute("aria-hidden") === "true").length;
});
assert("links in a closed menu are removed from tab order", hiddenReachable === 0,
  `${hiddenReachable} focusable`);

/* ---------- 2. light theme ---------- */
await page.setViewport({ width: 1440, height: 900 });
await load();
await page.evaluate(() => {
  if (document.documentElement.getAttribute("data-theme") !== "light") {
    document.getElementById("themeToggle").click();
  }
});
await page.evaluate(() => new Promise((r) => setTimeout(r, 600)));
await runAxe("light");

/* ---------- 3. reduced motion honoured ---------- */
await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
await load();
const reduced = await page.evaluate(() => {
  const typed = document.getElementById("typed");
  const marquee = document.querySelector(".marquee__track, #marqueeTrack");
  return {
    typedText: (typed?.textContent || "").trim(),
    marqueeAnim: marquee ? getComputedStyle(marquee).animationName : "none",
    heroIn: !!document.querySelector("[data-split].is-in")
  };
});
assert("reduced motion still shows role text (no empty typing)", reduced.typedText.length > 0,
  `"${reduced.typedText}"`);
assert("reduced motion still reveals hero content", reduced.heroIn === true);

/* ---------- images / landmarks ---------- */
await load();
const landmarks = await page.evaluate(() => ({
  main: document.querySelectorAll("main").length,
  h1: document.querySelectorAll("h1").length,
  imgsNoAlt: Array.from(document.querySelectorAll("img")).filter((i) => !i.hasAttribute("alt")).length,
  headingOrder: Array.from(document.querySelectorAll("h1,h2,h3,h4"))
    .map((h) => +h.tagName[1])
}));
assert("exactly one <main> landmark", landmarks.main === 1, String(landmarks.main));
assert("exactly one <h1>", landmarks.h1 === 1, String(landmarks.h1));
assert("every <img> has alt", landmarks.imgsNoAlt === 0, `${landmarks.imgsNoAlt} missing`);

let jumps = 0;
for (let i = 1; i < landmarks.headingOrder.length; i++) {
  if (landmarks.headingOrder[i] - landmarks.headingOrder[i - 1] > 1) jumps++;
}
assert("no skipped heading levels", jumps === 0, `${jumps} jumps`);

console.log(`\n${passed} passed, ${failed} failed\n`);
await shutdown();
process.exit(failed ? 1 : 0);
