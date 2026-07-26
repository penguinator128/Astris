/* ============================================================
   ASTRIS STUDIO — the control centre for the whole website.
   Reads and writes content directly in the GitHub repository;
   Vercel redeploys the public site on every commit.
   ============================================================ */
(() => {
"use strict";

const REPO = "penguinator128/Astris";
const BRANCH = "main";
const API = "https://api.github.com";
const TOKEN_KEY = "astris_studio_token";
const SITE_URL = location.origin;

const FILM_TYPES = ["Documentary", "Narrative", "Commercial", "Short Film", "Travel",
                    "Experimental", "Behind the Scenes", "Music Video", "Other"];

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
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
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
    `featured: ${f.featured === true}\nfeatured_order: ${Number(f.featuredOrder) || 999}\n---\n`;
}
function newsToMD(n) {
  return "---\n" +
    `title: ${yq(n.title)}\ndate: ${yq(n.date)}\nsummary: ${yq(n.summary)}\nimage: ${yq(n.image)}\n---\n` +
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
      featured: truthy(d.featured), featuredOrder: Number(d.featured_order) || 999
    };
  }))).sort((a, b) => String(b.date).localeCompare(String(a.date)));

  S.news = (await Promise.all(pick(/^content\/news\/.+\.md$/).map(async n => {
    const d = parseFM(await raw(n.path));
    return {
      path: n.path, slug: n.path.split("/").pop().replace(/\.md$/, ""),
      title: d.title || "", date: d.date || "", summary: d.summary || "",
      image: d.image || "", body: d.body || ""
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
      control = `<select id="${id}" data-k="${f.k}">${f.options.map(o =>
        `<option value="${esc(o)}" ${String(val) === String(o) ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
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
  if (/\.(mp4|webm|mov|m4v)$/i.test(val)) return `<video class="prev" src="${esc(val)}" muted></video>`;
  return `<img class="prev" src="${esc(val)}" alt="">`;
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
  return values;
}

/* ---------------- app render ---------------- */
function render() {
  const root = $("#root");
  if (!S.token) return renderSetup(root);
  if (!S.loaded) {
    root.innerHTML = `<div class="setup splash">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="12" r="9"></circle><path d="M12 3v4M12 17v4M3 12h4M17 12h4"></path></svg>
      <h1 style="font-size:24px;margin-top:18px">Astris Studio</h1>
      <p class="muted" style="margin-top:10px">Loading your library…</p></div>`;
    return;
  }
  const nav = [
    ["Library", [["dashboard", "Dashboard", ""], ["photos", "Photos", S.photos.length],
                 ["batch", "Batch Upload", ""], ["films", "Films", S.films.length],
                 ["news", "News", S.news.length], ["downloads", "Downloads", S.photos.filter(p => p.download).length]]],
    ["Organise", [["series", "Series", S.series.length], ["tags", "Tags", new Set(S.photos.flatMap(p => p.tags)).size],
                  ["banner", "Hero Banner", ""]]],
    ["Website", [["home", "Homepage", ""], ["pages", "About & Contact", ""], ["settings", "Site Settings", ""]]]
  ];
  root.innerHTML = `<div class="layout">
    <aside class="side">
      <span class="brand">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"></circle><path d="M12 3v4M12 17v4M3 12h4M17 12h4"></path></svg>
        <span>ASTRIS<small>STUDIO</small></span>
      </span>
      ${nav.map(([g, items]) => `<div class="group">${g}</div>` + items.map(([id, label, count]) =>
        `<button class="tab ${S.view === id ? "active" : ""}" data-view="${id}">${label}${count !== "" ? `<span class="count">${count}</span>` : ""}</button>`).join("")).join("")}
      <div class="foot">
        <a href="${SITE_URL}/" target="_blank">View website ↗</a>
        <a href="${SITE_URL}/admin/cms.html" target="_blank">Classic editor ↗</a>
        <span>${esc(S.user ? S.user.login : "")}</span>
        <a href="#" id="logout">Sign out</a>
      </div>
    </aside>
    <main class="main" id="view"></main>
  </div>`;
  $$(".tab", root).forEach(b => b.addEventListener("click", () => { S.view = b.dataset.view; render(); }));
  $("#logout").addEventListener("click", e => {
    e.preventDefault(); localStorage.removeItem(TOKEN_KEY); location.reload();
  });
  const views = { dashboard: vDashboard, photos: vPhotos, batch: vBatch, films: vFilms, news: vNews,
                  downloads: vDownloads, series: vSeries, tags: vTags, banner: vBanner,
                  home: vHome, pages: vPages, settings: vSettings };
  (views[S.view] || vDashboard)($("#view"));
}

/* ---------------- setup ---------------- */
function renderSetup(root) {
  root.innerHTML = `<div class="setup">
    <h1>Astris Studio</h1>
    <p class="muted" style="margin:12px 0 28px">The control centre for your portfolio — photos, films, news, pages and every site setting. It writes straight to your GitHub repository, so it needs a token once per browser.</p>
    <div class="panel">
      <h2>Connect to GitHub</h2>
      <ol>
        <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank">Fine-grained personal access tokens</a></li>
        <li>Repository access → <code>Only select repositories</code> → <code>penguinator128/Astris</code></li>
        <li>Permissions → Repository permissions → <code>Contents: Read and write</code></li>
        <li>Generate, copy, and paste it below.</li>
      </ol>
      <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">
        <input id="tokenInput" type="password" placeholder="github_pat_… or ghp_…" style="flex:1;min-width:250px">
        <button class="btn btn-primary" id="tokenSave">Connect</button>
      </div>
      <p class="muted" id="tokenMsg" style="margin-top:11px">Stored only in this browser.</p>
    </div>
  </div>`;
  $("#tokenSave").addEventListener("click", async () => {
    const t = $("#tokenInput").value.trim();
    if (!t) return;
    $("#tokenMsg").textContent = "Checking token…";
    S.token = t;
    try {
      await gh(`/repos/${REPO}`);
      localStorage.setItem(TOKEN_KEY, t);
      boot();
    } catch (e) {
      S.token = "";
      $("#tokenMsg").textContent = "That token couldn't reach the repository — check its permissions. (" + e.message + ")";
    }
  });
}

/* ---------------- dashboard ---------------- */
function vDashboard(v) {
  const recent = S.photos.slice(0, 6);
  const stats = [
    [S.photos.length, "Photos"], [S.films.length, "Films"], [S.news.length, "News posts"],
    [S.photos.filter(p => p.download).length, "Downloads on"],
    [S.photos.filter(p => p.featured).length + S.films.filter(f => f.featured).length, "Featured"],
    [S.series.length, "Series"], [new Set(S.photos.flatMap(p => p.tags)).size, "Tags"]
  ];
  v.innerHTML = `
    <div class="pagehead">
      <div><h1>Dashboard</h1><div class="sub">Everything on the site, managed from here. Changes publish to the live site within about a minute.</div></div>
      <div class="headbtns">
        <a class="btn btn-ghost" href="${SITE_URL}/" target="_blank">Preview site ↗</a>
        <button class="btn btn-primary" data-go="batch">+ Batch upload</button>
      </div>
    </div>
    <div class="cards">${stats.map(([n, l]) => `<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`).join("")}</div>
    <div class="panel"><h2>Quick actions</h2>
      <div style="display:flex;gap:9px;flex-wrap:wrap">
        ${[["batch", "Batch upload photos"], ["photos", "Edit photo library"], ["films", "Add / edit films"],
           ["news", "Write a news post"], ["banner", "Arrange hero banner"], ["series", "Manage series"],
           ["tags", "Manage tags"], ["home", "Homepage sections"], ["pages", "About & Contact"],
           ["settings", "Site settings"]]
          .map(([g, l]) => `<button class="btn btn-ghost btn-sm" data-go="${g}">${l}</button>`).join("")}
      </div></div>
    <div class="panel panel-flush"><div style="padding:20px 22px 0"><h2>Recent uploads</h2></div>
      ${recent.length ? `<table class="grid"><thead><tr><th></th><th>Title</th><th>Date</th><th>Series</th><th>Flags</th></tr></thead><tbody>
        ${recent.map(p => `<tr><td><img class="thumb" src="${esc(p.image)}" loading="lazy"></td>
          <td>${esc(p.title)}</td><td class="muted">${esc(String(p.date).slice(0, 10))}</td>
          <td>${p.series.map(s => `<span class="pill">${esc(s)}</span>`).join("")}</td>
          <td>${p.featured ? '<span class="pill pill-accent">featured</span>' : ""}${p.download ? '<span class="pill pill-ok">download</span>' : ""}</td>
        </tr>`).join("")}</tbody></table>` : `<p class="muted" style="padding:0 22px 22px">No photos yet — start with a batch upload.</p>`}
    </div>`;
  $$("[data-go]", v).forEach(b => b.addEventListener("click", () => { S.view = b.dataset.go; render(); }));
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
      <button class="btn btn-danger btn-sm" data-bulk="delete">Delete</button>
    </div>` : ""}
    <datalist id="seriesList">${S.series.map(s => `<option value="${esc(s.title)}">`).join("")}</datalist>
    <div class="panel panel-flush"><table class="grid"><thead><tr>
      <th><input type="checkbox" id="selAll" ${sel.size && sel.size === S.photos.length ? "checked" : ""}></th>
      <th></th><th>Title</th><th>Series / tags</th><th>Date</th><th>Featured</th><th>Download</th><th></th>
    </tr></thead><tbody>
      ${S.photos.map((p, i) => `<tr data-i="${i}" class="${S.dirty.has(p.slug) ? "dirty" : ""}">
        <td><input type="checkbox" class="rowSel" ${sel.has(p.slug) ? "checked" : ""}></td>
        <td><img class="thumb" src="${esc(p.image)}" loading="lazy"></td>
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
    extra: `<img src="${esc(p.image)}" style="width:100%;border-radius:7px;margin-bottom:20px">`,
    onSave: async (vals, changes) => {
      Object.assign(p, vals, { featuredOrder: Number(vals.featuredOrder) || 999 });
      changes.push({ path: p.path, content: photoToMD(p) });
      return `Update photo: ${p.title}`;
    },
    onDelete: async () => { await deletePhotos([p]); }
  });
}

/* ---------------- films ---------------- */
const FILM_FIELDS = [
  { k: "title", label: "Film title", span: 2 },
  { k: "type", label: "Film type", type: "select", options: ["", ...FILM_TYPES], span: 2 },
  { k: "description", label: "Description", type: "textarea", rows: 3, span: 4 },
  { k: "video_url", label: "YouTube / Vimeo URL", span: 4, help: "Preferred — paste a link and the thumbnail is generated automatically." },
  { k: "video", label: "Or upload a video file", type: "media", accept: "video/*", span: 2 },
  { k: "thumbnail", label: "Thumbnail", type: "media", accept: "image/*", span: 2 },
  { k: "year", label: "Year" }, { k: "length", label: "Length", placeholder: "4 min 10s" },
  { k: "date", label: "Date made", type: "datetime", span: 2 },
  { k: "featured", label: "Featured (hero banner)", type: "bool" },
  { k: "featuredOrder", label: "Banner order", type: "number" }
];
function vFilms(v) {
  v.innerHTML = `
    <div class="pagehead">
      <div><h1>Films</h1><div class="sub">Year and type appear as badges on the public film cards. Link YouTube or Vimeo, or upload a file directly.</div></div>
      <div class="headbtns"><a class="btn btn-ghost" href="${SITE_URL}/#/films" target="_blank">Preview ↗</a>
      <button class="btn btn-primary" id="newFilm">+ New film</button></div>
    </div>
    <div class="panel panel-flush">${S.films.length ? `<table class="grid">
      <thead><tr><th></th><th>Title</th><th>Type</th><th>Year</th><th>Source</th><th>Featured</th><th></th></tr></thead>
      <tbody>${S.films.map((f, i) => `<tr data-i="${i}">
        <td>${f.thumbnail ? `<img class="thumb" src="${esc(f.thumbnail)}" loading="lazy">` : `<div class="thumb"></div>`}</td>
        <td><strong>${esc(f.title)}</strong></td>
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
                     length: "", date: new Date().toISOString(), description: "", featured: false, featuredOrder: 999 };
  openDrawer({
    title: isNew ? "New film" : val.title,
    fields: FILM_FIELDS, values: val,
    onSave: async (vals, changes) => {
      const film = { ...val, ...vals, featuredOrder: Number(vals.featuredOrder) || 999 };
      if (!film.title.trim()) throw new Error("A film needs a title.");
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
}

/* ---------------- news ---------------- */
const NEWS_FIELDS = [
  { k: "title", label: "Title", span: 3 },
  { k: "date", label: "Date", type: "datetime" },
  { k: "summary", label: "Summary", type: "textarea", rows: 2, span: 4, help: "Short teaser shown on the news cards." },
  { k: "image", label: "Featured image", type: "media", accept: "image/*", span: 4 },
  { k: "body", label: "Body", type: "textarea", rows: 14, span: 4, help: "Markdown: # heading, **bold**, *italic*, - list, > quote, [link](url)." }
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
        <td>${n.image ? `<img class="thumb" src="${esc(n.image)}" loading="lazy">` : `<div class="thumb"></div>`}</td>
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
  const val = n || { title: "", date: new Date().toISOString(), summary: "", image: "", body: "" };
  openDrawer({
    title: isNew ? "New post" : val.title,
    fields: NEWS_FIELDS, values: val,
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
        <td><img class="thumb" src="${esc(p.image)}" loading="lazy"></td>
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

/* ---------------- hero banner ---------------- */
const HERO_FIELDS = [
  { k: "hero_title", label: "Hero title", span: 2, help: "The large word in the centre of the banner." },
  { k: "hero_subtitle", label: "Hero subtitle", span: 2 },
  { k: "hero_background", label: "Background source", type: "select", options: ["photos", "videos", "both"], span: 2,
    help: "Which featured items fill the banner." },
  { k: "hero_video", label: "Showreel video (optional)", type: "media", accept: "video/*", span: 2,
    help: "If set, plays as the first hero slide." },
  { k: "hero_cta_label", label: "Button label", span: 2 },
  { k: "hero_cta_destination", label: "Button destination", type: "select",
    options: ["auto", "photography", "films", "news", "about", "contact"], span: 2,
    help: "'auto' opens the featured item itself." },
  { k: "hero_autoplay", label: "Auto rotation", type: "bool" },
  { k: "hero_interval", label: "Interval (seconds)", type: "number", min: 3, max: 20 }
];
function vBanner(v) {
  const feat = [
    ...S.photos.filter(p => p.featured).map(p => ({ ...p, kind: "photo", ref: p })),
    ...S.films.filter(f => f.featured).map(f => ({ ...f, kind: "video", ref: f }))
  ].sort((a, b) => a.featuredOrder - b.featuredOrder);

  v.innerHTML = `
    <div class="pagehead">
      <div><h1>Hero banner</h1><div class="sub">The signature banner: your title in the centre, the featured project in a card near the bottom. Slides advance horizontally.</div></div>
      <div class="headbtns"><a class="btn btn-ghost" href="${SITE_URL}/" target="_blank">Preview ↗</a>
      <button class="btn btn-primary" id="saveHero">Save banner</button></div>
    </div>
    <div class="panel"><h2>Banner settings</h2>
      <div class="formgrid" id="heroForm">${HERO_FIELDS.map(f => fieldHTML(f, S.site[f.k])).join("")}</div></div>
    <div class="panel panel-flush"><div style="padding:20px 22px 0"><h2>Order</h2>
      <p class="hint">The first five appear in the banner. Feature photos from the Photos library and films from the Films page.</p></div>
      ${feat.length ? `<table class="grid"><tbody id="rows">
        ${feat.map((x, i) => `<tr data-i="${i}">
          <td class="muted" style="width:34px">${i + 1}</td>
          <td style="width:130px">${x.kind === "photo"
            ? `<img class="thumb-lg" src="${esc(x.image)}">`
            : (x.thumbnail ? `<img class="thumb-lg" src="${esc(x.thumbnail)}">` : `<div class="thumb-lg"></div>`)}</td>
          <td><strong>${esc(x.title)}</strong>
            <div><span class="pill ${x.kind === "video" ? "pill-accent" : ""}">${x.kind}</span>
            ${i < 5 ? '<span class="pill pill-ok">in banner</span>' : '<span class="pill">overflow</span>'}</div></td>
          <td style="text-align:right;white-space:nowrap">
            <button class="iconbtn" data-m="up" ${i === 0 ? "disabled" : ""}>↑</button>
            <button class="iconbtn" data-m="down" ${i === feat.length - 1 ? "disabled" : ""}>↓</button>
            <button class="iconbtn" data-m="out" title="Remove from banner">✕</button></td></tr>`).join("")}
      </tbody></table>` : `<p class="muted" style="padding:0 22px 22px">Nothing featured yet — feature photos or films to fill the banner.</p>`}</div>`;

  bindFields($("#heroForm", v));
  const pending = new Set();
  $$("#rows tr", v).forEach(tr => {
    $$("[data-m]", tr).forEach(b => b.addEventListener("click", () => {
      const i = Number(tr.dataset.i), m = b.dataset.m;
      if (m === "up" && i > 0) [feat[i - 1], feat[i]] = [feat[i], feat[i - 1]];
      if (m === "down" && i < feat.length - 1) [feat[i + 1], feat[i]] = [feat[i], feat[i + 1]];
      if (m === "out") { feat[i].ref.featured = false; pending.add(feat[i].ref); feat.splice(i, 1); }
      feat.forEach((x, k) => {
        if (x.ref.featuredOrder !== k + 1) { x.ref.featuredOrder = k + 1; pending.add(x.ref); }
      });
      S._heroPending = pending;
      vBanner(v);
      if (S._heroPending) S._heroPending.forEach(p => pending.add(p));
    }));
  });
  if (S._heroPending) { S._heroPending.forEach(p => pending.add(p)); }

  $("#saveHero", v).addEventListener("click", async () => {
    showProgress("Saving banner");
    try {
      const changes = [];
      const vals = await stagePickers($("#heroForm", v), readFields($("#heroForm", v), HERO_FIELDS, {}), changes);
      Object.assign(S.site, vals);
      changes.push({ path: PATHS.site, content: objToYAML(S.site) });
      pending.forEach(item => {
        const isPhoto = S.photos.includes(item);
        changes.push({ path: item.path, content: isPhoto ? photoToMD(item) : filmToMD(item) });
      });
      await commitFiles("Update hero banner via Astris Studio", changes);
      S._heroPending = null;
      hideProgress(); toast("Banner saved ✓", "ok");
      await reload();
    } catch (e) { hideProgress(); toast("Save failed: " + e.message, "err"); }
  });
}

/* ---------------- homepage sections ---------------- */
const HOME_SECTIONS = [
  { key: "photos", name: "Latest Photos", fields: [
    { k: "home_photos_enabled", label: "Visible", type: "bool" },
    { k: "home_photos_order", label: "Order", type: "number" },
    { k: "home_latest_photos_kicker", label: "Kicker" },
    { k: "home_latest_photos_heading", label: "Heading" },
    { k: "home_latest_photos_link", label: "Link label" }] },
  { key: "films", name: "Latest Films", fields: [
    { k: "home_films_enabled", label: "Visible", type: "bool" },
    { k: "home_films_order", label: "Order", type: "number" },
    { k: "home_latest_films_kicker", label: "Kicker" },
    { k: "home_latest_films_heading", label: "Heading" },
    { k: "home_latest_films_link", label: "Link label" }] },
  { key: "selected", name: "Selected Work", fields: [
    { k: "home_selected_enabled", label: "Visible", type: "bool" },
    { k: "home_selected_order", label: "Order", type: "number" },
    { k: "home_selected_kicker", label: "Kicker" },
    { k: "home_selected_heading", label: "Heading" },
    { k: "home_selected_intro", label: "Intro", span: 2 }] },
  { key: "about", name: "About Preview", fields: [
    { k: "home_about_enabled", label: "Visible", type: "bool" },
    { k: "home_about_order", label: "Order", type: "number" }] },
  { key: "news", name: "News Preview", fields: [
    { k: "home_news_enabled", label: "Visible", type: "bool" },
    { k: "home_news_order", label: "Order", type: "number" },
    { k: "home_news_kicker", label: "Kicker" },
    { k: "home_news_heading", label: "Heading" },
    { k: "home_news_link", label: "Link label" }] }
];
function vHome(v) {
  v.innerHTML = `
    <div class="pagehead">
      <div><h1>Homepage</h1><div class="sub">Rename, reorder or hide any section of the homepage. Lower order numbers appear first.</div></div>
      <div class="headbtns"><a class="btn btn-ghost" href="${SITE_URL}/" target="_blank">Preview ↗</a>
      <button class="btn btn-primary" id="saveHome">Save homepage</button></div>
    </div>
    <div id="homeForm">
      ${HOME_SECTIONS.map(s => `<div class="panel"><h2>${esc(s.name)}</h2>
        <div class="formgrid">${s.fields.map(f => fieldHTML(f, S.site[f.k])).join("")}</div></div>`).join("")}
    </div>
    <div class="panel"><h2>About preview text</h2>
      <p class="hint">Shown in the About band on the homepage.</p>
      <div class="formgrid" id="aboutPrev">
        ${fieldHTML({ k: "home_heading", label: "Heading", span: 2 }, S.about.home_heading)}
        ${fieldHTML({ k: "home_text", label: "Text", type: "textarea", rows: 2, span: 2 }, S.about.home_text)}
      </div></div>`;
  bindFields(v);
  $("#saveHome", v).addEventListener("click", async () => {
    showProgress("Saving homepage");
    try {
      const all = HOME_SECTIONS.flatMap(s => s.fields);
      Object.assign(S.site, readFields($("#homeForm", v), all, {}));
      Object.assign(S.about, readFields($("#aboutPrev", v),
        [{ k: "home_heading" }, { k: "home_text" }], {}));
      await commitFiles("Update homepage sections via Astris Studio", [
        { path: PATHS.site, content: objToYAML(S.site) },
        { path: PATHS.about, content: objToYAML(S.about) }
      ]);
      hideProgress(); toast("Homepage saved ✓", "ok");
    } catch (e) { hideProgress(); toast("Save failed: " + e.message, "err"); }
  });
}

/* ---------------- about & contact ---------------- */
const ABOUT_FIELDS = [
  { k: "kicker", label: "Kicker" }, { k: "heading", label: "Heading", span: 3 },
  { k: "intro", label: "Intro", type: "textarea", rows: 2, span: 4 },
  { k: "image", label: "Profile photo", type: "media", accept: "image/*", span: 2 },
  { k: "capabilities", label: "Capabilities", type: "list", span: 2, help: "Shown as chips." },
  { k: "body", label: "Biography", type: "textarea", rows: 10, span: 4, help: "Markdown supported." },
  { k: "button_label", label: "Button label", span: 2 },
  { k: "button_url", label: "Button destination", span: 2, help: "e.g. #/contact" },
  { k: "links", label: "Extra links", type: "pairs", span: 4 }
];
const CONTACT_FIELDS = [
  { k: "kicker", label: "Kicker" }, { k: "heading", label: "Heading", span: 3 },
  { k: "intro", label: "Intro", type: "textarea", rows: 2, span: 4 },
  { k: "email", label: "Work email", span: 2 },
  { k: "email_note", label: "Note under the email", span: 2 },
  { k: "location", label: "Based in", span: 2 },
  { k: "availability", label: "Availability", span: 2 },
  { k: "socials", label: "Social links", type: "pairs", span: 4, help: "Only links with a URL are shown." }
];
function vPages(v) {
  v.innerHTML = `
    <div class="pagehead">
      <div><h1>About &amp; Contact</h1><div class="sub">Everything on both pages. The contact page shows your details only — there is no form, by design.</div></div>
      <div class="headbtns"><a class="btn btn-ghost" href="${SITE_URL}/#/about" target="_blank">Preview ↗</a>
      <button class="btn btn-primary" id="savePages">Save pages</button></div>
    </div>
    <div class="panel"><h2>About page</h2><div class="formgrid" id="aboutForm">
      ${ABOUT_FIELDS.map(f => fieldHTML(f, S.about[f.k])).join("")}</div></div>
    <div class="panel"><h2>Contact page</h2><div class="formgrid" id="contactForm">
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
      await commitFiles("Update About & Contact via Astris Studio", changes);
      hideProgress(); toast("Pages saved ✓", "ok");
      await reload();
    } catch (e) { hideProgress(); toast("Save failed: " + e.message, "err"); }
  });
}

/* ---------------- site settings ---------------- */
const SETTINGS_GROUPS = [
  { name: "Brand", fields: [
    { k: "brand", label: "Brand name", span: 2 }, { k: "tagline", label: "Tagline", span: 2 }] },
  { name: "Page headers", fields: [
    { k: "photography_kicker", label: "Photography kicker" }, { k: "photography_heading", label: "Photography heading" },
    { k: "photography_intro", label: "Photography intro", span: 2 },
    { k: "films_kicker", label: "Films kicker" }, { k: "films_heading", label: "Films heading" },
    { k: "films_intro", label: "Films intro", span: 2 },
    { k: "downloads_kicker", label: "Downloads kicker" }, { k: "downloads_heading", label: "Downloads heading" },
    { k: "downloads_intro", label: "Downloads intro", span: 2 },
    { k: "news_kicker", label: "News kicker" }, { k: "news_heading", label: "News heading" },
    { k: "news_intro", label: "News intro", span: 2 }] },
  { name: "Navigation labels", fields: [
    { k: "nav_home", label: "Home" }, { k: "nav_films", label: "Films" },
    { k: "nav_photography", label: "Photography" }, { k: "nav_downloads", label: "Downloads" },
    { k: "nav_news", label: "News" }, { k: "nav_about", label: "About" }, { k: "nav_contact", label: "Contact" }] },
  { name: "Footer", fields: [
    { k: "footer_text", label: "Copyright / footer text", span: 2 },
    { k: "footer_note", label: "Extra note", span: 2 }] }
];
function vSettings(v) {
  v.innerHTML = `
    <div class="pagehead">
      <div><h1>Site settings</h1><div class="sub">Headings, navigation labels and footer text across the whole site — no code required.</div></div>
      <div class="headbtns"><a class="btn btn-ghost" href="${SITE_URL}/" target="_blank">Preview ↗</a>
      <button class="btn btn-primary" id="saveSettings">Save settings</button></div>
    </div>
    <div id="setForm">${SETTINGS_GROUPS.map(g => `<div class="panel"><h2>${esc(g.name)}</h2>
      <div class="formgrid">${g.fields.map(f => fieldHTML(f, S.site[f.k])).join("")}</div></div>`).join("")}</div>`;
  bindFields(v);
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
