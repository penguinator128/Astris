// A quick health check for the whole project. Run it any time:  node scripts/check.mjs
// It checks that the files are consistent, the code has no syntax errors, and the Studio can never be served by the public site.
import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rel = (p) => path.join(root, p);
let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  ok    " : "  FAIL  ") + msg); if (!cond) failed++; };
const read = (p) => readFile(rel(p), "utf8");

console.log("Shared files (website and Studio must match):");
for (const f of ["brand.js", "transitions.js", "intro.js"]) {
  ok((await read("assets/" + f)) === (await read("studio/shared/" + f)), `assets/${f} matches studio/shared/${f}` + " (if not: node scripts/sync-studio.mjs)");
}

console.log("JavaScript has no syntax errors:");
for (const f of ["app.js", "assets/brand.js", "assets/data.js", "assets/intro.js", "assets/transitions.js", "studio/studio.js", "studio/api/describe.js", "scripts/build-public.mjs"]) {
  let good = true; try { execFileSync(process.execPath, ["--check", rel(f)], { stdio: "pipe" }); } catch (e) { good = false; }
  ok(good, f);
}

console.log("Config files are valid JSON:");
for (const f of ["vercel.json", "studio/vercel.json", "studio/package.json", "site.webmanifest"]) {
  let good = true; try { JSON.parse(await read(f)); } catch (e) { good = false; }
  ok(good, f);
}

console.log("Content files can be read:");
const sandbox = { window: { location: { hostname: "x", protocol: "https:" } }, document: { addEventListener() {} }, URLSearchParams, fetch() {} };
sandbox.window.window = sandbox.window; vm.createContext(sandbox);
vm.runInContext(await read("assets/data.js"), sandbox);
const parse = sandbox.window.AstrisData.parseFrontMatter;
let count = 0, bad = 0;
for (const dir of ["photos", "videos", "news", "series", "settings"]) {
  if (!existsSync(rel("content/" + dir))) continue;
  for (const f of await readdir(rel("content/" + dir))) {
    if (!/\.(md|yml)$/.test(f)) continue;
    count++;
    const d = parse(await read(`content/${dir}/${f}`)).data;
    if (!d || (dir !== "settings" && !d.title)) { bad++; console.log("        problem in content/" + dir + "/" + f); }
  }
}
ok(bad === 0, `${count} content files read correctly`);

console.log("The public build never contains the Studio:");
execFileSync(process.execPath, [rel("scripts/build-public.mjs")], { stdio: "pipe" });
for (const banned of ["studio", "admin", "api", "scripts"]) ok(!existsSync(rel("dist/" + banned)), `dist/${banned} is not published`);
ok(existsSync(rel("dist/content-snapshot.json")), "dist/content-snapshot.json exists");
ok(existsSync(rel("dist/index.html")) && (await stat(rel("dist/index.html"))).size > 500, "dist/index.html exists");
ok(!existsSync(rel("admin")), "the old /admin folder is gone");

console.log(failed ? `\n${failed} problem(s) found.` : "\nEverything looks good.");
process.exit(failed ? 1 : 0);
