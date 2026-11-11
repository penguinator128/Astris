/* ASTRIS data layer: reads the content the Studio saves in the GitHub repo and turns it into plain objects.
   Same files and fields as before (content/photos, videos, news, series, settings), plus a few new optional ones. */
(function (root) {
  "use strict";

  var REPO = "penguinator128/Astris";
  var BRANCH = "main";
  var RAW = "https://raw.githubusercontent.com/" + REPO + "/" + BRANCH + "/";
  var CACHE_KEY = "astris_content_v4";
  var STAGES = ["Idea", "Writing", "Shooting", "Editing", "Finishing"];

  var D = { photos: [], films: [], news: [], series: [], site: {}, about: {}, contact: {}, ready: false, source: "" };

  /* ---------- small helpers ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function truthy(v) { return v === true || v === "true"; }
  function listify(v) {
    if (Array.isArray(v)) return v.filter(Boolean).map(String);
    if (v == null || v === "") return [];
    return [String(v)];
  }
  function clampNum(n, lo, hi) { n = Number(n); if (!isFinite(n)) return lo; return Math.min(hi, Math.max(lo, n)); }
  function fmtDate(d, opts) {
    if (!d) return "";
    var dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt)) return "";
    return dt.toLocaleDateString("en-AU", opts || { day: "numeric", month: "long", year: "numeric" });
  }
  function setting(key, def) {
    var v = D.site[key];
    return v === undefined || v === null || v === "" ? def : v;
  }
  function flag(key, def) {
    var v = D.site[key];
    if (v === undefined || v === null || v === "") return def;
    return !(v === false || v === "false");
  }

  /* ---------- YAML front-matter (the same small parser the site has always used) ---------- */
  function parseYAML(src) {
    var out = {};
    var lines = src.replace(/\r/g, "").split("\n");
    var i = 0;
    function unquote(v) {
      v = v.trim();
      if ((v.charAt(0) === '"' && v.charAt(v.length - 1) === '"') || (v.charAt(0) === "'" && v.charAt(v.length - 1) === "'"))
        return v.slice(1, -1).replace(/\\"/g, '"');
      if (v === "true") return true;
      if (v === "false") return false;
      if (v !== "" && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
      return v;
    }
    while (i < lines.length) {
      var line = lines[i];
      if (!line.trim() || line.trim().charAt(0) === "#") { i++; continue; }
      var m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!m) { i++; continue; }
      var key = m[1], val = m[2];

      if (val === "" || val == null) {
        var items = [], j = i + 1;
        while (j < lines.length) {
          var l = lines[j];
          if (!l.trim()) { j++; continue; }
          var im = l.match(/^\s+-\s*(.*)$/);
          if (!im) break;
          var rest = im[1], om = rest.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
          if (om) {
            var obj = {}; obj[om[1]] = unquote(om[2]);
            var baseIndent = l.match(/^\s*/)[0].length;
            j++;
            while (j < lines.length) {
              var l2 = lines[j];
              if (!l2.trim()) { j++; continue; }
              var ind = l2.match(/^\s*/)[0].length, km = l2.match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
              if (!km || ind <= baseIndent || /^\s+-/.test(l2)) break;
              obj[km[1]] = unquote(km[2]);
              j++;
            }
            items.push(obj);
          } else { items.push(unquote(rest)); j++; }
        }
        if (items.length) { out[key] = items; i = j; continue; }
        out[key] = ""; i++; continue;
      }
      if (/^[>|]/.test(val)) {
        var buf = [], j2 = i + 1;
        while (j2 < lines.length) {
          var l3 = lines[j2];
          if (l3.trim() && !/^\s/.test(l3)) break;
          buf.push(l3.replace(/^\s{2}/, "")); j2++;
        }
        out[key] = buf.join(val.charAt(0) === "|" ? "\n" : " ").trim(); i = j2; continue;
      }
      if (val.charAt(0) === "[" && val.charAt(val.length - 1) === "]") {
        out[key] = val.slice(1, -1).split(",").map(unquote).filter(function (s) { return s !== ""; });
        i++; continue;
      }
      out[key] = unquote(val); i++;
    }
    return out;
  }
  function parseFrontMatter(text) {
    var m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
    if (!m) return { data: parseYAML(text), body: "" };
    var data = parseYAML(m[1]);
    data.body = (m[2] || "").trim();
    return { data: data, body: data.body };
  }

  /* ---------- markdown (headings, lists, quotes, links, images, bold, italic) ---------- */
  function safeUrl(u) {
    u = String(u || "").trim();
    return /^(https?:\/\/|mailto:|#|\/|\.\/|images\/)/i.test(u) ? u : "#";
  }
  function md(src) {
    if (!src) return "";
    var blocks = String(src).replace(/\r/g, "").split(/\n{2,}/);
    function inline(s) {
      return esc(s)
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function (_, a, u) { return '<img src="' + esc(safeUrl(u)) + '" alt="' + a + '" loading="lazy">'; })
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, t, u) { return '<a href="' + esc(safeUrl(u.replace(/&amp;/g, "&"))) + '" target="_blank" rel="noopener">' + t + "</a>"; })
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\*([^*]+)\*/g, "<em>$1</em>")
        .replace(/`([^`]+)`/g, "<code>$1</code>");
    }
    return blocks.map(function (b) {
      var t = b.trim();
      if (!t) return "";
      if (/^###\s/.test(t)) return "<h4>" + inline(t.replace(/^###\s+/, "")) + "</h4>";
      if (/^##\s/.test(t)) return "<h3>" + inline(t.replace(/^##\s+/, "")) + "</h3>";
      if (/^#\s/.test(t)) return "<h2>" + inline(t.replace(/^#\s+/, "")) + "</h2>";
      if (/^>\s?/.test(t)) return "<blockquote>" + inline(t.replace(/^>\s?/gm, "")) + "</blockquote>";
      if (/^[-*]\s/.test(t)) return "<ul>" + t.split(/\n/).map(function (l) { return "<li>" + inline(l.replace(/^[-*]\s+/, "")) + "</li>"; }).join("") + "</ul>";
      if (/^\d+\.\s/.test(t)) return "<ol>" + t.split(/\n/).map(function (l) { return "<li>" + inline(l.replace(/^\d+\.\s+/, "")) + "</li>"; }).join("") + "</ol>";
      return "<p>" + inline(t).replace(/\n/g, "<br>") + "</p>";
    }).join("\n");
  }

  /* ---------- pictures: lighter copies for the page, the original for downloads ---------- */
  var SIZES = [256, 480, 640, 960, 1280, 1600, 2048];
  var OPT = { on: !/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(root.location.hostname) && root.location.protocol !== "file:", fails: 0 };
  function snap(w) { for (var i = 0; i < SIZES.length; i++) if (SIZES[i] >= w) return SIZES[i]; return SIZES[SIZES.length - 1]; }
  function isAbs(p) { return /^(https?:|data:|blob:)/i.test(p); }
  function sitePath(p) { return !p ? "" : isAbs(p) ? p : "/" + String(p).replace(/^\/+/, ""); }
  function rawUrl(p) { return !p ? "" : isAbs(p) ? p : RAW + String(p).replace(/^\/+/, ""); }
  function imgUrl(p, w) {
    var u = sitePath(p);
    if (!u || !w || !OPT.on || isAbs(u) || !/\.(jpe?g|png|webp)$/i.test(u)) return u;
    return "/_vercel/image?url=" + encodeURIComponent(u) + "&w=" + snap(w) + "&q=75";
  }
  /* an <img> that falls back by itself: optimised copy -> the file on the site -> the file on GitHub */
  function img(p, w, alt, cls, eager) {
    return '<img class="' + (cls || "") + '" src="' + esc(imgUrl(p, w)) + '" data-p="' + esc(p) + '" alt="' + esc(alt || "") + '" ' +
      (eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"') + ' decoding="async">';
  }
  function onImgError(e) {
    var t = e.target;
    if (!t || t.tagName !== "IMG" || !t.dataset || !t.dataset.p) return;
    var p = t.dataset.p, step = t.dataset.fb || "0";
    if (step === "0" && /\/_vercel\/image/.test(t.src)) {
      if (++OPT.fails >= 3) OPT.on = false;
      t.dataset.fb = "1"; t.src = sitePath(p);
    } else if (step !== "2" && !isAbs(p)) {
      t.dataset.fb = "2"; t.src = rawUrl(p);
    }
  }
  document.addEventListener("error", onImgError, true);

  /* ---------- shaping the raw files into data ---------- */
  function applyContent(raw) {
    D.site = raw.settings.site || {};
    D.about = raw.settings.about || {};
    D.contact = raw.settings.contact || {};
    if (D.site.image_optimize === false || D.site.image_optimize === "false") OPT.on = false;

    D.series = (raw.series || []).map(function (s) {
      return { title: s.title || s._slug, order: Number(s.order) || 999, description: s.description || "" };
    }).sort(function (a, b) { return a.order - b.order || a.title.localeCompare(b.title); });

    D.photos = (raw.photos || []).map(function (p) {
      var date = p.date ? new Date(p.date) : null;
      return {
        slug: p._slug, title: p.title || "", image: p.image || "", caption: p.caption || "",
        description: p.description || "", story: p.story || "",
        series: listify(p.series).length ? listify(p.series) : listify(p.project),
        tags: listify(p.tags),
        date: date && !isNaN(date) ? date : null,
        camera: p.camera || "", lens: p.lens || "",
        iso: p.iso === 0 ? "" : String(p.iso || ""),
        aperture: p.aperture || "", shutter: p.shutter_speed || "", focal: p.focal_length || "",
        featured: truthy(p.featured), featuredOrder: Number(p.featured_order) || 999,
        download: truthy(p.download) || truthy(p.downloadable)
      };
    }).filter(function (p) { return p.image; }).sort(function (a, b) { return (b.date || 0) - (a.date || 0); });

    D.films = (raw.videos || []).map(function (v) {
      var url = String(v.video_url || "");
      var yt = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
      var vm = url.match(/vimeo\.com\/(\d+)/);
      var date = v.date ? new Date(v.date) : null, vd = date && !isNaN(date) ? date : null;
      var status = String(v.status || "").toLowerCase();
      var wip = /progress|wip|making|production|upcoming/.test(status);
      var progress = clampNum(v.progress, 0, 100);
      var stage = String(v.stage || "");
      if (!stage || STAGES.indexOf(stage) < 0) stage = STAGES[Math.min(4, Math.floor(progress / 20))];
      var ud = v.update_date ? new Date(v.update_date) : null;
      return {
        slug: v._slug, title: v.title || "", file: v.video || "", url: url,
        yt: yt ? yt[1] : null, vimeo: vm ? vm[1] : null,
        thumb: v.thumbnail || (yt ? "https://i.ytimg.com/vi/" + yt[1] + "/hqdefault.jpg" : ""),
        length: v.length || "", type: v.type || "",
        year: v.year ? String(v.year) : (vd ? String(vd.getFullYear()) : ""),
        date: vd, description: v.description || v.body || "",
        featured: truthy(v.featured), featuredOrder: Number(v.featured_order) || 999,
        wip: wip, progress: progress, stage: stage, update: v.update || "", updateDate: ud && !isNaN(ud) ? ud : null,
        role: v.role || "", credits: v.credits || "", gallery: listify(v.gallery)
      };
    }).sort(function (a, b) { return (b.date || 0) - (a.date || 0); });

    D.news = (raw.news || []).map(function (n) {
      return {
        slug: n._slug, title: n.title || "", date: n.date ? new Date(n.date) : null,
        summary: n.summary || (n.body || "").replace(/[#>*_\[\]()]/g, "").slice(0, 160),
        image: n.image || "", body: n.body || "", tags: listify(n.tags), gallery: listify(n.gallery)
      };
    }).sort(function (a, b) { return (b.date || 0) - (a.date || 0); });

    D.ready = true;
  }

  /* ---------- loading: instant from the last visit, fast from the built snapshot, then live from GitHub ---------- */
  function filesToRaw(files) {
    var raw = { photos: [], videos: [], news: [], series: [], settings: {} };
    files.forEach(function (f) {
      if (!f.text) return;
      var parts = f.path.split("/"), folder = parts[1], name = parts[parts.length - 1].replace(/\.(md|yml|yaml)$/i, "");
      var data = parseFrontMatter(f.text).data;
      data._slug = name;
      if (folder === "settings") raw.settings[name] = data;
      else if (raw[folder]) raw[folder].push(data);
    });
    return raw;
  }
  function sig(files) {
    return files.map(function (f) { return f.path + "\u0001" + f.text; }).sort().join("\u0002");
  }
  function readCache() {
    try { var c = JSON.parse(localStorage.getItem(CACHE_KEY)); return c && c.files ? c.files : null; } catch (e) { return null; }
  }
  function writeCache(files) { try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), files: files })); } catch (e) { /* ignore */ } }

  function fetchSnapshot() {
    return fetch("/content-snapshot.json", { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("no snapshot");
      return r.json();
    }).then(function (j) { if (!j || !j.files || !j.files.length) throw new Error("empty snapshot"); return j.files; });
  }
  function fetchLive() {
    return fetch("https://api.github.com/repos/" + REPO + "/git/trees/" + BRANCH + "?recursive=1").then(function (r) {
      if (!r.ok) throw new Error("GitHub tree " + r.status);
      return r.json();
    }).then(function (j) {
      var wanted = (j.tree || []).filter(function (n) { return n.type === "blob" && /^content\/(photos|videos|news|series|settings)\/.+\.(md|yml|yaml)$/i.test(n.path); });
      return Promise.all(wanted.map(function (n) {
        return fetch(RAW + n.path).then(function (r) { return r.ok ? r.text() : ""; }).then(function (t) { return { path: n.path, text: t }; });
      }));
    });
  }

  /* load(onUpdate) -> Promise that resolves when the first data is ready.
     onUpdate(D) is called again if newer content turns up afterwards. */
  function load(onUpdate) {
    var current = null, settled = false, resolveFirst, failFirst;
    var first = new Promise(function (res, rej) { resolveFirst = res; failFirst = rej; });
    function take(files, source) {
      var s = sig(files);
      if (s === current) return;
      var wasReady = settled;
      current = s;
      applyContent(filesToRaw(files));
      D.source = source;
      writeCache(files);
      if (!settled) { settled = true; resolveFirst(D); } else if (wasReady && onUpdate) onUpdate(D);
    }
    var cached = readCache();
    if (cached) take(cached, "cache");
    var tries = [
      fetchSnapshot().then(function (f) { take(f, "snapshot"); return true; }, function () { return false; }),
      fetchLive().then(function (f) { take(f, "live"); return true; }, function () { return false; })
    ];
    Promise.all(tries).then(function (r) { if (!settled && !r[0] && !r[1]) failFirst(new Error("Couldn't load the content")); });
    return first;
  }

  root.AstrisData = {
    D: D, STAGES: STAGES, REPO: REPO, RAW: RAW,
    esc: esc, truthy: truthy, listify: listify, fmtDate: fmtDate, setting: setting, flag: flag,
    parseYAML: parseYAML, parseFrontMatter: parseFrontMatter, md: md,
    imgUrl: imgUrl, img: img, sitePath: sitePath, rawUrl: rawUrl, load: load
  };
})(window);
