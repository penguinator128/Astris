/* ============================================================
   ASTRIS: the website.
   Pages, routing, the opening, and the film-themed page changes.
   Content comes from the GitHub repo (saved by Astris Studio) through assets/data.js.
   Routes: #/  #/films  #/film/<slug>  #/photography  #/photo/<slug>  #/news  #/news/<slug>  #/hello
   (old links #/about #/contact #/downloads still work)
   ============================================================ */
(function () {
"use strict";

var A = window.AstrisData, D = A.D;
var esc = A.esc, img = A.img, imgUrl = A.imgUrl, md = A.md, fmtDate = A.fmtDate, setting = A.setting, flag = A.flag, listify = A.listify;
var TR = window.AstrisTransitions, INTRO = window.AstrisIntro, BRAND = window.ASTRIS_BRAND;
var $ = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
var RM = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
var SAVE = !!(navigator.connection && navigator.connection.saveData);

var NAV = [
  { id: "", label: "Home", key: "nav_home" },
  { id: "films", label: "Films", key: "nav_films" },
  { id: "photography", label: "Photography", key: "nav_photography" },
  { id: "news", label: "News", key: "nav_news" },
  { id: "hello", label: "Say hello", key: "nav_hello" }
];
var YT = "https://www.youtube.com/@AstrisProductions128";
var EMAIL = "astris.a.productions@gmail.com";
var SPEED = { fast: 0.72, normal: 1, relaxed: 1.45 };

/* ---------- small helpers ---------- */
function unique(a) { return a.filter(function (v, i) { return v && a.indexOf(v) === i; }); }
function pad(n) { return (n < 10 ? "0" : "") + n; }
function upper(s) { return esc(String(s || "").toUpperCase()); }
function dot(s) { return upper(s) + "<i>.</i>"; }
function dateOf(d) { return d ? fmtDate(d, { day: "numeric", month: "short", year: "numeric" }) : ""; }
function socials() {
  var list = (Array.isArray(D.contact.socials) ? D.contact.socials : []).concat(Array.isArray(D.about.links) ? D.about.links : [])
    .filter(function (s) { return s && s.url; }).map(function (s) { return { label: s.label || "Link", url: s.url }; });
  if (!list.some(function (s) { return /youtube/i.test(s.label + s.url); })) list.unshift({ label: "YouTube", url: YT });
  return list;
}
function handleOf(url) { var m = String(url).match(/@[A-Za-z0-9_.-]+/); return m ? m[0] : ""; }
function email() { return D.contact.email || EMAIL; }

/* ---------- the items that feed the intro, the reel and the slideshow ---------- */
function allItems() {
  var l = [];
  D.films.forEach(function (f) { if (f.thumb) l.push({ key: "film/" + f.slug, kind: "Film", title: f.title, href: "#/film/" + f.slug, img: f.thumb, date: f.date, featured: f.featured, order: f.featuredOrder }); });
  D.photos.forEach(function (p) { l.push({ key: "photo/" + p.slug, kind: "Photo", title: p.title || p.caption || "Photo", href: "#/photo/" + p.slug, img: p.image, date: p.date, featured: p.featured, order: p.featuredOrder }); });
  return l;
}
function featured() {
  return allItems().filter(function (x) { return x.featured; }).sort(function (a, b) { return (a.order - b.order) || ((b.date || 0) - (a.date || 0)); });
}
function latest(n) { return allItems().sort(function (a, b) { return (b.date || 0) - (a.date || 0); }).slice(0, n); }
function pickItems(key, n) {
  var keys = listify(D.site[key]);
  if (keys.length) {
    var map = {}; allItems().forEach(function (x) { map[x.key] = x; });
    var chosen = keys.map(function (k) { return map[k]; }).filter(Boolean);
    if (chosen.length) return chosen;
  }
  var f = featured();
  return f.length ? f : latest(n || 12);
}

/* ============================================================
   THE FOOTER (on every page), with the film reel rolling at the very bottom
   ============================================================ */
/* a rolling strip of film frames, used in the footer, on the home page, on some pages and in the menu */
function ribbonHtml(o) {
  o = o || {};
  var items = o.items && o.items.length ? o.items : pickItems("reel_items", 14), half = items.slice();
  while (half.length && half.length < (o.min || 14)) half = half.concat(items);
  if (!half.length) return "";
  var frames = half.map(function (it) {
    return '<a class="fr" href="' + esc(it.href) + '" tabindex="-1" draggable="false">' + img(it.img, o.w || 480, it.title, "fri") + "<span>" + esc(it.title) + "</span></a>";
  }).join("");
  var mult = { slow: 1.5, normal: 1, fast: 0.65 }[setting("reel_speed", "normal")] || 1;
  var dur = Math.round(Math.max(50, half.length * (o.per || 6)) * mult);
  return '<div class="ribbon' + (o.cls ? " " + o.cls : "") + '" aria-hidden="true"><div class="track" style="--dur:' + dur + 's">' + frames + frames + "</div></div>";
}
function bandItems(kind) {
  var all = allItems(), pick;
  if (kind === "film") {   /* frames from your films: each thumbnail and every still */
    pick = [];
    D.films.forEach(function (f) { unique([f.thumb].concat(f.gallery)).forEach(function (u) { pick.push({ key: "film/" + f.slug, kind: "Film", title: f.title, href: "#/film/" + f.slug, img: u, date: f.date }); }); });
  } else pick = all.filter(function (x) { return kind === "photo" ? x.kind === "Photo" : true; });
  if (pick.length < 4) pick = all;
  return pick.sort(function (a, b) { return (b.date || 0) - (a.date || 0); }).slice(0, 16);
}
/* the bigger rolling strips; switch them off in the Studio (Showreel & intro) */
function bandHtml(kind, big) {
  if (!flag("reel_bands", true)) return "";
  var items = bandItems(kind);
  if (items.length < 3) return "";
  return ribbonHtml({ cls: big ? "big band" : "mid", w: big ? 640 : 480, items: items, per: big ? 8 : 7 });
}

function footerHtml() {
  var brand = esc(setting("brand", "ASTRIS"));
  var base = esc(setting("footer_text", "© " + new Date().getFullYear() + " Astris Productions"));
  var who = esc(setting("footer_name", "Josh"));
  var note = setting("footer_note", "");
  var soc = socials().map(function (s) {
    var h = handleOf(s.url);
    return '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.label) + (h ? "<small>" + esc(h) + "</small>" : "") + "</a>";
  }).join("");
  return '<footer class="foot"><div class="foot-in">' +
    '<div class="fbrand"><svg class="logo" viewBox="0 0 1900 1600" role="img" aria-label="' + brand + '"><path fill="currentColor" fill-rule="evenodd" d="' + BRAND.logo + '"/></svg>' +
    '<div><b class="a">ASTRIS<br>PRODUCTIONS</b><p>' + esc(setting("tagline", "Photography & Film")) + "</p></div></div>" +
    '<nav class="fcol" aria-label="Footer"><h4>Explore</h4>' + NAV.map(function (n) { return '<a href="#/' + n.id + '">' + esc(setting(n.key, n.label)) + "</a>"; }).join("") + "</nav>" +
    '<div class="fcol"><h4>Follow</h4>' + soc + "</div>" +
    '<div class="fcol"><h4>Contact</h4><a href="mailto:' + esc(email()) + '">' + esc(email()) + "</a>" + (D.contact.location ? "<p>" + esc(D.contact.location) + "</p>" : "") + "</div></div>" +
    '<div class="fbase"><span>' + base + "</span><span>" + who + (note ? " &middot; " + esc(note) : "") + '</span><button type="button" data-replay>Replay intro</button></div>' +
    ribbonHtml() +
    "</footer>";
}

/* ============================================================
   PAGES. Each returns { key, nav, title, dark, html, bind(root) }
   ============================================================ */
function pageHead(title, intro) {
  return '<header class="ph"><h1 class="a">' + dot(title) + "</h1>" + (intro ? "<p>" + esc(intro) + "</p>" : "") + '</header><div class="perf" aria-hidden="true"></div>';
}
function empty(msg, link) {
  return '<div class="empty rv"><p>' + esc(msg) + "</p>" + (link || "") + "</div>";
}
function select(id, label, opts, cur) {
  return '<label class="sel"><span class="sr">' + esc(label) + '</span><select id="' + id + '">' + opts.map(function (o) {
    return '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? " selected" : "") + ">" + esc(o[1]) + "</option>";
  }).join("") + "</select></label>";
}
function tabs(group, list, cur) {
  return '<div class="tabs" data-g="' + group + '" role="group">' + list.map(function (t) {
    return '<button type="button" class="tab" data-v="' + esc(t[0]) + '" aria-pressed="' + (t[0] === cur) + '">' + esc(t[1]) + "</button>";
  }).join("") + "</div>";
}
function bindTabs(root, state, fn) {
  $$(".tabs", root).forEach(function (g) {
    $$(".tab", g).forEach(function (b) {
      b.onclick = function () {
        state[g.dataset.g] = b.dataset.v;
        $$(".tab", g).forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
        fn();
      };
    });
  });
}
function notFound(what) {
  return { key: "404", nav: "", title: "Not found", dark: true, html: '<div class="pg"><div class="pg-in">' + pageHead("Not found", "That " + what + " isn't here (any more).") + '<p><a class="btn y" href="#/">Back home</a></p></div></div>' };
}
function wrap(inner) { return '<div class="pg"><div class="pg-in">' + inner + "</div></div>"; }

/* ---- cards ---- */
function progressBar(f) {
  var stages = A.STAGES;
  return '<div class="prog" role="img" aria-label="' + esc(f.stage + ", " + f.progress + " percent") + '"><i style="width:' + f.progress + '%"></i></div>' +
    '<p class="stage"><b>' + esc(f.stage) + "</b> &middot; " + f.progress + "%" + (f.update ? " &middot; " + esc(f.update) : "") + "</p>";
}
function filmCard(f) {
  var meta = [f.type, f.year, f.length].filter(Boolean).join(" · ");
  return '<a class="card film rv" data-dive href="#/film/' + esc(f.slug) + '"><div class="im">' +
    (f.thumb ? img(f.thumb, 960, f.title, "ci") : '<span class="noim"></span>') +
    (f.wip ? '<span class="tag">In progress</span>' : "") + "</div><h3 class=\"a\">" + esc(f.title) + "</h3>" +
    (f.wip ? progressBar(f) : (meta ? '<p class="meta">' + esc(meta) + "</p>" : "")) + "</a>";
}
function photoTile(p, w) {
  return '<a class="tile rv" data-dive href="#/photo/' + esc(p.slug) + '" aria-label="' + esc(p.title || "Photo") + '">' + img(p.image, w || 640, p.title, "ci") + "</a>";
}
function newsRow(n) {
  return '<a class="post rv" href="#/news/' + esc(n.slug) + '"><time>' + esc(dateOf(n.date)) + '</time><h3 class="a">' + esc(n.title) + '</h3><span class="tg">' + esc(n.tags.join(" · ")) + "</span></a>";
}
function section(prefix, title, linkLabel, href, body, lead) {
  var heading = setting(prefix + "_heading", title);
  return '<section class="blk"><div class="blk-in"><div class="perf rv" aria-hidden="true"></div><div class="blk-h rv"><h2 class="a">' + dot(heading) + "</h2>" +
    (href ? '<a class="link" href="' + href + '">' + esc(setting(prefix + "_link", linkLabel)) + " &rarr;</a>" : "") + "</div>" +
    (lead ? '<p class="lead rv">' + esc(lead) + "</p>" : "") + body + "</div></section>";
}

/* ---- home ---- */
function pHome() {
  var hero = '<section class="hero"><div class="hero-in"><h1 class="a">' + upper(setting("hero_title", "Astris")) + '</h1><p class="prod">' + upper(setting("hero_subtitle", "Productions")) + "</p>" +
    '<p class="go"><a class="btn y" href="' + esc(setting("home_cta_link", "#/films")) + '">' + esc(setting("home_cta_label", "Watch the films")) + ' <span aria-hidden="true">&rarr;</span></a></p></div>' +
    '<div class="scue" aria-hidden="true">Scroll</div></section>';
  var secs = [];
  function add(key, def, order, html) { if (html && flag("home_" + key + "_enabled", def)) secs.push({ order: Number(setting("home_" + key + "_order", order)), html: html }); }
  add("films", true, 1, D.films.length ? section("home_latest_films", "Latest films", "All films", "#/films", '<div class="grid g3">' + D.films.slice(0, 3).map(filmCard).join("") + "</div>") : "");
  add("photos", true, 2, D.photos.length ? section("home_latest_photos", "Latest photos", "All photos", "#/photography", '<div class="grid g4 sq">' + D.photos.slice(0, 8).map(function (p) { return photoTile(p, 640); }).join("") + "</div>") : "");
  var feat = featured().slice(0, 6);
  add("selected", false, 3, feat.length ? section("home_selected", "Selected work", "", "", '<div class="grid g3">' + feat.map(function (x) {
    return '<a class="card rv" data-dive href="' + esc(x.href) + '"><div class="im">' + img(x.img, 960, x.title, "ci") + '<span class="tag alt">' + esc(x.kind) + "</span></div><h3 class=\"a\">" + esc(x.title) + "</h3></a>";
  }).join("") + "</div>", setting("home_selected_intro", "")) : "");
  var caps = listify(D.about.capabilities);
  add("about", true, 4, '<section class="blk"><div class="blk-in bio"><div class="me rv"><img class="me-img" src="' + esc(D.about.image ? imgUrl(D.about.image, 960) : "/images/silhouette.jpg") + '" alt="Silhouette of a person holding a camera" loading="lazy"></div><div class="rv"><h2 class="a">' + dot(D.about.home_heading || "Hi, I'm Josh") + "</h2><p>" +
    esc(D.about.home_text || D.about.intro || "Photographer and filmmaker.") + "</p>" + (caps.length ? '<p class="caps">' + caps.map(esc).join(" &middot; ") + "</p>" : "") +
    '<p><a class="btn y" href="#/hello">Say hello <span aria-hidden="true">&rarr;</span></a></p></div></div></section>');
  add("news", true, 5, D.news.length ? section("home_news", "News", "All news", "#/news", D.news.slice(0, 3).map(newsRow).join("")) : "");
  secs.sort(function (a, b) { return a.order - b.order; });
  return { key: "home", nav: "", title: "", dark: false, html: hero + bandHtml("all", true) + secs.map(function (s) { return s.html; }).join("") };
}

/* ---- films ---- */
var fs = { show: "all", type: "", sort: "new" };
function pFilms() {
  var types = unique(D.films.map(function (f) { return f.type; }));
  var html = pageHead(setting("films_heading", "Films"), setting("films_intro", "Finished films and the ones still being made, all in one place.")) +
    (D.films.length ? bandHtml("film") : "") +
    (D.films.length ? '<div class="bar rv">' + tabs("show", [["all", "All"], ["done", "Finished"], ["wip", "In progress"]], fs.show) +
      '<div class="bar-r">' + (types.length > 1 ? select("ftype", "Type", [["", "All types"]].concat(types.map(function (t) { return [t, t]; })), fs.type) : "") +
      select("fsort", "Sort", [["new", "Newest first"], ["old", "Oldest first"], ["az", "A to Z"]], fs.sort) + '<span class="count" id="fcount"></span></div></div><div class="grid g3" id="fout"></div>'
      : empty("No films here yet. The first ones are on their way.", '<p><a class="btn o" href="' + YT + '" target="_blank" rel="noopener">Follow on YouTube</a></p>'));
  return {
    key: "films", nav: "films", title: setting("films_heading", "Films"), dark: true, html: wrap(html),
    bind: function (root) {
      if (!D.films.length) return;
      function draw() {
        var l = D.films.filter(function (f) { return (fs.show === "all" || (fs.show === "wip" ? f.wip : !f.wip)) && (!fs.type || f.type === fs.type); });
        l.sort(function (a, b) { return fs.sort === "az" ? a.title.localeCompare(b.title) : fs.sort === "old" ? (a.date || 0) - (b.date || 0) : (b.date || 0) - (a.date || 0); });
        $("#fcount", root).textContent = l.length + (l.length === 1 ? " film" : " films");
        $("#fout", root).innerHTML = l.length ? l.map(filmCard).join("") : empty("Nothing here yet. Try another filter.");
        reveal($("#fout", root));
      }
      var st = $("#ftype", root), ss = $("#fsort", root);
      if (st) st.onchange = function () { fs.type = this.value; draw(); };
      ss.onchange = function () { fs.sort = this.value; draw(); };
      bindTabs(root, fs, draw);
      draw();
    }
  };
}
function stagesBlock(f) {
  var idx = A.STAGES.indexOf(f.stage);
  return '<div class="pb"><div class="prog big"><i style="width:' + f.progress + '%"></i></div><ol class="stl">' + A.STAGES.map(function (s, i) {
    return '<li' + (i === idx ? ' class="now"' : i < idx ? ' class="done"' : "") + ">" + esc(s) + "</li>";
  }).join("") + "</ol>" + (f.update ? '<p class="up"><b>' + (f.updateDate ? esc(dateOf(f.updateDate)) + "</b> &nbsp; " : "</b>") + esc(f.update) + "</p>" : "") + "</div>";
}
function pFilm(slug) {
  var f = D.films.filter(function (x) { return x.slug === slug; })[0];
  if (!f) return notFound("film");
  var n = D.films.length, i = D.films.indexOf(f), prev = n > 1 ? D.films[(i + n - 1) % n] : null, next = n > 1 ? D.films[(i + 1) % n] : null;
  var stills = unique([f.thumb].concat(f.gallery)), hero = stills[0] || "";
  var playable = !!(f.yt || f.vimeo || f.file);
  var facts = [
    ["Status", f.wip ? "In progress: " + f.stage : "Finished"], ["Type", f.type], [f.wip ? "Aiming for" : "Made", f.date ? dateOf(f.date) : f.year],
    ["Length", f.length], ["Role", f.role]
  ].filter(function (r) { return r[1]; });
  var html = '<a class="back rv" href="#/films">&larr; All films</a>' +
    '<div class="stagebox rv" id="stagebox">' + (hero ? img(hero, 960, f.title, "stage-img", true) : "") + '<div class="grad"></div>' +
    (playable ? '<button class="play" id="play" type="button"><i></i>' + (f.wip ? "Watch the teaser" : "Play film") + "</button>" : (f.wip ? '<span class="badge">In progress &middot; ' + esc(f.stage) + "</span>" : "")) +
    (stills.length > 1 ? '<span class="fc" id="fc"></span>' : "") + "</div>" +
    (stills.length > 1 ? '<div class="stills rv" id="stills">' + stills.map(function (s, x) { return '<button type="button" data-i="' + x + '" aria-label="Frame ' + (x + 1) + '"' + (x ? "" : ' aria-current="true"') + ">" + img(s, 480, "", "") + "</button>"; }).join("") + "</div>" : "") +
    '<div class="fd"><div class="rv"><h1 class="a">' + upper(f.title) + "</h1>" + (f.description ? '<div class="desc">' + md(f.description) + "</div>" : "") + (f.wip ? stagesBlock(f) : "") + "</div>" +
    '<dl class="facts rv">' + facts.map(function (r) { return "<dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd>"; }).join("") + (f.credits ? "<dt>Credits</dt><dd class=\"cr\">" + esc(f.credits).replace(/\n/g, "<br>") + "</dd>" : "") + "</dl></div>" +
    (prev || next ? '<div class="pn rv">' + (prev ? '<a href="#/film/' + esc(prev.slug) + '">&larr; ' + esc(prev.title) + "</a>" : "<span></span>") + (next ? '<a href="#/film/' + esc(next.slug) + '">' + esc(next.title) + " &rarr;</a>" : "") + "</div>" : "");
  return {
    key: "film", nav: "films", title: f.title, dark: true, html: wrap(html),
    bind: function (root) {
      var stage = $("#stagebox", root), cur = 0, playing = false, im = $(".stage-img", root);
      if (im && hero) upgrade(im, hero, 1600);
      function frame(k) {
        if (playing || stills.length < 2) return;
        cur = (k + stills.length) % stills.length;
        im.src = imgUrl(stills[cur], 1280); im.dataset.p = stills[cur]; im.dataset.fb = "0";
        $("#fc", root).textContent = "FRAME " + pad(cur + 1) + " / " + pad(stills.length);
        $$("#stills button", root).forEach(function (b, x) { b.setAttribute("aria-current", x === cur ? "true" : "false"); });
      }
      if (stills.length > 1) { $$("#stills button", root).forEach(function (b) { b.onclick = function () { frame(+b.dataset.i); }; }); frame(0); }
      var pl = $("#play", root);
      if (pl) pl.onclick = function () {
        playing = true;
        var media = f.yt ? '<iframe src="https://www.youtube-nocookie.com/embed/' + esc(f.yt) + '?autoplay=1&rel=0" title="' + esc(f.title) + '" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>'
          : f.vimeo ? '<iframe src="https://player.vimeo.com/video/' + esc(f.vimeo) + '?autoplay=1" title="' + esc(f.title) + '" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>'
          : '<video src="' + esc(A.sitePath(f.file)) + '" controls autoplay playsinline></video>';
        stage.classList.add("playing"); stage.innerHTML = media;
      };
    }
  };
}

/* ---- photography ---- */
var ps = { series: "", tag: "", camera: "", sort: "new", free: false };
var wallList = [];
function photoItems(list) {
  return list.map(function (p) {
    return {
      path: p.image, slug: p.slug, title: p.title || p.caption || "Photograph", caption: p.title ? p.caption : "", description: p.description, story: p.story,
      date: p.date, series: p.series, tags: p.tags, download: p.download,
      specs: [["Camera", p.camera], ["Lens", p.lens], ["ISO", p.iso], ["Shutter", p.shutter], ["Aperture", p.aperture], ["Focal length", p.focal]].filter(function (r) { return r[1]; })
    };
  });
}
function pPhotography(q) {
  if (q && q.has("series")) ps.series = q.get("series");
  if (q && q.has("tag")) ps.tag = q.get("tag");
  if (q && q.has("free")) ps.free = q.get("free") === "1";
  var series = unique(D.series.map(function (s) { return s.title; }).concat(D.photos.reduce(function (a, p) { return a.concat(p.series); }, [])));
  var tags = unique(D.photos.reduce(function (a, p) { return a.concat(p.tags); }, [])).sort(function (a, b) { return a.localeCompare(b); });
  var cams = unique(D.photos.map(function (p) { return p.camera; })).sort();
  var anyFree = D.photos.some(function (p) { return p.download; });
  var html = pageHead(setting("photography_heading", "Photography"), setting("photography_intro", "Stills from the archive. Some are free to download.")) +
    (D.photos.length ? bandHtml("photo") : "") +
    (D.photos.length ? '<div class="bar rv">' + (series.length ? tabs("series", [["", "All"]].concat(series.map(function (s) { return [s, s]; })), ps.series) : "") +
      '<div class="bar-r">' + (anyFree ? '<button type="button" class="tab sw" id="free" aria-pressed="' + ps.free + '">Free to download</button>' : "") +
      (tags.length ? select("ptag", "Tag", [["", "All tags"]].concat(tags.map(function (t) { return [t, "#" + t]; })), ps.tag) : "") +
      (cams.length > 1 ? select("pcam", "Camera", [["", "All cameras"]].concat(cams.map(function (c) { return [c, c]; })), ps.camera) : "") +
      select("psort", "Sort", [["new", "Newest first"], ["old", "Oldest first"], ["az", "A to Z"]], ps.sort) + '<span class="count" id="pcount"></span></div></div><div class="wall" id="wall"></div>'
      : empty("No photos here yet."));
  return {
    key: "photography", nav: "photography", title: setting("photography_heading", "Photography"), dark: true, html: wrap(html),
    bind: function (root) {
      if (!D.photos.length) return;
      function draw() {
        var l = D.photos.filter(function (p) {
          return (!ps.series || p.series.indexOf(ps.series) > -1) && (!ps.tag || p.tags.indexOf(ps.tag) > -1) && (!ps.camera || p.camera === ps.camera) && (!ps.free || p.download);
        });
        l.sort(function (a, b) { return ps.sort === "az" ? (a.title || "").localeCompare(b.title || "") : ps.sort === "old" ? (a.date || 0) - (b.date || 0) : (b.date || 0) - (a.date || 0); });
        wallList = photoItems(l);
        $("#pcount", root).textContent = l.length + (l.length === 1 ? " photo" : " photos");
        $("#wall", root).innerHTML = l.length ? l.map(function (p, i) {
          return '<figure class="ph1 rv" data-i="' + i + '" tabindex="0" role="button" aria-label="' + esc("Open " + (p.title || "photo")) + '">' + img(p.image, 640, p.title, "") +
            "<figcaption><span>" + esc(p.title || "") + "</span>" + (p.download ? '<b class="free">Free</b>' : "") + "</figcaption></figure>";
        }).join("") : empty("No photos match those filters yet.");
        $$(".ph1", root).forEach(function (f) {
          f.onclick = function () { openLb(wallList, +f.dataset.i, f); };
          f.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openLb(wallList, +f.dataset.i, f); } };
        });
        reveal($("#wall", root));
      }
      var el;
      (el = $("#ptag", root)) && (el.onchange = function () { ps.tag = this.value; draw(); });
      (el = $("#pcam", root)) && (el.onchange = function () { ps.camera = this.value; draw(); });
      $("#psort", root).onchange = function () { ps.sort = this.value; draw(); };
      (el = $("#free", root)) && (el.onclick = function () { ps.free = !ps.free; this.setAttribute("aria-pressed", String(ps.free)); draw(); });
      bindTabs(root, ps, draw);
      draw();
    }
  };
}

