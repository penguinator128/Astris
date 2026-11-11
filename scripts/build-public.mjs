// Builds the public website into ./dist
//   - copies ONLY the public files (so the Studio can never be reached from the public site)
//   - writes content-snapshot.json: a copy of everything in content/, so the site loads in one request
// Vercel runs this automatically (see vercel.json). You can also run it yourself:  node scripts/build-public.mjs
import { cp, mkdir, rm, readdir, readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist");

const FILES = ["index.html", "styles.css", "app.js", "favicon.ico", "favicon.svg", "apple-touch-icon.png", "site.webmanifest", "robots.txt"];
const DIRS = ["assets", "images"];
const CONTENT = ["photos", "videos", "news", "series", "settings"];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const f of FILES) {
  if (existsSync(path.join(root, f))) await cp(path.join(root, f), path.join(out, f));
}
for (const d of DIRS) {
  if (existsSync(path.join(root, d))) await cp(path.join(root, d), path.join(out, d), { recursive: true });
}

const files = [];
for (const dir of CONTENT) {
  const full = path.join(root, "content", dir);
  if (!existsSync(full)) continue;
  for (const name of (await readdir(full)).sort()) {
    if (!/\.(md|yml|yaml)$/i.test(name)) continue;
    const p = path.join(full, name);
    if (!(await stat(p)).isFile()) continue;
    files.push({ path: `content/${dir}/${name}`, text: await readFile(p, "utf8") });
  }
}
await writeFile(path.join(out, "content-snapshot.json"), JSON.stringify({ generated: new Date().toISOString(), files }));

// safety check: the Studio and the old admin must never be part of the public site
for (const banned of ["studio", "admin", "scripts", "api"]) {
  if (existsSync(path.join(out, banned))) throw new Error(`"${banned}" must not be in the public build`);
}
console.log(`Built the public site: ${files.length} content files in the snapshot.`);
