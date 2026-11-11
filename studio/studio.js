/* ============================================================
   ASTRIS STUDIO: the control centre for the whole website.
   A separate website from the public one. It reads and writes content
   directly in the GitHub repository; Vercel redeploys the public site
   on every commit.
   ============================================================ */
(() => {
"use strict";

const REPO = "penguinator128/Astris";
const BRANCH = "main";
const API = "https://api.github.com";
const TOKEN_KEY = "astris_studio_token";
const SITE_KEY = "astris_studio_site_url";
const DEFAULT_SITE = "https://astrisfinal.vercel.app";
const siteUrl = () => String(localStorage.getItem(SITE_KEY) || DEFAULT_SITE).replace(/\/+$/, "");
const SITE_URL = { toString: () => siteUrl() };   /* used inside template strings as ${SITE_URL} */

const FILM_TYPES = ["Short", "Documentary", "Experimental", "Narrative", "Commercial", "Music Video",
                    "Behind the Scenes", "Travel", "Other"];
const STAGES = ["Idea", "Writing", "Shooting", "Editing", "Finishing"];

const S = {
  token: localStorage.getItem(TOKEN_KEY) || "",
  view: "dashboard",
  photos: [], films: [], news: [], series: [],
  site: {}, about: {}, contact: {},
  imagePaths: new Set(), slugs: {},
  batch: [], sel: new Set(), dirty: new Set(),
  loaded: false, user: null, drawer: null
};

const PATHS = {
  site: "content/settings/site.yml",
  about: "content/settings/about.yml",
  contact: "content/settings/contact.yml"
};

/* ---------------- helpers ---------------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const truthy = v => v === true || v === "true";
const enabledV = v => v !== false && v !== "false";
const splitCSV = v => String(v || "").split(",").map(x => x.trim()).filter(Boolean);
const arr = v => Array.isArray(v) ? v.filter(x => x !== "" && x != null) : (v ? [v] : []);

function slugify(s) {
  return String(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "untitled";
}
function uniqueSlug(base, taken) {
  let s = base, n = 2;
  while (taken.has(s)) s = `${base}-${n++}`;
  return s;
}
function localDT(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ---------------- pictures: the Studio is its own website, so pictures are fetched from GitHub ---------------- */
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;
const ON_VERCEL = !/^(localhost|127\.|\[::1\])/.test(location.hostname) && location.protocol !== "file:";
const isAbs = p => /^(https?:|data:|blob:)/i.test(p || "");
const rawUrl = p => !p ? "" : isAbs(p) ? p : RAW + String(p).replace(/^\/+/, "");
/* w must be one of 96, 160, 256, 640, 1024, 1600 (see vercel.json) */
function imgSrc(p, w) {
  const u = rawUrl(p);
  if (!u || !w || !ON_VERCEL || /^(data:|blob:)/.test(u) || !/\.(jpe?g|png|webp)(\?|$)/i.test(u)) return u;
  return "/_vercel/image?url=" + encodeURIComponent(u) + "&w=" + w + "&q=70";
}
document.addEventListener("error", e => {
  const t = e.target;
  if (t && t.tagName === "IMG" && /\/_vercel\/image/.test(t.src) && !t.dataset.fb) {
    t.dataset.fb = "1";
    try { t.src = new URL(t.src, location.href).searchParams.get("url"); } catch (x) { /* ignore */ }
  }
}, true);
const logoSVG = (h) => `<svg viewBox="0 0 1900 1600" height="${h}" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path d="${(window.ASTRIS_BRAND || {}).logo || ""}"/></svg>`;

/* ---------------- GitHub ---------------- */
async function gh(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      "Authorization": "Bearer " + S.token,
      "Accept": opts.raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(opts.headers || {})
    }
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`GitHub ${res.status}: ${t.slice(0, 180)}`);
  }
  return opts.raw ? res.text() : res.json();
}

/* Commit a set of file changes as one commit (chunked for very large batches). */
async function commitFiles(message, changes, onProgress) {
  if (!changes.length) return;
  const chunks = [];
  let cur = [], curSize = 0;
  for (const ch of changes) {
    const size = ch.base64 ? ch.base64.length : (ch.content || "").length;
    if (cur.length && curSize + size > 36 * 1024 * 1024) { chunks.push(cur); cur = []; curSize = 0; }
    cur.push(ch); curSize += size;
  }
  if (cur.length) chunks.push(cur);

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    const suffix = chunks.length > 1 ? ` (${ci + 1}/${chunks.length})` : "";
    const ref = await gh(`/repos/${REPO}/git/ref/heads/${BRANCH}`);
    const headSha = ref.object.sha;
    const headCommit = await gh(`/repos/${REPO}/git/commits/${headSha}`);
    const treeEntries = [];
    let done = 0;
    for (const ch of chunk) {
      if (ch.del) {
        treeEntries.push({ path: ch.path, mode: "100644", type: "blob", sha: null });
      } else {
        const blob = await gh(`/repos/${REPO}/git/blobs`, {
          method: "POST",
          body: JSON.stringify(ch.base64
            ? { content: ch.base64, encoding: "base64" }
            : { content: ch.content, encoding: "utf-8" })
        });
        treeEntries.push({ path: ch.path, mode: "100644", type: "blob", sha: blob.sha });
      }
      done++;
      if (onProgress) onProgress(ci, chunks.length, done, chunk.length);
    }
    const tree = await gh(`/repos/${REPO}/git/trees`, {
      method: "POST", body: JSON.stringify({ base_tree: headCommit.tree.sha, tree: treeEntries })
    });
    const commit = await gh(`/repos/${REPO}/git/commits`, {
      method: "POST", body: JSON.stringify({ message: message + suffix, tree: tree.sha, parents: [headSha] })
    });
    await gh(`/repos/${REPO}/git/refs/heads/${BRANCH}`, {
      method: "PATCH", body: JSON.stringify({ sha: commit.sha })
    });
  }
}

