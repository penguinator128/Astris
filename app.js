/* ============================================================
   ASTRIS — portfolio app (v2)
   Content is loaded from the GitHub repo (committed by the CMS
   at /admin) and rendered client-side with hash routing.
   ============================================================ */
(() => {
"use strict";

const REPO = "penguinator128/Astris";
const BRANCH = "main";
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;
const CACHE_KEY = "astris_content_v2";
const CACHE_TTL = 5 * 60 * 1000;

const NAV = [
  { id: "", label: "Home" },
  { id: "films", label: "Films" },
  { id: "photography", label: "Photography" },
  { id: "downloads", label: "Downloads" },
  { id: "news", label: "News" },
  { id: "about", label: "About" },
  { id: "contact", label: "Contact" }
];

const D = {
  photos: [], films: [], news: [], series: [],
  site: {}, about: {}, contact: {},
  ready: false, error: null
};

/* ---------------- utilities ---------------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const attr = s => esc(s);

function fmtDate(d, opts) {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt)) return "";
  return dt.toLocaleDateString("en-AU", opts || { day: "numeric", month: "long", year: "numeric" });
}

/* ---------------- tiny YAML front-matter parser ----------------
   Handles the subset Decap CMS and the Studio admin emit:
   scalars, quoted strings, booleans, numbers, block lists
   (scalar items and small objects), inline [a, b] lists and
   folded/literal block scalars (>-, |). */
function parseYAML(src) {
  const out = {};
  const lines = src.replace(/\r/g, "").split("\n");
  let i = 0;
  const unquote = v => {
    v = v.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      return v.slice(1, -1);
    if (v === "true") return true;
    if (v === "false") return false;
    if (v !== "" && !isNaN(v) && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    return v;
  };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) { i++; continue; }
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) { i++; continue; }
    const key = m[1];
    let val = m[2];

    if (val === "" || val == null) {
      // possible block list / nested structure
      const items = [];
      let j = i + 1;
      while (j < lines.length) {
        const l = lines[j];
        if (!l.trim()) { j++; continue; }
        const im = l.match(/^\s+-\s*(.*)$/);
        if (!im) break;
        const rest = im[1];
        const om = rest.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (om) {
          // object item: collect following indented key: value lines
          const obj = {}; obj[om[1]] = unquote(om[2]);
          const baseIndent = l.match(/^\s*/)[0].length;
          j++;
          while (j < lines.length) {
            const l2 = lines[j];
            if (!l2.trim()) { j++; continue; }
            const ind = l2.match(/^\s*/)[0].length;
            const km = l2.match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
            if (!km || ind <= baseIndent || /^\s+-/.test(l2)) break;
            obj[km[1]] = unquote(km[2]);
            j++;
          }
          items.push(obj);
        } else {
          items.push(unquote(rest));
          j++;
        }
      }
      if (items.length) { out[key] = items; i = j; continue; }
      out[key] = "";
      i++;
      continue;
    }

    if (/^[>|]/.test(val)) {
      // folded / literal block scalar
      const buf = [];
      let j = i + 1;
      while (j < lines.length) {
        const l = lines[j];
        if (l.trim() && !/^\s/.test(l)) break;
        buf.push(l.replace(/^\s{2}/, ""));
        j++;
      }
      out[key] = buf.join(val.startsWith("|") ? "\n" : " ").trim();
      i = j;
      continue;
    }

    if (val.startsWith("[") && val.endsWith("]")) {
      out[key] = val.slice(1, -1).split(",").map(s => unquote(s)).filter(s => s !== "");
      i++;
      continue;
    }

    out[key] = unquote(val);
    i++;
  }
  return out;
}

function parseFrontMatter(text) {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { data: parseYAML(text), body: "" };
  const data = parseYAML(m[1]);
  data.body = (m[2] || "").trim();
  return { data, body: data.body };
}

