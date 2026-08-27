/* =====================================================================
   diagnose-icons.mjs — prove every icon in the SUBSET font renders.
   ---------------------------------------------------------------------
   Subsetting a font is exactly the kind of optimisation that "passes" while
   quietly breaking the page: a missing glyph still occupies layout, still has
   the right class, and still reports a computed font-family. It just draws a
   blank or a tofu box. No DOM assertion can see that.

   So this measures ink. For every distinct .bi-* on the page it renders the
   glyph to a canvas at 64px using the loaded font and counts non-transparent
   pixels. Zero ink = the glyph is missing from the subset.

   Run:  node diagnose-icons.mjs
   ===================================================================== */

import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";

const PORT = 5195;
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

let fails = 0;

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle2" });
  /* the icon font is font-display:block — wait for it to actually load */
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 600));

  const report = await page.evaluate(async () => {
    /* collect every distinct bi-* class on the page, and the codepoint the
       stylesheet assigns it via ::before content */
    const names = new Set();
    document.querySelectorAll('[class*="bi-"]').forEach((el) => {
      el.classList.forEach((c) => {
        if (c.startsWith("bi-") && c.length > 3) names.add(c.slice(3));
      });
    });

    const loaded = document.fonts.check('16px "bootstrap-icons"');

    const probe = document.createElement("i");
    probe.style.cssText = "position:absolute;left:-9999px;font-size:64px;";
    document.body.appendChild(probe);

    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 96;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const results = [];
    for (const name of [...names].sort()) {
      probe.className = `bi bi-${name}`;
      const cs = getComputedStyle(probe, "::before");
      const content = cs.content || "";
      const ch = content.replace(/^["']|["']$/g, "");
      const cp = ch ? ch.codePointAt(0).toString(16) : null;

      ctx.clearRect(0, 0, 96, 96);
      ctx.font = '64px "bootstrap-icons"';
      ctx.fillStyle = "#fff";
      ctx.textBaseline = "top";
      ctx.fillText(ch, 8, 8);
      const px = ctx.getImageData(0, 0, 96, 96).data;
      let ink = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] > 12) ink++;

      /* measure width too: a totally absent glyph often collapses to 0 */
      const w = ctx.measureText(ch).width;
      results.push({ name, cp, ink, w: Math.round(w) });
    }
    probe.remove();
    return { loaded, results };
  });

  console.log(`\nicon font loaded: ${report.loaded}`);
  console.log(`distinct icons on page: ${report.results.length}\n`);

  const blank = report.results.filter((r) => r.ink === 0);
  const noCp = report.results.filter((r) => !r.cp);

  for (const r of report.results) {
    const flag = r.ink === 0 ? "  <-- NO INK" : "";
    if (r.ink === 0 || process.env.VERBOSE) {
      console.log(
        `  ${r.name.padEnd(26)} U+${(r.cp || "????").toUpperCase().padEnd(5)} ink ${String(r.ink).padStart(5)} w ${r.w}${flag}`
      );
    }
  }

  const check = (n, ok, d = "") => {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? `  (${d})` : ""}`);
    if (!ok) fails++;
  };

  console.log("");
  check("subset icon font is loaded", report.loaded === true);
  check(
    "every icon class maps to a codepoint",
    noCp.length === 0,
    noCp.length ? noCp.map((r) => r.name).join(", ") : "all mapped"
  );
  check(
    "every icon renders visible ink (no tofu / blank glyphs)",
    blank.length === 0,
    blank.length ? `blank: ${blank.map((r) => r.name).join(", ")}` : `${report.results.length} glyphs drawn`
  );

  const inks = report.results.map((r) => r.ink).sort((a, b) => a - b);
  if (inks.length) {
    console.log(
      `  info  ink per glyph: min ${inks[0]} / median ${inks[Math.floor(inks.length / 2)]} / max ${inks[inks.length - 1]} px`
    );
  }

  console.log(`\n${fails === 0 ? "all icons verified" : `${fails} check(s) failed`}`);
  process.exitCode = fails === 0 ? 0 : 1;
} finally {
  await browser.close();
  server.kill();
}
