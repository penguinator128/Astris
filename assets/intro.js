/* ASTRIS opening: the bar drops down the A, the film strip rips past, and the camera goes straight in.
   About one second in all. No flash, no burst. Shared by the website and the Studio's preview.

     AstrisIntro.play({ host, frames, speed, wait, onArrive, onDone })  ->  { skip(), finished }

   host      the element to play inside (default: the whole page). A fixed full-screen layer is used for <body>.
   frames    picture URLs for the strip (the first one is the frame the camera zooms into)
   speed     "fast" | "normal" | "relaxed" (or a number: 1 = normal, smaller is quicker)
   wait      optional Promise: the A waits quietly on screen until it resolves (e.g. while pictures load)
   onArrive  called when the website should start appearing underneath
   onDone    called when the opening has finished or been skipped */
(function (root) {
  "use strict";

  var SPEEDS = { fast: 0.78, normal: 1, relaxed: 1.6 };
  var uid = 0, cssDone = false;

  /* timeline, in milliseconds at normal speed */
  var T = { strip: 420, slam: 280, pulse: 110, zoom0: 420, zoom1: 860, arrive: 600, fade0: 700, end: 920 };
  var FW = 440, FH = 300, STEP = 340, L = 12;       /* frame size, spacing, number of frames before the last one */
  var Y0 = 520, Y1 = -170 - L * STEP;               /* where the strip starts and finishes (along the slant) */
  var SLANT = 26.565;

  function factor(s) { return typeof s === "number" ? s : (SPEEDS[s] || 1); }
  function clamp(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function injectCss() {
    if (cssDone) return; cssDone = true;
    var st = document.createElement("style");
    st.textContent =
      ".ax-intro{background:#0b0a09;display:grid;place-items:center;overflow:hidden;user-select:none;-webkit-user-select:none;cursor:pointer}" +
      ".ax-intro svg{display:block;overflow:visible}" +
      ".ax-wait .ax-hint{animation:ax-breathe 1.1s ease-in-out infinite}" +
      "@keyframes ax-breathe{50%{opacity:.25}}" +
      ".ax-skip{position:absolute;right:max(20px,env(safe-area-inset-right,0px));bottom:max(18px,env(safe-area-inset-bottom,0px));font:500 11px/1 Inter,system-ui,sans-serif;letter-spacing:.22em;text-transform:uppercase;color:rgba(242,235,221,.45);background:none;border:0;padding:8px;cursor:pointer}" +
      ".ax-skip:hover{color:#f2b705}";
    document.head.appendChild(st);
  }

  /* load pictures first (but never wait long) so the strip does not pop in */
  function preload(urls, ms) {
    var jobs = (urls || []).map(function (u) {
      return new Promise(function (res) { var i = new Image(); i.onload = i.onerror = function () { res(); }; i.src = u; });
    });
    return Promise.race([Promise.all(jobs), new Promise(function (res) { setTimeout(res, ms || 900); })]);
  }

  function play(opts) {
    opts = opts || {};
    injectCss();
    var B = root.ASTRIS_BRAND;
    var k = factor(opts.speed);
    var host = opts.host || document.body;
    var page = host === document.body;
    var id = "ax" + (++uid);
    var frames = (opts.frames || []).filter(Boolean);

    var ov = document.createElement("div");
    ov.className = "ax-intro ax-wait";
    ov.setAttribute("role", "img");
    ov.setAttribute("aria-label", "Astris");
    ov.style.cssText = "position:" + (page ? "fixed" : "absolute") + ";inset:0;z-index:" + (opts.z || 120);

    var urls = [];
    for (var i = 0; i < L; i++) urls.push(frames.length ? frames[(i + 1) % frames.length] : null);
    urls.push(frames.length ? frames[0] : null);                          /* the frame the camera dives into */
    var colLen = L * STEP + 3200;
    var tones = ["#1d1914", "#241d12", "#171410", "#2a2113"];

    var imgs = urls.map(function (u, n) {
      var x = -FW / 2, y = n * STEP - FH / 2;
      return u
        ? '<image href="' + u.replace(/"/g, "%22") + '" x="' + x + '" y="' + y + '" width="' + FW + '" height="' + FH + '" preserveAspectRatio="xMidYMid slice"/>'
        : '<rect x="' + x + '" y="' + y + '" width="' + FW + '" height="' + FH + '" fill="' + tones[n % tones.length] + '"/>';
    }).join("");

    ov.innerHTML =
      '<svg viewBox="0 0 1900 1600" aria-hidden="true">' +
      '<defs><clipPath id="' + id + 'c"><path d="' + B.stripOuter + '"/></clipPath>' +
      '<pattern id="' + id + 'p" patternUnits="userSpaceOnUse" width="28" height="85"><rect x="0" y="14" width="28" height="56" rx="7" fill="#0b0a09"/></pattern></defs>' +
      '<path class="ax-hint" d="' + B.stripOuter + '" fill="none" stroke="#f2b705" stroke-opacity=".55" stroke-width="10"/>' +
      '<g class="ax-strip" opacity="0"><g clip-path="url(#' + id + 'c)"><rect x="-400" y="-400" width="2600" height="2400" fill="#16130f"/>' +
      '<g class="ax-col">' +
      '<rect x="-262" y="-1200" width="28" height="' + colLen + '" fill="url(#' + id + 'p)"/><rect x="234" y="-1200" width="28" height="' + colLen + '" fill="url(#' + id + 'p)"/>' + imgs +
      '</g></g><path d="' + B.stripOuter + '" fill="none" stroke="#f2b705" stroke-width="14"/></g>' +
      '<path class="ax-bar" fill="#f2b705" d="' + B.bar + '" opacity="0" transform="translate(-520 -1040)"/>' +
      '</svg><button class="ax-skip" type="button">Skip</button>';
    host.appendChild(ov);

    var svg = ov.querySelector("svg"), strip = ov.querySelector(".ax-strip"), col = ov.querySelector(".ax-col"),
        bar = ov.querySelector(".ax-bar");
    var frameEls = ov.querySelectorAll(".ax-col > image, .ax-col > rect:not([fill^='url'])");
    var last = frameEls[frameEls.length - 1];

    function box() {
      if (page) return { left: 0, top: 0, width: root.innerWidth, height: root.innerHeight };
      var r = host.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    }
    function size() {
      var r = box();
      var h = Math.min(r.height * 0.46, 420);
      svg.style.height = Math.max(120, h) + "px"; svg.style.width = "auto";
    }
    size();
    col.setAttribute("transform", "translate(500 1200) rotate(" + SLANT + ") translate(0 " + Y0 + ")");

    var ctl = { skip: skip, finished: null }, resolveDone, started = false, finished = false, arrived = false;
    ctl.finished = new Promise(function (r) { resolveDone = r; });
    var t0 = 0, zoom = null, raf = 0;

    function arrive() { if (arrived) return; arrived = true; if (opts.onArrive) opts.onArrive(); }
    function finish() {
      if (finished) return; finished = true; cancelAnimationFrame(raf);
      arrive();
      if (ov.parentNode) ov.parentNode.removeChild(ov);
      document.removeEventListener("keydown", onKey);
      if (opts.onDone) opts.onDone();
      resolveDone();
    }
    var skipping = false;
    function skip() {
      if (finished || skipping) return;
      skipping = true; cancelAnimationFrame(raf);
      arrive();
      ov.style.transition = "opacity .2s ease"; ov.style.opacity = "0";
      setTimeout(finish, 230);
    }
    function onKey(e) { if (e.key === "Escape") skip(); }
    ov.addEventListener("click", skip);
    document.addEventListener("keydown", onKey);

    function begin() {
      if (finished || skipping) return;
      started = true; ov.classList.remove("ax-wait"); size();
      strip.setAttribute("opacity", "1");
      t0 = performance.now();
      raf = requestAnimationFrame(tick);
    }

    function tick() {
      if (finished || skipping) return;
      var u = (performance.now() - t0) / k;

      /* the strip rips past, fast to slow */
      var p = clamp(u / T.strip), s = 1 - Math.pow(1 - p, 4);
      col.setAttribute("transform", "translate(500 1200) rotate(" + SLANT + ") translate(0 " + (Y0 + (Y1 - Y0) * s).toFixed(1) + ")");
      col.style.filter = p < 1 ? "blur(" + (6 * Math.pow(1 - p, 3)).toFixed(2) + "px)" : "none";
      strip.setAttribute("opacity", String(clamp(u / 50)));

      /* the bar slams down along the slant */
      var bp = clamp(u / T.slam), bt = Math.pow(bp, 2.3);
      bar.setAttribute("transform", "translate(" + (-520 * (1 - bt)).toFixed(1) + " " + (-1040 * (1 - bt)).toFixed(1) + ")");
      bar.setAttribute("opacity", u > 12 ? "1" : "0");

      /* a small thud when it lands */
      var pu = clamp((u - T.slam) / T.pulse);
      var thud = u >= T.slam && pu < 1 ? 1 + 0.04 * Math.sin(Math.PI * pu) : 1;
      var tf = "scale(" + thud.toFixed(4) + ")";

      /* then straight in: zoom into the last frame, levelling the slant */
      if (u >= T.zoom0) {
        if (!zoom) {
          var hr = box(), sr = svg.getBoundingClientRect(), fr = last.getBoundingClientRect();
          var fx = fr.left + fr.width / 2, fy = fr.top + fr.height / 2, kk = sr.width / 1900;
          zoom = {
            dx: hr.left + hr.width / 2 - fx, dy: hr.top + hr.height / 2 - fy,
            K: Math.max(hr.width / (FW * kk), hr.height / (FH * kk)) * 1.12
          };
          svg.style.transformOrigin = (fx - sr.left) + "px " + (fy - sr.top) + "px";
        }
        var z = clamp((u - T.zoom0) / (T.zoom1 - T.zoom0)), q = z * z * (3 - 2 * z);
        tf = "translate(" + (zoom.dx * q).toFixed(1) + "px," + (zoom.dy * q).toFixed(1) + "px) rotate(" + (-SLANT * q).toFixed(2) + "deg) scale(" + (1 + (zoom.K - 1) * q * q).toFixed(3) + ")";
      }
      svg.style.transform = tf;

      if (u >= T.arrive) arrive();
      if (u >= T.fade0) ov.style.opacity = String(1 - clamp((u - T.fade0) / (T.end - T.fade0)));
      if (u >= T.end) { finish(); return; }
      raf = requestAnimationFrame(tick);
    }

    if (opts.wait && typeof opts.wait.then === "function") opts.wait.then(begin, begin); else begin();
    return ctl;
  }

  root.AstrisIntro = { play: play, preload: preload, speeds: SPEEDS, total: T.end };
})(window);
