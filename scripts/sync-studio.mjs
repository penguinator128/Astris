// The Studio previews the website's transitions and opening, so it keeps its own copy of those three files.
// Run this after changing anything in assets/brand.js, assets/transitions.js or assets/intro.js:
//   node scripts/sync-studio.mjs
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(path.join(root, "studio/shared"), { recursive: true });
for (const f of ["brand.js", "transitions.js", "intro.js"]) {
  await copyFile(path.join(root, "assets", f), path.join(root, "studio/shared", f));
  console.log("copied", f);
}