/* ---- one photo ---- */
function pPhoto(slug) {
  var p = D.photos.filter(function (x) { return x.slug === slug; })[0];
  if (!p) return notFound("photo");
  var i = D.photos.indexOf(p), prev = D.photos[i - 1], next = D.photos[i + 1];
  var related = D.photos.filter(function (x) { return x !== p; }).map(function (x) {
    return { x: x, s: x.series.filter(function (s) { return p.series.indexOf(s) > -1; }).length * 2 + x.tags.filter(function (t) { return p.tags.indexOf(t) > -1; }).length };
  }).sort(function (a, b) { return b.s - a.s || (b.x.date || 0) - (a.x.date || 0); }).filter(function (r) { return r.s > 0; }).slice(0, 4).map(function (r) { return r.x; });
  var specs = [["Date taken", fmtDate(p.date)], ["Camera", p.camera], ["Lens", p.lens], ["ISO", p.iso], ["Shutter speed", p.shutter], ["Aperture", p.aperture], ["Focal length", p.focal]].filter(function (r) { return r[1]; });
  var html = '<div class="topline rv"><a class="back" href="#/photography">&larr; All photos</a>' + (p.download ? dlButton(p.image, p.slug, "Download") : "") + "</div>" +
    '<div class="photo-stage rv">' + (prev ? '<a class="pn-btn prev" href="#/photo/' + esc(prev.slug) + '" aria-label="Previous photo">&larr;</a>' : "") +
    img(p.image, 640, p.title, "detail", true).replace("<img ", '<img id="detailImg" crossorigin="anonymous" ') + (next ? '<a class="pn-btn next" href="#/photo/' + esc(next.slug) + '" aria-label="Next photo">&rarr;</a>' : "") + "</div>" +
    '<div class="pinfo"><div class="rv"><span class="cap">' + esc(p.series[0] || "Photograph") + '</span><h1 class="a">' + upper(p.title || p.caption) + "</h1>" +
    (p.caption && p.title ? '<p class="dim"><em>' + esc(p.caption) + "</em></p>" : "") + (p.description ? "<p>" + esc(p.description) + "</p>" : "") + (p.story ? '<p class="story">' + esc(p.story) + "</p>" : "") +
    '<p class="chips">' + p.series.map(function (s) { return '<a class="chip" href="#/photography?series=' + encodeURIComponent(s) + '">' + esc(s) + "</a>"; }).join("") +
    p.tags.map(function (t) { return '<a class="chip dim" href="#/photography?tag=' + encodeURIComponent(t) + '">#' + esc(t) + "</a>"; }).join("") + "</p></div>" +
    '<div class="rv">' + (specs.length ? '<dl class="specs">' + specs.map(function (r) { return "<div><dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd></div>"; }).join("") + "</dl>" : "") +
    '<div id="paletteWrap" hidden><span class="cap">Dominant colours</span><div class="palette" id="palette"></div></div></div></div>' +
    (related.length ? '<h2 class="a sub rv">' + dot("More like this") + '</h2><div class="grid g4 sq">' + related.map(function (r) { return photoTile(r, 640); }).join("") + "</div>" : "");
  return {
    key: "photo", nav: "photography", title: p.title || "Photograph", dark: true, html: wrap(html),
    bind: function (root) {
      var im = $("#detailImg", root);
      upgrade(im, p.image, 2048, function () {
        extractPalette(im).then(function (cols) {
          if (!cols.length) return;
          $("#paletteWrap", root).hidden = false;
          $("#palette", root).innerHTML = cols.map(function (c, k) { return '<span title="' + esc(c) + '" style="background:' + esc(c) + ";animation-delay:" + k * 90 + 'ms"></span>'; }).join("");
        }).catch(function () {});
      });
    }
  };
}
function extractPalette(im, count) {
  count = count || 5;
  return new Promise(function (resolve) {
    try {
      var c = document.createElement("canvas"), w = 72, h = Math.max(1, Math.round(72 * im.naturalHeight / (im.naturalWidth || 1)));
      c.width = w; c.height = h;
      var ctx = c.getContext("2d", { willReadFrequently: true }); ctx.drawImage(im, 0, 0, w, h);
      var px = ctx.getImageData(0, 0, w, h).data, buckets = {};
      for (var i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 200) continue;
        var key = ((px[i] >> 4) << 8) | ((px[i + 1] >> 4) << 4) | (px[i + 2] >> 4);
        var b = buckets[key] || (buckets[key] = { n: 0, r: 0, g: 0, b: 0 });
        b.n++; b.r += px[i]; b.g += px[i + 1]; b.b += px[i + 2];
      }
      var sorted = Object.keys(buckets).map(function (k) { return buckets[k]; }).sort(function (a, b) { return b.n - a.n; })
        .map(function (b) { return [Math.round(b.r / b.n), Math.round(b.g / b.n), Math.round(b.b / b.n)]; });
      var picked = [];
      sorted.forEach(function (rgb) {
        if (picked.length < count && picked.every(function (p) { return Math.abs(p[0] - rgb[0]) + Math.abs(p[1] - rgb[1]) + Math.abs(p[2] - rgb[2]) > 72; })) picked.push(rgb);
      });
      resolve(picked.map(function (c3) { return "#" + c3.map(function (v) { return v.toString(16).padStart(2, "0"); }).join(""); }));
    } catch (e) { resolve([]); }
  });
}
/* show the picture that is already loaded, then swap in the sharper one */
function upgrade(el, path, w, done) {
  if (!el) return;
  var hi = new Image(); hi.crossOrigin = "anonymous";
  hi.onload = function () { el.src = hi.src; el.dataset.fb = "0"; if (done) { if (el.complete) done(); else el.addEventListener("load", function () { done(); }, { once: true }); } };
  hi.onerror = function () { if (done && el.complete && el.naturalWidth) done(); };
  hi.src = imgUrl(path, w);
}