/* ---------------- tiny markdown renderer ---------------- */
function md(src) {
  if (!src) return "";
  const blocks = String(src).replace(/\r/g, "").split(/\n{2,}/);
  const inline = s => esc(s)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
  return blocks.map(b => {
    const t = b.trim();
    if (!t) return "";
    if (/^###\s/.test(t)) return `<h4>${inline(t.replace(/^###\s+/, ""))}</h4>`;
    if (/^##\s/.test(t)) return `<h3>${inline(t.replace(/^##\s+/, ""))}</h3>`;
    if (/^#\s/.test(t)) return `<h2>${inline(t.replace(/^#\s+/, ""))}</h2>`;
    if (/^>\s?/.test(t)) return `<blockquote>${inline(t.replace(/^>\s?/gm, ""))}</blockquote>`;
    if (/^[-*]\s/.test(t)) return `<ul>${t.split(/\n/).map(l => `<li>${inline(l.replace(/^[-*]\s+/, ""))}</li>`).join("")}</ul>`;
    if (/^\d+\.\s/.test(t)) return `<ol>${t.split(/\n/).map(l => `<li>${inline(l.replace(/^\d+\.\s+/, ""))}</li>`).join("")}</ol>`;
    return `<p>${inline(t).replace(/\n/g, "<br>")}</p>`;
  }).join("\n");
}

/* ---------------- content loading ---------------- */
async function loadContent() {
  const cached = readCache();
  if (cached) { applyContent(cached); return; }
  try {
    const treeRes = await fetch(`https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`);
    if (!treeRes.ok) throw new Error("GitHub tree request failed: " + treeRes.status);
    const tree = (await treeRes.json()).tree || [];
    const wanted = tree.filter(n =>
      n.type === "blob" &&
      /^content\/(photos|videos|news|series|settings)\/.+\.(md|yml|yaml)$/i.test(n.path));
    const files = await Promise.all(wanted.map(async n => {
      const txt = await fetch(RAW + n.path).then(r => r.ok ? r.text() : "");
      return { path: n.path, text: txt };
    }));
    const raw = { photos: [], videos: [], news: [], series: [], settings: {} };
    for (const f of files) {
      if (!f.text) continue;
      const folder = f.path.split("/")[1];
      const name = f.path.split("/").pop().replace(/\.(md|yml|yaml)$/i, "");
      const { data } = parseFrontMatter(f.text);
      data._slug = name;
      if (folder === "settings") raw.settings[name] = data;
      else if (raw[folder]) raw[folder].push(data);
    }
    writeCache(raw);
    applyContent(raw);
  } catch (e) {
    console.error("Content load failed", e);
    const stale = readCache(true);
    if (stale) applyContent(stale);
    else { D.error = e; D.ready = true; render(); }
  }
}

function readCache(ignoreTTL) {
  try {
    const c = JSON.parse(sessionStorage.getItem(CACHE_KEY));
    if (c && c.data && (ignoreTTL || Date.now() - c.t < CACHE_TTL)) return c.data;
  } catch (e) { /* ignore */ }
  return null;
}
function writeCache(data) {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), data })); } catch (e) { /* ignore */ }
}

function listify(v) {
  if (Array.isArray(v)) return v.filter(Boolean).map(String);
  if (v == null || v === "") return [];
  return [String(v)];
}

