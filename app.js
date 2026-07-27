/* ============================================================
   ASTRIS — portfolio app (v3)
   Content lives in the GitHub repo (committed by Astris Studio)
   and is rendered client-side with hash routing.
   ============================================================ */
(() => {
"use strict";

const REPO = "penguinator128/Astris";
const BRANCH = "main";
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;
const CACHE_KEY = "astris_content_v3";
const CACHE_TTL = 5 * 60 * 1000;

const NAV = [
  { id: "", label: "Home", key: "nav_home" },
  { id: "films", label: "Films", key: "nav_films" },
  { id: "photography", label: "Photography", key: "nav_photography" },
  { id: "downloads", label: "Downloads", key: "nav_downloads" },
  { id: "news", label: "News", key: "nav_news" },
  { id: "about", label: "About", key: "nav_about" },
  { id: "contact", label: "Contact", key: "nav_contact" }
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
const attr = esc;
const truthy = v => v === true || v === "true";
const enabled = (v) => v !== false && v !== "false";

function fmtDate(d, opts) {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt)) return "";
  return dt.toLocaleDateString("en-AU", opts || { day: "numeric", month: "long", year: "numeric" });
}

/* ---------------- YAML front-matter parser ---------------- */
function parseYAML(src) {
  const out = {};
  const lines = src.replace(/\r/g, "").split("\n");
  let i = 0;
  const unquote = v => {
    v = v.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      return v.slice(1, -1).replace(/\\"/g, '"');
    if (v === "true") return true;
    if (v === "false") return false;
    if (v !== "" && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
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

/* ---------------- markdown ---------------- */
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

/* ---------------- content loading ----------------
   Primary source is content-index.json, built at deploy time and
   served from this site's own domain. That keeps the public site
   off the GitHub API entirely — it allows only 60 requests/hour
   for unauthenticated callers, counted per IP, so relying on it
   meant visitors could hit the cap and get a stale copy (or an
   error) once traffic picked up. It's also one request instead of
   one per content file.

   The GitHub API path is kept purely as a fallback, for the case
   where the index hasn't been generated (e.g. a deploy that
   skipped the build step). */
async function loadContent() {
  try {
    const res = await fetch("content-index.json", { cache: "no-cache" });
    if (res.ok) {
      const raw = await res.json();
      if (raw && raw.photos) {
        writeCache(raw);
        applyContent(raw);
        return;
      }
    }
    console.warn("content-index.json unavailable — falling back to the GitHub API.");
  } catch (e) {
    console.warn("content-index.json fetch failed — falling back to the GitHub API.", e);
  }
  await loadContentFromGitHub();
}

async function loadContentFromGitHub() {
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
      iso: p.iso === 0 ? "" : String(p.iso || ""),
      aperture: p.aperture || "",
      shutter: p.shutter_speed || "",
      focal: p.focal_length || "",
      featured: truthy(p.featured),
      featuredOrder: Number(p.featured_order) || 999,
      download: truthy(p.download) || truthy(p.downloadable)
    };
  }).filter(p => p.image).sort((a, b) => (b.date || 0) - (a.date || 0));

  D.films = (raw.videos || []).map(v => {
    const url = String(v.video_url || "");
    const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
    const vm = url.match(/vimeo\.com\/(\d+)/);
    const date = v.date ? new Date(v.date) : null;
    const validDate = date && !isNaN(date) ? date : null;
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
      year: v.year ? String(v.year) : (validDate ? String(validDate.getFullYear()) : ""),
      date: validDate,
      description: v.description || v.body || "",
      featured: truthy(v.featured),
      featuredOrder: Number(v.featured_order) || 999
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
  buildShell();
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
let heroCleanup = null;

function render() {
  closeFilmModal();
  if (heroCleanup) { heroCleanup(); heroCleanup = null; }
  const app = $("#app");
  const route = parseHash();
  setNavActive(route.page);
  window.scrollTo({ top: 0 });

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
  return `<div class="film-card" data-film="${attr(f.slug)}">
    <div class="film-thumb">
      ${f.thumb
        ? `<img data-lazy src="${attr(f.thumb)}" alt="${attr(f.title)}" loading="lazy" decoding="async">`
        : `<div class="film-thumb-blank"></div>`}
      ${f.type ? `<span class="film-badge">${esc(f.type)}</span>` : ""}
      <span class="play"><span>${iconPlay(20)}</span></span>
    </div>
    <div class="film-row">
      <span class="film-title">${esc(f.title)}</span>
      ${f.year ? `<span class="film-year">${esc(f.year)}</span>` : ""}
    </div>
    ${f.length || f.description ? `<span class="film-meta">${esc(f.length || f.description.slice(0, 80))}</span>` : ""}
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
  const slides = buildHeroSlides();

  const sections = [
    {
      key: "photos",
      order: Number(s.home_photos_order) || 1,
      on: enabled(s.home_photos_enabled),
      html: () => {
        const latest = D.photos.slice(0, 4);
        if (!latest.length) return "";
        return sectionHTML({
          kicker: s.home_latest_photos_kicker || "Stills",
          heading: s.home_latest_photos_heading || "Latest photos",
          link: { href: "#/photography", label: s.home_latest_photos_link || "View gallery" },
          body: `<div class="grid-photos grid-anim">${latest.map(p => photoCard(p)).join("")}</div>`
        });
      }
    },
    {
      key: "films",
      order: Number(s.home_films_order) || 2,
      on: enabled(s.home_films_enabled),
      html: () => {
        const films = D.films.slice(0, 3);
        if (!films.length) return "";
        return sectionHTML({
          kicker: s.home_latest_films_kicker || "Motion",
          heading: s.home_latest_films_heading || "Latest films",
          link: { href: "#/films", label: s.home_latest_films_link || "All films" },
          body: `<div class="grid-films grid-anim">${films.map(f => filmCard(f)).join("")}</div>`
        });
      }
    },
    {
      key: "selected",
      order: Number(s.home_selected_order) || 3,
      on: enabled(s.home_selected_enabled),
      html: () => {
        const selected = D.photos.filter(p => p.featured)
          .sort((a, b) => a.featuredOrder - b.featuredOrder).slice(0, 6);
        if (!selected.length) return "";
        return sectionHTML({
          kicker: s.home_selected_kicker || "Curated",
          heading: s.home_selected_heading || "Selected work",
          intro: s.home_selected_intro,
          body: `<div class="masonry grid-anim">${selected.map(p => photoCard(p, { masonry: true })).join("")}</div>`
        });
      }
    },
    {
      key: "about",
      order: Number(s.home_about_order) || 4,
      on: enabled(s.home_about_enabled),
      html: () => {
        const a = D.about;
        return `<section class="about-band" data-reveal>
          <div style="max-width:52ch">
            <span class="kicker">${esc(a.kicker || "About")}</span>
            <h2 style="margin:10px 0 8px">${esc(a.home_heading || a.heading || "About Astris")}</h2>
            <p class="dim">${esc(a.home_text || a.intro || "")}</p>
          </div>
          <a class="btn btn-primary" href="#/about">Read more</a>
        </section>`;
      }
    },
    {
      key: "news",
      order: Number(s.home_news_order) || 5,
      on: enabled(s.home_news_enabled),
      html: () => {
        const news = D.news.slice(0, 3);
        if (!news.length) return "";
        return sectionHTML({
          kicker: s.home_news_kicker || "Journal",
          heading: s.home_news_heading || "Latest news",
          link: { href: "#/news", label: s.home_news_link || "All news" },
          body: `<div class="grid-news grid-anim">${news.map(n => newsCard(n)).join("")}</div>`
        });
      }
    }
  ];

  const body = sections.filter(x => x.on).sort((a, b) => a.order - b.order)
    .map(x => x.html()).join("");

  app.innerHTML = `<div class="page">${heroHTML(slides)}${body}</div>`;
  initHero(app, slides);
  bindFilmCards(app);
}

function sectionHTML({ kicker, heading, intro, link, body }) {
  return `<section class="section" data-reveal>
    <div class="section-head">
      <div>
        ${kicker ? `<span class="kicker">${esc(kicker)}</span>` : ""}
        <h2>${esc(heading)}</h2>
        ${intro ? `<p class="sub">${esc(intro)}</p>` : ""}
      </div>
      ${link ? `<a class="btn-link" href="${attr(link.href)}">${esc(link.label)} ${iconArrow(15)}</a>` : ""}
    </div>
    ${body}
  </section>`;
}

/* ---------------- HERO ---------------- */
function buildHeroSlides() {
  const s = D.site;
  const mode = String(s.hero_background || "photos").toLowerCase();
  const wantPhotos = mode !== "videos" && mode !== "video";
  const wantVideos = mode === "videos" || mode === "video" || mode === "both";
  const slides = [];

  if (s.hero_video) {
    slides.push({
      kind: "video", src: s.hero_video, poster: "",
      title: s.hero_showreel_title || "Showreel",
      href: "#/films", film: null
    });
  }
  if (wantPhotos) {
    D.photos.filter(p => p.featured)
      .sort((a, b) => a.featuredOrder - b.featuredOrder)
      .slice(0, 5)
      .forEach(p => slides.push({
        kind: "photo", src: p.image,
        title: p.title || p.caption, href: "#/photo/" + p.slug
      }));
  }
  if (wantVideos) {
    D.films.filter(f => f.featured)
      .sort((a, b) => a.featuredOrder - b.featuredOrder)
      .slice(0, 5)
      .forEach(f => slides.push({
        kind: f.file ? "video" : "photo",
        src: f.file || f.thumb,
        poster: f.thumb,
        title: f.title, href: "#/films", film: f
      }));
  }
  return slides.filter(x => x.src).slice(0, 8);
}

function heroHTML(slides) {
  const s = D.site;
  const title = s.hero_title || s.brand || "Astris";
  const sub = s.hero_subtitle || "";
  const many = slides.length > 1;

  const slideMedia = sl => sl.kind === "video"
    ? `<video class="hero-video" src="${attr(sl.src)}" ${sl.poster ? `poster="${attr(sl.poster)}"` : ""} muted loop playsinline preload="metadata"></video>`
    : `<img src="${attr(sl.src)}" alt="" draggable="false">`;
  const slideHTML = sl => `<div class="hero-slide">${slideMedia(sl)}</div>`;

  const track = !slides.length
    ? `<div class="hero-slide hero-slide-empty"></div>`
    : many
      ? [slides[slides.length - 1], ...slides, slides[0]].map(slideHTML).join("")
      : slideHTML(slides[0]);

  return `<section class="hero ${slides.length ? "" : "hero-bare"}" id="hero">
    <div class="hero-track no-anim" id="heroTrack">${track}</div>
    <div class="hero-veil"></div>

    <div class="hero-center">
      <h1 class="hero-wordmark">${esc(title)}</h1>
      ${sub ? `<p class="hero-sub">${esc(sub)}</p>` : ""}
    </div>

    ${slides.length ? `<div class="hero-card" id="heroCard">
      <div class="hero-card-text">
        <span class="hero-card-label">Featured project</span>
        <span class="hero-card-title" id="heroCardTitle"></span>
      </div>
      <a class="btn btn-primary hero-card-cta" id="heroCardCta" href="#">${esc(s.hero_cta_label || "View Project")}</a>
    </div>` : ""}

    ${many ? `
      <button class="hero-arrow prev" id="heroPrev" aria-label="Previous slide">${iconChevL(20)}</button>
      <button class="hero-arrow next" id="heroNext" aria-label="Next slide">${iconChevR(20)}</button>
      <div class="hero-dots" id="heroDots">${slides.map((_, i) =>
        `<button class="hero-dot" data-i="${i}" aria-label="Go to slide ${i + 1}"></button>`).join("")}</div>` : ""}
  </section>`;
}

function initHero(root, slides) {
  const hero = $("#hero", root);
  if (!hero || !slides.length) return;
  const track = $("#heroTrack", hero);
  const card = $("#heroCard", hero);
  const cardTitle = $("#heroCardTitle", hero);
  const cardCta = $("#heroCardCta", hero);
  const n = slides.length;
  const s = D.site;
  const dest = String(s.hero_cta_destination || "auto").toLowerCase();
  const autoplay = enabled(s.hero_autoplay);
  const interval = Math.max(3, Number(s.hero_interval) || 6) * 1000;
  hero.style.setProperty("--hero-interval", interval + "ms");

  const slideEls = $$(".hero-slide", track);
  let idx = n > 1 ? 1 : 0;
  let timer = null;
  let animating = false;

  const realIndex = () => n > 1 ? ((idx - 1) % n + n) % n : 0;

  const playCurrentVideo = () => {
    slideEls.forEach(el => {
      const v = $("video", el);
      if (!v) return;
      if (el.classList.contains("current")) { v.play().catch(() => {}); }
      else { v.pause(); }
    });
  };

  const updateCard = () => {
    const sl = slides[realIndex()];
    if (!sl || !card) return;
    card.classList.remove("in");
    // force reflow so the entrance animation replays on every slide change
    void card.offsetWidth;
    cardTitle.textContent = sl.title || "";
    cardCta.setAttribute("href", dest === "auto" || !dest ? (sl.href || "#") : "#/" + dest.replace(/^#\/?/, ""));
    cardCta.onclick = e => {
      if (sl.film && (sl.film.yt || sl.film.vimeo || sl.film.file) && (dest === "auto" || !dest)) {
        e.preventDefault();
        openFilmModal(sl.film);
      }
    };
    card.classList.add("in");
  };

  const markCurrent = () => {
    slideEls.forEach((el, i) => el.classList.toggle("current", i === idx));
    $$(".hero-dot", hero).forEach(d => d.classList.toggle("active", Number(d.dataset.i) === realIndex()));
    updateCard();
    playCurrentVideo();
  };
  const setX = animate => {
    track.classList.toggle("no-anim", !animate);
    track.style.transform = `translate3d(${-idx * 100}%,0,0)`;
  };

  setX(false);
  requestAnimationFrame(() => requestAnimationFrame(markCurrent));

  if (n === 1) { heroCleanup = () => {}; return; }

  const goTo = target => {
    if (animating) return;
    animating = true;
    idx = target;
    setX(true);
    markCurrent();
  };
  const onTransEnd = e => {
    if (e.target !== track) return;
    animating = false;
    if (idx === 0) { idx = n; setX(false); markCurrent(); }
    else if (idx === n + 1) { idx = 1; setX(false); markCurrent(); }
  };
  track.addEventListener("transitionend", onTransEnd);

  const next = () => goTo(idx + 1);
  const prev = () => goTo(idx - 1);
  $("#heroNext", hero).addEventListener("click", () => { next(); restart(); });
  $("#heroPrev", hero).addEventListener("click", () => { prev(); restart(); });
  $$(".hero-dot", hero).forEach(d => d.addEventListener("click", () => { goTo(Number(d.dataset.i) + 1); restart(); }));

  const start = () => {
    if (!autoplay || timer) return;
    hero.classList.add("autoplaying");
    timer = setInterval(next, interval);
  };
  const stop = () => { hero.classList.remove("autoplaying"); clearInterval(timer); timer = null; };
  const restart = () => { stop(); start(); };
  hero.addEventListener("mouseenter", stop);
  hero.addEventListener("mouseleave", start);
  const onVis = () => document.hidden ? stop() : start();
  document.addEventListener("visibilitychange", onVis);
  start();

  /* drag / swipe */
  let dragStart = null, dragDX = 0;
  const width = () => hero.clientWidth || 1;
  track.addEventListener("pointerdown", e => {
    if (animating || e.target.closest("a, button")) return;
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
    if (Math.abs(dragDX) > 6) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  /* trackpad horizontal swipe */
  let wheelAcc = 0, wheelLock = false;
  const lockWheel = () => { wheelAcc = 0; wheelLock = true; setTimeout(() => { wheelLock = false; }, 750); };
  const onWheel = e => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    if (wheelLock) return;
    wheelAcc += e.deltaX;
    if (wheelAcc > 70) { next(); restart(); lockWheel(); }
    else if (wheelAcc < -70) { prev(); restart(); lockWheel(); }
  };
  hero.addEventListener("wheel", onWheel, { passive: false });

  heroCleanup = () => {
    stop();
    document.removeEventListener("visibilitychange", onVis);
  };
}

/* ---------------- PHOTOGRAPHY ---------------- */
const galleryState = { series: "All", tags: [], sort: "new", camera: "All" };

function renderPhotography(app, params) {
  if (params.get("series")) galleryState.series = params.get("series");
  if (params.get("tag")) galleryState.tags = [params.get("tag")];
  const s = D.site;
  const seriesNames = D.series.map(x => x.title);
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
        ${["All", ...seriesNames].map(x => `<button class="chip" data-series="${attr(x)}">${esc(x)}</button>`).join("")}
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
        <button class="btn-link" id="clearFilters" style="margin-left:6px">Clear</button>
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
  $("#clearFilters", app).addEventListener("click", () => {
    galleryState.series = "All"; galleryState.tags = []; galleryState.camera = "All"; galleryState.sort = "new";
    syncChips(); applyFilters();
  });

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
          <span style="font-family:var(--font-head);font-size:11px;letter-spacing:.26em;text-transform:uppercase;color:var(--text-faint)">Dominant colours</span>
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
  }).catch(() => {});
  img.complete ? runPalette() : img.addEventListener("load", runPalette);
}

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
        ${list.map(p => `<div class="dl-item">
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
  else media = `<div class="modal-empty">No video source set</div>`;

  const meta = [f.type, f.year, f.length].filter(Boolean).join(" · ");
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
  const links = (Array.isArray(a.links) ? a.links : []).filter(x => x && x.url);
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
        <div style="margin-top:34px;display:flex;gap:12px;flex-wrap:wrap">
          <a class="btn btn-primary" href="${attr(a.button_url || "#/contact")}">${esc(a.button_label || "Get in touch")}</a>
          ${links.map(l => `<a class="btn btn-ghost" href="${attr(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join("")}
        </div>
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
      ${c.location || c.availability ? `<div class="contact-extra">
        ${c.location ? `<div><span class="k">Based in</span><span class="v">${esc(c.location)}</span></div>` : ""}
        ${c.availability ? `<div><span class="k">Availability</span><span class="v">${esc(c.availability)}</span></div>` : ""}
      </div>` : ""}
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

/* ---------------- shell ---------------- */
function buildShell() {
  const s = D.site;
  const navLinks = NAV.map(n =>
    `<a href="#/${n.id}" data-page="${n.id}">${esc(s[n.key] || n.label)}</a>`).join("");
  $("#navLinks").innerHTML = navLinks;
  $("#footerLinks").innerHTML = navLinks;
  $("#mobileLinks").innerHTML = navLinks;
  $("#footerNote").textContent = s.footer_text || "© Astris";
  $$(".brand span").forEach(el => { el.textContent = s.brand || "ASTRIS"; });
  setNavActive(parseHash().page);
}

function bindShellOnce() {
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
  bindShellOnce();
  buildShell();
  render();
  loadContent();
});

})();