/* ---- news ---- */
var ns = { tag: "", sort: "new" };
function pNews() {
  var tags = unique(D.news.reduce(function (a, n) { return a.concat(n.tags); }, []));
  var html = pageHead(setting("news_heading", "News"), setting("news_intro", "Releases, behind the scenes, and what the studio is up to.")) +
    (D.news.length ? '<div class="bar rv">' + (tags.length ? tabs("tag", [["", "All"]].concat(tags.map(function (t) { return [t, t]; })), ns.tag) : "") +
      '<div class="bar-r">' + select("nsort", "Sort", [["new", "Newest first"], ["old", "Oldest first"]], ns.sort) + '<span class="count" id="ncount"></span></div></div><div id="nout"></div>'
      : empty("No news yet. Check back soon."));
  return {
    key: "news", nav: "news", title: setting("news_heading", "News"), dark: true, html: wrap(html),
    bind: function (root) {
      if (!D.news.length) return;
      function draw() {
        var l = D.news.filter(function (n) { return !ns.tag || n.tags.indexOf(ns.tag) > -1; });
        l.sort(function (a, b) { return ns.sort === "old" ? (a.date || 0) - (b.date || 0) : (b.date || 0) - (a.date || 0); });
        $("#ncount", root).textContent = l.length + (l.length === 1 ? " post" : " posts");
        if (!l.length) { $("#nout", root).innerHTML = empty("No posts under that topic yet."); return; }
        var f = l[0];
        $("#nout", root).innerHTML = '<a class="feat rv" data-dive href="#/news/' + esc(f.slug) + '"><div class="im">' + (f.image ? img(f.image, 1280, f.title, "ci") : '<span class="noim"></span>') + '</div><div><span class="cap">' +
          esc([f.tags[0], dateOf(f.date)].filter(Boolean).join(" · ")) + '</span><h2 class="a">' + upper(f.title) + "</h2><p>" + esc(f.summary) + '</p><span class="btn o">Read the post <span aria-hidden="true">&rarr;</span></span></div></a>' +
          l.slice(1).map(newsRow).join("");
        reveal($("#nout", root));
      }
      $("#nsort", root).onchange = function () { ns.sort = this.value; draw(); };
      bindTabs(root, ns, draw);
      draw();
    }
  };
}
function pArticle(slug) {
  var n = D.news.filter(function (x) { return x.slug === slug; })[0];
  if (!n) return notFound("post");
  var c = D.news.length, i = D.news.indexOf(n), prev = c > 1 ? D.news[(i + c - 1) % c] : null, next = c > 1 ? D.news[(i + 1) % c] : null;
  var html = '<a class="back rv" href="#/news">&larr; All news</a><article class="np"><span class="cap rv">' + esc([n.tags.join(" · "), dateOf(n.date)].filter(Boolean).join(" · ")) + '</span><h1 class="a rv">' + upper(n.title) + "</h1>" +
    (n.image ? '<div class="hi rv">' + img(n.image, 1280, n.title, "ci", true) + "</div>" : "") +
    '<div class="tx rv">' + md(n.body) + "</div>" +
    (n.gallery.length ? '<div class="ng">' + n.gallery.map(function (g, x) { return '<button type="button" class="rv" data-x="' + x + '" aria-label="Open photo ' + (x + 1) + '">' + img(g, 640, "Photo " + (x + 1), "") + "</button>"; }).join("") + "</div>" : "") + "</article>" +
    (prev || next ? '<div class="pn rv">' + (prev ? '<a href="#/news/' + esc(prev.slug) + '">&larr; ' + esc(prev.title) + "</a>" : "<span></span>") + (next ? '<a href="#/news/' + esc(next.slug) + '">' + esc(next.title) + " &rarr;</a>" : "") + "</div>" : "");
  return {
    key: "article", nav: "news", title: n.title, dark: true, html: wrap(html),
    bind: function (root) {
      var items = n.gallery.map(function (g) { return { path: g, title: n.title, caption: "", specs: [], series: [], tags: [] }; });
      $$(".ng button", root).forEach(function (b) { b.onclick = function () { openLb(items, +b.dataset.x, b); }; });
    }
  };
}

