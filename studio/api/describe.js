/* Astris Studio: the AI helper.
   Suggests a title, caption, description and tags for a photo, a description for a film,
   or a summary for a news post. Only used when you press a ✨ button in the Studio.

   Setup (once): in this Studio's Vercel project, add an environment variable named ANTHROPIC_API_KEY.
   Optional: ANTHROPIC_MODEL to pick a different Claude model (default: claude-opus-5-5).

   Safety: it only answers someone who sends your GitHub key (the one the Studio already uses),
   and only if that key can write to the Astris repository. Nobody else can spend your credit. */
"use strict";

const crypto = require("node:crypto");

const REPO = "penguinator128/Astris";
const DEFAULT_MODEL = "claude-opus-5-5";
const MAX_IMAGE_B64 = 3_000_000;   /* about 2.2 MB of picture */
const MAX_TEXT = 8000;

const SYSTEM =
  "You write titles and short descriptions for the portfolio website of Astris Productions, a small film and photography studio run by Josh in Canberra, Australia. " +
  "Voice: warm, plain, specific, a little cinematic. Describe only what you can see or what you are told: never invent names, places, dates or facts. " +
  "Avoid cliches such as captivating, stunning, breathtaking, tapestry, testament, journey. No emoji, no hashtags, no quotation marks around titles. " +
  "Reply with one JSON object and nothing else.";

function loadSdk() {
  const mod = require("@anthropic-ai/sdk");
  return mod.default || mod.Anthropic || mod;
}

function clean(v, n) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n); }
function longText(v) { return String(v == null ? "" : v).slice(0, MAX_TEXT); }

function buildPrompt(body) {
  const kind = body.kind;
  if (kind === "photo") {
    const facts = [
      body.filename ? "File name: " + clean(body.filename, 120).replace(/[-_]+/g, " ") + " (often meaningless, ignore it if so)" : "",
      body.camera ? "Camera: " + clean(body.camera, 80) : "",
      body.lens ? "Lens: " + clean(body.lens, 80) : ""
    ].filter(Boolean).join("\n");
    return "Look at this photograph and write its entry for the gallery.\n" + facts + "\n\n" +
      'Return JSON: {"title": "1 to 5 words, specific, not generic (never just Photo or Image)", ' +
      '"caption": "one short line, 10 words at most", ' +
      '"description": "one or two plain sentences about what is in the picture and how it looks", ' +
      '"tags": ["3 to 6 lowercase tags, one or two words each"]}';
  }
  if (kind === "film") {
    const cur = longText(body.current);
    return "Write the description for a film on the website.\n" +
      (body.title ? "Title: " + clean(body.title, 120) + "\n" : "Title: not decided yet, suggest one.\n") +
      (body.type ? "Type: " + clean(body.type, 40) + "\n" : "") +
      (body.stage ? "It is still being made. Current stage: " + clean(body.stage, 40) + "\n" : "") +
      (body.image ? "The attached picture is a frame or thumbnail from it.\n" : "") +
      (cur ? "Josh's own notes or current description (keep every fact, tidy the wording, do not add facts):\n" + cur + "\n" : "") +
      '\nReturn JSON: {"title": "the title (keep Josh\'s if he gave one)", "description": "two or three plain sentences, no spoilers"}';
  }
  if (kind === "news") {
    return "Write a summary of this news post for a card on the website.\nTitle: " + clean(body.title, 160) + "\nPost:\n" + longText(body.body) +
      '\n\nReturn JSON: {"summary": "one or two sentences, 30 words at most, that make someone want to read the post"}';
  }
  return null;
}

function extractJson(text) {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("no json");
  return JSON.parse(text.slice(a, b + 1));
}

function shape(kind, j) {
  if (kind === "photo") {
    return {
      title: clean(j.title, 80), caption: clean(j.caption, 120), description: clean(j.description, 420),
      tags: (Array.isArray(j.tags) ? j.tags : []).map(t => clean(t, 30).toLowerCase()).filter(Boolean).slice(0, 8)
    };
  }
  if (kind === "film") return { title: clean(j.title, 100), description: clean(j.description, 700) };
  return { summary: clean(j.summary, 260) };
}

function createHandler(deps) {
  deps = deps || {};
  const fetchImpl = deps.fetch || globalThis.fetch;
  const verified = new Map();   /* token fingerprint -> expiry time, so GitHub is not asked on every click */
  let client = deps.client || null;

  async function mayWrite(token) {
    const fp = crypto.createHash("sha256").update(token).digest("hex");
    const hit = verified.get(fp);
    if (hit && hit > Date.now()) return true;
    const r = await fetchImpl("https://api.github.com/repos/" + REPO, {
      headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "User-Agent": "astris-studio" }
    });
    if (!r.ok) return false;
    const j = await r.json();
    const ok = !!(j && j.permissions && (j.permissions.push || j.permissions.admin));
    if (ok) verified.set(fp, Date.now() + 10 * 60 * 1000);
    return ok;
  }

  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    const ready = !!(deps.client || process.env.ANTHROPIC_API_KEY);
    if (req.method === "GET") return res.status(200).json({ ready });
    if (req.method !== "POST") return res.status(405).json({ message: "Use POST." });

    if (!ready) return res.status(503).json({ code: "not_configured", message: "The AI helper isn't switched on yet. Add ANTHROPIC_API_KEY to this Studio's Vercel project (see the README)." });

    const auth = String(req.headers.authorization || "");
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) return res.status(401).json({ message: "Sign in to the Studio first." });
    try { if (!(await mayWrite(token))) return res.status(403).json({ message: "That GitHub key can't edit the Astris repository." }); }
    catch (e) { return res.status(502).json({ message: "Couldn't check your GitHub key just now. Try again in a moment." }); }

    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
    if (!body || typeof body !== "object") return res.status(400).json({ message: "That request wasn't readable." });
    const prompt = buildPrompt(body);
    if (!prompt) return res.status(400).json({ message: "Unknown kind of suggestion." });
    const image = typeof body.image === "string" ? body.image : "";
    if (image.length > MAX_IMAGE_B64) return res.status(413).json({ message: "That picture is too large to send. It should be shrunk automatically; try again." });
    if (body.kind === "photo" && !image) return res.status(400).json({ message: "No picture was sent." });

    const content = [];
    if (image) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } });
    content.push({ type: "text", text: prompt });

    try {
      if (!client) { const Anthropic = loadSdk(); client = new Anthropic(); }
      const msg = await client.messages.create({
        model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
        max_tokens: 4000,
        system: SYSTEM,
        output_config: { effort: "low" },
        messages: [{ role: "user", content }]
      });
      if (msg.stop_reason === "refusal") return res.status(422).json({ message: "The AI declined to write this one. Please write it yourself." });
      const block = (msg.content || []).find(b => b.type === "text");
      if (!block) return res.status(502).json({ message: "The AI didn't answer in time. Please try again." });
      return res.status(200).json(shape(body.kind, extractJson(block.text)));
    } catch (e) {
      const st = e && e.status;
      if (st === 401 || st === 403) return res.status(502).json({ message: "The API key on the server wasn't accepted. Check ANTHROPIC_API_KEY in Vercel." });
      if (st === 429) return res.status(429).json({ message: "The AI is busy. Wait a few seconds and try again." });
      if (e instanceof SyntaxError || (e && e.message === "no json")) return res.status(502).json({ message: "The AI's answer wasn't readable. Please try again." });
      return res.status(502).json({ message: "The AI helper had a problem. Please try again in a moment." });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
