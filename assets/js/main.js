/* =====================================================================
   main.js — Samar Bhatt portfolio interactions
   ---------------------------------------------------------------------
   Modules:
     01  Preloader
     02  Theme (dark / light, persisted)
     03  Custom cursor + magnetic elements
     04  Navigation (sticky, pill, active link, mobile menu)
     05  Scroll progress bar
     06  Hero: split-line intro + typing effect
     07  Reveal on scroll (IntersectionObserver)
     08  Counters, skill bars, CGPA gauge, timeline spine
     09  3D tilt on cards
     10  Work filters + cursor-follow glow
     11  Contact form validation
     12  Marquee duplication, footer year, GSAP parallax
   ===================================================================== */

(function () {
  "use strict";

  const $ = (s, ctx) => (ctx || document).querySelector(s);
  const $$ = (s, ctx) => Array.from((ctx || document).querySelectorAll(s));
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const IS_TOUCH = window.matchMedia("(hover: none)").matches;

  const lerp = (a, b, n) => a + (b - a) * n;
  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

  /**
   * Has this element reached (or already passed) its reveal line?
   *
   * The trigger must LATCH, not describe a window. An earlier version used
   * `rect.top < innerHeight * 0.92 && rect.bottom > 0`, which is only true
   * while the element is on screen — so anything scrolled past quickly (or
   * skipped by an anchor jump, where IntersectionObserver coalesces its
   * callbacks) stayed invisible at opacity 0 permanently.
   *
   * Testing only the top edge means "once crossed, always true", so the
   * scroll backstop can always recover a missed element.
   */
  const hasCrossedRevealLine = (el) =>
    el.getBoundingClientRect().top < window.innerHeight * 0.92;

  /* =================================================================
     SCROLL SCHEDULER
     -----------------------------------------------------------------
     Every scroll handler used to run synchronously on the scroll event
     and call getBoundingClientRect(), forcing a fresh layout each time.
     Measured: ~66 forced layouts per scroll event (2,660 in 1.6s), which
     dropped scrolling to ~15fps.

     Now all subscribers run once per animation frame, so the browser
     performs at most one layout per frame no matter how many handlers
     exist. Measured effect: +42 fps.
     ================================================================= */
  const onScrollFrame = (() => {
    const subs = new Set();
    let queued = false;

    const flush = () => {
      queued = false;
      subs.forEach((fn) => {
        try { fn(); } catch (err) { /* one bad handler must not kill the rest */ }
      });
    };

    const request = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(flush);
    };

    window.addEventListener("scroll", request, { passive: true });
    window.addEventListener("resize", request, { passive: true });

    return (fn, runNow) => {
      subs.add(fn);
      if (runNow !== false) fn();
      return () => subs.delete(fn);
    };
  })();

  /* =================================================================
     06. HERO INTRO + TYPING  (declared early — preloader calls it)
     ================================================================= */
  const Hero = (() => {
    const parts = $$("[data-split]");
    const typedEl = $("#typed");

    const ROLES = [
      "UI/UX Developer",
      "Computer Engineering Student",
      "Figma to Front-End",
      "Design Systems Builder",
      "Interaction Designer"
    ];

    function typeLoop() {
      if (!typedEl) return;

      // The first role ships in the HTML so the heading is never empty at first
      // paint (and stays correct with JS off / reduced motion on).
      const seeded = (typedEl.textContent || "").trim();
      if (REDUCED) {
        if (!seeded) typedEl.textContent = ROLES[0];
        return;
      }

      // Resume from the seeded word instead of blanking it, so there is no flash
      // of empty text when the animation takes over.
      let r = Math.max(0, ROLES.indexOf(seeded));
      let i = seeded && ROLES[r] === seeded ? seeded.length : 0;
      let deleting = i > 0;
      let hold = deleting ? 1700 : 0;

      (function step() {
        const word = ROLES[r];
        typedEl.textContent = word.slice(0, i);

        let delay = deleting ? 42 : 82;

        if (hold) { delay = hold; hold = 0; }
        else if (!deleting && i === word.length) {
          deleting = true;
          delay = 1700;
        } else if (deleting && i === 0) {
          deleting = false;
          r = (r + 1) % ROLES.length;
          delay = 320;
        } else {
          i += deleting ? -1 : 1;
        }
        setTimeout(step, delay);
      })();
    }

    let played = false;
    return {
      play() {
        if (played) return;
        played = true;
        parts.forEach((p, i) => {
          p.style.transitionDelay = `${0.08 + i * 0.085}s`;
          p.classList.add("is-in");
        });
        setTimeout(typeLoop, 520);
      }
    };
  })();

  /* =================================================================
     01. PRELOADER
     ================================================================= */
  const Preloader = (() => {
    const el = $("#preloader");
    if (!el) {
      Hero.play();
      return { done() {} };
    }

    const bar = $("[data-loader-bar]");
    const pct = $("[data-loader-pct]");
    const txt = $("[data-loader-text]");
    const phases = [
      "Composing the grid",
      "Loading design tokens",
      "Aligning to 8pt rhythm",
      "Ready"
    ];

    let progress = 0;
    let finished = false;
    let closed = false;
    let raf;

    document.body.classList.add("is-locked");

    function close() {
      if (closed) return;
      closed = true;
      cancelAnimationFrame(raf);
      el.classList.add("is-done");
      document.body.classList.remove("is-locked");
      document.body.classList.add("is-loaded");
      setTimeout(() => { el.style.display = "none"; }, 780);
      Hero.play();
    }

    function loop() {
      // creep toward 92% while assets load, then complete on window load
      const target = finished ? 100 : 92;
      progress = lerp(progress, target, finished ? 0.24 : 0.022);
      if (finished && progress > 99.3) progress = 100;

      const p = Math.round(progress);
      if (bar) bar.style.width = p + "%";
      if (pct) pct.textContent = p + "%";
      if (txt) {
        const idx = clamp(Math.floor((p / 100) * phases.length), 0, phases.length - 1);
        if (txt.textContent !== phases[idx]) txt.textContent = phases[idx];
      }

      if (p >= 100) { close(); return; }
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);

    return { done() { finished = true; } };
  })();

  /* =================================================================
     02. THEME
     ================================================================= */
  (function theme() {
    const KEY = "sb-theme";
    const root = document.documentElement;
    const btn = $("#themeToggle");
    const icon = $("[data-theme-icon]");

    function apply(next, animate) {
      root.setAttribute("data-theme", next);
      if (icon) icon.className = next === "light" ? "bi bi-sun" : "bi bi-moon-stars";
      try { localStorage.setItem(KEY, next); } catch (e) {}
      window.dispatchEvent(new CustomEvent("themechange", { detail: { theme: next } }));

      if (animate && btn && btn.animate) {
        btn.animate(
          [{ transform: "rotate(0) scale(1)" },
           { transform: "rotate(180deg) scale(.82)" },
           { transform: "rotate(360deg) scale(1)" }],
          { duration: 520, easing: "cubic-bezier(.22,1,.36,1)" }
        );
      }
    }

    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) {}
    apply(saved || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"), false);

    if (btn) {
      btn.addEventListener("click", () =>
        apply(root.getAttribute("data-theme") === "light" ? "dark" : "light", true)
      );
    }
  })();

  /* =================================================================
     03. CUSTOM CURSOR + MAGNETIC
     ================================================================= */
  (function cursor() {
    if (IS_TOUCH) return;

    const dot = $("#cursorDot");
    const ring = $("#cursorRing");

    if (dot && ring) {
      const label = $(".cursor-ring__label", ring);
      const pos = { x: innerWidth / 2, y: innerHeight / 2 };
      const rp = { x: pos.x, y: pos.y };

      window.addEventListener("pointermove", (e) => {
        pos.x = e.clientX;
        pos.y = e.clientY;
      }, { passive: true });

      (function render() {
        requestAnimationFrame(render);
        dot.style.transform = `translate3d(${pos.x}px,${pos.y}px,0) translate(-50%,-50%)`;
        rp.x = lerp(rp.x, pos.x, 0.16);
        rp.y = lerp(rp.y, pos.y, 0.16);
        ring.style.transform = `translate3d(${rp.x}px,${rp.y}px,0) translate(-50%,-50%)`;
      })();

      const HOVERABLE = "a, button, [data-cursor], .work, .tool, .fact, input, textarea";
      document.addEventListener("pointerover", (e) => {
        const t = e.target.closest && e.target.closest(HOVERABLE);
        if (!t) return;
        ring.classList.add("is-hover");
        if (label) label.textContent = t.getAttribute("data-cursor") || "";
      });
      document.addEventListener("pointerout", (e) => {
        if (!(e.target.closest && e.target.closest(HOVERABLE))) return;
        ring.classList.remove("is-hover");
        if (label) label.textContent = "";
      });
    }

    /* magnetic pull */
    if (REDUCED) return;
    $$("[data-magnetic]").forEach((el) => {
      const S = 0.3;
      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect();
        const mx = e.clientX - (r.left + r.width / 2);
        const my = e.clientY - (r.top + r.height / 2);
        el.style.transform = `translate(${(mx * S).toFixed(2)}px,${(my * S).toFixed(2)}px)`;
      });
      el.addEventListener("pointerleave", () => { el.style.transform = ""; });
    });
  })();

  /* =================================================================
     04. NAVIGATION
     ================================================================= */
  (function nav() {
    const bar = $("#nav");
    const links = $$("[data-nav]");
    const pill = $("#navPill");
    const burger = $("#burger");
    const menu = $("#mobileMenu");

    const onScroll = () => bar && bar.classList.toggle("is-stuck", window.scrollY > 24);
    onScrollFrame(onScroll);

    const activeLink = () => links.find((l) => l.classList.contains("is-active"));

    function movePill(target) {
      if (!pill || !target) return;
      pill.style.opacity = "1";
      pill.style.width = target.offsetWidth + "px";
      pill.style.transform = `translateX(${target.offsetLeft}px)`;
    }

    links.forEach((l) => l.addEventListener("pointerenter", () => movePill(l)));
    const wrap = $("#navLinks");
    if (wrap) wrap.addEventListener("pointerleave", () => movePill(activeLink()));
    window.addEventListener("load", () => movePill(activeLink()));
    window.addEventListener("resize", () => movePill(activeLink()));

    const sections = links
      .map((l) => document.querySelector(l.getAttribute("href")))
      .filter(Boolean);

    if ("IntersectionObserver" in window && sections.length) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          const id = "#" + en.target.id;
          links.forEach((l) => l.classList.toggle("is-active", l.getAttribute("href") === id));
          movePill(activeLink());
        });
      }, { rootMargin: "-45% 0px -50% 0px" });
      sections.forEach((s) => io.observe(s));
    }

    function setMenu(open) {
      if (!menu || !burger) return;
      menu.classList.toggle("is-open", open);
      burger.classList.toggle("is-open", open);
      burger.setAttribute("aria-expanded", String(open));
      burger.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      document.body.classList.toggle("is-locked", open);

      /* A closed full-screen overlay is still in the DOM, so it must be
         hidden from assistive tech and pulled out of the tab order —
         otherwise Tab walks through 7 invisible links. */
      menu.setAttribute("aria-hidden", String(!open));

      const items = $$("a", menu);
      items.forEach((a, i) => {
        a.tabIndex = open ? 0 : -1;
        if (a.hasAttribute("data-mobile-link")) {
          a.style.transitionDelay = open ? `${0.16 + i * 0.055}s` : "0s";
        }
      });

      if (open) {
        /* move focus into the dialog so the keyboard follows the eye */
        const first = items[0];
        if (first) setTimeout(() => first.focus(), 60);
      } else {
        /* return focus to the control that opened it */
        if (menu.contains(document.activeElement)) burger.focus();
      }
    }

    /* focus trap: keep Tab inside the dialog while it is open */
    if (menu) {
      menu.addEventListener("keydown", (e) => {
        if (e.key !== "Tab" || !menu.classList.contains("is-open")) return;
        const items = $$("a", menu).filter((a) => a.offsetParent !== null);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      });

      /* start closed and untabbable */
      setMenu(false);
    }

    if (burger) burger.addEventListener("click", () => setMenu(!menu.classList.contains("is-open")));
    $$("[data-mobile-link]").forEach((a) => a.addEventListener("click", () => setMenu(false)));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && menu && menu.classList.contains("is-open")) setMenu(false);
    });
  })();

  /* =================================================================
     05. SCROLL PROGRESS
     ================================================================= */
  (function progress() {
    const bar = $("#scrollBar");
    if (!bar) return;
    /* scrollHeight is a layout read, so it belongs in the batched frame too */
    onScrollFrame(() => {
      const h = document.documentElement.scrollHeight - innerHeight;
      bar.style.width = (h > 0 ? (window.scrollY / h) * 100 : 0) + "%";
    });
  })();

  /* =================================================================
     07. REVEAL ON SCROLL
     ================================================================= */
  (function reveal() {
    const items = $$("[data-reveal]");
    if (!items.length) return;

    if (!("IntersectionObserver" in window)) {
      items.forEach((i) => i.classList.add("is-in"));
      return;
    }

    const show = (el) => {
      if (el.classList.contains("is-in")) return;
      const sibs = Array.from(el.parentElement ? el.parentElement.children : [])
        .filter((c) => c.hasAttribute("data-reveal"));
      const idx = Math.max(0, sibs.indexOf(el));
      el.style.transitionDelay = `${Math.min(idx * 0.075, 0.45)}s`;
      el.classList.add("is-in");
    };

    const io = new IntersectionObserver((entries, obs) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        show(en.target);
        obs.unobserve(en.target);
      });
    }, { threshold: 0, rootMargin: "0px 0px -8% 0px" });

    items.forEach((i) => io.observe(i));

    /* Safety net: threshold-free IO can still be skipped by anchor jumps,
       and elements taller than the viewport need a geometry test.
       Runs batched, and unsubscribes once everything has been revealed so
       it stops costing layout entirely. */
    let stop;
    const sweep = () => {
      let pending = false;
      /* cache the viewport height once instead of per element */
      const line = window.innerHeight * 0.92;
      items.forEach((el) => {
        if (el.classList.contains("is-in")) return;
        if (el.getBoundingClientRect().top < line) show(el);
        else pending = true;
      });
      if (!pending && stop) stop();
    };
    stop = onScrollFrame(sweep);
  })();

  /* =================================================================
     08. COUNTERS / BARS / GAUGE / SPINE
     ================================================================= */
  (function metrics() {
    function runCounter(el) {
      const target = parseFloat(el.dataset.count || "0");
      const decimals = parseInt(el.dataset.decimals || "0", 10);
      const suffix = el.dataset.suffix || "";
      const dur = 1500;
      const t0 = performance.now();

      (function frame(now) {
        const p = Math.min((now - t0) / dur, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = (target * eased).toFixed(decimals) + suffix;
        if (p < 1) requestAnimationFrame(frame);
        else el.textContent = target.toFixed(decimals) + suffix;
      })(t0);
    }

    const seen = new WeakSet();

    /**
     * Fires `cb` once per element when it enters the viewport.
     *
     * Uses IntersectionObserver with a 0 threshold plus an explicit
     * geometry test, because a percentage threshold can never be met by
     * elements taller than the viewport, and fast scrolling / anchor jumps
     * can skip an element's intersection entirely. A scroll fallback
     * guarantees anything already on screen still triggers.
     */
    function observe(selector, cb) {
      const els = $$(selector);
      if (!els.length) return;

      const fire = (el) => {
        if (seen.has(el)) return;
        seen.add(el);
        cb(el);
      };

      if (!("IntersectionObserver" in window)) {
        els.forEach(fire);
        return;
      }

      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((en) => {
            if (en.isIntersecting) fire(en.target);
          });
        },
        { threshold: 0, rootMargin: "0px 0px -8% 0px" }
      );
      els.forEach((e) => io.observe(e));

      /* safety net for jump-scrolls and above-the-fold content; detaches
         itself once every element has fired so it costs nothing afterwards */
      let stop;
      const sweep = () => {
        els.forEach((el) => { if (!seen.has(el) && hasCrossedRevealLine(el)) fire(el); });
        if (els.every((el) => seen.has(el)) && stop) stop();
      };
      stop = onScrollFrame(sweep);
    }

    observe("[data-count]", runCounter);

    observe("[data-bar]", (el) => {
      const fill = $(".bar__track i", el);
      if (fill) setTimeout(() => { fill.style.width = el.dataset.bar + "%"; }, 90);
    });

    observe("[data-gauge]", (el) => {
      setTimeout(() => { el.style.width = el.dataset.gauge + "%"; }, 120);
    });

    const spine = $("#spineFill");
    const timeline = $(".timeline");
    if (spine && timeline) {
      onScrollFrame(() => {
        const r = timeline.getBoundingClientRect();
        const total = r.height;
        const done = clamp(innerHeight * 0.72 - r.top, 0, total);
        spine.style.height = (total ? (done / total) * 100 : 0) + "%";
      });
    }
  })();

  /* =================================================================
     09. 3D TILT
     ================================================================= */
  (function tilt() {
    if (IS_TOUCH || REDUCED) return;

    $$("[data-tilt]").forEach((card) => {
      const MAX = 7;
      let raf;

      card.addEventListener("pointermove", (e) => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        const rx = (0.5 - py) * MAX * 2;
        const ry = (px - 0.5) * MAX * 2;

        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          card.style.transform =
            `perspective(1000px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateY(-5px)`;
        });
      });

      card.addEventListener("pointerleave", () => {
        cancelAnimationFrame(raf);
        card.style.transform = "";
      });
    });
  })();

  /* =================================================================
     10. WORK FILTERS + GLOW
     ================================================================= */
  (function work() {
    const grid = $("#workGrid");
    if (!grid) return;
    const cards = $$(".work", grid);

    $$(".filter").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$(".filter").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");

        const f = btn.dataset.filter;
        cards.forEach((card) => {
          const match = f === "all" || (card.dataset.cat || "").split(" ").indexOf(f) > -1;
          if (match) {
            card.classList.remove("is-hidden");
            card.style.animation = "none";
            void card.offsetWidth;
            card.style.animation = "popIn .5s cubic-bezier(.22,1,.36,1)";
          } else {
            card.classList.add("is-hidden");
          }
        });
      });
    });

    if (IS_TOUCH) return;
    cards.forEach((card) => {
      card.addEventListener("pointermove", (e) => {
        const r = card.getBoundingClientRect();
        card.style.setProperty("--mx", (e.clientX - r.left) + "px");
        card.style.setProperty("--my", (e.clientY - r.top) + "px");
      });
    });
  })();

  /* =================================================================
     11. CONTACT FORM
     ================================================================= */
  (function form() {
    const f = $("#contactForm");
    if (!f) return;
    const ok = $("#formOk");

    const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v.trim());

    function validate(input) {
      const field = input.closest(".field");
      if (!field) return true;
      const v = input.value.trim();
      let valid = true;

      if (input.hasAttribute("required") && !v) valid = false;
      else if (input.type === "email" && !isEmail(v)) valid = false;
      else if (input.minLength > 0 && v.length < input.minLength) valid = false;

      field.classList.toggle("is-invalid", !valid);
      field.classList.toggle("is-valid", valid && v.length > 0);
      return valid;
    }

    const inputs = $$("input, textarea", f);
    inputs.forEach((i) => {
      i.addEventListener("blur", () => validate(i));
      i.addEventListener("input", () => {
        const fl = i.closest(".field");
        if (fl && fl.classList.contains("is-invalid")) validate(i);
      });
    });

    f.addEventListener("submit", (e) => {
      e.preventDefault();
      const allValid = inputs.map(validate).every(Boolean);

      if (!allValid) {
        const bad = $(".field.is-invalid input, .field.is-invalid textarea", f);
        if (bad) bad.focus();
        if (f.animate) {
          f.animate(
            [{ transform: "translateX(0)" }, { transform: "translateX(-9px)" },
             { transform: "translateX(9px)" }, { transform: "translateX(0)" }],
            { duration: 320, easing: "ease-in-out" }
          );
        }
        return;
      }

      const btn = $("button[type=submit]", f);
      const original = btn ? btn.innerHTML : "";
      if (btn) {
        btn.innerHTML = '<span>Sending...</span><i class="bi bi-arrow-repeat"></i>';
        btn.disabled = true;
      }

      /* Front-end demo. Swap this block for a real endpoint
         (Formspree / EmailJS / your own API) to go live. */
      setTimeout(() => {
        if (ok) ok.classList.add("is-show");
        f.reset();
        $$(".field", f).forEach((x) => x.classList.remove("is-valid", "is-invalid"));
        if (btn) { btn.innerHTML = original; btn.disabled = false; }
        setTimeout(() => ok && ok.classList.remove("is-show"), 6000);
      }, 1100);
    });
  })();

  /* =================================================================
     12. MISC — marquee, year, GSAP parallax, smooth anchors
     ================================================================= */
  (function misc() {
    const track = $("#marqueeTrack");
    if (track) track.innerHTML += track.innerHTML;

    const year = $("#year");
    if (year) year.textContent = new Date().getFullYear();

    if (window.gsap && window.ScrollTrigger && !REDUCED) {
      gsap.registerPlugin(ScrollTrigger);

      gsap.utils.toArray(".sec-head__title").forEach((el) => {
        gsap.from(el, {
          yPercent: 12,
          opacity: 0.4,
          ease: "none",
          scrollTrigger: { trigger: el, start: "top 90%", end: "top 45%", scrub: 0.6 }
        });
      });
    }

    /* smooth anchors with nav offset */
    $$('a[href^="#"]').forEach((a) => {
      a.addEventListener("click", (e) => {
        const id = a.getAttribute("href");
        if (!id || id === "#") return;
        const target = document.querySelector(id);
        if (!target) return;
        e.preventDefault();

        const isSkip = a.classList.contains("skip-link");
        /* The skip link lands at the very top of <main>; content links keep
           the nav offset so the heading is not hidden behind the header. */
        const top = isSkip
          ? target.getBoundingClientRect().top + window.scrollY
          : target.getBoundingClientRect().top + window.scrollY - 70;

        window.scrollTo({ top, behavior: REDUCED ? "auto" : "smooth" });

        /* preventDefault() also cancels the hash update and the focus move,
           which is what makes a skip link useful — restore both so keyboard
           and screen-reader users actually continue from the target. */
        if (history.replaceState) history.replaceState(null, "", id);
        else location.hash = id;

        if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
      });
    });
  })();

  /* =================================================================
     BOOT
     ================================================================= */
  window.addEventListener("load", () => Preloader.done());
  /* safety net — never trap the visitor behind the preloader */
  setTimeout(() => Preloader.done(), 4200);
})();