/* ---- say hello ---- */
function pHello() {
  var ab = D.about, ct = D.contact, em = email(), caps = listify(ab.capabilities);
  var pic = ab.image ? img(ab.image, 960, "Josh", "me-img", true) : '<img class="me-img" src="/images/silhouette.jpg" alt="Silhouette of a person holding a camera" loading="eager">';
  var html = '<section class="hello"><div class="rv"><h1 class="a">' + upper(setting("hello_heading", "Say hello")).replace(/\s+/, "<br>") + "<i>.</i></h1>" + (ct.intro && ct.intro.length > 3 ? '<p class="lead">' + esc(ct.intro) + "</p>" : "") + '</div><div class="me rv">' + pic + "</div></section>" +
    '<section class="contact rv"><div><h4>Email</h4><a class="big" id="em" href="mailto:' + esc(em) + '">' + esc(em) + '</a><p><button class="btn o" id="cp" type="button">Copy email</button></p>' + (ct.email_note ? '<p class="dim">' + esc(ct.email_note) + "</p>" : "") + "</div>" +
    "<div><h4>About</h4>" + (ab.intro ? "<p>" + esc(ab.intro) + "</p>" : "") + (caps.length ? '<p class="caps">' + caps.map(esc).join(" &middot; ") + "</p>" : "") + (ct.location ? '<p class="dim">Based in ' + esc(ct.location) + "</p>" : "") + (ct.availability ? '<p class="dim">' + esc(ct.availability) + "</p>" : "") + "</div>" +
    "<div><h4>Follow</h4>" + socials().map(function (s) { var h = handleOf(s.url); return '<p><a class="big sm" href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.label) + (h ? "<small>" + esc(h) + "</small>" : "") + "</a></p>"; }).join("") + "</div></section>" +
    (ab.body ? '<section class="bio-body rv">' + md(ab.body) + "</section>" : "");
  return {
    key: "hello", nav: "hello", title: "Say hello", dark: true, html: wrap(html),
    bind: function (root) {
      $("#cp", root).onclick = function () {
        var t = em, ok = function () { toast("Email copied"); };
        function sel() { var r = document.createRange(); r.selectNodeContents($("#em")); var s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("Press Ctrl+C to copy"); }
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, sel); else sel();
      };
    }
  };
}

/* ============================================================
   PICTURE VIEWER (photos, and the photos inside news posts)
   ============================================================ */
var lb = { list: [], i: 0, opener: null };
function dlButton(path, slug, text) {
  var ext = (String(path).match(/\.(jpe?g|png|webp)$/i) || [".jpg"])[0].toLowerCase();
  return '<a class="btn y" href="' + esc(A.sitePath(path)) + '" download="astris-' + esc(slug || "photo") + ext + '" data-dl="' + esc(path) + '" data-name="astris-' + esc(slug || "photo") + ext + '">' + esc(text) + "</a>";
}
function downloadPhoto(path, name) {
  function save(blob) { var u = URL.createObjectURL(blob), a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000); }
  function get(url) { return fetch(url).then(function (r) { if (!r.ok || /text\/html/.test(r.headers.get("content-type") || "")) throw new Error("bad"); return r.blob(); }); }
  toast("Starting your download…");
  get(A.sitePath(path)).catch(function () { return get(A.rawUrl(path)); }).then(save, function () { window.open(A.rawUrl(path), "_blank"); });
}
function openLb(list, i, opener) {
  lb.list = list; lb.opener = opener || null;
  var el = $("#lb"); el.hidden = false; document.body.classList.add("lb-open");
  showLb(i);
  $(".lb-x", el).focus({ preventScroll: true });
}
function showLb(i) {
  var n = lb.list.length; lb.i = (i + n) % n;
  var it = lb.list[lb.i], el = $("#lb");
  el.innerHTML = '<button class="lb-x" type="button" aria-label="Close">&#10005;</button><div class="lb-pic">' + (n > 1 ? '<button class="lb-nv prev" type="button" aria-label="Previous">&larr;</button>' : "") +
    img(it.path, 1600, it.title, "lb-img", true) + (n > 1 ? '<button class="lb-nv next" type="button" aria-label="Next">&rarr;</button>' : "") + "</div>" +
    '<aside class="lb-side"><span class="cap">' + esc(it.series && it.series.length ? it.series.join(" · ") : "Photo") + '</span><h2 class="a">' + upper(it.title) + "</h2>" +
    '<p class="dim">' + esc([dateOf(it.date), n > 1 ? (lb.i + 1) + " of " + n : ""].filter(Boolean).join(" · ")) + "</p>" +
    (it.caption ? '<p><em>' + esc(it.caption) + "</em></p>" : "") + (it.description ? "<p>" + esc(it.description) + "</p>" : "") +
    (it.specs && it.specs.length ? '<dl class="specs">' + it.specs.map(function (r) { return "<div><dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd></div>"; }).join("") + "</dl>" : "") +
    (it.download ? "<p>" + dlButton(it.path, it.slug, "Download photo") + '</p><p class="dim sm">Free to use. A credit is always appreciated.</p>' : "") +
    (it.slug ? '<p><a class="link" data-dive=".lb-img" href="#/photo/' + esc(it.slug) + '">Full details &rarr;</a></p>' : "") + "</aside>";
  [lb.i + 1, lb.i - 1].forEach(function (k) { var o = lb.list[(k + n) % n]; if (o && n > 1) { var pre = new Image(); pre.src = imgUrl(o.path, 1600); } });
}
function closeLb() {
  var el = $("#lb"); if (el.hidden) return;
  el.hidden = true; el.innerHTML = ""; document.body.classList.remove("lb-open");
  if (lb.opener && document.contains(lb.opener)) lb.opener.focus({ preventScroll: true });
}
function lbBind() {
  var el = $("#lb"), sx = null;
  el.addEventListener("click", function (e) {
    if (e.target.closest(".lb-x") || e.target === el || e.target.classList.contains("lb-pic")) closeLb();
    else if (e.target.closest(".prev")) showLb(lb.i - 1);
    else if (e.target.closest(".next")) showLb(lb.i + 1);
    else if (e.target.closest("[data-dl]")) { e.preventDefault(); var a = e.target.closest("[data-dl]"); downloadPhoto(a.dataset.dl, a.dataset.name); }
    else if (e.target.closest("a[href^='#']")) closeLb();
  });
  el.addEventListener("touchstart", function (e) { sx = e.touches[0].clientX; }, { passive: true });
  el.addEventListener("touchend", function (e) {
    if (sx == null) return; var dx = e.changedTouches[0].clientX - sx; sx = null;
    if (Math.abs(dx) > 55) showLb(lb.i + (dx < 0 ? 1 : -1));
  }, { passive: true });
}