/* ---------------- YAML ---------------- */
function parseYAML(src) {
  const out = {}; const lines = String(src).replace(/\r/g, "").split("\n"); let i = 0;
  const unq = v => {
    v = v.trim();
    if (v.startsWith('"') && v.endsWith('"') && v.length > 1)
      return v.slice(1, -1).replace(/\\(["\\nrt])/g, (m, c) => ({ '"': '"', "\\": "\\", n: "\n", r: "\r", t: "\t" }[c]));
    if (v.startsWith("'") && v.endsWith("'") && v.length > 1) return v.slice(1, -1).replace(/''/g, "'");
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
    const key = m[1]; const val = m[2];
    if (val === "") {
      const items = []; let j = i + 1;
      while (j < lines.length) {
        const l = lines[j];
        if (!l.trim()) { j++; continue; }
        const im = l.match(/^\s+-\s*(.*)$/);
        if (!im) break;
        const om = im[1].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (om) {
          const obj = {}; obj[om[1]] = unq(om[2]);
          const bi = l.match(/^\s*/)[0].length; j++;
          while (j < lines.length) {
            const l2 = lines[j]; if (!l2.trim()) { j++; continue; }
            const km = l2.match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
            if (!km || l2.match(/^\s*/)[0].length <= bi || /^\s+-/.test(l2)) break;
            obj[km[1]] = unq(km[2]); j++;
          }
          items.push(obj);
        } else { items.push(unq(im[1])); j++; }
      }
      if (items.length) { out[key] = items; i = j; continue; }
      out[key] = ""; i++; continue;
    }
    if (/^[>|]/.test(val)) {
      const buf = []; let j = i + 1;
      while (j < lines.length) { const l = lines[j]; if (l.trim() && !/^\s/.test(l)) break; buf.push(l.replace(/^\s{2}/, "")); j++; }
      out[key] = buf.join(val.startsWith("|") ? "\n" : " ").trim(); i = j; continue;
    }
    if (val.startsWith("[") && val.endsWith("]")) {
      out[key] = val.slice(1, -1).split(",").map(unq).filter(x => x !== ""); i++; continue;
    }
    out[key] = unq(val); i++;
  }
  return out;
}
function parseFM(text) {
  const m = String(text).match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  const data = parseYAML(m ? m[1] : text);
  data.body = m ? (m[2] || "").trim() : "";
  return data;
}
function yq(v) {
  if (v === true || v === false) return String(v);
  if (typeof v === "number") return String(v);
  const s = String(v == null ? "" : v);
  if (s === "") return '""';
  if (/^[A-Za-z][A-Za-z0-9 _./()&+'-]*$/.test(s) && !/^(true|false|null|yes|no|on|off)$/i.test(s)) return s;
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n").replace(/\t/g, "\\t") + '"';
}
function objToYAML(obj) {
  return Object.entries(obj).filter(([k]) => k !== "body" && k !== "_slug" && k !== "path")
    .map(([k, v]) => {
      if (Array.isArray(v)) {
        if (!v.length) return `${k}: []`;
        if (typeof v[0] === "object" && v[0] !== null) {
          return `${k}:\n` + v.map(o => Object.entries(o)
            .map(([k2, v2], i) => (i ? "    " : "  - ") + `${k2}: ${yq(v2)}`).join("\n")).join("\n");
        }
        return `${k}:\n` + v.map(x => `  - ${yq(x)}`).join("\n");
      }
      if (typeof v === "string" && v.includes("\n")) {
        return `${k}: |-\n` + v.split("\n").map(l => "  " + l).join("\n");
      }
      return `${k}: ${yq(v)}`;
    }).join("\n") + "\n";
}
function listYAML(key, a) {
  const c = arr(a);
  if (!c.length) return `${key}: []\n`;
  return `${key}:\n` + c.map(x => `  - ${yq(x)}`).join("\n") + "\n";
}

function photoToMD(p) {
  return "---\n" +
    `title: ${yq(p.title)}\nimage: ${yq(p.image)}\ncaption: ${yq(p.caption)}\n` +
    `description: ${yq(p.description)}\nstory: ${yq(p.story)}\n` +
    listYAML("series", p.series) + listYAML("tags", p.tags) +
    `date: ${yq(p.date)}\ncamera: ${yq(p.camera)}\nlens: ${yq(p.lens)}\niso: ${yq(p.iso)}\n` +
    `aperture: ${yq(p.aperture)}\nshutter_speed: ${yq(p.shutter)}\nfocal_length: ${yq(p.focal)}\n` +
    `featured: ${p.featured === true}\nfeatured_order: ${Number(p.featuredOrder) || 999}\n` +
    `download: ${p.download === true}\n---\n`;
}
function filmToMD(f) {
  return "---\n" +
    `title: ${yq(f.title)}\nvideo_url: ${yq(f.video_url)}\nvideo: ${yq(f.video)}\n` +
    `thumbnail: ${yq(f.thumbnail)}\ntype: ${yq(f.type)}\nyear: ${yq(f.year)}\nlength: ${yq(f.length)}\n` +
    `date: ${yq(f.date)}\ndescription: ${yq(f.description)}\n` +
    `status: ${yq(f.status === "in-progress" ? "in-progress" : "finished")}\nstage: ${yq(f.stage || "")}\nprogress: ${Math.max(0, Math.min(100, Number(f.progress) || 0))}\n` +
    `update: ${yq(f.update || "")}\nupdate_date: ${yq(f.update_date || "")}\nrole: ${yq(f.role || "")}\ncredits: ${yq(f.credits || "")}\n` +
    listYAML("gallery", f.gallery) +
    `featured: ${f.featured === true}\nfeatured_order: ${Number(f.featuredOrder) || 999}\n---\n`;
}
function newsToMD(n) {
  return "---\n" +
    `title: ${yq(n.title)}\ndate: ${yq(n.date)}\nsummary: ${yq(n.summary)}\nimage: ${yq(n.image)}\n` +
    listYAML("tags", n.tags) + listYAML("gallery", n.gallery) + "---\n" +
    (n.body || "") + "\n";
}
function seriesToMD(s) {
  return `---\ntitle: ${yq(s.title)}\norder: ${Number(s.order) || 999}\ndescription: ${yq(s.description || "")}\n---\n`;
}

/* ---------------- data load ---------------- */
async function loadAll() {
  S.user = await gh("/user");
  const tree = (await gh(`/repos/${REPO}/git/trees/${BRANCH}?recursive=1`)).tree || [];
  S.imagePaths = new Set(tree.filter(n => n.path.startsWith("images/uploads/")).map(n => n.path));
  const raw = p => gh(`/repos/${REPO}/contents/${p.split("/").map(encodeURIComponent).join("/")}?ref=${BRANCH}`, { raw: true });
  const pick = re => tree.filter(n => re.test(n.path));

  S.photos = (await Promise.all(pick(/^content\/photos\/.+\.md$/).map(async n => {
    const d = parseFM(await raw(n.path));
    return {
      path: n.path, slug: n.path.split("/").pop().replace(/\.md$/, ""),
      title: d.title || "", image: d.image || "", caption: d.caption || "",
      description: d.description || "", story: d.story || "",
      series: arr(d.series).length ? arr(d.series) : arr(d.project),
      tags: arr(d.tags),
      date: d.date || "", camera: d.camera || "", lens: d.lens || "",
      iso: d.iso === 0 ? "" : String(d.iso || ""), aperture: d.aperture || "",
      shutter: d.shutter_speed || "", focal: d.focal_length || "",
      featured: truthy(d.featured), featuredOrder: Number(d.featured_order) || 999,
      download: truthy(d.download) || truthy(d.downloadable)
    };
  }))).sort((a, b) => String(b.date).localeCompare(String(a.date)));

  S.films = (await Promise.all(pick(/^content\/videos\/.+\.(md|yml)$/).map(async n => {
    const d = parseFM(await raw(n.path));
    return {
      path: n.path, slug: n.path.split("/").pop().replace(/\.(md|yml)$/, ""),
      title: d.title || "", video_url: d.video_url || "", video: d.video || "",
      thumbnail: d.thumbnail || "", type: d.type || "", length: d.length || "",
      year: d.year ? String(d.year) : (d.date ? String(new Date(d.date).getFullYear() || "") : ""),
      date: d.date || "", description: d.description || d.body || "",
      status: /progress|wip|making|production/i.test(String(d.status || "")) ? "in-progress" : "finished",
      stage: d.stage || "", progress: Math.max(0, Math.min(100, Number(d.progress) || 0)),
      update: d.update || "", update_date: d.update_date || "", role: d.role || "", credits: d.credits || "",
      gallery: arr(d.gallery),
      featured: truthy(d.featured), featuredOrder: Number(d.featured_order) || 999
    };
  }))).sort((a, b) => String(b.date).localeCompare(String(a.date)));

  S.news = (await Promise.all(pick(/^content\/news\/.+\.md$/).map(async n => {
    const d = parseFM(await raw(n.path));
    return {
      path: n.path, slug: n.path.split("/").pop().replace(/\.md$/, ""),
      title: d.title || "", date: d.date || "", summary: d.summary || "",
      image: d.image || "", body: d.body || "", tags: arr(d.tags), gallery: arr(d.gallery)
    };
  }))).sort((a, b) => String(b.date).localeCompare(String(a.date)));

  S.series = (await Promise.all(pick(/^content\/series\/.+\.md$/).map(async n => {
    const d = parseFM(await raw(n.path));
    return { path: n.path, title: d.title || "", order: Number(d.order) || 999, description: d.description || "" };
  }))).sort((a, b) => a.order - b.order);

  for (const [k, p] of Object.entries(PATHS)) {
    try { S[k] = parseYAML(await raw(p)); } catch (e) { S[k] = {}; }
  }
  S.slugs = {
    photos: new Set(S.photos.map(p => p.slug)),
    films: new Set(S.films.map(f => f.slug)),
    news: new Set(S.news.map(n => n.slug))
  };
  S.loaded = true;
}

/* ---------------- UI chrome ---------------- */
function toast(msg, kind) {
  const t = document.createElement("div");
  t.className = "toast " + (kind || "");
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4600);
}
let overlayEl = null;
function showProgress(title) {
  overlayEl = document.createElement("div");
  overlayEl.className = "overlay";
  overlayEl.innerHTML = `<div class="box"><h2 style="font-size:21px">${esc(title)}</h2>
    <p class="muted" id="progText" style="margin:9px 0 0">Starting…</p>
    <div class="progress"><i id="progBar" style="width:3%"></i></div></div>`;
  document.body.appendChild(overlayEl);
}
function setProgress(frac, text) {
  if (!overlayEl) return;
  $("#progBar", overlayEl).style.width = Math.max(3, Math.round(frac * 100)) + "%";
  if (text) $("#progText", overlayEl).textContent = text;
}
function hideProgress() { if (overlayEl) { overlayEl.remove(); overlayEl = null; } }

function readBase64(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(",")[1]);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}
/* Turn a picked File into a repo path + pending change (committed by the caller). */
async function stageMedia(file, changes) {
  const ext = (file.name.match(/\.[a-z0-9]+$/i) || [""])[0].toLowerCase() || "";
  let path = "images/uploads/" + slugify(file.name.replace(/\.[^.]+$/, "")) + ext;
  let n = 2;
  while (S.imagePaths.has(path)) path = `images/uploads/${slugify(file.name.replace(/\.[^.]+$/, ""))}-${n++}${ext}`;
  S.imagePaths.add(path);
  changes.push({ path, base64: await readBase64(file) });
  return "/" + path;
}

async function reload() {
  S.loaded = false; render();
  await loadAll();
  render();
}

/* ---------------- field rendering ---------------- */
function fieldHTML(f, val) {
  const id = "f_" + f.k;
  const cls = f.span === 4 ? "full" : f.span === 2 ? "span2" : "";
  const label = `<label for="${id}">${esc(f.label)}</label>`;
  const help = f.help ? `<span class="help">${esc(f.help)}</span>` : "";
  let control;
  switch (f.type) {
    case "bool":
      return `<div class="field ${cls}"><label>${esc(f.label)}</label>
        <label class="flag"><span class="toggle ${enabledV(val) && val !== "" ? "on" : ""}" data-bool="${f.k}"></span>
        <span data-boollabel="${f.k}">${enabledV(val) && val !== "" ? "On" : "Off"}</span></label>${help}</div>`;
    case "select":
      control = `<select id="${id}" data-k="${f.k}">${f.options.map(o => {
        const [ov, ol] = Array.isArray(o) ? o : [o, o];
        return `<option value="${esc(ov)}" ${String(val) === String(ov) ? "selected" : ""}>${esc(ol)}</option>`;
      }).join("")}</select>`;
      break;
    case "number":
      control = `<input id="${id}" data-k="${f.k}" type="number" value="${esc(val)}" ${f.min != null ? `min="${f.min}"` : ""} ${f.max != null ? `max="${f.max}"` : ""}>`;
      break;
    case "textarea":
      control = `<textarea id="${id}" data-k="${f.k}" rows="${f.rows || 4}">${esc(val)}</textarea>`;
      break;
    case "datetime":
      control = `<input id="${id}" data-k="${f.k}" data-dt="1" type="datetime-local" value="${esc(localDT(val))}">`;
      break;
    case "list":
      control = `<input id="${id}" data-k="${f.k}" data-list="1" value="${esc(arr(val).join(", "))}" placeholder="comma separated">`;
      break;
    case "media":
      return `<div class="field ${cls}"><label>${esc(f.label)}</label>
        <div class="mediapick" data-media="${f.k}" data-accept="${esc(f.accept || "image/*")}">
          ${mediaPreviewHTML(f, val)}
          <div class="acts">
            <div class="name" data-name>${esc(val || "Nothing selected")}</div>
            <div style="display:flex;gap:7px">
              <button type="button" class="btn btn-ghost btn-sm" data-pick>Choose file</button>
              ${val ? `<button type="button" class="btn btn-ghost btn-sm" data-clear>Clear</button>` : ""}
            </div>
          </div>
        </div>${help}</div>`;
    case "gallery":
      return `<div class="field ${cls}"><label>${esc(f.label)}</label>
        <div class="gal" data-gallery="${f.k}">${arr(val).map(p => galItemHTML({ path: p })).join("")}
          <button type="button" class="galadd" data-galadd>+ Add pictures</button></div>${help}</div>`;
    case "pairs":
      return `<div class="field ${cls}"><label>${esc(f.label)}</label>
        <div class="repeater" data-pairs="${f.k}">
          ${(Array.isArray(val) ? val : []).map(row => pairRowHTML(row)).join("")}
          <div><button type="button" class="btn btn-ghost btn-sm" data-addpair>+ Add</button></div>
        </div>${help}</div>`;
    default:
      control = `<input id="${id}" data-k="${f.k}" value="${esc(val == null ? "" : val)}" placeholder="${esc(f.placeholder || "")}">`;
  }
  return `<div class="field ${cls}">${label}${control}${help}</div>`;
}
function mediaPreviewHTML(f, val) {
  if (!val) return `<div class="prev">none</div>`;
  if (/\.(mp4|webm|mov|m4v)$/i.test(val)) return `<video class="prev" src="${esc(rawUrl(val))}" muted></video>`;
  return `<img class="prev" src="${imgSrc(val, 160)}" alt="">`;
}
function galItemHTML(it) {
  return `<div class="galitem" ${it.file ? `data-fi="${it.fi}"` : `data-path="${esc(it.path)}"`}>
    <img src="${it.file ? it.url : imgSrc(it.path, 160)}" alt="">
    <span class="galbtns"><button type="button" class="iconbtn" data-galmv="-1" title="Move left">←</button><button type="button" class="iconbtn" data-galmv="1" title="Move right">→</button><button type="button" class="iconbtn" data-galdel title="Remove">✕</button></span></div>`;
}
function pairRowHTML(row) {
  return `<div class="row"><input data-pk="label" value="${esc(row && row.label || "")}" placeholder="Label">
    <input data-pk="url" value="${esc(row && row.url || "")}" placeholder="https://">
    <button type="button" class="iconbtn" data-delpair>✕</button></div>`;
}

/* Collect values from a rendered field container back into an object. */
function readFields(root, fields, target) {
  const out = { ...target };
  fields.forEach(f => {
    if (f.type === "bool") {
      const t = $(`[data-bool="${f.k}"]`, root);
      if (t) out[f.k] = t.classList.contains("on");
      return;
    }
    if (f.type === "media") {
      const w = $(`[data-media="${f.k}"]`, root);
      if (w) out[f.k] = w.dataset.value != null ? w.dataset.value : (out[f.k] || "");
      return;
    }
    if (f.type === "gallery") {
      const w = $(`[data-gallery="${f.k}"]`, root);
      if (w) out[f.k] = $$(".galitem[data-path]", w).map(x => x.dataset.path);
      return;
    }
    if (f.type === "pairs") {
      const w = $(`[data-pairs="${f.k}"]`, root);
      if (w) out[f.k] = $$(".row", w).map(r => ({
        label: $('[data-pk="label"]', r).value.trim(),
        url: $('[data-pk="url"]', r).value.trim()
      })).filter(x => x.label || x.url);
      return;
    }
    const el = $(`[data-k="${f.k}"]`, root);
    if (!el) return;
    if (f.type === "list") out[f.k] = splitCSV(el.value);
    else if (f.type === "number") out[f.k] = el.value === "" ? "" : Number(el.value);
    else if (f.type === "datetime") out[f.k] = el.value ? new Date(el.value).toISOString() : "";
    else out[f.k] = el.value;
  });
  return out;
}

/* Wire up interactive field widgets (toggles, media pickers, repeaters). */
function bindFields(root) {
  $$("[data-bool]", root).forEach(t => t.addEventListener("click", () => {
    t.classList.toggle("on");
    const lab = $(`[data-boollabel="${t.dataset.bool}"]`, root);
    if (lab) lab.textContent = t.classList.contains("on") ? "On" : "Off";
  }));
  $$("[data-media]", root).forEach(w => {
    const pick = $("[data-pick]", w);
    const clear = $("[data-clear]", w);
    pick.addEventListener("click", () => {
      const inp = document.createElement("input");
      inp.type = "file"; inp.accept = w.dataset.accept;
      inp.addEventListener("change", () => {
        const f = inp.files[0];
        if (!f) return;
        w._file = f;
        w.dataset.value = "";
        const url = URL.createObjectURL(f);
        const prev = $(".prev", w);
        const isVid = /^video\//.test(f.type);
        prev.outerHTML = isVid ? `<video class="prev" src="${url}" muted></video>` : `<img class="prev" src="${url}" alt="">`;
        $("[data-name]", w).textContent = f.name + " (will upload on save)";
      });
      inp.click();
    });
    if (clear) clear.addEventListener("click", () => {
      w._file = null; w.dataset.value = "";
      $(".prev", w).outerHTML = `<div class="prev">none</div>`;
      $("[data-name]", w).textContent = "Nothing selected";
    });
  });
  $$("[data-gallery]", root).forEach(w => {
    w._files = [];
    const wire = () => {
      $$(".galitem", w).forEach(it => {
        $("[data-galdel]", it).onclick = () => it.remove();
        $$("[data-galmv]", it).forEach(b => b.onclick = () => {
          const d = Number(b.dataset.galmv), sib = d < 0 ? it.previousElementSibling : it.nextElementSibling;
          if (!sib || !sib.classList.contains("galitem")) return;
          if (d < 0) w.insertBefore(it, sib); else w.insertBefore(sib, it);
        });
      });
    };
    $("[data-galadd]", w).addEventListener("click", () => {
      const inp = document.createElement("input");
      inp.type = "file"; inp.accept = "image/*"; inp.multiple = true;
      inp.addEventListener("change", () => {
        Array.from(inp.files).forEach(file => {
          const fi = w._files.push(file) - 1;
          $("[data-galadd]", w).insertAdjacentHTML("beforebegin", galItemHTML({ file, fi, url: URL.createObjectURL(file) }));
        });
        wire();
      });
      inp.click();
    });
    wire();
  });
  $$("[data-pairs]", root).forEach(w => {
    const add = $("[data-addpair]", w);
    add.addEventListener("click", () => {
      add.parentElement.insertAdjacentHTML("beforebegin", pairRowHTML({}));
      bindPairDeletes(w);
    });
    bindPairDeletes(w);
  });
}
function bindPairDeletes(w) {
  $$("[data-delpair]", w).forEach(b => {
    b.onclick = () => b.closest(".row").remove();
  });
}
/* Upload any files staged in media pickers, writing their new paths into `values`. */
async function stagePickers(root, values, changes) {
  for (const w of $$("[data-media]", root)) {
    if (w._file) values[w.dataset.media] = await stageMedia(w._file, changes);
  }
  for (const w of $$("[data-gallery]", root)) {
    const list = [];
    for (const it of $$(".galitem", w)) {
      if (it.dataset.path) list.push(it.dataset.path);
      else if (it.dataset.fi != null && w._files[Number(it.dataset.fi)]) list.push(await stageMedia(w._files[Number(it.dataset.fi)], changes));
    }
    values[w.dataset.gallery] = list;
  }
  return values;
}

/* ---------------- app render ---------------- */
function render() {
  const root = $("#root");
  if (!S.token) return renderSetup(root);
  if (!S.loaded) {
    root.innerHTML = `<div class="setup splash">
      ${logoSVG(56)}
      <h1 style="font-size:30px;margin-top:18px">Astris Studio</h1>
      <p class="muted" style="margin-top:10px">Loading your library…</p></div>`;
    return;
  }
  const nav = [
    ["Library", [["dashboard", "Overview", ""], ["batch", "Add photos", ""], ["photos", "Photos", S.photos.length],
                 ["films", "Films", S.films.length], ["news", "News", S.news.length],
                 ["downloads", "Downloads", S.photos.filter(p => p.download).length]]],
    ["Organise", [["series", "Series", S.series.length], ["tags", "Tags", new Set(S.photos.flatMap(p => p.tags)).size],
                  ["featured", "Featured", S.photos.filter(p => p.featured).length + S.films.filter(f => f.featured).length]]],
    ["Look and feel", [["show", "Showreel &amp; intro", ""], ["transitions", "Transitions", ""]]],
    ["Pages", [["home", "Home page", ""], ["pages", "Say hello", ""], ["settings", "Site settings", ""]]]
  ];
  root.innerHTML = `<div class="layout">
    <aside class="side">
      <span class="brand">${logoSVG(22)}<span>ASTRIS<small>STUDIO</small></span></span>
      ${nav.map(([g, items]) => `<div class="group">${g}</div>` + items.map(([id, label, count]) =>
        `<button class="tab ${S.view === id ? "active" : ""}" data-view="${id}">${label}${count !== "" ? `<span class="count">${count}</span>` : ""}</button>`).join("")).join("")}
      <div class="foot">
        <a href="${SITE_URL}/" target="_blank" rel="noopener">View website ↗</a>
        <span>${esc(S.user ? S.user.login : "")}</span>
        <a href="#" id="logout">Sign out</a>
      </div>
    </aside>
    <main class="main" id="view"></main>
  </div>`;
  $$(".tab", root).forEach(b => b.addEventListener("click", () => { S.view = b.dataset.view; render(); window.scrollTo(0, 0); }));
  $("#logout").addEventListener("click", e => {
    e.preventDefault(); localStorage.removeItem(TOKEN_KEY); location.reload();
  });
  const views = { dashboard: vDashboard, photos: vPhotos, batch: vBatch, films: vFilms, news: vNews,
                  downloads: vDownloads, series: vSeries, tags: vTags, featured: vFeatured,
                  show: vShow, transitions: vTransitions,
                  home: vHome, pages: vPages, settings: vSettings };
  (views[S.view] || vDashboard)($("#view"));
}

/* ---------------- setup ---------------- */
function renderSetup(root) {
  root.innerHTML = `<div class="setup">
    <div class="setup-logo">${logoSVG(52)}</div>
    <h1>Astris Studio</h1>
    <p class="muted" style="margin:12px 0 28px;font-size:15px">The control centre for your website: photos, films, news, the showreel, the intro, the page transitions and every setting. It is a separate website from the public one, and it saves straight to your GitHub repository, so it needs a key once on each browser.</p>
    <div class="panel">
      <h2>Connect to GitHub</h2>
      <ol>
        <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Fine-grained personal access tokens</a></li>
        <li>Repository access: <code>Only select repositories</code>, then pick <code>penguinator128/Astris</code></li>
        <li>Permissions: Repository permissions: <code>Contents: Read and write</code></li>
        <li>Generate, copy, and paste it below.</li>
      </ol>
      <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">
        <input id="tokenInput" type="password" placeholder="github_pat_… or ghp_…" style="flex:1;min-width:250px">
        <button class="btn btn-primary" id="tokenSave">Connect</button>
      </div>
      <p class="muted" id="tokenMsg" style="margin-top:11px">Stored only in this browser.</p>
    </div>
    <div class="panel">
      <h2>Your website address</h2>
      <p class="hint">Used for the "View website" links. You can change it any time in Site settings.</p>
      <input id="siteUrlInput" value="${esc(siteUrl())}" style="width:100%">
    </div>
  </div>`;
  $("#tokenSave").addEventListener("click", async () => {
    const t = $("#tokenInput").value.trim();
    if (!t) return;
    $("#tokenMsg").textContent = "Checking the key…";
    S.token = t;
    try {
      await gh(`/repos/${REPO}`);
      localStorage.setItem(TOKEN_KEY, t);
      const u = $("#siteUrlInput").value.trim();
      if (/^https?:\/\//i.test(u)) localStorage.setItem(SITE_KEY, u);
      boot();
    } catch (e) {
      S.token = "";
      $("#tokenMsg").textContent = "That key couldn't reach the repository. Check its permissions. (" + e.message + ")";
    }
  });
}

/* ---------------- dashboard ---------------- */
function vDashboard(v) {
  const recent = S.photos.slice(0, 6);
  const stats = [
    [S.photos.length, "Photos"], [S.films.filter(f => f.status !== "in-progress").length, "Films"],
    [S.films.filter(f => f.status === "in-progress").length, "In progress"], [S.news.length, "News posts"],
    [S.photos.filter(p => p.download).length, "Free downloads"],
    [S.photos.filter(p => p.featured).length + S.films.filter(f => f.featured).length, "Featured"],
    [S.series.length, "Series"]
  ];
  const introOn = enabledV(S.site.intro_enabled);
  const checks = [
    ["Showreel", !!S.site.showreel, S.site.showreel ? "Your showreel is set." : "Upload the one-minute showreel that plays behind every page.", "show"],
    ["Opening", introOn, introOn ? "The quick opening plays once per visit." : "The opening is switched off.", "show"],
    ["Films", S.films.length > 0, S.films.length ? S.films.length + " in the gallery." : "Add your first film. A YouTube link is easiest.", "films"],
    ["Page changes", (S.site.transition_mode || "random") !== "off", "Mode: " + (S.site.transition_mode || "random") + ".", "transitions"]
  ];
  v.innerHTML = `
    <div class="pagehead">
      <div><h1>Overview</h1><div class="sub">Everything on the site, managed from here. Changes go live within about a minute.</div></div>
      <div class="headbtns">
        <a class="btn btn-ghost" href="${SITE_URL}/" target="_blank" rel="noopener">View website ↗</a>
        <button class="btn btn-primary" data-go="batch">+ Add photos</button>
      </div>
    </div>
    <div class="cards">${stats.map(([n, l]) => `<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`).join("")}</div>
    <div class="panel"><h2>Set-up</h2>
      <ul class="checks">${checks.map(([n, ok, msg, go]) => `<li class="${ok ? "ok" : ""}"><i></i><b>${n}</b><span>${esc(msg)}</span><button class="btn btn-ghost btn-sm" data-go="${go}">${ok ? "Change" : "Set up"}</button></li>`).join("")}
        <li id="aiCheck"><i></i><b>AI helper</b><span>Checking…</span></li></ul></div>
    <div class="panel"><h2>Quick actions</h2>
      <div style="display:flex;gap:9px;flex-wrap:wrap">
        ${[["batch", "Add photos"], ["photos", "Edit the photo library"], ["films", "Add or edit films"],
           ["news", "Write a news post"], ["show", "Showreel and intro"], ["transitions", "Choose page transitions"],
           ["featured", "Arrange featured"], ["home", "Home page"], ["pages", "Say hello page"], ["settings", "Site settings"]]
          .map(([g, l]) => `<button class="btn btn-ghost btn-sm" data-go="${g}">${l}</button>`).join("")}
      </div></div>
    <div class="panel panel-flush"><div style="padding:20px 22px 0"><h2>Recent photos</h2></div>
      ${recent.length ? `<table class="grid"><thead><tr><th></th><th>Title</th><th>Date</th><th>Series</th><th>Flags</th></tr></thead><tbody>
        ${recent.map(p => `<tr><td><img class="thumb" src="${imgSrc(p.image, 160)}" loading="lazy" alt=""></td>
          <td>${esc(p.title)}</td><td class="muted">${esc(String(p.date).slice(0, 10))}</td>
          <td>${p.series.map(s => `<span class="pill">${esc(s)}</span>`).join("")}</td>
          <td>${p.featured ? '<span class="pill pill-accent">featured</span>' : ""}${p.download ? '<span class="pill pill-ok">download</span>' : ""}</td>
        </tr>`).join("")}</tbody></table>` : `<p class="muted" style="padding:0 22px 22px">No photos yet. Start with Add photos.</p>`}
    </div>`;
  $$("[data-go]", v).forEach(b => b.addEventListener("click", () => { S.view = b.dataset.go; render(); window.scrollTo(0, 0); }));
  aiReady().then(ok => {
    const li = $("#aiCheck", v); if (!li) return;
    li.className = ok ? "ok" : "";
    $("span", li).textContent = ok ? "Ready. Look for the ✨ buttons next to titles and descriptions."
      : "Not switched on yet. Add ANTHROPIC_API_KEY to this Studio's Vercel project (see the README).";
  });
}

/* ---------------- batch upload ---------------- */
async function filesPicked(files) {
  const imgs = Array.from(files).filter(f => /^image\//.test(f.type));
  if (!imgs.length) return;
  for (const f of imgs) {
    const row = {
      file: f, url: URL.createObjectURL(f), collapsed: S.batch.length > 0,
      title: f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim(),
      caption: "", description: "", story: "", series: [], tags: [],
      date: "", camera: "", lens: "", iso: "", aperture: "", shutter: "", focal: "",
      featured: false, download: false
    };
    S.batch.push(row);
    try {
      const x = await exifr.parse(f, ["Make", "Model", "LensModel", "ISO", "FNumber",
                                      "ExposureTime", "FocalLength", "DateTimeOriginal", "CreateDate"]);
      if (x) {
        row.camera = [x.Make, x.Model].filter(Boolean).join(" ").replace(/^(\S+)\s+\1/i, "$1");
        row.lens = x.LensModel || "";
        row.iso = x.ISO ? String(x.ISO) : "";
        row.aperture = x.FNumber ? "f/" + x.FNumber : "";
        row.shutter = x.ExposureTime ? (x.ExposureTime < 1 ? "1/" + Math.round(1 / x.ExposureTime) + "s" : x.ExposureTime + "s") : "";
        row.focal = x.FocalLength ? Math.round(x.FocalLength) + "mm" : "";
        const d = x.DateTimeOriginal || x.CreateDate;
        if (d instanceof Date && !isNaN(d)) row.date = d.toISOString();
      }
    } catch (e) { /* EXIF is best effort */ }
  }
  render();
}

function vBatch(v) {
  const n = S.batch.length;
  v.innerHTML = `
    <div class="pagehead">
      <div><h1>Batch upload</h1><div class="sub">Drop in as many photos as you like. Metadata is read from each file automatically — edit anything, then publish the whole set with one button.</div></div>
      ${n ? `<div class="headbtns"><button class="btn btn-ghost" id="clearBatch">Clear</button>
        <button class="btn btn-primary" id="pub1">Publish ${n} photo${n > 1 ? "s" : ""}</button></div>` : ""}
    </div>
    <div class="drop" id="drop"><strong>Drop photos here</strong>
      or click to browse — JPEG, PNG, WebP. EXIF is extracted automatically.
      <input id="filePick" type="file" accept="image/*" multiple hidden></div>
    ${n ? `<div class="bulkbar" style="margin-top:18px">
      <strong>Apply to all ${n}</strong>
      <input id="bSeries" list="seriesList" placeholder="Series" style="width:180px">
      <input id="bTags" placeholder="Tags" style="width:180px">
      <label class="flag"><span class="toggle" id="bFeat"></span>Featured</label>
      <label class="flag"><span class="toggle" id="bDl"></span>Download</label>
      <button class="btn btn-ghost btn-sm" id="bApply">Apply</button>
      <button class="btn btn-ghost btn-sm" id="bAI">✨ Suggest titles &amp; descriptions</button>
    </div>` : ""}
    <div id="rows" style="margin-top:16px"></div>
    <datalist id="seriesList">${S.series.map(s => `<option value="${esc(s.title)}">`).join("")}</datalist>
    ${n ? `<button class="btn btn-primary" id="pub2" style="margin-top:10px">Publish ${n} photo${n > 1 ? "s" : ""}</button>` : ""}`;

  const drop = $("#drop", v), pick = $("#filePick", v);
  drop.addEventListener("click", () => pick.click());
  pick.addEventListener("change", () => filesPicked(pick.files));
  ["dragover", "dragenter"].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", ev => filesPicked(ev.dataTransfer.files));

  const rows = $("#rows", v);
  rows.innerHTML = S.batch.map((r, i) => batchRowHTML(r, i)).join("");
  S.batch.forEach((r, i) => bindBatchRow(rows, r, i));

  ["#pub1", "#pub2"].forEach(sel => { const b = $(sel, v); if (b) b.addEventListener("click", publishBatch); });
  const c = $("#clearBatch", v); if (c) c.addEventListener("click", () => { S.batch = []; render(); });
  const bf = $("#bFeat", v), bd = $("#bDl", v);
  if (bf) bf.addEventListener("click", () => bf.classList.toggle("on"));
  if (bd) bd.addEventListener("click", () => bd.classList.toggle("on"));
  const bai = $("#bAI", v);
  if (bai) bai.addEventListener("click", async () => {
    showProgress("Suggesting titles and descriptions");
    let done = 0;
    for (const r of S.batch) {
      setProgress(done / S.batch.length, `Looking at ${r.file.name}…`);
      try { await aiBatchRowCore(r); } catch (e) { hideProgress(); toast(e.message, "err"); return render(); }
      done++;
    }
    hideProgress(); render(); toast(`Suggestions added to ${done} photos. Read them over, then publish.`, "ok");
  });
  const ba = $("#bApply", v);
  if (ba) ba.addEventListener("click", () => {
    const ser = splitCSV($("#bSeries", v).value), tg = splitCSV($("#bTags", v).value);
    S.batch.forEach(r => {
      if (ser.length) r.series = [...new Set([...r.series, ...ser])];
      if (tg.length) r.tags = [...new Set([...r.tags, ...tg])];
      if (bf.classList.contains("on")) r.featured = true;
      if (bd.classList.contains("on")) r.download = true;
    });
    render(); toast("Applied to all rows", "ok");
  });
}

function batchRowHTML(r, i) {
  const F = (label, key, type) => `<div class="field"><label>${label}</label>${
    type === "ta" ? `<textarea data-f="${key}" rows="2">${esc(r[key])}</textarea>`
    : `<input data-f="${key}" ${type === "dt" ? 'type="datetime-local"' : ""} value="${esc(type === "dt" ? localDT(r[key]) : r[key])}">`}</div>`;
  return `<div class="batch-row" data-i="${i}">
    <div class="batch-head">
      <img src="${r.url}">
      <div style="flex:1;min-width:0">
        <div class="ttl">${esc(r.title || "Untitled")}</div>
        <div class="fn">${esc(r.file.name)} · ${(r.file.size / 1048576).toFixed(1)} MB${r.camera ? " · " + esc(r.camera) : ""}${r.aperture ? " · " + esc(r.aperture) : ""}${r.shutter ? " · " + esc(r.shutter) : ""}</div>
      </div>
      ${r.featured ? '<span class="pill pill-accent">featured</span>' : ""}
      ${r.download ? '<span class="pill pill-ok">download</span>' : ""}
      <button class="iconbtn" data-act="ai" title="Suggest title and description">✨</button>
      <button class="iconbtn" data-act="dup" title="Duplicate">⧉</button>
      <button class="iconbtn" data-act="del" title="Remove">✕</button>
      <button class="iconbtn" data-act="fold">${r.collapsed ? "▸" : "▾"}</button>
    </div>
    <div class="batch-body ${r.collapsed ? "hidden" : ""}">
      <div class="field span2"><label>Title</label><input data-f="title" value="${esc(r.title)}"></div>
      <div class="field span2"><label>Caption</label><input data-f="caption" value="${esc(r.caption)}"></div>
      <div class="field full"><label>Description</label><input data-f="description" value="${esc(r.description)}"></div>
      <div class="field full"><label>Story</label><textarea data-f="story" rows="2">${esc(r.story)}</textarea></div>
      <div class="field span2"><label>Series</label><input data-f="series" list="seriesList" value="${esc(r.series.join(", "))}" placeholder="comma separated"></div>
      <div class="field span2"><label>Tags</label><input data-f="tags" value="${esc(r.tags.join(", "))}" placeholder="unlimited, comma separated"></div>
      ${F("Date taken", "date", "dt")}${F("Camera", "camera")}${F("Lens", "lens")}${F("ISO", "iso")}
      ${F("Aperture", "aperture")}${F("Shutter", "shutter")}${F("Focal length", "focal")}
      <div class="field"></div>
      <div class="flagrow full">
        <label class="flag"><span class="toggle ${r.featured ? "on" : ""}" data-t="featured"></span>Featured (hero banner)</label>
        <label class="flag"><span class="toggle ${r.download ? "on" : ""}" data-t="download"></span>Allow download</label>
      </div>
    </div></div>`;
}
function bindBatchRow(rows, r, i) {
  const el = $(`.batch-row[data-i="${i}"]`, rows);
  $$("[data-f]", el).forEach(inp => inp.addEventListener("input", () => {
    const f = inp.dataset.f;
    if (f === "series" || f === "tags") r[f] = splitCSV(inp.value);
    else if (f === "date") r.date = inp.value ? new Date(inp.value).toISOString() : "";
    else r[f] = inp.value;
  }));
  $$("[data-t]", el).forEach(t => t.addEventListener("click", () => {
    r[t.dataset.t] = !r[t.dataset.t]; t.classList.toggle("on", r[t.dataset.t]);
  }));
  $$("[data-act]", el).forEach(b => b.addEventListener("click", e => {
    e.stopPropagation();
    const a = b.dataset.act;
    if (a === "ai") { aiBatchRow(r, b).then(ok => { if (ok) render(); }); return; }
    if (a === "del") S.batch.splice(i, 1);
    if (a === "dup") S.batch.splice(i + 1, 0, { ...r, series: [...r.series], tags: [...r.tags] });
    if (a === "fold") r.collapsed = !r.collapsed;
    render();
  }));
  $(".batch-head", el).addEventListener("click", e => {
    if (e.target.closest("button")) return;
    r.collapsed = !r.collapsed; render();
  });
}

async function publishBatch() {
  if (!S.batch.length) return;
  const mb = S.batch.reduce((a, r) => a + r.file.size, 0) / 1048576;
  if (mb > 300 && !confirm(`This batch is ${Math.round(mb)} MB — large batches take a while. Continue?`)) return;
  showProgress(`Publishing ${S.batch.length} photos`);
  try {
    const taken = new Set(S.slugs.photos);
    const changes = [];
    let maxOrder = Math.max(0, ...S.photos.filter(p => p.featured).map(p => p.featuredOrder).filter(o => o < 999));
    for (let i = 0; i < S.batch.length; i++) {
      const r = S.batch[i];
      setProgress(0.35 * (i / S.batch.length), `Preparing ${r.file.name}…`);
      const image = await stageMedia(r.file, changes);
      const slug = uniqueSlug(slugify(r.title || r.file.name), taken);
      taken.add(slug);
      changes.push({ path: "content/photos/" + slug + ".md", content: photoToMD({
        title: r.title || slug, image, caption: r.caption, description: r.description, story: r.story,
        series: r.series, tags: r.tags, date: r.date || new Date().toISOString(),
        camera: r.camera, lens: r.lens, iso: r.iso, aperture: r.aperture, shutter: r.shutter, focal: r.focal,
        featured: r.featured, featuredOrder: r.featured ? ++maxOrder : 999, download: r.download
      }) });
    }
    await commitFiles(`Batch upload: ${S.batch.length} photos via Astris Studio`, changes,
      (ci, cn, d, t) => setProgress(0.35 + 0.65 * ((ci + d / t) / cn), `Uploading… (${d}/${t})`));
    hideProgress();
    toast(`Published ${S.batch.length} photos ✓ — live in about a minute.`, "ok");
    S.batch = [];
    await reload();
  } catch (e) { hideProgress(); toast("Publish failed: " + e.message, "err"); }
}

/* ---------------- photo library ---------------- */
function vPhotos(v) {
  const sel = S.sel;
  v.innerHTML = `
    <div class="pagehead">
      <div><h1>Photos</h1><div class="sub">${S.photos.length} in the library. Edit inline, select rows for bulk changes, or open one for the full editor.</div></div>
      <div class="headbtns">
        <button class="btn btn-ghost" data-go="batch">+ Add photos</button>
        <button class="btn btn-primary" id="save" ${S.dirty.size ? "" : "disabled"}>Save ${S.dirty.size || ""} change${S.dirty.size === 1 ? "" : "s"}</button>
      </div>
    </div>
    ${sel.size ? `<div class="bulkbar">
      <strong>${sel.size} selected</strong>
      <input id="bSeries" list="seriesList" placeholder="Add series" style="width:150px">
      <input id="bTags" placeholder="Add tags" style="width:150px">
      <button class="btn btn-ghost btn-sm" data-bulk="apply">Apply</button>
      <button class="btn btn-ghost btn-sm" data-bulk="featOn">Feature</button>
      <button class="btn btn-ghost btn-sm" data-bulk="featOff">Unfeature</button>
      <button class="btn btn-ghost btn-sm" data-bulk="dlOn">Downloads on</button>
      <button class="btn btn-ghost btn-sm" data-bulk="dlOff">Downloads off</button>
      <button class="btn btn-ghost btn-sm" data-bulk="ai">✨ Suggest titles</button>
      <button class="btn btn-danger btn-sm" data-bulk="delete">Delete</button>
    </div>` : ""}
    <datalist id="seriesList">${S.series.map(s => `<option value="${esc(s.title)}">`).join("")}</datalist>
    <div class="panel panel-flush"><table class="grid"><thead><tr>
      <th><input type="checkbox" id="selAll" ${sel.size && sel.size === S.photos.length ? "checked" : ""}></th>
      <th></th><th>Title</th><th>Series / tags</th><th>Date</th><th>Featured</th><th>Download</th><th></th>
    </tr></thead><tbody>
      ${S.photos.map((p, i) => `<tr data-i="${i}" class="${S.dirty.has(p.slug) ? "dirty" : ""}">
        <td><input type="checkbox" class="rowSel" ${sel.has(p.slug) ? "checked" : ""}></td>
        <td><img class="thumb" src="${imgSrc(p.image, 160)}" loading="lazy"></td>
        <td style="min-width:150px"><input data-f="title" value="${esc(p.title)}" style="width:100%"></td>
        <td style="min-width:220px">
          <input data-f="series" list="seriesList" value="${esc(p.series.join(", "))}" placeholder="series" style="width:100%;margin-bottom:5px">
          <input data-f="tags" value="${esc(p.tags.join(", "))}" placeholder="tags" style="width:100%"></td>
        <td class="muted" style="white-space:nowrap">${esc(String(p.date).slice(0, 10))}</td>
        <td><span class="toggle ${p.featured ? "on" : ""}" data-t="featured"></span></td>
        <td><span class="toggle ${p.download ? "on" : ""}" data-t="download"></span></td>
        <td style="white-space:nowrap">
          <button class="iconbtn" data-act="edit" title="Full editor">✎</button>
          <button class="iconbtn" data-act="del" title="Delete">✕</button></td>
      </tr>`).join("")}
    </tbody></table></div>`;

  $$("[data-go]", v).forEach(b => b.addEventListener("click", () => { S.view = b.dataset.go; render(); }));
  $("#selAll", v).addEventListener("change", e => {
    S.sel = e.target.checked ? new Set(S.photos.map(p => p.slug)) : new Set(); render();
  });
  $$("tbody tr", v).forEach(tr => {
    const p = S.photos[Number(tr.dataset.i)];
    $(".rowSel", tr).addEventListener("change", e => {
      e.target.checked ? S.sel.add(p.slug) : S.sel.delete(p.slug); render();
    });
    $$("[data-f]", tr).forEach(inp => inp.addEventListener("input", () => {
      const f = inp.dataset.f;
      p[f] = (f === "series" || f === "tags") ? splitCSV(inp.value) : inp.value;
      markDirty(p);
    }));
    $$("[data-t]", tr).forEach(t => t.addEventListener("click", () => {
      p[t.dataset.t] = !p[t.dataset.t];
      t.classList.toggle("on", p[t.dataset.t]);
      if (t.dataset.t === "featured" && p.featured && p.featuredOrder >= 999) p.featuredOrder = nextFeatOrder(S.photos, p);
      markDirty(p);
    }));
    $("[data-act=edit]", tr).addEventListener("click", () => openPhotoDrawer(p));
    $("[data-act=del]", tr).addEventListener("click", async () => {
      if (confirm(`Delete "${p.title}" permanently?`)) await deletePhotos([p]);
    });
  });
  $$("[data-bulk]", v).forEach(b => b.addEventListener("click", async () => {
    const picked = S.photos.filter(p => S.sel.has(p.slug));
    const a = b.dataset.bulk;
    if (a === "ai") { await aiBulkPhotos(picked); return; }
    if (a === "delete") { if (confirm(`Delete ${picked.length} photos permanently?`)) await deletePhotos(picked); return; }
    if (a === "apply") {
      const ser = splitCSV($("#bSeries", v).value), tg = splitCSV($("#bTags", v).value);
      picked.forEach(p => {
        if (ser.length) p.series = [...new Set([...p.series, ...ser])];
        if (tg.length) p.tags = [...new Set([...p.tags, ...tg])];
        S.dirty.add(p.slug);
      });
    }
    if (a === "featOn") picked.forEach(p => { p.featured = true; if (p.featuredOrder >= 999) p.featuredOrder = nextFeatOrder(S.photos, p); S.dirty.add(p.slug); });
    if (a === "featOff") picked.forEach(p => { p.featured = false; S.dirty.add(p.slug); });
    if (a === "dlOn") picked.forEach(p => { p.download = true; S.dirty.add(p.slug); });
    if (a === "dlOff") picked.forEach(p => { p.download = false; S.dirty.add(p.slug); });
    render();
  }));
  $("#save", v).addEventListener("click", savePhotos);
}
function nextFeatOrder(list, self) {
  return Math.max(0, ...list.filter(x => x.featured && x !== self).map(x => x.featuredOrder).filter(o => o < 999)) + 1;
}
function markDirty(p) {
  S.dirty.add(p.slug);
  const b = $("#save");
  if (b) { b.disabled = false; b.textContent = `Save ${S.dirty.size} change${S.dirty.size === 1 ? "" : "s"}`; }
}
async function savePhotos() {
  if (!S.dirty.size) return;
  showProgress(`Saving ${S.dirty.size} photos`);
  try {
    const changes = S.photos.filter(p => S.dirty.has(p.slug)).map(p => ({ path: p.path, content: photoToMD(p) }));
    await commitFiles(`Update ${changes.length} photos via Astris Studio`, changes,
      (ci, cn, d, t) => setProgress(d / t, `Saving… (${d}/${t})`));
    S.dirty = new Set();
    hideProgress(); toast("Saved ✓", "ok"); render();
  } catch (e) { hideProgress(); toast("Save failed: " + e.message, "err"); }
}
async function deletePhotos(list) {
  showProgress(`Deleting ${list.length} photo${list.length > 1 ? "s" : ""}`);
  try {
    const changes = [];
    for (const p of list) {
      changes.push({ path: p.path, del: true });
      const img = (p.image || "").replace(/^\//, "");
      if (img && S.imagePaths.has(img) && !S.photos.some(x => x !== p && x.image.replace(/^\//, "") === img))
        changes.push({ path: img, del: true });
    }
    await commitFiles(`Delete ${list.length} photos via Astris Studio`, changes);
    hideProgress(); toast("Deleted ✓", "ok");
    S.sel = new Set(); S.dirty = new Set();
    await reload();
  } catch (e) { hideProgress(); toast("Delete failed: " + e.message, "err"); }
}

const PHOTO_FIELDS = [
  { k: "title", label: "Title", span: 2 },
  { k: "caption", label: "Caption", span: 2 },
  { k: "description", label: "Description", type: "textarea", rows: 2, span: 4 },
  { k: "story", label: "Story", type: "textarea", rows: 4, span: 4, help: "The longer story behind the shot." },
  { k: "series", label: "Series", type: "list", span: 2 },
  { k: "tags", label: "Tags", type: "list", span: 2, help: "Unlimited, comma separated." },
  { k: "date", label: "Date taken", type: "datetime" },
  { k: "camera", label: "Camera" }, { k: "lens", label: "Lens" }, { k: "iso", label: "ISO" },
  { k: "aperture", label: "Aperture" }, { k: "shutter", label: "Shutter speed" },
  { k: "focal", label: "Focal length" }, { k: "featuredOrder", label: "Banner order", type: "number" },
  { k: "featured", label: "Featured", type: "bool" }, { k: "download", label: "Allow download", type: "bool" }
];
function openPhotoDrawer(p) {
  openDrawer({
    title: p.title || "Photo",
    fields: PHOTO_FIELDS, values: p,
    extra: `<img src="${imgSrc(p.image, 1024)}" style="width:100%;border-radius:7px;margin-bottom:14px">` + aiBarHTML("Suggest title &amp; description"),
    onSave: async (vals, changes) => {
      Object.assign(p, vals, { featuredOrder: Number(vals.featuredOrder) || 999 });
      changes.push({ path: p.path, content: photoToMD(p) });
      return `Update photo: ${p.title}`;
    },
    onDelete: async () => { await deletePhotos([p]); }
  });
  bindAI(S.drawer.el, "photo", p);
}

/* ---------------- films ---------------- */
const FILM_FIELDS = [
  { k: "title", label: "Film title", span: 2 },
  { k: "type", label: "Film type", type: "select", options: ["", ...FILM_TYPES], span: 2 },
  { k: "status", label: "Status", type: "select", options: [["finished", "Finished"], ["in-progress", "In progress"]], span: 2,
    help: "In progress shows a banner and a progress bar on the Films page." },
  { k: "stage", label: "Stage (if in progress)", type: "select", options: ["", ...STAGES] },
  { k: "progress", label: "Progress %", type: "number", min: 0, max: 100 },
  { k: "update", label: "Latest update", span: 4, help: "One line under the progress bar, e.g. Rough cut done, colour next." },
  { k: "update_date", label: "Update date", type: "datetime", span: 2 },
  { k: "date", label: "Date made (or aiming for)", type: "datetime", span: 2 },
  { k: "description", label: "Description", type: "textarea", rows: 4, span: 4, help: "Markdown works: **bold**, [links](https://…), - lists." },
  { k: "video_url", label: "YouTube or Vimeo link", span: 4, help: "Best for full films: paste the link and the thumbnail is made for you. GitHub can't hold large video files." },
  { k: "video", label: "Or a small video file", type: "media", accept: "video/*", span: 2, help: "Only for short clips, under about 50 MB." },
  { k: "thumbnail", label: "Thumbnail", type: "media", accept: "image/*", span: 2 },
  { k: "gallery", label: "Stills and behind-the-scenes pictures", type: "gallery", span: 4 },
  { k: "year", label: "Year" }, { k: "length", label: "Length", placeholder: "4 min 10s" },
  { k: "role", label: "Your role", span: 2, placeholder: "Director, camera, edit" },
  { k: "credits", label: "Credits", type: "textarea", rows: 3, span: 4, help: "Cast, music and thanks. One per line." },
  { k: "featured", label: "Featured", type: "bool" },
  { k: "featuredOrder", label: "Featured order", type: "number" }
];
function vFilms(v) {
  v.innerHTML = `
    <div class="pagehead">
      <div><h1>Films</h1><div class="sub">Finished films and the ones still being made, together in one gallery. In-progress films get a banner and a progress bar. For full films, link YouTube or Vimeo.</div></div>
      <div class="headbtns"><a class="btn btn-ghost" href="${SITE_URL}/#/films" target="_blank" rel="noopener">View page ↗</a>
      <button class="btn btn-primary" id="newFilm">+ New film</button></div>
    </div>
    <div class="panel panel-flush">${S.films.length ? `<table class="grid">
      <thead><tr><th></th><th>Title</th><th>Type</th><th>Year</th><th>Source</th><th>Featured</th><th></th></tr></thead>
      <tbody>${S.films.map((f, i) => `<tr data-i="${i}">
        <td>${f.thumbnail ? `<img class="thumb" src="${imgSrc(f.thumbnail, 160)}" loading="lazy">` : `<div class="thumb"></div>`}</td>
        <td><strong>${esc(f.title)}</strong>${f.status === "in-progress" ? ` <span class="pill pill-accent">in progress${f.stage ? " · " + esc(f.stage) : ""} ${Number(f.progress) || 0}%</span>` : ""}</td>
        <td>${f.type ? `<span class="pill">${esc(f.type)}</span>` : '<span class="muted">—</span>'}</td>
        <td class="muted">${esc(f.year || "")}</td>
        <td class="muted">${f.video_url ? "Link" : f.video ? "Uploaded file" : "—"}</td>
        <td><span class="toggle ${f.featured ? "on" : ""}" data-t="featured"></span></td>
        <td style="white-space:nowrap"><button class="iconbtn" data-act="edit">✎</button>
          <button class="iconbtn" data-act="del">✕</button></td>
      </tr>`).join("")}</tbody></table>`
      : `<p class="muted" style="padding:24px">No films yet — add your first.</p>`}</div>`;

  $("#newFilm", v).addEventListener("click", () => openFilmDrawer(null));
  $$("tbody tr", v).forEach(tr => {
    const f = S.films[Number(tr.dataset.i)];
    $("[data-act=edit]", tr).addEventListener("click", () => openFilmDrawer(f));
    $("[data-act=del]", tr).addEventListener("click", async () => {
      if (!confirm(`Delete film "${f.title}"?`)) return;
      await commitOp(`Delete film: ${f.title}`, [{ path: f.path, del: true }]);
    });
    $("[data-t]", tr).addEventListener("click", async () => {
      f.featured = !f.featured;
      if (f.featured && f.featuredOrder >= 999) f.featuredOrder = nextFeatOrder(S.films, f);
      await commitOp(`${f.featured ? "Feature" : "Unfeature"} film: ${f.title}`, [{ path: f.path, content: filmToMD(f) }]);
    });
  });
}
function openFilmDrawer(f) {
  const isNew = !f;
  const val = f || { title: "", video_url: "", video: "", thumbnail: "", type: "", year: String(new Date().getFullYear()),
                     length: "", date: new Date().toISOString(), description: "", status: "finished", stage: "", progress: 0,
                     update: "", update_date: "", role: "", credits: "", gallery: [], featured: false, featuredOrder: 999 };
  openDrawer({
    title: isNew ? "New film" : val.title,
    fields: FILM_FIELDS, values: val,
    extra: aiBarHTML("Suggest a description"),
    onSave: async (vals, changes) => {
      const film = { ...val, ...vals, featuredOrder: Number(vals.featuredOrder) || 999, progress: Number(vals.progress) || 0 };
      if (!film.title.trim()) throw new Error("A film needs a title.");
      if (film.status === "in-progress" && !film.stage) film.stage = STAGES[Math.min(4, Math.floor(film.progress / 20))];
      if (film.update && !film.update_date) film.update_date = new Date().toISOString();
      if (!film.year && film.date) film.year = String(new Date(film.date).getFullYear());
      const path = isNew
        ? "content/videos/" + uniqueSlug(slugify(film.title), S.slugs.films) + ".md"
        : val.path;
      changes.push({ path, content: filmToMD(film) });
      return `${isNew ? "Add" : "Update"} film: ${film.title}`;
    },
    onDelete: isNew ? null : async () => {
      await commitOp(`Delete film: ${val.title}`, [{ path: val.path, del: true }]);
    }
  });
  bindAI(S.drawer.el, "film", val);
}

/* ---------------- news ---------------- */
const NEWS_FIELDS = [
  { k: "title", label: "Title", span: 3 },
  { k: "date", label: "Date", type: "datetime" },
  { k: "tags", label: "Topics", type: "list", span: 2, help: "e.g. Films, Photography, Behind the scenes. They become tabs on the News page." },
  { k: "summary", label: "Summary", type: "textarea", rows: 2, span: 4, help: "Short teaser shown on the news cards." },
  { k: "image", label: "Main picture", type: "media", accept: "image/*", span: 4 },
  { k: "body", label: "Post", type: "textarea", rows: 14, span: 4, help: "Markdown: # heading, **bold**, *italic*, - list, > quote, [link](url)." },
  { k: "gallery", label: "Photos for this post", type: "gallery", span: 4, help: "Shown as a gallery under the text. A click opens them full size." }
];
function vNews(v) {
  v.innerHTML = `
    <div class="pagehead">
      <div><h1>News</h1><div class="sub">Posts appear on the News page and, for the most recent three, on the homepage.</div></div>
      <div class="headbtns"><a class="btn btn-ghost" href="${SITE_URL}/#/news" target="_blank">Preview ↗</a>
      <button class="btn btn-primary" id="newPost">+ New post</button></div>
    </div>
    <div class="panel panel-flush">${S.news.length ? `<table class="grid">
      <thead><tr><th></th><th>Title</th><th>Date</th><th>Summary</th><th></th></tr></thead>
      <tbody>${S.news.map((n, i) => `<tr data-i="${i}">
        <td>${n.image ? `<img class="thumb" src="${imgSrc(n.image, 160)}" loading="lazy">` : `<div class="thumb"></div>`}</td>
        <td><strong>${esc(n.title)}</strong></td>
        <td class="muted" style="white-space:nowrap">${esc(String(n.date).slice(0, 10))}</td>
        <td class="muted">${esc((n.summary || "").slice(0, 70))}</td>
        <td style="white-space:nowrap"><button class="iconbtn" data-act="edit">✎</button>
          <button class="iconbtn" data-act="del">✕</button></td>
      </tr>`).join("")}</tbody></table>`
      : `<p class="muted" style="padding:24px">No posts yet.</p>`}</div>`;
  $("#newPost", v).addEventListener("click", () => openNewsDrawer(null));
  $$("tbody tr", v).forEach(tr => {
    const n = S.news[Number(tr.dataset.i)];
    $("[data-act=edit]", tr).addEventListener("click", () => openNewsDrawer(n));
    $("[data-act=del]", tr).addEventListener("click", async () => {
      if (confirm(`Delete post "${n.title}"?`)) await commitOp(`Delete news: ${n.title}`, [{ path: n.path, del: true }]);
    });
  });
}
function openNewsDrawer(n) {
  const isNew = !n;
  const val = n || { title: "", date: new Date().toISOString(), summary: "", image: "", body: "", tags: [], gallery: [] };
  openDrawer({
    title: isNew ? "New post" : val.title,
    fields: NEWS_FIELDS, values: val,
    extra: aiBarHTML("Suggest a summary"),
    onSave: async (vals, changes) => {
      const post = { ...val, ...vals };
      if (!post.title.trim()) throw new Error("A post needs a title.");
      const path = isNew ? "content/news/" + uniqueSlug(slugify(post.title), S.slugs.news) + ".md" : val.path;
      changes.push({ path, content: newsToMD(post) });
      return `${isNew ? "Add" : "Update"} news: ${post.title}`;
    },
    onDelete: isNew ? null : async () => {
      await commitOp(`Delete news: ${val.title}`, [{ path: val.path, del: true }]);
    }
  });
  bindAI(S.drawer.el, "news", val);
}

/* ---------------- downloads ---------------- */
function vDownloads(v) {
  const on = S.photos.filter(p => p.download);
  v.innerHTML = `
    <div class="pagehead">
      <div><h1>Downloads</h1><div class="sub">Every photo with downloads enabled appears on the public Downloads page with a free download button — no login, ever.</div></div>
      <a class="btn btn-ghost" href="${SITE_URL}/#/downloads" target="_blank">Preview ↗</a>
    </div>
    <div class="panel panel-flush">${on.length ? `<table class="grid">
      <thead><tr><th></th><th>Title</th><th>Series</th><th>Download</th></tr></thead><tbody>
      ${on.map(p => `<tr data-slug="${esc(p.slug)}">
        <td><img class="thumb" src="${imgSrc(p.image, 160)}" loading="lazy"></td>
        <td>${esc(p.title)}</td>
        <td>${p.series.map(s => `<span class="pill">${esc(s)}</span>`).join("")}</td>
        <td><span class="toggle on" data-off></span></td></tr>`).join("")}
      </tbody></table>` : `<p class="muted" style="padding:24px">No photos have downloads enabled. Turn them on from the Photos library.</p>`}</div>`;
  $$("[data-off]", v).forEach(t => t.addEventListener("click", async () => {
    const p = S.photos.find(x => x.slug === t.closest("tr").dataset.slug);
    p.download = false;
    await commitOp(`Disable download: ${p.title}`, [{ path: p.path, content: photoToMD(p) }]);
  }));
}

/* ---------------- series ---------------- */
function vSeries(v) {
  const count = t => S.photos.filter(p => p.series.includes(t)).length;
  v.innerHTML = `
    <div class="pagehead"><div><h1>Series</h1>
      <div class="sub">Series are the chips across the top of the Photography page. A photo can belong to as many as you like.</div></div></div>
    <div class="panel"><h2>New series</h2>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <input id="newSeries" placeholder="e.g. Wildlife" style="width:240px">
        <button class="btn btn-primary btn-sm" id="addSeries">Create</button></div></div>
    <div class="panel panel-flush"><table class="grid">
      <thead><tr><th style="width:34px"></th><th>Series</th><th>Photos</th><th></th></tr></thead><tbody>
      ${S.series.map((s, i) => `<tr data-i="${i}"><td class="muted">${i + 1}</td>
        <td><strong>${esc(s.title)}</strong></td><td class="muted">${count(s.title)}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="iconbtn" data-m="up" ${i === 0 ? "disabled" : ""}>↑</button>
          <button class="iconbtn" data-m="down" ${i === S.series.length - 1 ? "disabled" : ""}>↓</button>
          <button class="btn btn-ghost btn-sm" data-m="rename">Rename</button>
          <button class="btn btn-ghost btn-sm" data-m="merge">Merge</button>
          <button class="btn btn-danger btn-sm" data-m="del">Delete</button></td></tr>`).join("")}
      </tbody></table></div>
    <p class="muted">Renaming, merging or deleting a series updates every photo that uses it.</p>`;

  $("#addSeries", v).addEventListener("click", async () => {
    const t = $("#newSeries", v).value.trim();
    if (!t) return;
    if (S.series.some(s => s.title.toLowerCase() === t.toLowerCase())) return toast("That series already exists", "err");
    await commitOp("Create series: " + t, [{
      path: "content/series/" + slugify(t) + ".md",
      content: seriesToMD({ title: t, order: S.series.length + 1 })
    }]);
  });
  $$("tbody tr", v).forEach(tr => {
    const s = S.series[Number(tr.dataset.i)];
    $$("[data-m]", tr).forEach(b => b.addEventListener("click", async () => {
      const m = b.dataset.m;
      if (m === "up" || m === "down") {
        const i = S.series.indexOf(s), j = m === "up" ? i - 1 : i + 1;
        [S.series[i], S.series[j]] = [S.series[j], S.series[i]];
        await commitOp("Reorder series", S.series.map((x, k) => {
          x.order = k + 1; return { path: x.path, content: seriesToMD(x) };
        }));
      }
      if (m === "rename") {
        const nt = prompt(`Rename "${s.title}" to:`, s.title);
        if (!nt || nt === s.title) return;
        const changes = [{ path: s.path, del: true },
          { path: "content/series/" + slugify(nt) + ".md", content: seriesToMD({ ...s, title: nt }) }];
        S.photos.filter(p => p.series.includes(s.title)).forEach(p => {
          p.series = p.series.map(x => x === s.title ? nt : x);
          changes.push({ path: p.path, content: photoToMD(p) });
        });
        await commitOp(`Rename series ${s.title} → ${nt}`, changes);
      }
      if (m === "merge") {
        const others = S.series.filter(x => x !== s).map(x => x.title);
        if (!others.length) return toast("Nothing to merge into", "err");
        const target = prompt(`Merge "${s.title}" into which series?\n\n${others.join(", ")}`);
        if (!target) return;
        if (!others.includes(target)) return toast("Unknown series: " + target, "err");
        const changes = [{ path: s.path, del: true }];
        S.photos.filter(p => p.series.includes(s.title)).forEach(p => {
          p.series = [...new Set(p.series.map(x => x === s.title ? target : x))];
          changes.push({ path: p.path, content: photoToMD(p) });
        });
        await commitOp(`Merge series ${s.title} → ${target}`, changes);
      }
      if (m === "del") {
        const n = count(s.title);
        if (!confirm(`Delete series "${s.title}"?${n ? ` It will be removed from ${n} photo${n > 1 ? "s" : ""}.` : ""}`)) return;
        const changes = [{ path: s.path, del: true }];
        S.photos.filter(p => p.series.includes(s.title)).forEach(p => {
          p.series = p.series.filter(x => x !== s.title);
          changes.push({ path: p.path, content: photoToMD(p) });
        });
        await commitOp("Delete series: " + s.title, changes);
      }
    }));
  });
}

/* ---------------- tags ---------------- */
function vTags(v) {
  const counts = new Map();
  S.photos.forEach(p => p.tags.forEach(t => counts.set(t, (counts.get(t) || 0) + 1)));
  const tags = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  v.innerHTML = `
    <div class="pagehead"><div><h1>Tags</h1>
      <div class="sub">Tags are free-form and unlimited. They power the tag filters on the Photography page.</div></div></div>
    <div class="panel panel-flush">${tags.length ? `<table class="grid">
      <thead><tr><th>Tag</th><th>Photos</th><th></th></tr></thead><tbody>
      ${tags.map(([t, c]) => `<tr data-tag="${esc(t)}"><td><strong>${esc(t)}</strong></td><td class="muted">${c}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn-ghost btn-sm" data-m="rename">Rename</button>
          <button class="btn btn-ghost btn-sm" data-m="merge">Merge</button>
          <button class="btn btn-danger btn-sm" data-m="del">Delete</button></td></tr>`).join("")}
      </tbody></table>` : `<p class="muted" style="padding:24px">No tags yet — add them when uploading, or from the photo library.</p>`}</div>`;
  $$("tbody tr", v).forEach(tr => {
    const tag = tr.dataset.tag;
    const affected = () => S.photos.filter(p => p.tags.includes(tag));
    $$("[data-m]", tr).forEach(b => b.addEventListener("click", async () => {
      const m = b.dataset.m;
      if (m === "rename") {
        const nt = prompt(`Rename tag "${tag}" to:`, tag);
        if (!nt || nt === tag) return;
        const changes = affected().map(p => {
          p.tags = [...new Set(p.tags.map(x => x === tag ? nt : x))];
          return { path: p.path, content: photoToMD(p) };
        });
        await commitOp(`Rename tag ${tag} → ${nt}`, changes);
      }
      if (m === "merge") {
        const others = [...counts.keys()].filter(x => x !== tag);
        const target = prompt(`Merge "${tag}" into which tag?\n\n${others.join(", ")}`);
        if (!target || !others.includes(target)) { if (target) toast("Unknown tag: " + target, "err"); return; }
        const changes = affected().map(p => {
          p.tags = [...new Set(p.tags.map(x => x === tag ? target : x))];
          return { path: p.path, content: photoToMD(p) };
        });
        await commitOp(`Merge tag ${tag} → ${target}`, changes);
      }
      if (m === "del") {
        const n = affected().length;
        if (!confirm(`Remove tag "${tag}" from ${n} photo${n > 1 ? "s" : ""}?`)) return;
        const changes = affected().map(p => {
          p.tags = p.tags.filter(x => x !== tag);
          return { path: p.path, content: photoToMD(p) };
        });
        await commitOp("Delete tag: " + tag, changes);
      }
    }));
  });
}

/* ---------------- featured ---------------- */
function vFeatured(v) {
  const feat = [
    ...S.photos.filter(p => p.featured).map(p => ({ ...p, kind: "photo", ref: p })),
    ...S.films.filter(f => f.featured).map(f => ({ ...f, kind: "film", ref: f }))
  ].sort((a, b) => a.featuredOrder - b.featuredOrder);
  const pend = S._featPending || (S._featPending = new Set());
  v.innerHTML = `
    <div class="pagehead">
      <div><h1>Featured</h1><div class="sub">Featured items front your site: they are the slideshow behind the home page (until your showreel is in), the pictures in the opening A, the footer reel, and the Selected work section. Feature things from the Photos and Films pages, then put them in order here. You can also pick the opening and reel pictures by hand under Showreel &amp; intro.</div></div>
      <div class="headbtns"><button class="btn btn-primary" id="saveFeat" ${pend.size ? "" : "disabled"}>Save order</button></div>
    </div>
    <div class="panel panel-flush">
      ${feat.length ? `<table class="grid"><tbody id="rows">
        ${feat.map((x, i) => `<tr data-i="${i}">
          <td class="muted" style="width:34px">${i + 1}</td>
          <td style="width:130px"><img class="thumb-lg" src="${imgSrc(x.kind === "photo" ? x.image : x.thumbnail, 160)}" alt=""></td>
          <td><strong>${esc(x.title)}</strong><div><span class="pill ${x.kind === "film" ? "pill-accent" : ""}">${x.kind}</span></div></td>
          <td style="text-align:right;white-space:nowrap">
            <button class="iconbtn" data-m="up" ${i === 0 ? "disabled" : ""}>↑</button>
            <button class="iconbtn" data-m="down" ${i === feat.length - 1 ? "disabled" : ""}>↓</button>
            <button class="iconbtn" data-m="out" title="Remove from featured">✕</button></td></tr>`).join("")}
      </tbody></table>` : `<p class="muted" style="padding:22px">Nothing is featured yet. Switch on Featured for photos and films to fill this list.</p>`}</div>`;
  $$("#rows tr", v).forEach(tr => $$("[data-m]", tr).forEach(b => b.addEventListener("click", () => {
    const i = Number(tr.dataset.i), m = b.dataset.m;
    if (m === "up" && i > 0) [feat[i - 1], feat[i]] = [feat[i], feat[i - 1]];
    if (m === "down" && i < feat.length - 1) [feat[i + 1], feat[i]] = [feat[i], feat[i + 1]];
    if (m === "out") { feat[i].ref.featured = false; pend.add(feat[i].ref); feat.splice(i, 1); }
    feat.forEach((x, k) => { if (x.ref.featuredOrder !== k + 1) { x.ref.featuredOrder = k + 1; pend.add(x.ref); } });
    vFeatured(v);
  })));
  $("#saveFeat", v).addEventListener("click", async () => {
    const changes = [...pend].map(item => ({ path: item.path, content: S.photos.includes(item) ? photoToMD(item) : filmToMD(item) }));
    S._featPending = new Set();
    await commitOp("Update featured order", changes);
  });
}

/* ---------------- home page ---------------- */
const HERO_FIELDS = [
  { k: "hero_title", label: "The big word", span: 2, help: "The large word in the middle of the first screen." },
  { k: "hero_subtitle", label: "The thin word underneath", span: 2 },
  { k: "home_cta_label", label: "Button label", span: 2 },
  { k: "home_cta_link", label: "Button goes to", type: "select", span: 2,
    options: [["#/films", "Films"], ["#/photography", "Photography"], ["#/news", "News"], ["#/hello", "Say hello"]] }
];
const HOME_SECTIONS = [
  { key: "films", name: "Latest films", fields: [
    { k: "home_films_enabled", label: "Show", type: "bool" }, { k: "home_films_order", label: "Order", type: "number" },
    { k: "home_latest_films_heading", label: "Heading" }, { k: "home_latest_films_link", label: "Link label" }] },
  { key: "photos", name: "Latest photos", fields: [
    { k: "home_photos_enabled", label: "Show", type: "bool" }, { k: "home_photos_order", label: "Order", type: "number" },
    { k: "home_latest_photos_heading", label: "Heading" }, { k: "home_latest_photos_link", label: "Link label" }] },
  { key: "selected", name: "Selected work", fields: [
    { k: "home_selected_enabled", label: "Show", type: "bool" }, { k: "home_selected_order", label: "Order", type: "number" },
    { k: "home_selected_heading", label: "Heading" }, { k: "home_selected_intro", label: "Intro line", span: 2 }] },
  { key: "about", name: "Hi, I'm Josh (the bio)", fields: [
    { k: "home_about_enabled", label: "Show", type: "bool" }, { k: "home_about_order", label: "Order", type: "number" }] },
  { key: "news", name: "News", fields: [
    { k: "home_news_enabled", label: "Show", type: "bool" }, { k: "home_news_order", label: "Order", type: "number" },
    { k: "home_news_heading", label: "Heading" }, { k: "home_news_link", label: "Link label" }] }
];
function vHome(v) {
  v.innerHTML = `
    <div class="pagehead">
      <div><h1>Home page</h1><div class="sub">The first screen, then the sections below it. Rename, reorder or hide any of them. Lower order numbers come first. Empty sections (no films yet, say) hide themselves.</div></div>
      <div class="headbtns"><a class="btn btn-ghost" href="${SITE_URL}/" target="_blank" rel="noopener">View website ↗</a>
      <button class="btn btn-primary" id="saveHome">Save home page</button></div>
    </div>
    <div class="panel"><h2>First screen</h2>
      <div class="formgrid" id="heroForm">${HERO_FIELDS.map(f => fieldHTML(f, S.site[f.k])).join("")}</div></div>
    <div id="homeForm">
      ${HOME_SECTIONS.map(sec => `<div class="panel"><h2>${esc(sec.name)}</h2>
        <div class="formgrid">${sec.fields.map(f => fieldHTML(f, S.site[f.k])).join("")}</div></div>`).join("")}
    </div>
    <div class="panel"><h2>The bio text</h2>
      <p class="hint">Shown beside your silhouette picture on the home page.</p>
      <div class="formgrid" id="aboutPrev">
        ${fieldHTML({ k: "home_heading", label: "Heading", span: 2 }, S.about.home_heading)}
        ${fieldHTML({ k: "home_text", label: "Text", type: "textarea", rows: 2, span: 2 }, S.about.home_text)}
      </div></div>`;
  bindFields(v);
  $("#saveHome", v).addEventListener("click", async () => {
    showProgress("Saving home page");
    try {
      const all = HOME_SECTIONS.flatMap(sec => sec.fields);
      Object.assign(S.site, readFields($("#heroForm", v), HERO_FIELDS, {}), readFields($("#homeForm", v), all, {}));
      Object.assign(S.about, readFields($("#aboutPrev", v), [{ k: "home_heading" }, { k: "home_text" }], {}));
      await commitFiles("Update home page via Astris Studio", [
        { path: PATHS.site, content: objToYAML(S.site) },
        { path: PATHS.about, content: objToYAML(S.about) }
      ]);
      hideProgress(); toast("Home page saved ✓", "ok");
    } catch (e) { hideProgress(); toast("Save failed: " + e.message, "err"); }
  });
}

/* ---------------- say hello (about + contact) ---------------- */
const ABOUT_FIELDS = [
  { k: "intro", label: "One-line intro", type: "textarea", rows: 2, span: 4 },
  { k: "image", label: "Profile photo", type: "media", accept: "image/*", span: 2, help: "Leave empty to use your yellow silhouette picture." },
  { k: "capabilities", label: "What you do", type: "list", span: 2, help: "Shown as a line, e.g. Photography · Filmmaking · Editing." },
  { k: "body", label: "Longer bio (optional)", type: "textarea", rows: 8, span: 4, help: "Markdown works. Shown under the contact details." },
  { k: "links", label: "Extra links", type: "pairs", span: 4 }
];
const CONTACT_FIELDS = [
  { k: "intro", label: "Short line under SAY HELLO", type: "textarea", rows: 2, span: 4 },
  { k: "email", label: "Email", span: 2 },
  { k: "email_note", label: "Note under the email", span: 2 },
  { k: "location", label: "Based in", span: 2 },
  { k: "availability", label: "Availability", span: 2 },
  { k: "socials", label: "Social links", type: "pairs", span: 4, help: "Only links with a web address are shown. YouTube always appears." }
];
function vPages(v) {
  v.innerHTML = `
    <div class="pagehead">
      <div><h1>Say hello</h1><div class="sub">Your bio, your details and your links, all on the Say hello page. There's no contact form: people email you directly.</div></div>
      <div class="headbtns"><a class="btn btn-ghost" href="${SITE_URL}/#/hello" target="_blank" rel="noopener">View page ↗</a>
      <button class="btn btn-primary" id="savePages">Save pages</button></div>
    </div>
    <div class="panel"><h2>About you</h2><div class="formgrid" id="aboutForm">
      ${ABOUT_FIELDS.map(f => fieldHTML(f, S.about[f.k])).join("")}</div></div>
    <div class="panel"><h2>Contact details</h2><div class="formgrid" id="contactForm">
      ${CONTACT_FIELDS.map(f => fieldHTML(f, S.contact[f.k])).join("")}</div></div>`;
  bindFields(v);
  $("#savePages", v).addEventListener("click", async () => {
    showProgress("Saving pages");
    try {
      const changes = [];
      const aRoot = $("#aboutForm", v), cRoot = $("#contactForm", v);
      Object.assign(S.about, await stagePickers(aRoot, readFields(aRoot, ABOUT_FIELDS, {}), changes));
      Object.assign(S.contact, await stagePickers(cRoot, readFields(cRoot, CONTACT_FIELDS, {}), changes));
      changes.push({ path: PATHS.about, content: objToYAML(S.about) });
      changes.push({ path: PATHS.contact, content: objToYAML(S.contact) });
      await commitFiles("Update Say hello page via Astris Studio", changes);
      hideProgress(); toast("Pages saved ✓", "ok");
      await reload();
    } catch (e) { hideProgress(); toast("Save failed: " + e.message, "err"); }
  });
}

/* ---------------- site settings ---------------- */
const SETTINGS_GROUPS = [
  { name: "Brand", fields: [
    { k: "brand", label: "Brand name", span: 2 }, { k: "tagline", label: "Tagline", span: 2 }] },
  { name: "Page headings", fields: [
    { k: "films_heading", label: "Films heading" }, { k: "films_intro", label: "Films intro", span: 2 },
    { k: "photography_heading", label: "Photography heading" }, { k: "photography_intro", label: "Photography intro", span: 2 },
    { k: "news_heading", label: "News heading" }, { k: "news_intro", label: "News intro", span: 2 },
    { k: "hello_heading", label: "Say hello heading" }] },
  { name: "Menu labels", fields: [
    { k: "nav_home", label: "Home" }, { k: "nav_films", label: "Films" }, { k: "nav_photography", label: "Photography" },
    { k: "nav_news", label: "News" }, { k: "nav_hello", label: "Say hello" }] },
  { name: "Footer", fields: [
    { k: "footer_text", label: "Copyright line", span: 2 }, { k: "footer_name", label: "Your name" },
    { k: "footer_note", label: "Extra note", span: 2 }] },
  { name: "Pictures", fields: [
    { k: "image_optimize", label: "Lighter copies of pictures", type: "bool", span: 4,
      help: "Keeps the site quick by showing smaller copies. Free downloads always give the full-size original. Turn this off only if pictures ever fail to show." }] }
];
function vSettings(v) {
  v.innerHTML = `
    <div class="pagehead">
      <div><h1>Site settings</h1><div class="sub">Headings, menu labels and footer text across the whole site. No code needed.</div></div>
      <div class="headbtns"><a class="btn btn-ghost" href="${SITE_URL}/" target="_blank" rel="noopener">View website ↗</a>
      <button class="btn btn-primary" id="saveSettings">Save settings</button></div>
    </div>
    <div id="setForm">${SETTINGS_GROUPS.map(g => `<div class="panel"><h2>${esc(g.name)}</h2>
      <div class="formgrid">${g.fields.map(f => fieldHTML(f, S.site[f.k])).join("")}</div></div>`).join("")}</div>
    <div class="panel"><h2>This Studio</h2>
      <p class="hint">Where "View website" links go. Saved in this browser only.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap"><input id="siteUrl" value="${esc(siteUrl())}" style="flex:1;min-width:260px">
      <button class="btn btn-ghost" id="saveSiteUrl">Save address</button></div></div>`;
  bindFields(v);
  $("#saveSiteUrl", v).addEventListener("click", () => {
    const u = $("#siteUrl", v).value.trim();
    if (!/^https?:\/\//i.test(u)) return toast("The address should start with https://", "err");
    localStorage.setItem(SITE_KEY, u); toast("Address saved ✓", "ok");
  });
  $("#saveSettings", v).addEventListener("click", async () => {
    showProgress("Saving settings");
    try {
      Object.assign(S.site, readFields($("#setForm", v), SETTINGS_GROUPS.flatMap(g => g.fields), {}));
      await commitFiles("Update site settings via Astris Studio",
        [{ path: PATHS.site, content: objToYAML(S.site) }]);
      hideProgress(); toast("Settings saved ✓", "ok");
    } catch (e) { hideProgress(); toast("Save failed: " + e.message, "err"); }
  });
}

/* ---------------- generic drawer editor ---------------- */
function openDrawer({ title, fields, values, extra, onSave, onDelete }) {
  closeDrawer();
  const back = document.createElement("div");
  back.className = "drawer-back";
  const el = document.createElement("aside");
  el.className = "drawer";
  el.innerHTML = `
    <header><h2>${esc(title)}</h2><button class="iconbtn" data-close>✕</button></header>
    <div class="body">${extra || ""}<div class="formgrid" id="drawerForm">
      ${fields.map(f => fieldHTML(f, values[f.k])).join("")}</div></div>
    <footer>
      ${onDelete ? `<button class="btn btn-danger btn-sm" data-del>Delete</button>` : "<span></span>"}
      <div style="display:flex;gap:10px">
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn btn-primary" data-save>Save</button>
      </div></footer>`;
  document.body.appendChild(back);
  document.body.appendChild(el);
  S.drawer = { back, el };
  bindFields(el);
  $$("[data-close]", el).forEach(b => b.addEventListener("click", closeDrawer));
  back.addEventListener("click", closeDrawer);
  const delBtn = $("[data-del]", el);
  if (delBtn) delBtn.addEventListener("click", async () => { closeDrawer(); await onDelete(); });
  $("[data-save]", el).addEventListener("click", async () => {
    const form = $("#drawerForm", el);
    showProgress("Saving");
    try {
      const changes = [];
      const vals = await stagePickers(form, readFields(form, fields, {}), changes);
      const msg = await onSave(vals, changes);
      await commitFiles(msg + " via Astris Studio", changes);
      hideProgress(); closeDrawer(); toast("Saved ✓", "ok");
      await reload();
    } catch (e) { hideProgress(); toast("Save failed: " + e.message, "err"); }
  });
}
function closeDrawer() {
  if (!S.drawer) return;
  S.drawer.back.remove(); S.drawer.el.remove(); S.drawer = null;
}

/* Run a small write operation with progress + reload. */
async function commitOp(msg, changes) {
  showProgress(msg);
  try {
    await commitFiles(msg + " via Astris Studio", changes);
    hideProgress(); toast("Done ✓", "ok");
    await reload();
  } catch (e) { hideProgress(); toast("Failed: " + e.message, "err"); }
}

/* ---------------- items for the opening and the footer reel ---------------- */
function allItems() {
  const l = [];
  S.films.forEach(f => { if (f.thumbnail) l.push({ key: "film/" + f.slug, kind: "Film", title: f.title, img: f.thumbnail, date: f.date }); });
  S.photos.forEach(p => l.push({ key: "photo/" + p.slug, kind: "Photo", title: p.title || p.slug, img: p.image, date: p.date }));
  return l.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}
function featuredItems(items) {
  const f = new Set([...S.photos.filter(p => p.featured).map(p => "photo/" + p.slug), ...S.films.filter(x => x.featured).map(x => "film/" + x.slug)]);
  return items.filter(i => f.has(i.key));
}
function chooserHTML(id) {
  return `<div class="chooser" data-chooser="${id}">
    <div class="chooser-bar"><span class="muted" data-count></span><button type="button" class="btn btn-ghost btn-sm" data-clear>Back to automatic</button></div>
    <div class="chgrid">${allItems().map(it => `<button type="button" class="chitem" data-key="${esc(it.key)}" title="${esc(it.title)}"><img src="${imgSrc(it.img, 160)}" alt="" loading="lazy"><b></b><span>${esc(it.title)}</span></button>`).join("")}</div></div>`;
}
function bindChooser(root, id, selected) {
  const w = $(`[data-chooser="${id}"]`, root);
  const paint = () => {
    $$(".chitem", w).forEach(b => {
      const i = selected.indexOf(b.dataset.key);
      b.classList.toggle("on", i > -1); $("b", b).textContent = i > -1 ? String(i + 1) : "";
    });
    $("[data-count]", w).textContent = selected.length
      ? `${selected.length} chosen, numbered in the order you clicked`
      : "Automatic: your featured items, or the newest if none are featured";
  };
  $$(".chitem", w).forEach(b => b.addEventListener("click", () => {
    const i = selected.indexOf(b.dataset.key);
    if (i > -1) selected.splice(i, 1); else selected.push(b.dataset.key);
    paint();
  }));
  $("[data-clear]", w).addEventListener("click", () => { selected.length = 0; paint(); });
  paint();
}

/* ---------------- showreel, opening, footer reel, grain ---------------- */
const SHOW_FIELDS = [
  { k: "showreel", label: "Showreel video", type: "media", accept: "video/mp4,video/webm", span: 4,
    help: "Plays silently on a loop behind every page. About a minute is perfect." },
  { k: "showreel_poster", label: "Poster picture (optional)", type: "media", accept: "image/*", span: 4,
    help: "Shown while the video loads. A still from the reel works well." }
];
const INTRO_FIELDS = [
  { k: "intro_enabled", label: "Play the opening", type: "bool", help: "Plays once each visit. Visitors can skip it with a click." },
  { k: "intro_speed", label: "Opening speed", type: "select", options: [["fast", "Fast (under a second)"], ["normal", "Normal (about a second)"], ["relaxed", "Relaxed (a second and a half)"]] },
  { k: "reel_speed", label: "Footer reel speed", type: "select", options: [["slow", "Slow"], ["normal", "Normal"], ["fast", "Fast"]] },
  { k: "grain", label: "Film grain", type: "select", options: [["off", "Off"], ["low", "Light"], ["medium", "Medium"], ["high", "Heavy"]] }
];
function vShow(v) {
  const site = S.site;
  const vals = { intro_enabled: true, intro_speed: "normal", reel_speed: "normal", grain: "medium", ...site };
  const introSel = arr(site.intro_items).slice(), reelSel = arr(site.reel_items).slice();
  v.innerHTML = `
    <div class="pagehead">
      <div><h1>Showreel &amp; intro</h1><div class="sub">The moving parts at the front of your site: the showreel behind every page, the quick opening, the film reel along the bottom of every page, and the film grain.</div></div>
      <div class="headbtns"><button class="btn btn-primary" id="saveShow">Save</button></div>
    </div>
    <div class="panel"><h2>Showreel</h2>
      ${site.showreel ? `<video class="reelprev" src="${esc(rawUrl(site.showreel))}" controls muted playsinline preload="metadata"></video>`
        : `<p class="muted">No showreel yet. Until you add one, a slow slideshow of your featured photos plays instead.</p>`}
      <div class="formgrid" id="showForm" style="margin-top:14px">${SHOW_FIELDS.map(f => fieldHTML(f, site[f.k])).join("")}</div>
      <p class="hint" style="margin-top:12px">Tip: export from Premiere as H.264 mp4, 1920×1080, about 3 Mbps, no audio. That is roughly 22 MB a minute, which keeps the site quick. GitHub stops files at 100 MB. Full-length films are better on YouTube, linked from the Films page.</p>
    </div>
    <div class="panel"><h2>Opening</h2>
      <div class="formgrid" id="introForm">${INTRO_FIELDS.slice(0, 2).map(f => fieldHTML(f, vals[f.k])).join("")}</div>
      <div class="headbtns" style="margin:16px 0 4px"><button class="btn btn-ghost" id="previewIntro">▶ Preview the opening</button></div>
      <h3 class="h3">Pictures that rip past inside the A</h3>
      <p class="hint">Click pictures to choose them. They run past in the order you click, and the first one is the picture the camera dives into. On automatic, your featured items are used.</p>
      ${chooserHTML("intro")}
    </div>
    <div class="panel"><h2>Footer reel</h2>
      <div class="formgrid" id="reelForm">${fieldHTML(INTRO_FIELDS[2], vals.reel_speed)}</div>
      <p class="hint" style="margin-top:12px">The film reel that rolls along the bottom of every page. Choose what appears on it, or leave it on automatic.</p>
      ${chooserHTML("reel")}
    </div>
    <div class="panel"><h2>Film grain</h2>
      <div class="formgrid" id="grainForm">${fieldHTML(INTRO_FIELDS[3], vals.grain)}</div></div>`;
  bindFields(v);
  bindChooser(v, "intro", introSel); bindChooser(v, "reel", reelSel);
  $("#previewIntro", v).addEventListener("click", () => previewIntro(introSel, ($("[data-k=intro_speed]", v) || {}).value || "normal"));
  $("#saveShow", v).addEventListener("click", async () => {
    const form = $("#showForm", v);
    const file = ($('[data-media="showreel"]', form) || {})._file;
    if (file && file.size > 95 * 1048576) return toast("That video is over 95 MB, which is more than GitHub allows. Export a smaller one (see the tip).", "err");
    if (file && file.size > 45 * 1048576 && !confirm(`That video is ${Math.round(file.size / 1048576)} MB. It will work, but visitors on slow connections may wait. Upload it anyway?`)) return;
    showProgress("Saving");
    try {
      const changes = [];
      const vals2 = await stagePickers(form, readFields(form, SHOW_FIELDS, {}), changes);
      Object.assign(S.site, vals2,
        readFields($("#introForm", v), INTRO_FIELDS.slice(0, 2), {}),
        readFields($("#reelForm", v), [INTRO_FIELDS[2]], {}),
        readFields($("#grainForm", v), [INTRO_FIELDS[3]], {}),
        { intro_items: introSel, reel_items: reelSel });
      changes.push({ path: PATHS.site, content: objToYAML(S.site) });
      await commitFiles("Update showreel, intro and reel via Astris Studio", changes,
        (ci, cn, d, t) => setProgress((ci + d / t) / cn, `Uploading… (${d}/${t})`));
      hideProgress(); toast("Saved ✓ Live in about a minute.", "ok");
      await reload();
    } catch (e) { hideProgress(); toast("Save failed: " + e.message, "err"); }
  });
}
function previewIntro(sel, speed) {
  const items = allItems();
  let list = sel.map(k => items.find(i => i.key === k)).filter(Boolean);
  if (!list.length) list = featuredItems(items);
  if (!list.length) list = items.slice(0, 8);
  const urls = list.slice(0, 10).map((it, i) => imgSrc(it.img, i === 0 ? 1024 : 640));
  const back = document.createElement("div");
  back.className = "overlay";
  back.innerHTML = `<div class="box wide"><h2 style="font-size:21px;margin-bottom:12px">Opening preview</h2>
    <div class="preview16" id="introBox"></div>
    <div class="headbtns" style="margin-top:14px"><button class="btn btn-ghost" id="introAgain">↻ Play again</button><button class="btn btn-primary" id="introClose">Close</button></div></div>`;
  document.body.appendChild(back);
  const box = $("#introBox", back); let ctl = null;
  const run = () => {
    if (ctl) ctl.skip();
    box.innerHTML = ""; box.style.backgroundImage = "";
    ctl = window.AstrisIntro.play({ host: box, frames: urls, speed, wait: window.AstrisIntro.preload(urls, 800),
      onArrive: () => { box.style.background = `linear-gradient(rgba(11,10,9,.55), rgba(11,10,9,.8)), center / cover url("${urls[0]}")`; box.dataset.after = "Then your website appears here."; },
      onDone: () => { box.classList.add("arrived"); } });
    box.classList.remove("arrived");
  };
  $("#introAgain", back).addEventListener("click", run);
  $("#introClose", back).addEventListener("click", () => { if (ctl) ctl.skip(); back.remove(); });
  run();
}

/* ---------------- transitions ---------------- */
function vTransitions(v) {
  const T = window.AstrisTransitions;
  const site = S.site;
  const st = {
    mode: String(site.transition_mode || "random"),
    single: String(site.transition_single || "dissolve"),
    speed: String(site.transition_speed || "normal"),
    enabled: (arr(site.transitions_enabled).length ? arr(site.transitions_enabled) : T.defaults).filter(T.has)
  };
  const MODES = [["random", "Random: a different one each time"], ["cycle", "In order, one after another"], ["single", "Always the same one"], ["off", "None: pages just appear"]];
  v.innerHTML = `
    <div class="pagehead">
      <div><h1>Transitions</h1><div class="sub">How the site moves from one page to the next. Every one is borrowed from film-making. Switch on the ones you like, try them on the screen below, then save. "Dive in" is the one where clicking a card makes its picture grow to fill the screen.</div></div>
      <div class="headbtns"><button class="btn btn-primary" id="saveTr">Save</button></div>
    </div>
    <div class="panel"><h2>How they are used</h2>
      <div class="formgrid" id="trForm">
        ${fieldHTML({ k: "mode", label: "Mode", type: "select", options: MODES, span: 2 }, st.mode)}
        ${fieldHTML({ k: "single", label: "The one to always use", type: "select", options: T.list.map(t => [t.id, t.name]) }, st.single)}
        ${fieldHTML({ k: "speed", label: "Speed", type: "select", options: [["fast", "Fast"], ["normal", "Normal"], ["relaxed", "Relaxed"]] }, st.speed)}
      </div></div>
    <div class="panel"><h2>Try them</h2>
      <div class="demo" id="demo"></div>
      <div class="headbtns" style="margin-top:14px"><button class="btn btn-ghost" id="playSet">▶ Play my set, one after another</button><span class="muted" id="demoName"></span></div></div>
    <div class="tgrid" id="tgrid"></div>`;

  /* the demo screen: two pages built from your own pictures */
  const demo = $("#demo", v);
  const imgs = S.photos.slice(0, 9).map(p => imgSrc(p.image, 640));
  let side = 0, busy = false;
  const page = (title, n) => {
    const d = document.createElement("div");
    d.className = "demo-layer";
    d.innerHTML = `<div class="demo-page"><h4>${title}<i>.</i></h4><div class="demo-row">${[0, 1, 2].map(i =>
      `<div class="demo-img" style="${imgs.length ? `background-image:url('${esc(imgs[(n * 3 + i) % imgs.length])}')` : ""}"></div>`).join("")}</div></div>`;
    return d;
  };
  demo.appendChild(page("FILMS", 0));
  const run = id => {
    if (busy) return Promise.resolve();
    busy = true;
    const from = demo.lastElementChild, next = 1 - side, to = page(next ? "PHOTOGRAPHY" : "FILMS", next);
    demo.insertBefore(to, from);
    const r = $$(".demo-img", from)[1].getBoundingClientRect();
    $("#demoName", v).textContent = T.list.find(t => t.id === id).name;
    return T.play(id, { stage: demo, from, to, force: true, speed: st.speed, dir: 1,
      origin: { x: r.left + r.width / 2, y: r.top + r.height / 2, rect: { left: r.left, top: r.top, width: r.width, height: r.height }, src: imgs.length ? imgs[(side * 3 + 1) % imgs.length] : "" } })
      .then(() => { from.remove(); side = next; busy = false; });
  };

  const paint = () => {
    $("#tgrid", v).innerHTML = T.list.map(t => {
      const on = st.enabled.indexOf(t.id) > -1;
      return `<div class="tcard ${on ? "on" : ""}"><div class="thead"><b>${esc(t.name)}</b><span class="toggle ${on ? "on" : ""}" data-t="${t.id}" title="${on ? "In use" : "Not in use"}"></span></div>
        <p>${esc(t.note)}</p><button type="button" class="btn btn-ghost btn-sm" data-try="${t.id}">▶ Preview</button></div>`;
    }).join("");
    $$("[data-t]", v).forEach(b => b.addEventListener("click", () => {
      const id = b.dataset.t, i = st.enabled.indexOf(id);
      if (i > -1) { if (st.enabled.length === 1) return toast("Keep at least one switched on.", "err"); st.enabled.splice(i, 1); } else st.enabled.push(id);
      paint();
    }));
    $$("[data-try]", v).forEach(b => b.addEventListener("click", () => run(b.dataset.try)));
  };
  paint();
  bindFields(v);
  const read = () => readFields($("#trForm", v), [{ k: "mode" }, { k: "single" }, { k: "speed" }], {});
  $("#trForm", v).addEventListener("change", () => { const x = read(); st.mode = x.mode; st.single = x.single; st.speed = x.speed; });
  $("#playSet", v).addEventListener("click", async () => {
    const list = T.list.filter(t => st.enabled.indexOf(t.id) > -1);
    for (const t of list) { await run(t.id); await new Promise(r => setTimeout(r, 650)); }
    $("#demoName", v).textContent = "";
  });
  $("#saveTr", v).addEventListener("click", async () => {
    showProgress("Saving transitions");
    try {
      const x = read();
      Object.assign(S.site, { transition_mode: x.mode, transition_single: x.single, transition_speed: x.speed,
        transitions_enabled: T.list.filter(t => st.enabled.indexOf(t.id) > -1).map(t => t.id) });
      await commitFiles("Update page transitions via Astris Studio", [{ path: PATHS.site, content: objToYAML(S.site) }]);
      hideProgress(); toast("Transitions saved ✓ Live in about a minute.", "ok");
    } catch (e) { hideProgress(); toast("Save failed: " + e.message, "err"); }
  });
}

/* ---------------- AI helper (optional): suggests titles and descriptions ---------------- */
let AI_STATE = null;
async function aiReady() {
  if (AI_STATE !== null) return AI_STATE;
  try { const r = await fetch("/api/describe"); AI_STATE = r.ok ? !!(await r.json()).ready : false; } catch (e) { AI_STATE = false; }
  return AI_STATE;
}
function aiBarHTML(label) {
  return `<div class="aibar"><button type="button" class="btn btn-ghost btn-sm" id="aiBtn">✨ ${label}</button><span class="muted" id="aiNote"></span></div>`;
}
function loadImg(src) {
  return new Promise((res, rej) => {
    const im = new Image(); im.crossOrigin = "anonymous";
    im.onload = () => res(im); im.onerror = () => rej(new Error("Couldn't read that picture"));
    im.src = src;
  });
}
async function jpegBase64(src, max) {
  const im = await loadImg(src), k = Math.min(1, (max || 1024) / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
  c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.82).split(",")[1];
}
async function photoJpeg(path) {
  try { return await jpegBase64(imgSrc(path, 1024), 1024); }
  catch (e) { return jpegBase64(rawUrl(path), 1024); }
}
async function aiAsk(payload) {
  const res = await fetch("/api/describe", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + S.token }, body: JSON.stringify(payload) });
  let j = {}; try { j = await res.json(); } catch (e) { /* ignore */ }
  if (!res.ok) throw new Error(j.message || ("The AI helper isn't available right now (" + res.status + ")."));
  return j;
}
async function aiRun(btn, fn) {
  const old = btn ? btn.innerHTML : "";
  if (btn) { btn.disabled = true; btn.textContent = "Thinking…"; }
  try { await fn(); return true; }
  catch (e) { toast(e.message, "err"); return false; }
  finally { if (btn && document.contains(btn)) { btn.disabled = false; btn.innerHTML = old; } }
}
async function aiBatchRowCore(r) {
  const out = await aiAsk({ kind: "photo", image: await jpegBase64(r.url, 1024), filename: r.file.name, camera: r.camera, lens: r.lens });
  if (out.title) r.title = out.title;
  if (out.description) r.description = out.description;
  if (out.caption && !r.caption) r.caption = out.caption;
  if (out.tags && out.tags.length && !r.tags.length) r.tags = out.tags;
}
function aiBatchRow(r, btn) { return aiRun(btn, () => aiBatchRowCore(r)); }
async function aiBulkPhotos(list) {
  if (!list.length) return;
  if (!(await aiReady())) return toast("The AI helper isn't switched on yet. See the README.", "err");
  if (!confirm(`Suggest a title and description for ${list.length} photo${list.length > 1 ? "s" : ""}? This replaces their current titles and descriptions. You can read them over before you save.`)) return;
  showProgress("Suggesting titles and descriptions");
  let n = 0;
  try {
    for (const p of list) {
      setProgress(n / list.length, `Looking at ${p.title || p.slug}…`);
      const out = await aiAsk({ kind: "photo", image: await photoJpeg(p.image), filename: p.slug, camera: p.camera, lens: p.lens });
      if (out.title) p.title = out.title;
      if (out.description) p.description = out.description;
      if (out.caption && !p.caption) p.caption = out.caption;
      if (out.tags && out.tags.length && !p.tags.length) p.tags = out.tags;
      S.dirty.add(p.slug); n++;
    }
    hideProgress(); render(); toast(`Suggestions added to ${n} photos. Read them over, then press Save.`, "ok");
  } catch (e) { hideProgress(); if (n) render(); toast(`Stopped after ${n}: ${e.message}`, "err"); }
}
function bindAI(el, kind, obj) {
  const btn = $("#aiBtn", el), note = $("#aiNote", el);
  if (!btn) return;
  aiReady().then(ok => { if (!ok && note) note.textContent = "Not switched on yet (see the README)."; });
  btn.addEventListener("click", () => aiRun(btn, async () => {
    const val = k => { const x = $(`[data-k="${k}"]`, el); return x ? x.value : ""; };
    const setv = (k, text) => { const x = $(`[data-k="${k}"]`, el); if (x && text) x.value = text; };
    if (kind === "photo") {
      const out = await aiAsk({ kind: "photo", image: await photoJpeg(obj.image), filename: obj.slug, camera: obj.camera, lens: obj.lens });
      setv("title", out.title); setv("description", out.description);
      if (!val("caption")) setv("caption", out.caption);
      if (out.tags && out.tags.length && !val("tags")) setv("tags", out.tags.join(", "));
    } else if (kind === "film") {
      const w = $('[data-media="thumbnail"]', el);
      let image = "";
      if (w && w._file) image = await jpegBase64(URL.createObjectURL(w._file), 1024);
      else if (obj.thumbnail) image = await photoJpeg(obj.thumbnail);
      const out = await aiAsk({ kind: "film", image, title: val("title"), type: val("type"), stage: val("stage"), current: val("description") });
      if (!val("title")) setv("title", out.title);
      setv("description", out.description);
    } else {
      const out = await aiAsk({ kind: "news", title: val("title"), body: val("body") });
      setv("summary", out.summary);
    }
    toast("Suggestion added. Read it over and edit as you like, then save.", "ok");
  }));
}

/* ---------------- boot ---------------- */
async function boot() {
  render();
  if (!S.token) return;
  try { await loadAll(); render(); }
  catch (e) {
    toast("Couldn't load the library: " + e.message, "err");
    if (/401|403/.test(e.message)) { localStorage.removeItem(TOKEN_KEY); S.token = ""; render(); }
  }
}
document.addEventListener("keydown", e => { if (e.key === "Escape") closeDrawer(); });
boot();
})();
