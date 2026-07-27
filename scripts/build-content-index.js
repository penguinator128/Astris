#!/usr/bin/env node
/* ============================================================
   Builds content-index.json from everything in content/.

   Why this exists: the public site used to read its content
   straight from the GitHub API on every page load. That API
   allows only 60 requests/hour for unauthenticated callers,
   counted per IP — so once a visitor crossed it the site fell
   back to a stale cached copy, or showed nothing at all. It
   also meant one HTTP request per content file (20+ per page).

   This script runs at deploy time and bakes everything into a
   single JSON file served from the site's own domain, so the
   public site needs no GitHub API access at all and loads in
   one request.

   Pure Node, zero dependencies — nothing to install at build.
   ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONTENT = path.join(ROOT, "content");
const OUT = path.join(ROOT, "content-index.json");

/* Same YAML subset the CMS and Studio emit: scalars, quoted
   strings, booleans, numbers, block lists (scalar and object
   items), inline [a, b] lists, and folded/literal block scalars. */
function parseYAML(src) {
  const out = {};
  const lines = String(src).replace(/\r/g, "").split("\n");
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
    const val = m[2];

    if (val === "") {
      const items = [];
      let j = i + 1;
      while (j < lines.length) {
        const l = lines[j];
        if (!l.trim()) { j++; continue; }
        const im = l.match(/^\s+-\s*(.*)$/);
        if (!im) break;
        const om = im[1].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (om) {
          const obj = {};
          obj[om[1]] = unquote(om[2]);
          const baseIndent = l.match(/^\s*/)[0].length;
          j++;
          while (j < lines.length) {
            const l2 = lines[j];
            if (!l2.trim()) { j++; continue; }
            const km = l2.match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
            if (!km || l2.match(/^\s*/)[0].length <= baseIndent || /^\s+-/.test(l2)) break;
            obj[km[1]] = unquote(km[2]);
            j++;
          }
          items.push(obj);
        } else {
          items.push(unquote(im[1]));
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
      out[key] = val.slice(1, -1).split(",").map(unquote).filter(x => x !== "");
      i++;
      continue;
    }

    out[key] = unquote(val);
    i++;
  }
  return out;
}

function parseFrontMatter(text) {
  const m = String(text).match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  const data = parseYAML(m ? m[1] : text);
  data.body = m ? (m[2] || "").trim() : "";
  return data;
}

function readDir(folder) {
  const dir = path.join(CONTENT, folder);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => /\.(md|yml|yaml)$/i.test(f))
    .map(f => {
      const data = parseFrontMatter(fs.readFileSync(path.join(dir, f), "utf8"));
      data._slug = f.replace(/\.(md|yml|yaml)$/i, "");
      return data;
    });
}

function build() {
  const settings = {};
  const settingsDir = path.join(CONTENT, "settings");
  if (fs.existsSync(settingsDir)) {
    for (const f of fs.readdirSync(settingsDir)) {
      if (!/\.(yml|yaml)$/i.test(f)) continue;
      const name = f.replace(/\.(yml|yaml)$/i, "");
      settings[name] = parseFrontMatter(fs.readFileSync(path.join(settingsDir, f), "utf8"));
    }
  }

  const index = {
    generated: new Date().toISOString(),
    photos: readDir("photos"),
    videos: readDir("videos"),
    news: readDir("news"),
    series: readDir("series"),
    settings
  };

  fs.writeFileSync(OUT, JSON.stringify(index));
  console.log(
    `content-index.json written: ${index.photos.length} photos, ` +
    `${index.videos.length} films, ${index.news.length} news, ` +
    `${index.series.length} series, ${Object.keys(settings).length} settings files`
  );
}

build();