function applyContent(raw) {
  D.site = raw.settings.site || {};
  D.about = raw.settings.about || {};
  D.contact = raw.settings.contact || {};

  D.series = (raw.series || [])
    .map(s => ({ title: s.title || s._slug, order: Number(s.order) || 999, description: s.description || "" }))
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

  D.photos = (raw.photos || []).map(p => {
    const date = p.date ? new Date(p.date) : null;
    return {
      slug: p._slug,
      title: p.title || "",
      image: p.image || "",
      caption: p.caption || "",
      description: p.description || "",
      story: p.story || "",
      series: listify(p.series).length ? listify(p.series) : listify(p.project),
      tags: listify(p.tags),
      date: date && !isNaN(date) ? date : null,
      camera: p.camera || "",
      lens: p.lens || "",
      iso: p.iso || "",
      aperture: p.aperture || "",
      shutter: p.shutter_speed || "",
      focal: p.focal_length || "",
      featured: p.featured === true,
      featuredOrder: Number(p.featured_order) || 999,
      download: p.download === true || p.downloadable === true
    };
  }).filter(p => p.image).sort((a, b) => (b.date || 0) - (a.date || 0));

  D.films = (raw.videos || []).map(v => {
    const url = v.video_url || "";
    const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
    const vm = url.match(/vimeo\.com\/(\d+)/);
    return {
      slug: v._slug,
      title: v.title || "",
      file: v.video || "",
      url,
      yt: yt ? yt[1] : null,
      vimeo: vm ? vm[1] : null,
      thumb: v.thumbnail || (yt ? `https://i.ytimg.com/vi/${yt[1]}/hqdefault.jpg` : ""),
      length: v.length || "",
      type: v.type || "",
      date: v.date ? new Date(v.date) : null,
      description: v.description || v.body || ""
    };
  }).sort((a, b) => (b.date || 0) - (a.date || 0));

  D.news = (raw.news || []).map(n => ({
    slug: n._slug,
    title: n.title || "",
    date: n.date ? new Date(n.date) : null,
    summary: n.summary || (n.body || "").replace(/[#>*_]/g, "").slice(0, 150),
    image: n.image || "",
    body: n.body || ""
  })).sort((a, b) => (b.date || 0) - (a.date || 0));

  D.ready = true;
  D.error = null;
  render();
}

/* ---------------- routing ---------------- */
function parseHash() {
  const h = location.hash.replace(/^#\/?/, "");
  const [pathPart, queryPart] = h.split("?");
  const segs = pathPart.split("/").filter(Boolean);
  const params = new URLSearchParams(queryPart || "");
  return { page: segs[0] || "", arg: segs.slice(1).join("/"), params };
}

function go(hash) { location.hash = hash; }

let filmModalEl = null;

function render() {
  closeFilmModal();
  const app = $("#app");
  const route = parseHash();
  setNavActive(route.page);
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });

  if (!D.ready) { app.innerHTML = loaderHTML(); return; }
  if (D.error && !D.photos.length) {
    app.innerHTML = `<div class="loader"><span>Couldn't load content — please refresh.</span></div>`;
    return;
  }

  switch (route.page) {
    case "": renderHome(app); break;
    case "films": renderFilms(app); break;
    case "photography": renderPhotography(app, route.params); break;
    case "downloads": renderDownloads(app); break;
    case "news": route.arg ? renderArticle(app, route.arg) : renderNews(app); break;
    case "photo": renderPhotoPage(app, route.arg); break;
    case "about": renderAbout(app); break;
    case "contact": renderContact(app); break;
    default: renderHome(app);
  }
  bindImages(app);
  bindReveal(app);
}

function setNavActive(page) {
  $$(".site-nav a, .mobile-menu a").forEach(a => {
    a.classList.toggle("active", (a.dataset.page || "") === page);
  });
}

function loaderHTML() {
  return `<div class="loader">
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="12" r="9"></circle><path d="M12 3v4M12 17v4M3 12h4M17 12h4"></path></svg>
    <span>Astris</span></div>`;
}

/* ---------------- shared partials ---------------- */
function photoCard(p, opts = {}) {
  const meta = [p.series[0], fmtDate(p.date, { month: "short", year: "numeric" })].filter(Boolean).join(" · ");
  return `<a class="ph-card" href="#/photo/${attr(p.slug)}" ${opts.masonry ? "" : 'style="--ratio:4/5"'}>
    <img data-lazy src="${attr(p.image)}" alt="${attr(p.title || p.caption)}" loading="lazy" decoding="async">
    <div class="ph-overlay">
      <span class="ph-title">${esc(p.title || p.caption)}</span>
      <span class="ph-meta">${esc(meta)}</span>
    </div>
    ${p.download ? `<span class="dl-badge" title="Free download available">${iconDownload(14)}</span>` : ""}
  </a>`;
}

function filmCard(f) {
  const meta = [f.date ? f.date.getFullYear() : "", f.length].filter(Boolean).join(" · ");
  return `<div class="film-card" data-film="${attr(f.slug)}">
    <div class="film-thumb">
      ${f.thumb
        ? `<img data-lazy src="${attr(f.thumb)}" alt="${attr(f.title)}" loading="lazy" decoding="async">`
        : `<div style="position:absolute;inset:0;background:linear-gradient(135deg,var(--surface) 0%,var(--surface-2) 100%)"></div>`}
      <span class="play"><span>${iconPlay(20)}</span></span>
    </div>
    ${f.type ? `<span class="film-kicker">${esc(f.type)}</span>` : ""}
    <span class="film-title">${esc(f.title)}</span>
    ${meta ? `<span class="film-meta">${esc(meta)}</span>` : ""}
  </div>`;
}

function newsCard(n) {
  return `<a class="news-card" href="#/news/${attr(n.slug)}">
    ${n.image ? `<div class="news-thumb"><img data-lazy src="${attr(n.image)}" alt="" loading="lazy" decoding="async"></div>` : ""}
    <span class="news-date">${esc(fmtDate(n.date))}</span>
    <span class="news-title">${esc(n.title)}</span>
    <p class="news-summary">${esc(n.summary)}</p>
    <span class="btn-link">Read more ${iconArrow(14)}</span>
  </a>`;
}

const iconArrow = s => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>`;
const iconPlay = s => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>`;
const iconDownload = s => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 4v11M6 11l6 6 6-6M5 20h14"></path></svg>`;
const iconChevL = s => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M15 18l-6-6 6-6"></path></svg>`;
const iconChevR = s => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 6l6 6-6 6"></path></svg>`;

/* ---------------- HOME ---------------- */
function renderHome(app) {
  const s = D.site;
  const featured = D.photos.filter(p => p.featured).sort((a, b) => a.featuredOrder - b.featuredOrder).slice(0, 5);
  const latest = D.photos.slice(0, 4);
  const films = D.films.slice(0, 3);
  const selected = D.photos.filter(p => p.featured).sort((a, b) => a.featuredOrder - b.featuredOrder).slice(0, 6);
  const news = D.news.slice(0, 3);
  const about = D.about;

  app.innerHTML = `<div class="page">
    ${heroHTML(featured)}

    <section class="section" data-reveal>
      <div class="section-head">
        <div><span class="kicker">Stills</span><h2>${esc(s.home_latest_photos_heading || "Latest photos")}</h2></div>
        <a class="btn-link" href="#/photography">${esc(s.home_latest_photos_link || "View gallery")} ${iconArrow(15)}</a>
      </div>
      ${latest.length
        ? `<div class="grid-photos grid-anim">${latest.map(p => photoCard(p)).join("")}</div>`
        : `<p class="empty-note">Photos are coming soon.</p>`}
    </section>

    ${films.length ? `<section class="section" data-reveal>
      <div class="section-head">
        <div><span class="kicker">Motion</span><h2>${esc(s.home_latest_films_heading || "Latest films")}</h2></div>
        <a class="btn-link" href="#/films">${esc(s.home_latest_films_link || "All films")} ${iconArrow(15)}</a>
      </div>
      <div class="grid-films grid-anim">${films.map(f => filmCard(f)).join("")}</div>
    </section>` : ""}

    ${selected.length ? `<section class="section" data-reveal>
      <div class="section-head">
        <div><span class="kicker">Curated</span><h2>${esc(s.home_selected_heading || "Selected work")}</h2>
        <p class="sub">${esc(s.home_selected_intro || "")}</p></div>
      </div>
      <div class="masonry grid-anim">${selected.map(p => photoCard(p, { masonry: true })).join("")}</div>
    </section>` : ""}

    <section class="about-band" data-reveal>
      <div style="max-width:52ch">
        <span class="kicker">${esc(about.kicker || "About")}</span>
        <h2 style="margin:10px 0 8px">${esc(about.home_heading || about.heading || "About Astris")}</h2>
        <p class="dim">${esc(about.home_text || about.intro || "")}</p>
      </div>
      <a class="btn btn-primary" href="#/about">${esc(about.button_label || "Read more")}</a>
    </section>

    ${news.length ? `<section class="section" data-reveal style="padding-top:0">
      <div class="section-head">
        <div><span class="kicker">Journal</span><h2>${esc(s.home_news_heading || "Latest news")}</h2></div>
        <a class="btn-link" href="#/news">${esc(s.home_news_link || "All news")} ${iconArrow(15)}</a>
      </div>
      <div class="grid-news grid-anim">${news.map(n => newsCard(n)).join("")}</div>
    </section>` : ""}
  </div>`;

  initHero(app, featured);
  bindFilmCards(app);
}

/* ---------------- HERO BANNER ---------------- */
function heroHTML(slides) {
  if (!slides.length) {
    return `<section class="hero" style="display:flex;align-items:center;justify-content:center">
      <div class="hero-copy" style="position:relative;inset:auto">
        <span class="kicker">${esc(D.site.tagline || "Photography & Film")}</span>
        <h1 class="hero-title" style="color:var(--text)">${esc(D.site.brand || "ASTRIS")}</h1>
      </div></section>`;
  }
  const slideHTML = p => `<div class="hero-slide">
    <img src="${attr(p.image)}" alt="${attr(p.title)}" draggable="false">
    <div class="hero-copy">
      <span class="hero-kicker">${esc(p.series[0] || "Featured")}</span>
      <h1 class="hero-title">${esc(p.title || p.caption)}</h1>
      <a class="btn btn-primary hero-cta" href="#/photo/${attr(p.slug)}">${esc(D.site.hero_cta_label || "View photo")}</a>
    </div>
  </div>`;
  const many = slides.length > 1;
  const track = many
    ? [slides[slides.length - 1], ...slides, slides[0]].map(slideHTML).join("")
    : slideHTML(slides[0]);
  return `<section class="hero" id="hero">
    <div class="hero-track no-anim" id="heroTrack">${track}</div>
    ${many ? `
      <button class="hero-arrow prev" id="heroPrev" aria-label="Previous slide">${iconChevL(20)}</button>
      <button class="hero-arrow next" id="heroNext" aria-label="Next slide">${iconChevR(20)}</button>
      <div class="hero-dots" id="heroDots">${slides.map((_, i) =>
        `<button class="hero-dot" data-i="${i}" aria-label="Go to slide ${i + 1}"></button>`).join("")}</div>` : ""}
  </section>`;
}

function initHero(root, slides) {
  const hero = $("#hero", root);
  if (!hero || slides.length === 0) return;
  const track = $("#heroTrack", hero);
  const n = slides.length;
  const autoplay = D.site.hero_autoplay !== false;
  const interval = Math.max(3, Number(D.site.hero_interval) || 6) * 1000;
  hero.style.setProperty("--hero-interval", interval + "ms");

  let idx = 1;             // position in track incl. clones
  let timer = null;
  let animating = false;

  const slideEls = $$(".hero-slide", track);
  const markCurrent = () => {
    slideEls.forEach((el, i) => el.classList.toggle("current", i === idx));
    const real = ((idx - 1) % n + n) % n;
    $$(".hero-dot", hero).forEach(d => d.classList.toggle("active", Number(d.dataset.i) === real));
  };
  const setX = (animate) => {
    track.classList.toggle("no-anim", !animate);
    track.style.transform = `translate3d(${-idx * 100}%,0,0)`;
  };

  if (n === 1) { slideEls[0].classList.add("current"); return; }

  setX(false);
  requestAnimationFrame(() => requestAnimationFrame(markCurrent));

  const goTo = (target) => {
    if (animating) return;
    animating = true;
    idx = target;
    setX(true);
    markCurrent();
  };
  track.addEventListener("transitionend", e => {
    if (e.target !== track) return;
    animating = false;
    if (idx === 0) { idx = n; setX(false); markCurrent(); }
    else if (idx === n + 1) { idx = 1; setX(false); markCurrent(); }
  });

  const next = () => goTo(idx + 1);
  const prev = () => goTo(idx - 1);
  $("#heroNext", hero).addEventListener("click", () => { next(); restart(); });
  $("#heroPrev", hero).addEventListener("click", () => { prev(); restart(); });
  $$(".hero-dot", hero).forEach(d => d.addEventListener("click", () => {
    goTo(Number(d.dataset.i) + 1); restart();
  }));

  // autoplay
  const start = () => {
    if (!autoplay || timer) return;
    hero.classList.add("autoplaying");
    timer = setInterval(next, interval);
  };
  const stop = () => { hero.classList.remove("autoplaying"); clearInterval(timer); timer = null; };
  const restart = () => { stop(); start(); };
  hero.addEventListener("mouseenter", stop);
  hero.addEventListener("mouseleave", start);
  document.addEventListener("visibilitychange", () => document.hidden ? stop() : start());
  start();

  // pointer drag / touch swipe
  let dragStart = null, dragDX = 0;
  const width = () => hero.clientWidth || 1;
  track.addEventListener("pointerdown", e => {
    if (animating) return;
    if (e.target.closest("a, button")) return;
    dragStart = e.clientX; dragDX = 0;
    hero.classList.add("dragging");
    track.setPointerCapture(e.pointerId);
    stop();
  });
  track.addEventListener("pointermove", e => {
    if (dragStart == null) return;
    dragDX = e.clientX - dragStart;
    track.style.transform = `translate3d(calc(${-idx * 100}% + ${dragDX}px),0,0)`;
  });
  const endDrag = () => {
    if (dragStart == null) return;
    hero.classList.remove("dragging");
    const t = width() * 0.14;
    if (dragDX < -t) goTo(idx + 1);
    else if (dragDX > t) goTo(idx - 1);
    else setX(true);
    dragStart = null; dragDX = 0;
    start();
  };
  track.addEventListener("pointerup", endDrag);
  track.addEventListener("pointercancel", endDrag);
  track.addEventListener("click", e => {
    // suppress accidental navigation after a drag
    if (Math.abs(dragDX) > 6) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // trackpad horizontal swipe
  let wheelAcc = 0, wheelLock = false;
  hero.addEventListener("wheel", e => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    if (wheelLock) return;
    wheelAcc += e.deltaX;
    if (wheelAcc > 70) { next(); restart(); lockWheel(); }
    else if (wheelAcc < -70) { prev(); restart(); lockWheel(); }
  }, { passive: false });
  const lockWheel = () => { wheelAcc = 0; wheelLock = true; setTimeout(() => { wheelLock = false; }, 750); };
}

/* ---------------- PHOTOGRAPHY ---------------- */
const galleryState = { series: "All", tags: [], sort: "new", camera: "All" };

function renderPhotography(app, params) {
  if (params.get("series")) galleryState.series = params.get("series");
  if (params.get("tag")) galleryState.tags = [params.get("tag")];
  const s = D.site;
  const seriesNames = D.series.map(x => x.title);
  // include any series referenced by photos but missing a series file
  D.photos.forEach(p => p.series.forEach(x => { if (x && !seriesNames.includes(x)) seriesNames.push(x); }));
  const allTags = [...new Set(D.photos.flatMap(p => p.tags))].sort((a, b) => a.localeCompare(b));
  const allCameras = [...new Set(D.photos.map(p => p.camera).filter(Boolean))].sort();

  app.innerHTML = `<div class="page">
    <div class="page-head">
      <span class="kicker">${esc(s.photography_kicker || "Photography")}</span>
      <h1>${esc(s.photography_heading || "The gallery")}</h1>
      <p>${esc(s.photography_intro || "")}</p>
    </div>
    <div class="filter-bar">
      <div class="chip-row" id="seriesRow">
        <span class="row-label">Series</span>
        ${["All", ...seriesNames].map(x =>
          `<button class="chip" data-series="${attr(x)}">${esc(x)}</button>`).join("")}
      </div>
      ${allTags.length ? `<div class="chip-row" id="tagRow">
        <span class="row-label">Tags</span>
        ${allTags.map(t => `<button class="chip chip-sm" data-tag="${attr(t)}">${esc(t)}</button>`).join("")}
      </div>` : ""}
      <div class="chip-row">
        <span class="row-label">Sort</span>
        <select class="select" id="sortSel">
          <option value="new">Newest first</option>
          <option value="old">Oldest first</option>
        </select>
        ${allCameras.length ? `<select class="select" id="cameraSel">
          <option value="All">All cameras</option>
          ${allCameras.map(c => `<option value="${attr(c)}">${esc(c)}</option>`).join("")}
        </select>` : ""}
      </div>
    </div>
    <section class="section" style="padding-top:0">
      <div class="masonry grid-anim" id="galleryGrid"></div>
      <p class="empty-note" id="galleryEmpty" hidden>No photos match those filters yet.</p>
    </section>
  </div>`;

  const syncChips = () => {
    $$("#seriesRow .chip", app).forEach(c => c.classList.toggle("active", c.dataset.series === galleryState.series));
    $$("#tagRow .chip", app).forEach(c => c.classList.toggle("active", galleryState.tags.includes(c.dataset.tag)));
    const ss = $("#sortSel", app); if (ss) ss.value = galleryState.sort;
    const cs = $("#cameraSel", app); if (cs) cs.value = galleryState.camera;
  };

  const applyFilters = () => {
    let list = D.photos.slice();
    if (galleryState.series !== "All") list = list.filter(p => p.series.includes(galleryState.series));
    if (galleryState.tags.length) list = list.filter(p => galleryState.tags.every(t => p.tags.includes(t)));
    if (galleryState.camera !== "All") list = list.filter(p => p.camera === galleryState.camera);
    list.sort((a, b) => galleryState.sort === "old" ? (a.date || 0) - (b.date || 0) : (b.date || 0) - (a.date || 0));
    const grid = $("#galleryGrid", app);
    grid.innerHTML = list.map(p => photoCard(p, { masonry: true })).join("");
    grid.classList.remove("grid-anim"); void grid.offsetWidth; grid.classList.add("grid-anim");
    $("#galleryEmpty", app).hidden = list.length > 0;
    bindImages(grid);
  };

  $$("#seriesRow .chip", app).forEach(c => c.addEventListener("click", () => {
    galleryState.series = c.dataset.series; syncChips(); applyFilters();
  }));
  $$("#tagRow .chip", app).forEach(c => c.addEventListener("click", () => {
    const t = c.dataset.tag;
    galleryState.tags = galleryState.tags.includes(t)
      ? galleryState.tags.filter(x => x !== t) : [...galleryState.tags, t];
    syncChips(); applyFilters();
  }));
  const ss = $("#sortSel", app); if (ss) ss.addEventListener("change", () => { galleryState.sort = ss.value; applyFilters(); });
  const cs = $("#cameraSel", app); if (cs) cs.addEventListener("change", () => { galleryState.camera = cs.value; applyFilters(); });

  syncChips();
  applyFilters();
}

/* ---------------- PHOTO DETAIL ---------------- */
function renderPhotoPage(app, slug) {
  const p = D.photos.find(x => x.slug === slug);
  if (!p) { app.innerHTML = `<div class="loader"><span>Photo not found.</span></div>`; return; }
  const ordered = D.photos;
  const i = ordered.indexOf(p);
  const prev = ordered[i - 1], next = ordered[i + 1];

  const related = D.photos
    .filter(x => x !== p)
    .map(x => ({ x, score: x.series.filter(s => p.series.includes(s)).length * 2 + x.tags.filter(t => p.tags.includes(t)).length }))
    .sort((a, b) => b.score - a.score || (b.x.date || 0) - (a.x.date || 0))
    .slice(0, 4).filter(r => r.score > 0).map(r => r.x);

  const specs = [
    ["Date taken", fmtDate(p.date)],
    ["Camera", p.camera], ["Lens", p.lens],
    ["ISO", p.iso], ["Shutter speed", p.shutter],
    ["Aperture", p.aperture], ["Focal length", p.focal]
  ].filter(([, v]) => v);

  app.innerHTML = `<div class="photo-page">
    <div class="back-bar">
      <button class="btn-link" id="backBtn">${iconChevL(15)} Back</button>
      ${p.download ? `<a class="btn btn-primary" href="${attr(p.image)}" download>${iconDownload(15)} Download</a>` : ""}
    </div>
    <div class="photo-stage">
      ${prev ? `<button class="photo-nav-btn prev" id="pPrev" aria-label="Previous photo">${iconChevL(18)}</button>` : ""}
      <img id="detailImg" src="${attr(p.image)}" alt="${attr(p.title)}" crossorigin="anonymous">
      ${next ? `<button class="photo-nav-btn next" id="pNext" aria-label="Next photo">${iconChevR(18)}</button>` : ""}
    </div>
    <div class="photo-info">
      <div data-reveal>
        <span class="kicker">${esc(p.series[0] || "Photograph")}</span>
        <h1 style="margin:10px 0 12px">${esc(p.title || p.caption)}</h1>
        ${p.caption && p.title ? `<p class="dim" style="font-style:italic;margin-bottom:14px">${esc(p.caption)}</p>` : ""}
        ${p.description ? `<p style="font-size:16px;line-height:1.75">${esc(p.description)}</p>` : ""}
        ${p.story ? `<p class="story">${esc(p.story)}</p>` : ""}
        <div class="chip-row" style="margin-top:26px">
          ${p.series.map(sr => `<a class="chip-static" href="#/photography?series=${encodeURIComponent(sr)}">${esc(sr)}</a>`).join("")}
          ${p.tags.map(t => `<a class="chip-static" href="#/photography?tag=${encodeURIComponent(t)}" style="opacity:.75">#${esc(t)}</a>`).join("")}
        </div>
      </div>
      <div data-reveal>
        ${specs.length ? `<div class="spec-table">
          ${specs.map(([k, v]) => `<div class="spec-cell"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join("")}
        </div>` : ""}
        <div id="paletteWrap" hidden style="margin-top:22px">
          <span class="row-label" style="font-family:var(--font-head);font-size:11px;letter-spacing:.26em;text-transform:uppercase;color:var(--text-faint)">Dominant colours</span>
          <div class="palette-row" id="paletteRow"></div>
        </div>
      </div>
    </div>
    ${related.length ? `<section class="section" style="padding-top:0" data-reveal>
      <div class="section-head"><div><span class="kicker">More like this</span><h2>Related photos</h2></div></div>
      <div class="grid-photos grid-anim">${related.map(r => photoCard(r)).join("")}</div>
    </section>` : ""}
  </div>`;

  $("#backBtn", app).addEventListener("click", () => {
    history.length > 1 ? history.back() : go("#/photography");
  });
  if (prev) $("#pPrev", app).addEventListener("click", () => go("#/photo/" + prev.slug));
  if (next) $("#pNext", app).addEventListener("click", () => go("#/photo/" + next.slug));

  const img = $("#detailImg", app);
  const runPalette = () => extractPalette(img).then(colors => {
    if (!colors.length) return;
    $("#paletteWrap", app).hidden = false;
    $("#paletteRow", app).innerHTML = colors.map((c, ci) =>
      `<span class="palette-dot" title="${attr(c)}" style="background:${attr(c)};animation-delay:${ci * 90}ms"></span>`).join("");
  }).catch(() => { /* palette is a nice-to-have */ });
  img.complete ? runPalette() : img.addEventListener("load", runPalette);
}

/* dominant colour extraction via canvas sampling */
async function extractPalette(img, count = 5) {
  const c = document.createElement("canvas");
  const w = 72, h = Math.max(1, Math.round(72 * img.naturalHeight / (img.naturalWidth || 1)));
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const buckets = new Map();
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 200) continue;
    const key = ((px[i] >> 4) << 8) | ((px[i + 1] >> 4) << 4) | (px[i + 2] >> 4);
    const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += px[i]; b.g += px[i + 1]; b.b += px[i + 2];
    buckets.set(key, b);
  }
  const sorted = [...buckets.values()].sort((a, b) => b.n - a.n)
    .map(b => [Math.round(b.r / b.n), Math.round(b.g / b.n), Math.round(b.b / b.n)]);
  const picked = [];
  for (const rgb of sorted) {
    if (picked.every(p => Math.abs(p[0] - rgb[0]) + Math.abs(p[1] - rgb[1]) + Math.abs(p[2] - rgb[2]) > 72))
      picked.push(rgb);
    if (picked.length >= count) break;
  }
  return picked.map(([r, g, b]) => "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join(""));
}

/* ---------------- DOWNLOADS ---------------- */
function renderDownloads(app) {
  const s = D.site;
  const list = D.photos.filter(p => p.download);
  app.innerHTML = `<div class="page">
    <div class="page-head">
      <span class="kicker">${esc(s.downloads_kicker || "Free to use")}</span>
      <h1>${esc(s.downloads_heading || "Downloads")}</h1>
      <p>${esc(s.downloads_intro || "")}</p>
    </div>
    <section class="section" style="padding-top:16px">
      ${list.length ? `<div class="grid-photos grid-anim">
        ${list.map(p => `<div style="display:flex;flex-direction:column;gap:10px">
          ${photoCard(p)}
          <a class="btn btn-ghost" style="width:100%" href="${attr(p.image)}" download>${iconDownload(15)} Download</a>
        </div>`).join("")}
      </div>` : `<p class="empty-note">No downloadable photos yet — check back soon.</p>`}
    </section>
  </div>`;
}

/* ---------------- FILMS ---------------- */
function renderFilms(app) {
  const s = D.site;
  const types = [...new Set(D.films.map(f => f.type).filter(Boolean))];
  app.innerHTML = `<div class="page">
    <div class="page-head">
      <span class="kicker">${esc(s.films_kicker || "Filmography")}</span>
      <h1>${esc(s.films_heading || "Films")}</h1>
      <p>${esc(s.films_intro || "")}</p>
    </div>
    ${types.length > 1 ? `<div class="filter-bar"><div class="chip-row" id="filmTypeRow">
      ${["All", ...types].map(t => `<button class="chip ${t === "All" ? "active" : ""}" data-type="${attr(t)}">${esc(t)}</button>`).join("")}
    </div></div>` : ""}
    <section class="section" style="padding-top:0">
      ${D.films.length
        ? `<div class="grid-films grid-anim" id="filmGrid">${D.films.map(f => filmCard(f)).join("")}</div>`
        : `<p class="empty-note">Films are coming soon.</p>`}
    </section>
  </div>`;

  $$("#filmTypeRow .chip", app).forEach(c => c.addEventListener("click", () => {
    $$("#filmTypeRow .chip", app).forEach(x => x.classList.remove("active"));
    c.classList.add("active");
    const t = c.dataset.type;
    const list = t === "All" ? D.films : D.films.filter(f => f.type === t);
    const grid = $("#filmGrid", app);
    grid.innerHTML = list.map(f => filmCard(f)).join("");
    grid.classList.remove("grid-anim"); void grid.offsetWidth; grid.classList.add("grid-anim");
    bindImages(grid); bindFilmCards(grid);
  }));
  bindFilmCards(app);
}

function bindFilmCards(root) {
  $$("[data-film]", root).forEach(card => card.addEventListener("click", () => {
    const f = D.films.find(x => x.slug === card.dataset.film);
    if (f) openFilmModal(f);
  }));
}

function openFilmModal(f) {
  closeFilmModal();
  let media;
  if (f.yt) media = `<iframe src="https://www.youtube-nocookie.com/embed/${attr(f.yt)}?autoplay=1&rel=0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
  else if (f.vimeo) media = `<iframe src="https://player.vimeo.com/video/${attr(f.vimeo)}?autoplay=1" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
  else if (f.file) media = `<video src="${attr(f.file)}" controls autoplay playsinline></video>`;
  else media = `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--text-faint)">No video source set</div>`;

  const meta = [f.type, f.date ? f.date.getFullYear() : "", f.length].filter(Boolean).join(" · ");
  filmModalEl = document.createElement("div");
  filmModalEl.className = "modal-backdrop";
  filmModalEl.innerHTML = `
    <button class="modal-close" aria-label="Close">✕</button>
    <div class="modal-box">
      <div class="modal-frame">${media}</div>
      <div class="modal-caption">
        <div><span class="film-title" style="font-size:24px">${esc(f.title)}</span>
        ${meta ? `<div class="film-meta" style="margin-top:4px">${esc(meta)}</div>` : ""}</div>
        ${f.description ? `<p class="dim" style="max-width:60ch;font-size:14px">${esc(f.description)}</p>` : ""}
      </div>
    </div>`;
  filmModalEl.addEventListener("click", e => {
    if (e.target === filmModalEl || e.target.closest(".modal-close")) closeFilmModal();
  });
  document.body.appendChild(filmModalEl);
  document.body.style.overflow = "hidden";
}
function closeFilmModal() {
  if (filmModalEl) { filmModalEl.remove(); filmModalEl = null; document.body.style.overflow = ""; }
}

/* ---------------- NEWS ---------------- */
function renderNews(app) {
  const s = D.site;
  app.innerHTML = `<div class="page">
    <div class="page-head">
      <span class="kicker">${esc(s.news_kicker || "Journal")}</span>
      <h1>${esc(s.news_heading || "News")}</h1>
      <p>${esc(s.news_intro || "")}</p>
    </div>
    <section class="section" style="padding-top:16px">
      ${D.news.length
        ? `<div class="grid-news grid-anim">${D.news.map(n => newsCard(n)).join("")}</div>`
        : `<p class="empty-note">No news yet — check back soon.</p>`}
    </section>
  </div>`;
}

function renderArticle(app, slug) {
  const n = D.news.find(x => x.slug === slug);
  if (!n) { renderNews(app); return; }
  app.innerHTML = `<div class="page"><article class="article">
    <button class="btn-link" id="backBtn" style="margin-bottom:26px">${iconChevL(15)} All news</button>
    <span class="news-date">${esc(fmtDate(n.date))}</span>
    <h1 style="margin:10px 0 0">${esc(n.title)}</h1>
    ${n.image ? `<div class="lede-img"><img src="${attr(n.image)}" alt=""></div>` : ""}
    <div class="article-body">${md(n.body)}</div>
  </article></div>`;
  $("#backBtn", app).addEventListener("click", () => go("#/news"));
}

/* ---------------- ABOUT ---------------- */
function renderAbout(app) {
  const a = D.about;
  app.innerHTML = `<div class="page">
    <div class="page-head">
      <span class="kicker">${esc(a.kicker || "About")}</span>
      <h1>${esc(a.heading || "About")}</h1>
      <p>${esc(a.intro || "")}</p>
    </div>
    <div class="about-grid">
      ${a.image ? `<div class="about-photo" data-reveal><img src="${attr(a.image)}" alt="Portrait"></div>` : "<div></div>"}
      <div data-reveal>
        <div class="article-body" style="font-size:17px">${md(a.body || "")}</div>
        ${listify(a.capabilities).length ? `<div class="chip-row" style="margin-top:30px">
          ${listify(a.capabilities).map(c => `<span class="chip-static">${esc(c)}</span>`).join("")}
        </div>` : ""}
        <div style="margin-top:34px"><a class="btn btn-primary" href="#/contact">Get in touch</a></div>
      </div>
    </div>
  </div>`;
}

/* ---------------- CONTACT ---------------- */
function renderContact(app) {
  const c = D.contact;
  const socials = (Array.isArray(c.socials) ? c.socials : []).filter(x => x && x.url);
  app.innerHTML = `<div class="page">
    <div class="contact-wrap">
      <span class="kicker">${esc(c.kicker || "Contact")}</span>
      <h1 style="margin:12px 0 16px">${esc(c.heading || "Let's talk.")}</h1>
      <p class="dim" style="max-width:52ch;font-size:16.5px;margin-bottom:44px">${esc(c.intro || "")}</p>
      ${c.email ? `<a class="contact-email" href="mailto:${attr(c.email)}">${esc(c.email)}</a>` : ""}
      ${c.email_note ? `<p class="dim" style="margin-top:18px;font-size:13.5px">${esc(c.email_note)}</p>` : ""}
      ${socials.length ? `<div class="social-row">
        ${socials.map(sx => `<a class="chip" href="${attr(sx.url)}" target="_blank" rel="noopener">${esc(sx.label)}</a>`).join("")}
      </div>` : ""}
    </div>
  </div>`;
}

/* ---------------- image + reveal binding ---------------- */
function bindImages(root) {
  $$("img[data-lazy]", root).forEach(img => {
    const done = () => img.classList.add("loaded");
    img.complete && img.naturalWidth ? done() : img.addEventListener("load", done, { once: true });
    img.addEventListener("error", done, { once: true });
  });
}

let revealObserver = null;
function bindReveal(root) {
  if (!("IntersectionObserver" in window)) {
    $$("[data-reveal]", root).forEach(el => el.classList.add("in"));
    return;
  }
  if (!revealObserver) {
    revealObserver = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (en.isIntersecting) { en.target.classList.add("in"); revealObserver.unobserve(en.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
  }
  $$("[data-reveal]", root).forEach(el => revealObserver.observe(el));
}

/* ---------------- shell (nav + footer) ---------------- */
function buildShell() {
  const navLinks = mode => NAV.map(n =>
    `<a href="#/${n.id}" data-page="${n.id}">${n.label}</a>`).join("");

  $("#navLinks").innerHTML = navLinks();
  $("#footerLinks").innerHTML = navLinks();
  $("#mobileLinks").innerHTML = navLinks();
  $("#footerNote").textContent = D.site.footer_text || "© Astris";

  const menu = $("#mobileMenu");
  $("#navToggle").addEventListener("click", () => menu.classList.add("open"));
  $("#navClose").addEventListener("click", () => menu.classList.remove("open"));
  menu.addEventListener("click", e => { if (e.target.tagName === "A") menu.classList.remove("open"); });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { closeFilmModal(); menu.classList.remove("open"); }
  });
}

/* ---------------- boot ---------------- */
window.addEventListener("hashchange", render);
document.addEventListener("DOMContentLoaded", () => {
  buildShell();
  render();
  loadContent().then(() => {
    $("#footerNote").textContent = D.site.footer_text || "© Astris";
  });
});

})();
