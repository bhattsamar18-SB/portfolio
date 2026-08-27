/* =====================================================================
   three-lab.js — the WebGL "Design Lab" showpiece.
   ---------------------------------------------------------------------
   WHY THIS FILE IS SHAPED LIKE THIS
   --------------------------------
   Three.js is ~655 KB raw. The previous version of this portfolio loaded it
   with a blocking <script> in the hero, which cost 10.9s to first contentful
   paint. So the library is NOT in the HTML at all any more — it is pulled in
   by a dynamic import() that only runs when:

     1. the Design Lab section is actually approaching the viewport, and
     2. the browser reports a usable WebGL context, and
     3. the visitor has not asked for reduced motion, and
     4. the device is not obviously low-powered (few cores / small screen).

   If any of those fail, the section keeps its CSS poster and no bytes are
   spent. That is the entire point: 3D is a reward for scrolling, never a tax
   on arriving.

   The render loop is also gated: an IntersectionObserver stops rAF the moment
   the canvas leaves the screen, and `visibilitychange` stops it on tab switch.
   An always-on loop is what makes WebGL pages feel hot and drain batteries.
   ===================================================================== */

(function () {
  "use strict";

  const MOUNT = document.getElementById("labCanvas");
  const SECTION = document.getElementById("lab");
  if (!MOUNT || !SECTION) return;

  const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js";
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const statusEl = SECTION.querySelector("[data-lab-status]");
  const setStatus = (text, state) => {
    if (statusEl) statusEl.textContent = text;
    if (state) SECTION.dataset.labState = state;
  };

  /* ---------------------------------------------------------------
     Capability gate — decide BEFORE downloading 655 KB
     --------------------------------------------------------------- */
  function canRunWebGL() {
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl2") || c.getContext("webgl");
      if (!gl) return false;
      /* A software rasteriser will technically succeed and then run at 5fps.
         Checking the renderer string lets us decline gracefully instead. */
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      if (dbg) {
        const r = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "");
        if (/swiftshader|software|llvmpipe/i.test(r)) return "software";
      }
      return true;
    } catch {
      return false;
    }
  }

  const isLowPower =
    (navigator.hardwareConcurrency || 4) <= 2 ||
    Math.min(window.innerWidth, window.innerHeight) < 380;

  /* ---------------------------------------------------------------
     Boot when the section approaches — not on page load
     --------------------------------------------------------------- */
  let booted = false;

  function scheduleBoot() {
    if (booted) return;
    booted = true;

    const cap = canRunWebGL();

    if (REDUCED) {
      setStatus("Motion reduced — showing a static preview", "static");
      return;
    }
    if (cap === false) {
      setStatus("WebGL unavailable — showing a static preview", "static");
      return;
    }
    if (cap === "software" || isLowPower) {
      /* Still render, but in the cheapest possible configuration. A software
         GL path can cope with a low-poly wireframe; it cannot cope with a
         thousand particles at devicePixelRatio 2. */
      setStatus("Lite mode (software renderer detected)", "lite");
      start({ lite: true });
      return;
    }
    start({ lite: false });
  }

  const bootWatcher = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          bootWatcher.disconnect();
          scheduleBoot();
        }
      }
    },
    /* 300px of runway so the import finishes before it is on screen */
    { rootMargin: "300px 0px" }
  );
  bootWatcher.observe(SECTION);

  /* ---------------------------------------------------------------
     The scene
     --------------------------------------------------------------- */
  async function start({ lite }) {
    setStatus("Loading WebGL…", "loading");

    let THREE;
    try {
      THREE = await import(/* webpackIgnore: true */ THREE_URL);
    } catch (err) {
      setStatus("Could not load the 3D library — static preview", "static");
      return;
    }

    const width = () => MOUNT.clientWidth || 1;
    const height = () => MOUNT.clientHeight || 1;

    const renderer = new THREE.WebGLRenderer({
      antialias: !lite,
      alpha: true,
      powerPreference: "high-performance"
    });
    /* Cap DPR at 1.5 (1 in lite mode). Retina phones report 3, which means
       9x the fragments for a difference nobody can see on a decorative scene. */
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lite ? 1 : 1.5));
    renderer.setSize(width(), height(), false);
    renderer.setClearColor(0x000000, 0);
    MOUNT.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-hidden", "true");

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(52, width() / height(), 0.1, 100);
    camera.position.set(0, 0, 6.2);

    /* --- the object: an icosahedron wireframe wrapped around a solid core.
       Reads as "design system geometry" and stays cheap: two draw calls. --- */
    const detail = lite ? 0 : 1;
    const geo = new THREE.IcosahedronGeometry(1.85, detail);

    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x7c5cff, transparent: true, opacity: 0.55 })
    );

    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.2, lite ? 0 : 2),
      new THREE.MeshBasicMaterial({ color: 0x22e0c8, transparent: true, opacity: 0.08 })
    );

    const group = new THREE.Group();
    group.add(wire, core);
    scene.add(group);

    /* --- orbiting points: the "tokens" floating around the system --- */
    let points = null;
    if (!lite) {
      const COUNT = 420;
      const pos = new Float32Array(COUNT * 3);
      for (let i = 0; i < COUNT; i++) {
        /* even-ish spherical distribution in a shell */
        const r = 2.6 + Math.random() * 1.5;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        pos[i * 3 + 2] = r * Math.cos(phi);
      }
      const pGeo = new THREE.BufferGeometry();
      pGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      points = new THREE.Points(
        pGeo,
        new THREE.PointsMaterial({
          color: 0xff7ac6,
          size: 0.035,
          transparent: true,
          opacity: 0.85,
          sizeAttenuation: true
        })
      );
      scene.add(points);
    }

    /* --- pointer parallax, normalised and eased --- */
    const target = { x: 0, y: 0 };
    const current = { x: 0, y: 0 };
    const onPointer = (e) => {
      const r = MOUNT.getBoundingClientRect();
      target.x = ((e.clientX - r.left) / r.width - 0.5) * 2;
      target.y = ((e.clientY - r.top) / r.height - 0.5) * 2;
    };
    /* passive: this must never delay a scroll */
    SECTION.addEventListener("pointermove", onPointer, { passive: true });
    SECTION.addEventListener("pointerleave", () => { target.x = target.y = 0; }, { passive: true });

    /* --- resize, debounced through rAF --- */
    let resizeQueued = false;
    const onResize = () => {
      if (resizeQueued) return;
      resizeQueued = true;
      requestAnimationFrame(() => {
        resizeQueued = false;
        camera.aspect = width() / height();
        camera.updateProjectionMatrix();
        renderer.setSize(width(), height(), false);
      });
    };
    window.addEventListener("resize", onResize, { passive: true });

    /* ---------------------------------------------------------------
       Visibility-gated render loop.
       The loop only runs while the canvas is on screen AND the tab is
       focused. Everything else is a battery bug.
       --------------------------------------------------------------- */
    let onScreen = false;
    let running = false;
    let raf = 0;

    /* Time must ACCUMULATE across pauses, not restart.

       THREE.Clock.start() resets elapsedTime to 0, so calling it in play()
       rewound the scene to its opening pose every time the visitor scrolled
       past the section and came back — the rotation visibly snapped. Using a
       delta-accumulated clock instead means a pause freezes the animation
       where it was and resume continues from exactly that pose, which is what
       "paused" should mean. getDelta() is also called once per frame here so
       the long gap spent off-screen never lands in a frame's delta. */
    const clock = new THREE.Clock();
    let elapsed = 0;

    const frame = () => {
      if (!running) return;
      elapsed += clock.getDelta();
      const t = elapsed;

      current.x += (target.x - current.x) * 0.05;
      current.y += (target.y - current.y) * 0.05;

      group.rotation.y = t * 0.16 + current.x * 0.5;
      group.rotation.x = Math.sin(t * 0.22) * 0.16 + current.y * 0.35;

      if (points) {
        points.rotation.y = -t * 0.05;
        points.rotation.z = t * 0.02;
      }

      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    };

    const play = () => {
      if (running || !onScreen || document.hidden) return;
      running = true;
      /* Discard the idle gap: getDelta() would otherwise return the whole
         off-screen duration and jump the scene forward on the first frame. */
      clock.getDelta();
      raf = requestAnimationFrame(frame);
    };
    const pause = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    new IntersectionObserver(
      (entries) => {
        onScreen = entries.some((e) => e.isIntersecting);
        onScreen ? play() : pause();
      },
      { threshold: 0.01 }
    ).observe(MOUNT);

    document.addEventListener("visibilitychange", () => {
      document.hidden ? pause() : play();
    });

    /* --- context loss must not leave a dead black box --- */
    renderer.domElement.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      pause();
      setStatus("3D paused (graphics context lost)", "static");
    });
    renderer.domElement.addEventListener("webglcontextrestored", () => {
      setStatus("Interactive · drag your cursor", "live");
      play();
    });

    setStatus(lite ? "Lite mode · move your cursor" : "Interactive · move your cursor", "live");

    /* expose a tiny handle so the test suite can assert the loop really pauses */
    window.__lab = {
      get running() { return running; },
      get onScreen() { return onScreen; },
      /* elapsed is exposed so a test can prove time survives a pause */
      get elapsed() { return elapsed; },
      lite,
      dispose() {
        pause();
        window.removeEventListener("resize", onResize);
        geo.dispose();
        wire.geometry.dispose();
        wire.material.dispose();
        core.geometry.dispose();
        core.material.dispose();
        if (points) { points.geometry.dispose(); points.material.dispose(); }
        renderer.dispose();
      }
    };
  }
})();