/* ============================================================
   REEL: your showreel behind everything (a slow slideshow of stills until the video is in)
   ============================================================ */
var reel = { key: "", timer: 0, mode: "" };
function reelSlides() {
  var f = featured().filter(function (x) { return x.kind === "Photo"; });
  var l = f.length ? f : latest(10).filter(function (x) { return x.kind === "Photo"; });
  return l.slice(0, 8);
}
function setupReel() {
  var src = String(setting("showreel", setting("hero_video", "")) || "");
  var slides = reelSlides(), poster = String(setting("showreel_poster", "") || "");
  var key = [src, poster, slides.map(function (s) { return s.key; }).join(",")].join("|");
  if (key === reel.key) return;
  reel.key = key; clearInterval(reel.timer);
  var host = $("#reel"), v = $("#rv"), box = $("#slides");
  box.innerHTML = slides.map(function (s, i) { return '<div class="slide' + (i ? "" : " on") + '">' + img(s.img, 1600, "", "", i === 0) + "</div>"; }).join("");
  var els = $$(".slide", box), cur = 0;
  function startSlides() {
    host.classList.remove("has-video"); reel.mode = "slides";
    if (els.length < 2 || RM) return;
    reel.timer = setInterval(function () {
      els[cur].classList.remove("on"); cur = (cur + 1) % els.length;
      var s = els[cur]; s.style.animation = "none"; void s.offsetWidth; s.style.animation = ""; s.classList.add("on");
    }, 7000);
  }
  startSlides();
  if (src && !RM && !SAVE) {
    var tried = 0;
    v.onloadeddata = function () { host.classList.add("has-video"); reel.mode = "video"; clearInterval(reel.timer); var p = v.play(); if (p && p.catch) p.catch(function () {}); };
    v.onerror = function () {
      if (tried++ === 0 && !/^https?:/i.test(src)) { v.src = A.rawUrl(src); v.load(); }
      else { host.classList.remove("has-video"); startSlides(); }
    };
    if (poster) v.poster = A.sitePath(poster);
    v.src = A.sitePath(src); v.load();
  } else { v.removeAttribute("src"); v.load(); }
}
document.addEventListener("visibilitychange", function () {
  var v = $("#rv"); if (!v || reel.mode !== "video") return;
  if (document.hidden) v.pause(); else { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
});

/* look: film grain strength */
function applyLook() {
  var g = { off: 0, low: 0.11, medium: 0.2, high: 0.32 }[String(setting("grain", "medium"))];
  document.documentElement.style.setProperty("--grain", String(g == null ? 0.2 : g));
  document.documentElement.classList.toggle("no-grain", g === 0);
}

/* ============================================================
   THE SHELL: menu, toast, reveal-on-scroll
   ============================================================ */
function buildShell() {
  $("#nav").innerHTML = NAV.map(function (n) { return '<a href="#/' + n.id + '" data-nav="' + n.id + '">' + esc(setting(n.key, n.label)) + "</a>"; }).join("");
  $("#menu-nav").innerHTML = NAV.map(function (n, i) {
    return '<a href="#/' + n.id + '" data-nav="' + n.id + '" style="--i:' + i + '"><span class="n">' + pad(i + 1) + '</span><span class="t">' + esc(setting(n.key, n.label)) + "</span></a>";
  }).join("");
  $("#menu-info").innerHTML = '<p class="mi-tag">' + esc(setting("tagline", "Photography & Film")) + "</p>" +
    '<a class="mi-mail" href="mailto:' + esc(email()) + '">' + esc(email()) + "</a>" +
    socials().map(function (s) { var h = handleOf(s.url); return '<a class="mi-link" href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.label) + (h ? "<small>" + esc(h) + "</small>" : "") + "</a>"; }).join("") +
    (D.contact.location ? "<p>" + esc(D.contact.location) + "</p>" : "") + '<button type="button" class="mi-replay" data-replay>Replay intro</button>';
  menuReel = false;
  applyLook();
}
var menuReel = false;
function openMenu() {
  if (!menuReel) { menuReel = true; $("#menu-reel").innerHTML = ribbonHtml({ cls: "menuband", w: 480, items: bandItems("all"), per: 5 }); }
  document.body.classList.add("menu"); $("#burger").setAttribute("aria-expanded", "true");
  setTimeout(function () { var x = $(".menu-x"); if (x) x.focus({ preventScroll: true }); }, 60);
}
function closeMenu() { document.body.classList.remove("menu"); var b = $("#burger"); if (b) b.setAttribute("aria-expanded", "false"); }
function navActive(id) { $$("#nav a, #menu-nav a").forEach(function (a) { a.setAttribute("aria-current", a.dataset.nav === id ? "page" : "false"); }); }
var tt;
function toast(m) { var t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(tt); tt = setTimeout(function () { t.classList.remove("on"); }, 2400); }

var io = null;
function reveal(root) {
  var els = $$(".rv:not(.in)", root || document), vh = window.innerHeight;
  if (!("IntersectionObserver" in window) || RM) { els.forEach(function (e) { e.classList.add("in", "now"); }); return; }
  if (!io) io = new IntersectionObserver(function (en) { en.forEach(function (x) { if (x.isIntersecting) { x.target.classList.add("in"); io.unobserve(x.target); } }); }, { rootMargin: "0px 0px -6% 0px", threshold: 0.05 });
  els.forEach(function (e) { if (e.getBoundingClientRect().top < vh * 0.98) e.classList.add("in", "now"); else io.observe(e); });
}

/* ============================================================
   ROUTER + FILM-THEMED PAGE CHANGES
   ============================================================ */
function parseHash() {
  var h = location.hash.replace(/^#\/?/, ""), qi = h.indexOf("?");
  var path = qi < 0 ? h : h.slice(0, qi), q = new URLSearchParams(qi < 0 ? "" : h.slice(qi + 1));
  var segs = path.split("/").filter(Boolean).map(function (s) { try { return decodeURIComponent(s); } catch (e) { return s; } });
  return { page: segs[0] || "", arg: segs.slice(1).join("/"), q: q, raw: h };
}
function build(r) {
  switch (r.page) {
    case "": case "home": return pHome();
    case "films": return pFilms();
    case "film": return pFilm(r.arg);
    case "photography": return pPhotography(r.q);
    case "photo": return pPhoto(r.arg);
    case "news": return r.arg ? pArticle(r.arg) : pNews();
    case "hello": case "about": case "contact": return pHello();
    case "downloads": ps.free = true; return pPhotography(new URLSearchParams("free=1"));
    default: return pHome();
  }
}
function depth(def) { var i = 0; NAV.forEach(function (n, k) { if (n.id === def.nav) i = k; }); return i * 10 + (/^(film|photo|article)$/.test(def.key) ? 1 : 0); }

var cur = { key: "", def: null }, state = { last: "", i: -1 }, running = null, click = null, touched = false;

function swap(def, o) {
  o = o || {};
  var page = $("#page");
  document.body.dataset.page = def.key;
  page.className = "page" + (def.dark ? " dark" : "") + (def.key === "home" ? " fade" : "");
  page.innerHTML = def.html + footerHtml();
  document.title = (def.title ? def.title + " · " : "") + setting("brand_title", "Astris Productions");
  $("#sr").textContent = def.title || "Home";
  navActive(def.nav);
  closeLb(); closeMenu();
  if (!o.keepScroll) window.scrollTo(0, 0);
  reveal(page);
  if (def.bind) def.bind(page);
  var rp = $("[data-replay]", page); if (rp) rp.onclick = function () { runIntro(true); };
  cur.def = def;
}

/* the old page, as a still copy sitting on top of its own snapshot of the reel */
function makeGhost(page, sy) {
  var g = document.createElement("div");
  g.className = "layer ghost"; g.setAttribute("aria-hidden", "true"); g.setAttribute("inert", "");
  g.style.width = page.getBoundingClientRect().width + "px";
  var back = document.createElement("div"); back.className = "ghost-reel";
  var v = $("#rv");
  if (reel.mode === "video" && v && v.readyState >= 2 && v.videoWidth) {
    try {
      var cv = document.createElement("canvas"), w = Math.min(960, window.innerWidth), h = Math.round(w * window.innerHeight / window.innerWidth);
      cv.width = w; cv.height = h;
      var s = Math.max(w / v.videoWidth, h / v.videoHeight), dw = v.videoWidth * s, dh = v.videoHeight * s;
      cv.getContext("2d").drawImage(v, (w - dw) / 2, (h - dh) / 2, dw, dh);
      back.appendChild(cv);
    } catch (e) { /* keep the plain dark backing */ }
  } else {
    var on = $(".slide.on img"); if (on) back.appendChild(on.cloneNode());
  }
  var sc = $("#scrim"); if (sc) back.appendChild(sc.cloneNode());
  g.appendChild(back);
  var inner = document.createElement("div"); inner.className = "ghost-in"; inner.style.transform = "translateY(" + (-sy) + "px)";
  var copy = page.cloneNode(true); copy.removeAttribute("id");
  $$("[id]", copy).forEach(function (n) { n.removeAttribute("id"); });
  inner.appendChild(copy); g.appendChild(inner);
  document.body.appendChild(g);
  return g;
}

function cfg() {
  return { mode: String(setting("transition_mode", "random")), single: String(setting("transition_single", "dissolve")), enabled: listify(D.site.transitions_enabled) };
}
function go(def, key) {
  var page = $("#page");
  if (running) { running.cancel(); running = null; }
  var origin = click && Date.now() - click.t < 1500 ? click : null;
  var id = (RM || !page.firstChild || !cur.def) ? null : TR.pick(cfg(), state, !!(origin && origin.rect));
  if (!id) { swap(def); return; }
  var sy = window.scrollY || 0, dir = cur.def && depth(def) < depth(cur.def) ? -1 : 1;
  var ghost = makeGhost(page, sy);
  swap(def);
  window.scrollTo(0, 0);
  page.classList.add("xing");
  document.body.classList.add("moving");
  var fx = $("#fx");
  var p = TR.play(id, {
    stage: fx, host: fx, from: ghost, to: page, base: 10, pos: "absolute", dir: dir,
    speed: SPEED[String(setting("transition_speed", "normal"))] || 1, origin: origin
  });
  running = p;
  function end() { if (running === p) running = null; ghost.remove(); page.classList.remove("xing"); document.body.classList.remove("moving"); window.scrollTo(0, 0); try { page.focus({ preventScroll: true }); } catch (e) {} }
  var cancel = p.cancel; p.cancel = function () { cancel(); end(); };
  p.then(end);
}

function show(initial) {
  if (!D.ready) return;
  var r = parseHash(), def = build(r);
  var key = def.key + "/" + (r.arg || "");
  if (initial) { swap(def); cur.key = key; return; }
  if (key === cur.key) { return; }
  touched = true;
  cur.key = key;
  go(def, key);
}

/* remember what was clicked, so the page change can start from it (going into a card) */
document.addEventListener("click", function (e) {
  var a = e.target.closest && e.target.closest("a[href^='#']");
  if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
  var c = { t: Date.now(), x: e.clientX, y: e.clientY };
  if (a.hasAttribute("data-dive")) {
    var sel = a.getAttribute("data-dive"), im = sel ? $(sel) : $("img", a);
    if (im && im.complete && im.naturalWidth) { var r = im.getBoundingClientRect(); c.rect = { left: r.left, top: r.top, width: r.width, height: r.height }; c.src = im.currentSrc || im.src; }
  }
  click = c;
}, true);
window.addEventListener("hashchange", function () { show(false); });
window.addEventListener("scroll", function () {
  if (window.scrollY > 90) touched = true;
  /* at the very bottom the side menu fades out, so it never sits on top of the film reel */
  document.body.classList.toggle("at-end", window.scrollY + window.innerHeight > document.documentElement.scrollHeight - 320);
}, { passive: true });

/* ============================================================
   THE OPENING + BOOT
   ============================================================ */
var introCtl = null;
function seen() { try { return sessionStorage.getItem("astris-intro") === "1"; } catch (e) { return false; } }
function runIntro(force) {
  if (RM || !INTRO) return;
  if (!force && (seen() || !flag("intro_enabled", true))) return;
  try { sessionStorage.setItem("astris-intro", "1"); } catch (e) { /* ignore */ }
  var items = pickItems("intro_items", 8).slice(0, 10);
  var urls = items.map(function (it, i) { return imgUrl(it.img, i === 0 ? 1280 : 640); });
  if (introCtl) return;
  window.scrollTo(0, 0);
  document.body.classList.add("preintro");
  introCtl = INTRO.play({
    frames: urls, speed: String(setting("intro_speed", "normal")), wait: INTRO.preload(urls, 800),
    onArrive: function () { document.body.classList.remove("preintro"); document.body.classList.add("arrive"); setTimeout(function () { document.body.classList.remove("arrive"); }, 900); },
    onDone: function () { introCtl = null; document.body.classList.remove("preintro"); }
  });
}

function onData(initial) {
  buildShell(); setupReel();
  if (initial) { show(true); return; }
  /* newer content arrived: refresh quietly, but never under someone who is already looking around */
  if (!touched && !running && $("#lb").hidden) { var r = parseHash(), def = build(r); swap(def, { keepScroll: true }); }
}

function boot() {
  var bootEl = $("#boot");
  if (bootEl && BRAND) bootEl.innerHTML = '<svg viewBox="0 0 1900 1600" aria-hidden="true"><path d="' + BRAND.stripOuter + '" fill="none" stroke="#f2b705" stroke-width="12"/></svg>';
  var wantIntro = !RM && !seen() && /^(#\/?)?(home)?$/.test(location.hash);
  lbBind();
  $("#burger").onclick = openMenu;
  $("#menu").addEventListener("click", function (e) {
    if (e.target.closest("[data-replay]")) { closeMenu(); runIntro(true); return; }
    if (e.target.closest("a, .menu-x") || e.target === this || e.target.classList.contains("menu-body")) closeMenu();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { closeLb(); closeMenu(); }
    if (!$("#lb").hidden) { if (e.key === "ArrowRight") showLb(lb.i + 1); if (e.key === "ArrowLeft") showLb(lb.i - 1); }
  });
  A.load(function () { onData(false); }).then(function () {
    onData(true);
    if (bootEl) { bootEl.classList.add("gone"); setTimeout(function () { bootEl.remove(); }, 400); }
    if (wantIntro) runIntro(false);
  }, function () {
    if (bootEl) bootEl.innerHTML = '<p class="boot-err">Couldn’t load the site just now. Please refresh in a moment.</p>';
  });
}
boot();
})();
