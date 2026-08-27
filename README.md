# Samar Bhatt — Portfolio

A modern, motion-rich portfolio for **Samar Bhatt** — UI/UX Developer and Computer
Engineering diploma student. Built with plain HTML, CSS and JavaScript plus
Bootstrap 5, GSAP and a lazily-loaded Three.js showpiece.

**Live:** enable GitHub Pages on `main` / root, then visit
`https://bhattsamar18-sb.github.io/portfolio/`

---

## Highlights

- **Glassmorphism design system** — CSS custom-property tokens, dark/light theme
  that persists to `localStorage`, and a custom magnetic cursor.
- **Scroll storytelling** — GSAP + ScrollTrigger reveals, an animated CGPA
  counter, skill bars, a progressing timeline spine and a filterable work grid.
- **A Three.js "Design Lab"** — an interactive icosahedron with orbiting points,
  loaded **only** when you scroll to it (see *Performance* below).
- **Accessible by construction** — 21 automated checks: axe-core clean in both
  themes and with the mobile menu open, a real skip link, visible focus rings on
  every control, focus trapping and restoration, and reduced-motion fallbacks.
- **Verified, not assumed** — 96 automated assertions across four suites.

## Performance

The first version of this page loaded Three.js with a blocking `<script>` in the
hero and painted three `filter: blur(110px)` animated orbs. First Contentful
Paint was **10.9 s**.

Both were removed from the critical path:

| | Before | After |
|---|---|---|
| First Contentful Paint | 10,900 ms | **~950 ms** (median of 5 loads) |
| Page weight | 602 KB | **380 KB** |
| Critical-path JS | 223 KB | **102 KB** |
| Canvas / WebGL above the fold | 1 | **0** |
| `filter: blur()` above the fold | 3 | **0** |

Three.js still ships — it is just no longer a tax on arriving. `three-lab.js`
pulls it in with a dynamic `import()` that fires from an `IntersectionObserver`
300 px before the Design Lab scrolls into view, and only after checking for a
real (non-software) WebGL context, no `prefers-reduced-motion`, and a device
that is not obviously low-powered. If any check fails the section keeps a
pure-CSS poster and **zero** extra bytes are spent. The render loop is gated on
both viewport intersection and `visibilitychange`, so it never runs off-screen.

The ambient hero glow is now a paint-once `radial-gradient` stack instead of
blurred, animated orbs.

## Getting started

```bash
npm install          # dev-only: puppeteer-core, axe-core, pngjs
npm start            # serve on http://127.0.0.1:5173
```

No build step is required to view the site — `index.html` is served as-is.

### Editing CSS

`assets/css/style.css` is **generated**. Edit the numbered modules in
`assets/css/` and re-concatenate:

```bash
npm run build:css    # 8 modules -> assets/css/style.css
```

The generated file is committed on purpose: GitHub Pages serves it directly.

## Testing

```bash
python verify.py     # static integrity: anchors, JS hooks, CSS, assets   (11 checks)
node render-test.mjs # headless browser behaviour + screenshots           (57 checks)
node a11y-test.mjs   # axe-core WCAG audit + keyboard/reduced-motion      (21 checks)
node perf-test.mjs   # paint timings, long tasks, weight, leak smells     (18 checks)
```

Start the dev server first — the three Node suites drive a real Chrome against
`http://127.0.0.1:5173/`. Override with `TEST_URL` / `CHROME_PATH`.

### On measurement honesty

Some of these numbers cannot be measured reliably in headless Chrome, and the
suites say so rather than inventing a passing grade:

- **FPS is not asserted.** Repeated runs of the *identical* page spread across
  65 fps under SwiftShader — wider than any effect being tested. Frame health is
  gated on something deterministic instead: forced reflows (a geometry read
  after a style write in the same frame), currently **0**.
- **Paint timings assert on a median of 5 loads.** A single sample ranged
  668–2472 ms on unchanged code, because host CPU contention dilates the whole
  timeline at once. A threshold that fails at random teaches you to ignore red.

For real-world numbers, run Lighthouse in a headed browser on real hardware.

## Project structure

```
index.html               single page, all sections
assets/
  css/                   00-icons … 07-lab  ->  style.css (generated)
  js/main.js             preloader, theme, cursor, nav, reveals, form
  js/three-lab.js        lazy WebGL Design Lab (dynamic import)
  fonts/bi-subset.woff2  subset icon font
  img/                   responsive portrait + avatar (jpg/webp)
  img/source/            committed original the derivatives come from
build-css.py             concatenates the CSS modules
build-icons.py           builds the icon-font subset
verify.py                static integrity check
*-test.mjs               the four suites above
diagnose-*.mjs           narrow, single-question debugging probes
```

## Contact

**Samar Bhatt** — [bhattsamar18@gmail.com](mailto:bhattsamar18@gmail.com)

## License

MIT
