# Astris Studio

The back end for the Astris website. It is its own website (its own Vercel project, Root Directory `studio`),
so it is never reachable from the public site.

- Static pages: `index.html`, `studio.js`, `studio.css`
- `vendor/exifr.full.umd.js`: reads camera details from photos (bundled, MIT licence)
- `shared/`: copies of the website's logo, intro and transitions, so the previews match exactly.
  After changing `assets/brand.js`, `assets/intro.js` or `assets/transitions.js`, run `node scripts/sync-studio.mjs` at the top level.
- `api/describe.js`: the AI helper (a Vercel serverless function)

## Setting up on Vercel

1. Add New → Project → pick the repo → **Root Directory: `studio`** → Deploy.
2. For the ✨ buttons: Settings → Environment Variables → add `ANTHROPIC_API_KEY` → Redeploy.
   Optional: `ANTHROPIC_MODEL` (default `claude-opus-5-5`; a smaller model such as `claude-haiku-5-5` costs much less).

## How the AI helper stays safe

- It answers only if the request carries a GitHub key that can write to `penguinator128/Astris`.
- It only runs when you press a ✨ button. Pictures are shrunk to about 1024 px before they are sent.
- If the model declines, or the key is missing, the Studio says so politely and nothing is changed.
  Suggestions are only ever put into the form: you read them, edit them, and press Save.
