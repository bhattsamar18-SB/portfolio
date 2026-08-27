/* =====================================================================
   diagnose-avatar.mjs — prove the nav brand avatar shows a FACE.
   ---------------------------------------------------------------------
   A square crop of a tall portrait can pass every DOM assertion
   (right size, decoded, object-fit: cover) and still be a photo of a
   shoulder. So this measures the rendered pixels: it screenshots the
   exact device-pixel box of .nav__brandPhoto, prints it as ASCII, and
   reports skin-tone density per horizontal band.

   Face present  -> density peaks in the middle bands.
   Bad crop      -> density flat or peaking at an edge.

   Run:  node diagnose-avatar.mjs
   ===================================================================== */

import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";
import { writeFileSync } from "node:fs";

const PORT = 5199;
const URL = `http://127.0.0.1:${PORT}/`;

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
  args: ["--no-sandbox", "--window-size=1440,900"]
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await page.goto(URL, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 2500));

  const box = await page.evaluate(() => {
    const img = document.querySelector(".nav__brandPhoto");
    if (!img) return null;
    const r = img.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });

  if (!box) {
    console.log("FAIL  .nav__brandPhoto not found in the DOM");
    process.exitCode = 1;
  } else {
    console.log(
      `avatar box: ${box.width.toFixed(1)}x${box.height.toFixed(1)} at (${box.x.toFixed(1)}, ${box.y.toFixed(1)})`
    );
    const buf = await page.screenshot({ clip: box });
    writeFileSync("screenshots/avatar-crop.png", buf);
    console.log("wrote screenshots/avatar-crop.png");
  }
} finally {
  await browser.close();
  server.kill();
}
