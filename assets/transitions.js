/* ASTRIS page transitions, all borrowed from film-making.
   Shared by the website and the Studio's preview, so what you preview is exactly what visitors see.

   A transition moves between two full-size layers that sit inside one stage:
     from = the page you are leaving (a still copy of it)
     to   = the page you are arriving on (already drawn, underneath)
   The page swap has already happened by the time play() runs, so there is never a flat colour covering the
   screen while content loads: every move is a continuous camera or film motion. */
(function (root) {
  "use strict";

  var LIST = [
    { id: "dissolve", name: "Dissolve",     note: "The classic film cross-dissolve with a gentle push-in. Calm and safe." },
    { id: "iris",     name: "Iris",         note: "A silent-film iris closes down on the spot you clicked and opens onto the next page." },
    { id: "advance",  name: "Film advance", note: "The page advances like a frame through the projector gate, with the sprockets rolling past." },
    { id: "whip",     name: "Whip pan",     note: "A quick sideways camera whip with motion blur." },
    { id: "zoom",     name: "Push in",      note: "The camera pushes into the page and settles on the next one." },
    { id: "dive",     name: "Dive in",      note: "Click a card and its picture grows to fill the screen, so you go right into it." },
    { id: "rack",     name: "Rack focus",   note: "Focus pulls from one page to the next, the way a cinematographer shifts a shot." },
    { id: "burn",     name: "Film burn",    note: "A warm light leak washes over the cut, like a roll of film catching the light." },
    { id: "gate",     name: "Gate",         note: "The page parts down the middle like the gate of a projector and opens onto the next." },
    { id: "shutter",  name: "Shutter",      note: "Camera-shutter slats flip open one after another." },
    { id: "slate",    name: "Clapperboard", note: "A slate claps shut and lifts away. Fun, a little louder than the rest." },
    { id: "cut",      name: "Quick cut",    note: "Almost instant, with a tiny projector flicker. The fastest option." }
  ];
  var DEFAULT_ENABLED = ["dissolve", "iris", "advance", "whip", "zoom", "dive", "rack", "burn", "gate"];
  var SPEEDS = { fast: 0.72, normal: 1, relaxed: 1.45 };

  var YELLOW = "#f2b705", INK = "#f2ebdd", NIGHT = "#0b0a09";
  var EASE_IO = "cubic-bezier(.7,0,.25,1)";
  var EASE_OUT = "cubic-bezier(.16,.84,.3,1)";
  var EASE_IN = "cubic-bezier(.55,0,.9,.5)";

  function has(id) { return LIST.some(function (t) { return t.id === id; }); }
  function speedFactor(name) { return typeof name === "number" ? name : (SPEEDS[name] || 1); }
  function canAnimate() { return typeof Element !== "undefined" && typeof Element.prototype.animate === "function"; }
  function reduced() { return !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches); }

  /* choose which transition to use for this click */
  function pick(cfg, st, hasOrigin) {
    cfg = cfg || {}; st = st || {};
    var mode = cfg.mode || "random";
    if (mode === "off") return null;
    var enabled = (cfg.enabled && cfg.enabled.length ? cfg.enabled : DEFAULT_ENABLED).filter(has);
    if (!enabled.length) enabled = ["dissolve"];
    if (mode === "single") return has(cfg.single) ? cfg.single : enabled[0];
    if (hasOrigin && enabled.indexOf("dive") > -1) return "dive";
    var pool = enabled.filter(function (id) { return id !== "dive"; });
    if (!pool.length) pool = ["dissolve"];
    if (mode === "cycle") { st.i = ((st.i == null ? -1 : st.i) + 1) % pool.length; return pool[st.i]; }
    var id, guard = 0;
    do { id = pool[Math.floor(Math.random() * pool.length)]; } while (pool.length > 1 && id === st.last && ++guard < 12);
    st.last = id;
    return id;
  }

  /* ---------- the engine ---------- */
  function play(id, opts) {
    opts = opts || {};
    var stage = opts.stage, from = opts.from, to = opts.to;
    if (!stage || !from || !to || !canAnimate() || (reduced() && !opts.force)) return done();
    if (!has(id)) id = "dissolve";

    var sr = stage.getBoundingClientRect();
    var c = {
      stage: stage, from: from, to: to,
      host: opts.host || stage,
      pos: opts.pos || "absolute",
      base: opts.base || 0,
      speed: speedFactor(opts.speed),
      dir: opts.dir < 0 ? -1 : 1,
      W: Math.max(1, sr.width), H: Math.max(1, sr.height),
      anims: [], nodes: [], saved: []
    };
    c.D = function (ms) { return Math.max(1, Math.round(ms * c.speed)); };
    c.Z = function (n) { return String(c.base + n); };
    [from, to].forEach(function (el) { c.saved.push([el, el.getAttribute("style")]); });

    /* where the click happened (for iris / push in / dive) */
    var o = opts.origin || null;
    c.ox = o && o.x != null ? o.x - sr.left : c.W / 2;
    c.oy = o && o.y != null ? o.y - sr.top : c.H / 2;
    c.ox = Math.min(c.W, Math.max(0, c.ox)); c.oy = Math.min(c.H, Math.max(0, c.oy));
    c.rect = o && o.rect ? { left: o.rect.left - sr.left, top: o.rect.top - sr.top, width: o.rect.width, height: o.rect.height } : null;
    c.src = o && o.src ? o.src : "";

    /* helpers bound to this run */
    c.mk = function (css, html) {
      var n = document.createElement("div");
      n.setAttribute("aria-hidden", "true");
      n.style.cssText = "position:" + c.pos + ";pointer-events:none;" + css;
      if (html) n.innerHTML = html;
      c.host.appendChild(n); c.nodes.push(n);
      return n;
    };
    c.A = function (el, frames, o2) {
      var a = el.animate(frames, Object.assign({ fill: "both", easing: EASE_IO }, o2));
      c.anims.push(a);
      return a.finished.catch(function () {});
    };

    from.style.zIndex = c.Z(2); to.style.zIndex = c.Z(1);
    from.style.pointerEvents = "none"; to.style.pointerEvents = "none";
    from.style.willChange = "transform, opacity, filter"; to.style.willChange = "transform, opacity, filter";

    var run = MOVES[id] || MOVES.dissolve;
    var finished = false, timer;
    function cleanup() {
      if (finished) return; finished = true; clearTimeout(timer);
      c.anims.forEach(function (a) { try { a.cancel(); } catch (e) {} });
      c.nodes.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
      c.saved.forEach(function (s) { if (s[1] == null) s[0].removeAttribute("style"); else s[0].setAttribute("style", s[1]); });
    }
    var p = new Promise(function (resolve) {
      var ps;
      try { ps = run(c); } catch (e) { ps = Promise.resolve(); }
      timer = setTimeout(function () { cleanup(); resolve(); }, 2600 * c.speed + 400);
      Promise.resolve(ps).then(function () { cleanup(); resolve(); }, function () { cleanup(); resolve(); });
    });
    p.cancel = cleanup;
    return p;
  }
  function done() { var p = Promise.resolve(); p.cancel = function () {}; return p; }
  function all(list) { return Promise.all(list); }

  /* ---------- the moves ---------- */
  var MOVES = {};

  /* 1. Dissolve: the old page holds, then melts into the new one while the camera drifts in. */
  MOVES.dissolve = function (c) {
    var d = c.D(600);
    return all([
      c.A(c.from, [{ opacity: 1, transform: "scale(1)" }, { opacity: 1, offset: .3 }, { opacity: 0, transform: "scale(1.04)" }], { duration: d, easing: "cubic-bezier(.4,0,.2,1)" }),
      c.A(c.to, [{ opacity: 0, transform: "scale(.975)" }, { opacity: 1, transform: "scale(1)" }], { duration: d, easing: "cubic-bezier(.3,0,.2,1)" })
    ]);
  };

  /* 2. Cut: nearly instant, with a flicker like a projector frame change. */
  MOVES.cut = function (c) {
    var d = c.D(210);
    return all([
      c.A(c.from, [{ opacity: 1, filter: "brightness(1)" }, { opacity: 1, filter: "brightness(1.9)", offset: .35 }, { opacity: 0, filter: "brightness(1.9)" }], { duration: d, easing: "linear" }),
      c.A(c.to, [{ opacity: 0, filter: "brightness(1.7)" }, { opacity: 0, offset: .35 }, { opacity: 1, filter: "brightness(1)" }], { duration: d, easing: "linear" })
    ]);
  };

  /* 3. Iris: the old page shrinks into a circle around your click; a thin gold rim follows the edge. */
  MOVES.iris = function (c) {
    var d = c.D(680), x = c.ox, y = c.oy;
    var R = Math.ceil(Math.hypot(Math.max(x, c.W - x), Math.max(y, c.H - y))) + 6;
    var ring = c.mk("left:" + x + "px;top:" + y + "px;width:" + 2 * R + "px;height:" + 2 * R + "px;margin:" + (-R) + "px 0 0 " + (-R) + "px;border-radius:50%;" +
      "border:2px solid rgba(242,183,5,.8);box-shadow:inset 0 0 70px rgba(0,0,0,.55);z-index:" + c.Z(5));
    return all([
      c.A(c.from, [{ clipPath: "circle(" + R + "px at " + x + "px " + y + "px)" }, { clipPath: "circle(0px at " + x + "px " + y + "px)" }], { duration: d }),
      c.A(ring, [{ transform: "scale(1)", opacity: 1 }, { transform: "scale(.002)", opacity: .9 }], { duration: d }),
      c.A(c.to, [{ transform: "scale(1.05)" }, { transform: "scale(1)" }], { duration: d })
    ]);
  };

  /* 4. Film advance: the next frame slides into the gate, sprocket holes rolling past on both edges. */
  MOVES.advance = function (c) {
    var d = c.D(680), s = c.dir, H = c.H, e = "cubic-bezier(.75,0,.2,1)";
    var tile = "data:image/svg+xml;utf8," + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='30' height='56'><rect x='8' y='17' width='14' height='22' rx='4' fill='#d9d2c3'/></svg>");
    function rail(side) {
      return c.mk(side + ":0;top:0;bottom:0;width:30px;z-index:" + c.Z(6) + ";background:#0a0908 url(\"" + tile + "\") 0 0 repeat-y;border-" + (side === "left" ? "right" : "left") + ":1px solid rgba(242,235,221,.14)");
    }
    var rails = [rail("left"), rail("right")];
    var seam = c.mk("left:0;right:0;top:0;height:16px;z-index:" + c.Z(5) + ";background:#070605;border-block:1px solid rgba(242,183,5,.55)");
    var shift = Math.round(H / 56) * 56;
    var seamFrom = s > 0 ? H - 8 : -8, seamTo = s > 0 ? -8 : H - 8;
    var jobs = [
      c.A(c.from, [{ transform: "translateY(0)" }, { transform: "translateY(" + (-s * H) + "px)" }], { duration: d, easing: e }),
      c.A(c.to, [{ transform: "translateY(" + (s * H) + "px)" }, { transform: "translateY(" + (-s * H * .012) + "px)", offset: .84 }, { transform: "translateY(0)" }], { duration: d, easing: e }),
      c.A(seam, [{ transform: "translateY(" + seamFrom + "px)" }, { transform: "translateY(" + (seamTo + (-s * H * .012)) + "px)", offset: .84 }, { transform: "translateY(" + seamTo + "px)" }], { duration: d, easing: e })
    ];
    rails.forEach(function (r) {
      jobs.push(c.A(r, [{ backgroundPosition: "0 0", opacity: 0 }, { opacity: 1, offset: .14 }, { opacity: 1, offset: .82 }, { backgroundPosition: "0 " + (-s * shift) + "px", opacity: 0 }], { duration: d, easing: e }));
    });
    return all(jobs);
  };

  /* 5. Whip pan: a fast sideways camera whip. */
  MOVES.whip = function (c) {
    var d = c.D(560), s = c.dir, e = "cubic-bezier(.72,0,.22,1)";
    return all([
      c.A(c.from, [{ transform: "translateX(0) skewX(0)", filter: "blur(0px)", opacity: 1 },
        { opacity: 1, offset: .55 },
        { transform: "translateX(" + (-s * 26) + "%) skewX(" + (s * 9) + "deg)", filter: "blur(14px)", opacity: 0 }], { duration: d, easing: e }),
      c.A(c.to, [{ transform: "translateX(" + (s * 26) + "%) skewX(" + (-s * 9) + "deg)", filter: "blur(14px)", opacity: 0 },
        { opacity: 1, offset: .45 },
        { transform: "translateX(0) skewX(0)", filter: "blur(0px)", opacity: 1 }], { duration: d, easing: e })
    ]);
  };

  /* 6. Push in: the camera dollies into the old page, then settles onto the new one. */
  MOVES.zoom = function (c) {
    var org = c.ox + "px " + c.oy + "px";
    c.from.style.transformOrigin = org; c.to.style.transformOrigin = org;
    return all([
      c.A(c.from, [{ transform: "scale(1)", opacity: 1, filter: "blur(0px)" }, { transform: "scale(1.55)", opacity: 0, filter: "blur(7px)" }], { duration: c.D(400), easing: EASE_IN }),
      c.A(c.to, [{ transform: "scale(.86)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: c.D(480), delay: c.D(170), easing: EASE_OUT })
    ]);
  };

  /* 7. Dive in: the picture you clicked grows to fill the screen and becomes the next page. */
  MOVES.dive = function (c) {
    if (!c.rect || !c.src) return MOVES.zoom(c);
    var r = c.rect, W = c.W, H = c.H, d = c.D(520);
    var chip = c.mk("left:" + r.left + "px;top:" + r.top + "px;width:" + r.width + "px;height:" + r.height + "px;z-index:" + c.Z(7) +
      ";background:#000 center/cover no-repeat;border-radius:3px;box-shadow:0 24px 70px rgba(0,0,0,.55)");
    chip.style.backgroundImage = 'url("' + String(c.src).replace(/"/g, "%22") + '")';
    return all([
      c.A(chip, [
        { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px", borderRadius: "3px", opacity: 1 },
        { left: "0px", top: "0px", width: W + "px", height: H + "px", borderRadius: "0px", opacity: 1, offset: .78 },
        { left: "0px", top: "0px", width: W + "px", height: H + "px", borderRadius: "0px", opacity: 0 }
      ], { duration: c.D(640), easing: "cubic-bezier(.66,0,.2,1)" }),
      c.A(c.from, [{ opacity: 1, transform: "scale(1)", filter: "brightness(1)" }, { opacity: 0, transform: "scale(1.05)", filter: "brightness(.55)" }], { duration: c.D(420), easing: "cubic-bezier(.4,0,.6,1)" }),
      c.A(c.to, [{ opacity: 0 }, { opacity: 1 }], { duration: c.D(300), delay: c.D(330), easing: "ease-out" })
    ]);
  };

  /* 8. Rack focus: the page defocuses into a blur and the next one pulls sharp. */
  MOVES.rack = function (c) {
    return all([
      c.A(c.from, [{ filter: "blur(0px) brightness(1)", opacity: 1 }, { filter: "blur(22px) brightness(.6)", opacity: 1, offset: .75 }, { filter: "blur(26px) brightness(.5)", opacity: 0 }], { duration: c.D(400), easing: EASE_IN }),
      c.A(c.to, [{ filter: "blur(26px) brightness(.5)", opacity: 0, transform: "scale(1.03)" }, { opacity: 1, offset: .25 }, { filter: "blur(0px) brightness(1)", opacity: 1, transform: "scale(1)" }], { duration: c.D(480), delay: c.D(190), easing: EASE_OUT })
    ]);
  };

  /* 9. Film burn: warm light floods the frame and the cut happens inside the glow. */
  MOVES.burn = function (c) {
    var d = c.D(780), s = c.dir;
    var leak = c.mk("left:-25%;right:-25%;top:-25%;bottom:-25%;z-index:" + c.Z(6) + ";background:" +
      "radial-gradient(55% 60% at " + (s > 0 ? "78%" : "22%") + " 30%, rgba(255,226,140,.95), rgba(255,150,40,.7) 38%, rgba(190,50,0,0) 74%)," +
      "radial-gradient(48% 55% at " + (s > 0 ? "12%" : "88%") + " 95%, rgba(255,120,30,.8), rgba(170,30,0,0) 72%)," +
      "linear-gradient(115deg, rgba(255,170,60,0), rgba(255,205,100,.28) 50%, rgba(255,120,30,0))");
    return all([
      c.A(leak, [{ opacity: 0, transform: "translate3d(" + (-s * 7) + "%,3%,0) scale(1.05)" }, { opacity: .85, offset: .42 }, { opacity: 0, transform: "translate3d(" + (s * 7) + "%,-3%,0) scale(1.3)" }], { duration: d, easing: "ease-in-out" }),
      c.A(c.from, [{ opacity: 1, filter: "brightness(1)" }, { opacity: 1, filter: "brightness(1.4)", offset: .4 }, { opacity: 0, filter: "brightness(1.7)", offset: .58 }, { opacity: 0 }], { duration: d, easing: "linear" }),
      c.A(c.to, [{ opacity: 0, filter: "brightness(1.7)" }, { opacity: 0, offset: .4 }, { opacity: 1, filter: "brightness(1.35)", offset: .62 }, { opacity: 1, filter: "brightness(1)" }], { duration: d, easing: "linear" })
    ]);
  };

  /* 10. Gate: the old page splits in two like projector gate doors and slides apart. */
  MOVES.gate = function (c) {
    var d = c.D(640), W = c.W, e = "cubic-bezier(.72,0,.2,1)";
    var left = c.from, right = c.from.cloneNode(true);
    c.from.parentNode.insertBefore(right, c.from.nextSibling); c.nodes.push(right);
    right.style.zIndex = c.Z(2);
    left.style.clipPath = "inset(0 50% 0 0)"; right.style.clipPath = "inset(0 0 0 50%)";
    var shL = c.mk("left:0;top:0;bottom:0;width:" + W * .5 + "px;z-index:" + c.Z(3) + ";background:linear-gradient(270deg,rgba(0,0,0,.55),rgba(0,0,0,0) 38%)");
    var shR = c.mk("left:" + W * .5 + "px;top:0;bottom:0;width:" + W * .5 + "px;z-index:" + c.Z(3) + ";background:linear-gradient(90deg,rgba(0,0,0,.55),rgba(0,0,0,0) 38%)");
    return all([
      c.A(left, [{ transform: "translateX(0)" }, { transform: "translateX(-52%)" }], { duration: d, easing: e }),
      c.A(right, [{ transform: "translateX(0)" }, { transform: "translateX(52%)" }], { duration: d, easing: e }),
      c.A(shL, [{ transform: "translateX(0)", opacity: 1 }, { transform: "translateX(-52%)", opacity: 1, offset: .9 }, { opacity: 0, transform: "translateX(-52%)" }], { duration: d, easing: e }),
      c.A(shR, [{ transform: "translateX(0)", opacity: 1 }, { transform: "translateX(52%)", opacity: 1, offset: .9 }, { opacity: 0, transform: "translateX(52%)" }], { duration: d, easing: e }),
      c.A(c.to, [{ transform: "scale(.93)", filter: "brightness(.55)" }, { transform: "scale(1)", filter: "brightness(1)" }], { duration: d, easing: e })
    ]);
  };

  /* 11. Shutter: horizontal slats of the old page flip open, one after another, like blinds or a camera shutter. */
  MOVES.shutter = function (c) {
    var N = 7, H = c.H, band = H / N, per = c.D(400), gap = c.D(44), jobs = [];
    c.from.style.visibility = "hidden";
    for (var i = 0; i < N; i++) {
      var s = c.from.cloneNode(true);
      s.style.visibility = "visible"; s.style.zIndex = c.Z(2);
      s.style.clipPath = "inset(" + (i * band).toFixed(1) + "px 0 " + (H - (i + 1) * band - .5).toFixed(1) + "px 0)";
      s.style.transformOrigin = "50% " + ((i + .5) * band).toFixed(1) + "px";
      s.style.backfaceVisibility = "hidden";
      c.from.parentNode.insertBefore(s, c.from.nextSibling); c.nodes.push(s);
      jobs.push(c.A(s, [
        { transform: "perspective(1700px) rotateX(0deg)", filter: "brightness(1)" },
        { transform: "perspective(1700px) rotateX(-92deg)", filter: "brightness(.45)" }
      ], { duration: per, delay: i * gap, easing: "cubic-bezier(.45,0,.7,.35)" }));
    }
    jobs.push(c.A(c.to, [{ transform: "scale(.97)", filter: "brightness(.6)" }, { transform: "scale(1)", filter: "brightness(1)" }], { duration: per + gap * (N - 1), easing: EASE_OUT }));
    return all(jobs);
  };

  /* 12. Clapperboard: a slate pops up, claps shut, and lifts away to reveal the next page. */
  MOVES.slate = function (c) {
    var W = c.W, H = c.H, bw = Math.min(W * .66, 820), bh = Math.round(bw * .62);
    var armH = Math.round(bh * .17), left = Math.round((W - bw) / 2), top = Math.round((H - bh - armH) / 2 + armH * .4);
    var stripes = "repeating-linear-gradient(-58deg," + "#141210 0 28px," + YELLOW + " 28px 56px)";
    var line = "border-top:1px solid rgba(242,235,221,.5);padding:" + Math.round(bh * .02) + "px 0 0;";
    var slate = c.mk("left:" + left + "px;top:" + top + "px;width:" + bw + "px;height:" + (bh + armH) + "px;z-index:" + c.Z(7) + ";transform-origin:50% 60%;",
      '<div class="ax-arm" style="position:absolute;left:0;top:0;width:100%;height:' + armH + 'px;background:' + stripes + ';border:3px solid #050403;transform-origin:0 100%;"></div>' +
      '<div style="position:absolute;left:0;top:' + armH + 'px;width:100%;height:' + bh + 'px;background:#0e0d0b;border:3px solid #050403;border-top:0;color:' + INK + ';font:400 ' + Math.round(bh * .1) + 'px/1.1 Anton,Impact,sans-serif;letter-spacing:.06em;padding:' + Math.round(bh * .08) + 'px ' + Math.round(bw * .05) + 'px;box-sizing:border-box;">' +
      '<div style="font-size:' + Math.round(bh * .17) + 'px;color:' + YELLOW + '">ASTRIS PRODUCTIONS</div>' +
      '<div style="display:flex;gap:' + Math.round(bw * .05) + 'px;margin-top:' + Math.round(bh * .07) + 'px;' + line + 'font-size:' + Math.round(bh * .075) + 'px;"><span>SCENE 01</span><span>TAKE 01</span><span style="margin-left:auto">ROLL A</span></div>' +
      '<div style="margin-top:' + Math.round(bh * .06) + 'px;' + line + 'font:500 ' + Math.round(bh * .05) + 'px/1.2 Inter,sans-serif;letter-spacing:.2em;color:rgba(242,235,221,.7)">PHOTOGRAPHY AND FILM</div>' +
      '</div>');
    var arm = slate.querySelector(".ax-arm");
    var flash = c.mk("inset:0;z-index:" + c.Z(8) + ";background:#fff;opacity:0");
    var d = c.D(680);
    return all([
      c.A(slate, [
        { opacity: 0, transform: "translateY(26px) scale(.9) rotate(-3deg)" },
        { opacity: 1, transform: "translateY(0) scale(1) rotate(-2deg)", offset: .22 },
        { transform: "translateY(5px) scale(1) rotate(-2deg)", offset: .35 },
        { transform: "translateY(0) scale(1) rotate(-2deg)", offset: .43 },
        { opacity: 1, transform: "translateY(0) scale(1) rotate(-2deg)", offset: .5 },
        { opacity: 0, transform: "translateY(-60px) scale(1.06) rotate(-2deg)" }
      ], { duration: d, easing: "linear" }),
      c.A(arm, [{ transform: "rotate(-30deg)", offset: 0 }, { transform: "rotate(-30deg)", offset: .18, easing: "cubic-bezier(.55,0,1,.5)" }, { transform: "rotate(0deg)", offset: .33 }, { transform: "rotate(0deg)", offset: 1 }], { duration: d, easing: "linear" }),
      c.A(flash, [{ opacity: 0 }, { opacity: 0, offset: .32 }, { opacity: .32, offset: .35 }, { opacity: 0, offset: .43 }, { opacity: 0 }], { duration: d, easing: "linear" }),
      c.A(c.from, [{ opacity: 1, filter: "brightness(1)" }, { opacity: 1, filter: "brightness(.25)", offset: .2 }, { opacity: 1, filter: "brightness(.25)", offset: .5 }, { opacity: 0, filter: "brightness(.25)", offset: .51 }, { opacity: 0 }], { duration: d, easing: "linear" }),
      c.A(c.to, [{ opacity: 0 }, { opacity: 0, offset: .46 }, { opacity: 1 }], { duration: d, easing: "linear" })
    ]);
  };

  root.AstrisTransitions = {
    list: LIST,
    defaults: DEFAULT_ENABLED.slice(),
    speeds: SPEEDS,
    has: has,
    speedFactor: speedFactor,
    pick: pick,
    play: play
  };
})(window);
