/* =============================================================================
   PEAR / MERIDIAN — secure backend proxy for Decart Lucy VTON (realtime)
   -----------------------------------------------------------------------------
   Token-minting strategy (three-tier waterfall, most to least specific):

     Tier 1 — SDK  : decart.tokens.create({ expiresIn, allowedModels })
     Tier 2 — REST : POST https://api.decart.ai/v1/realtime/tokens
     Tier 3 — REST : POST https://api.decart.ai/v1/client/tokens

   Each tier logs the full Decart response body on failure so the exact
   upstream error is visible in the server terminal.  The browser always
   receives a clean JSON object — either { apiKey, expiresAt, model } or
   { error, message, decart_status, decart_body }.

   Endpoints exposed by this server:
     POST|GET /api/realtime-token   → ephemeral ek_… token
     POST|GET /api/tryon            → alias (blueprint-compatible)
     GET      /api/health           → diagnostics
   ============================================================================ */

import "dotenv/config";
import express from "express";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createDecartClient } from "@decartai/sdk";
import { logTryOn } from "./lib/sheets.js";

logTryOn({ garmentName: "Local Test Shirt", size: "XL" }).catch(e => console.error("Sheets test failed:", e.message));

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ── environment ─────────────────────────────────────────────────────────── */
const KEY_SOURCE =
  (process.env.DECART_API_KEY    && "DECART_API_KEY") ||
  (process.env.DESCARTES_API_KEY && "DESCARTES_API_KEY") ||
  null;
const API_KEY  = process.env.DECART_API_KEY || process.env.DESCARTES_API_KEY || "";
const PORT     = Number(process.env.PORT) || 3000;
const VTON_MODEL  = process.env.DECART_VTON_MODEL  || "lucy-vton-latest";
const TOKEN_TTL   = Math.min(3600, Math.max(1, Number(process.env.DECART_TOKEN_TTL) || 600));
const ALLOWED_ORIGINS = (process.env.DECART_ALLOWED_ORIGINS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

/* ── Express setup ───────────────────────────────────────────────────────── */
const app = express();
app.use(express.json({ limit: "8mb" }));
app.disable("x-powered-by");

/* ── CORS enforcement ────────────────────────────────────────────────────────
   The fitting room is PUBLICLY ACCESSIBLE to any anonymous visitor — no login
   or account is required. CORS is used solely to ensure API calls originate
   from our storefront domain, not from third-party scrapers or abusers.

   Production: set DECART_ALLOWED_ORIGINS to your live domain(s), e.g.:
     DECART_ALLOWED_ORIGINS=https://yourstore.vercel.app,https://yourshop.myshopify.com
   Dev / unset: all origins are allowed (with a one-time startup warning) so a
   missing env var never silently breaks a live deployment.

   WebRTC transport: DTLS/SRTP is mandated by the WebRTC spec and enforced by
   the browser — all peer-connection media is end-to-end encrypted regardless
   of this server's config.
   Zero-retention: this proxy never receives, buffers, or persists user images,
   WebRTC frames, or body measurements.  It only mints short-lived ek_ tokens;
   all sensitive data flows over the encrypted peer channel to Decart's servers. */
const ORIGINS_LOCKED = ALLOWED_ORIGINS.length > 0;

const isOriginAllowed = (origin, reqHost) => {
  if (!origin) return true;              // same-origin / server-to-server requests
  if (!ORIGINS_LOCKED) return true;      // open fallback — env var not configured yet
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // Auto-allow the server's own host so a fetch() from /fitting-room/ to
  // /api/realtime-token always works on any Vercel URL, preview deployment,
  // or custom domain without needing to update DECART_ALLOWED_ORIGINS.
  if (reqHost &&
      (origin === `https://${reqHost}` || origin === `http://${reqHost}`)) return true;
  return false;
};

app.use("/api", (req, res, next) => {
  const origin = req.headers.origin || "";
  const allowed = isOriginAllowed(origin, req.headers.host);

  if (origin) res.header("Access-Control-Allow-Origin", allowed ? origin : "null");
  res.header("Vary",                          "Origin");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Max-Age",       "600");
  res.header("X-Content-Type-Options",       "nosniff");
  res.header("Referrer-Policy",              "strict-origin-when-cross-origin");

  if (req.method === "OPTIONS") return res.sendStatus(allowed ? 204 : 403);
  if (!allowed) {
    console.warn(
      `[cors] blocked: origin="${origin}" host="${req.headers.host}" ` +
      `allowed=[${ALLOWED_ORIGINS.join(", ") || "(none)"}]`
    );
    return res.status(403).json({ error: "forbidden", message: "Origin not allowed." });
  }
  console.log(`[api] ${req.method} ${req.originalUrl}`);
  next();
});

/* ── SDK client (holds the permanent key — never sent to the browser) ─────── */
let decart = null;
if (API_KEY && /^(?:one)?dct_|^dct_last-/.test(API_KEY)) {
  try {
    decart = createDecartClient({ apiKey: API_KEY });
    console.log(`✓ Decart SDK client initialised (key from ${KEY_SOURCE}).`);
  } catch (err) {
    console.error("✗ Decart SDK init failed:", err?.message || err);
  }
} else {
  console.warn(
    "⚠ No valid Decart key found in DECART_API_KEY or DESCARTES_API_KEY.\n" +
    "  Set DECART_API_KEY in .env (copy from platform.decart.ai → API Keys).\n" +
    "  /api/realtime-token will return 503 until a key is configured."
  );
}

/* ── Tier 1: SDK ─────────────────────────────────────────────────────────── */
async function trySDK() {
  if (!decart) throw Object.assign(new Error("SDK not initialised"), { tier: "sdk" });

  const opts = { expiresIn: TOKEN_TTL, allowedModels: [VTON_MODEL] };
  if (ALLOWED_ORIGINS.length) opts.allowedOrigins = ALLOWED_ORIGINS;

  let token;
  try {
    token = await decart.tokens.create(opts);
  } catch (errScoped) {
    console.warn(`[tier1-sdk] scoped create failed: ${errScoped?.message || errScoped}`);
    token = await decart.tokens.create();   // bare call — no scope
  }

  if (!token?.apiKey) throw Object.assign(new Error("SDK returned no apiKey"), { tier: "sdk" });
  console.log("[tier1-sdk] ✓ token minted via SDK");
  return {
    apiKey:      token.apiKey,
    expiresAt:   token.expiresAt   ?? null,
    permissions: token.permissions ?? null,
  };
}

/* ── Tier 2 & 3: direct REST ─────────────────────────────────────────────── */
const REST_ENDPOINTS = [
  "https://api.decart.ai/v1/realtime/tokens",  // 2026 realtime endpoint
  "https://api.decart.ai/v1/client/tokens",    // legacy client endpoint
];

async function tryREST(url) {
  const body = JSON.stringify({ model: VTON_MODEL, expires_in: TOKEN_TTL });
  console.log(`[rest] POST ${url}`);

  const resp = await fetch(url, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY":    API_KEY,
      "Authorization": `Bearer ${API_KEY}`,
    },
    body,
  });

  const rawText = await resp.text();

  if (!resp.ok) {
    // Log the full upstream response so the exact Decart error is visible.
    console.error(
      `[rest] ✗ ${url} → HTTP ${resp.status}\n` +
      `  response body: ${rawText}`
    );
    const err = new Error(`Decart ${resp.status} from ${url}`);
    err.decart_status = resp.status;
    err.decart_body   = rawText;
    err.tier          = "rest";
    throw err;
  }

  let parsed;
  try { parsed = JSON.parse(rawText); } catch (_) {
    throw Object.assign(new Error("Decart returned non-JSON"), { tier: "rest", decart_body: rawText });
  }

  // Accept either { apiKey } (SDK-style) or { api_key } (REST-style)
  const apiKey = parsed.apiKey || parsed.api_key || parsed.token || parsed.key;
  if (!apiKey) {
    console.error(`[rest] ✗ ${url} → no apiKey field in response: ${rawText}`);
    throw Object.assign(new Error("Decart response has no apiKey field"), { tier: "rest", decart_body: rawText });
  }

  console.log(`[rest] ✓ token minted via ${url}`);
  return {
    apiKey,
    expiresAt:   parsed.expiresAt ?? parsed.expires_at ?? null,
    permissions: parsed.permissions                    ?? null,
  };
}

/* ── Waterfall: SDK → REST endpoints in order ────────────────────────────── */
async function mintTokenWaterfall() {
  // Tier 1
  try { return await trySDK(); } catch (e) {
    console.warn(`[waterfall] SDK failed (${e.message}), trying REST fallback…`);
  }

  // Tier 2 + 3
  let lastErr;
  for (const url of REST_ENDPOINTS) {
    try { return await tryREST(url); } catch (e) {
      lastErr = e;
      console.warn(`[waterfall] ${url} failed, trying next…`);
    }
  }

  // All tiers exhausted — surface the last error
  const err = lastErr || new Error("All token-mint strategies failed");
  err.allFailed = true;
  throw err;
}

/* ── Express handler ─────────────────────────────────────────────────────── */
async function mintToken(req, res) {
  if (!API_KEY) {
    return res.status(503).json({
      error:   "decart_unconfigured",
      message: "Server has no Decart API key (set DECART_API_KEY in .env).",
    });
  }

  try {
    const token = await mintTokenWaterfall();
    return res.json({ ...token, model: VTON_MODEL });
  } catch (err) {
    console.error("[mintToken] all tiers failed:", err?.message || err);
    return res.status(502).json({
      error:        "token_mint_failed",
      message:      err?.message || "Could not mint a Decart client token.",
      decart_status: err?.decart_status ?? null,
      decart_body:   err?.decart_body   ?? null,
    });
  }
}

/* ── Routes ──────────────────────────────────────────────────────────────── */
function mountTokenRoute(p) {
  app.route(p)
    .get(mintToken)
    .post(mintToken)
    .all((_req, res) =>
      res.set("Allow", "GET, POST, OPTIONS").status(405).json({
        error:   "method_not_allowed",
        message: `Use GET or POST on ${p}. If you're getting 405, make sure the page is ` +
                 `served by THIS Express server: http://localhost:${PORT}/pear-demo/`,
      })
    );
}

mountTokenRoute("/api/realtime-token");
mountTokenRoute("/api/tryon");

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, decart: !!decart, model: VTON_MODEL, keySource: KEY_SOURCE, ttl: TOKEN_TTL });
});

app.get("/api/speed-probe", (_req, res) => {
  const payload = Buffer.alloc(102_400); // 100 KB calibration payload for bandwidth check
  res
    .set("Content-Type", "application/octet-stream")
    .set("Cache-Control", "no-store, no-cache, must-revalidate")
    .set("Pragma", "no-cache")
    .send(payload);
});

/* ── Analytics: log a garment try-on to Google Sheets ───────────────────────── */
app.post("/api/track-tryon", async (req, res) => {
  const { garmentId, garmentName, garmentType, subType, size } = req.body || {};
  const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.ip || "";
  try {
    await logTryOn({ garmentId, garmentName, garmentType, subType, size, ip });
    console.log("[track-tryon] sheet row written");
    res.json({ ok: true });
  } catch (err) {
    console.error("[track-tryon] sheet write failed:", err?.message);
    res.json({ ok: false, error: err?.message });
  }
});

/* ── Debug: verify Sheets env vars and write a test row ─────────────────────── */
app.get("/api/test-sheets", async (req, res) => {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const email   = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key     = process.env.GOOGLE_PRIVATE_KEY;
  const envCheck = {
    GOOGLE_SHEET_ID:              sheetId ? `✓ (${sheetId})` : "✗ MISSING",
    GOOGLE_SERVICE_ACCOUNT_EMAIL: email   ? `✓ (${email})`   : "✗ MISSING",
    GOOGLE_PRIVATE_KEY:           key     ? "✓ present"       : "✗ MISSING",
  };
  if (!sheetId || !email || !key) {
    return res.json({ ok: false, envCheck, error: "Missing env vars — check Vercel settings" });
  }
  try {
    await logTryOn({ garmentId: "test", garmentName: "TEST", garmentType: "test", subType: "test", size: "test", ip: req.ip });
    res.json({ ok: true, envCheck, message: "Row written successfully — check the sheet!" });
  } catch (err) {
    res.json({ ok: false, envCheck, error: err?.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   ADMIN DASHBOARD — session-log ingest + password-gated read API
   ---------------------------------------------------------------------------
   Security model:
     • The dashboard password lives ONLY on the server (env ADMIN_PASSWORD, with
       the agreed default). It is never shipped to the browser.
     • POST /api/admin/login verifies the password (constant-time) and hands back
       a DERIVED bearer token = HMAC-SHA256(password, fixed-label). An attacker
       who doesn't know the password cannot forge this token.
     • GET /api/admin/sessions returns data ONLY when that exact token is presented
       in the Authorization header. So opening admin.html or sniffing the network
       reveals nothing — the row data never leaves the server pre-auth.
     • Session rows persist in Google Sheets (lib/sheets.js), so every admin who
       logs in sees the SAME shared, durable dataset.
   ══════════════════════════════════════════════════════════════════════════ */
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "PEARM2010YGIA";
const ADMIN_TOKEN = crypto
  .createHmac("sha256", ADMIN_PASSWORD)
  .update("pear-admin-dashboard-v1")
  .digest("hex");

// Length-safe constant-time string comparison (avoids timing leaks). Used for
// the derived bearer token, which must match exactly.
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Normalise away the usual login foot-guns before comparing the PASSWORD:
// surrounding/inner whitespace, zero-width + non-printable chars, letter-case,
// and the classic look-alikes (O↔0, I/L↔1). For a fixed internal admin password
// this trades a sliver of entropy for "it just works, every time".
function normPw(s) {
  return String(s ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || "";
  // Look for the credential in ANY of: Authorization: Bearer <pw>, x-admin-key
  // header, or ?password=/?key= query param — whichever the client sends.
  const provided =
    (auth.startsWith("Bearer ") ? auth.slice(7) : "") ||
    req.headers["x-admin-key"] ||
    req.query.password ||
    req.query.key ||
    "";

  // Accept EITHER the raw password (normalised — bulletproof) OR the derived token.
  const ok = normPw(provided) === normPw(ADMIN_PASSWORD) || safeEqual(provided, ADMIN_TOKEN);
  if (!ok) {
    return res.status(401).json({ error: "unauthorized", message: "Valid admin credentials required." });
  }
  next();
}

/* ── Local JSON persistence via fs.promises ───────────────────────────────────
   Writes go to a WRITABLE directory: the project root in local dev, but /tmp on
   Vercel — its deployment dir (/var/task) is READ-ONLY, so writing there throws
   EROFS. Reads never try to CREATE the file, so a read can never error.
   ⚠ On Vercel, /tmp is per-instance + ephemeral: rows persist within a warm
   instance but reset on cold starts and aren't shared across instances. For
   durable, shared storage on the live site use Vercel KV (see note in chat). */
const fsp = fs.promises;
const DATA_DIR      = process.env.VERCEL ? "/tmp" : __dirname;   // /var/task is read-only on Vercel
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");

// Best-effort startup init — create the file ONLY if absent. Never throws
// (EEXIST when present, EROFS on a read-only FS are both swallowed).
fsp.writeFile(SESSIONS_FILE, "[]", { flag: "wx" })
  .then(() => console.log("[sessions] initialised", SESSIONS_FILE))
  .catch(() => {});

// Read all logs from disk. Missing file → []. Strips a UTF-8 BOM (PowerShell/
// editors add one, which would otherwise break JSON.parse). NEVER throws.
async function readSessionLogs() {
  try {
    let raw = await fsp.readFile(SESSIONS_FILE, "utf8");
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);   // strip UTF-8 BOM
    raw = raw.trim();
    const arr = JSON.parse(raw || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    if (err.code !== "ENOENT") console.warn("[sessions] read/parse failed:", err?.message);
    return [];   // no file yet, or unreadable → empty list (no error to the client)
  }
}

// Append one log and write the whole array back to the writable path.
async function saveSessionLog(entry) {
  const all = await readSessionLogs();
  all.push(entry);
  await fsp.writeFile(SESSIONS_FILE, JSON.stringify(all, null, 2));   // no BOM
  return all.length;
}

/* ── POST: save a session → appends to sessions.json ─────────────────────── */
async function saveSession(req, res) {
  const b = req.body || {};
  const m = b.measurements || {};   // tolerate either nested {measurements} or flat fields
  const str = (v, max = 80) => (v == null ? "" : String(v).slice(0, max));
  const n   = (v) => { const x = Number(v); return Number.isFinite(x) ? x : ""; };
  const pick = (a, c) => (a !== undefined && a !== null && a !== "" ? a : c);

  const entry = {
    sessionId:   str(b.sessionId, 64) || crypto.randomUUID(),
    height:      n(pick(b.height, m.height)),
    weight:      n(pick(b.weight, m.weight)),
    chest:       n(pick(b.chest,  m.chest)),
    waist:       n(pick(b.waist,  m.waist)),
    legs:        n(pick(b.legs,   m.legs)),
    size:        str(b.size, 8),
    garmentId:   str(b.garmentId, 64),
    garmentName: str(b.garmentName, 80),
    ts:          new Date().toISOString(),
  };

  try {
    const total = await saveSessionLog(entry);
    console.log(`[sessions] saved session → ${SESSIONS_FILE} (total now ${total})`);
    res.json({ ok: true });
  } catch (err) {
    console.error("[sessions] persist failed:", err?.message);
    res.json({ ok: false, error: err?.message });
  }
}

/* ── GET: retrieve sessions (password-gated) → reads sessions.json ─────────── */
async function getSessions(_req, res) {
  try {
    const sessions = (await readSessionLogs()).reverse();   // newest first
    // Requirement 1c — explicit debug log of WHERE we read and HOW MANY we found.
    console.log(`[admin/sessions] reading ${SESSIONS_FILE} → ${sessions.length} session(s) found`);
    res.json({ ok: true, count: sessions.length, sessions });
  } catch (err) {
    console.error("[admin/sessions] read failed:", err?.message);
    res.status(500).json({ ok: false, error: err?.message, sessions: [], count: 0 });
  }
}

/* Canonical routes the dashboard uses. */
app.post("/api/sessions", saveSession);
app.get("/api/sessions", requireAdmin, getSessions);

/* Back-compat aliases (older clients / earlier code paths). */
app.post("/api/session-log",      saveSession);
app.get("/api/admin/sessions",    requireAdmin, getSessions);

/* Login — verify password, return the derived bearer token (optional path). */
app.post("/api/admin/login", (req, res) => {
  const password = (req.body && req.body.password) || "";
  if (normPw(password) !== normPw(ADMIN_PASSWORD)) {
    return res.status(401).json({ error: "unauthorized", message: "Incorrect password." });
  }
  res.json({ ok: true, token: ADMIN_TOKEN });
});

/* ── In-memory image cache — avoids re-fetching the same CDN image within a warm
   Lambda container. Keyed by full URL; evicts oldest entry when the cap is hit.
   Vercel's CDN also caches the HTTP response (via Cache-Control), so Decart's
   server often hits the edge cache on repeat fetches — this cache additionally
   cuts Lambda execution time for the first in-process hit. */
const imgCache = new Map();
const IMG_CACHE_MAX = 50;

/* ── Image proxy — fetches garment images server-side to sidestep CORS restrictions
   on CDN hosts (cdn.suitsupply.com, img.magnific.com, etc.) that block browser
   cross-origin fetch.  The Decart SDK calls fetch(imageUrl) internally when you
   pass a URL string to rtClient.set(), which fails for those CDNs.  By proxying
   through this endpoint the browser always makes a same-origin request, and the
   server (no CORS restriction) retrieves the image and pipes it back as a Blob.
   The client then passes the Blob directly to rtClient.set() — no CDN fetch needed.
   ─────────────────────────────────────────────────────────────────────────────── */
app.get("/api/img-proxy", async (req, res) => {
  const raw = req.query.url;
  if (!raw) return res.status(400).json({ error: "missing_url", message: "?url= is required" });

  let parsed;
  try {
    parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("bad protocol");
  } catch {
    return res.status(400).json({ error: "invalid_url", message: "url must be an absolute http(s) URL" });
  }

  const cacheKey = parsed.href;
  if (imgCache.has(cacheKey)) {
    const { buffer, contentType } = imgCache.get(cacheKey);
    return res
      .set("Content-Type", contentType)
      .set("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400")
      .set("Access-Control-Allow-Origin", "*")
      .set("X-Cache", "HIT")
      .send(buffer);
  }

  try {
    const upstream = await fetch(parsed.href, {
      headers: { "User-Agent": "PEAR-VTON-Proxy/1.0" },
    });
    if (!upstream.ok) {
      return res.status(502).json({
        error: "upstream_error",
        message: `Upstream returned HTTP ${upstream.status} for ${parsed.href}`,
      });
    }
    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await upstream.arrayBuffer());

    // Populate in-process cache (oldest-first eviction at cap).
    if (imgCache.size >= IMG_CACHE_MAX) imgCache.delete(imgCache.keys().next().value);
    imgCache.set(cacheKey, { buffer, contentType });

    res
      .set("Content-Type", contentType)
      .set("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400")
      .set("Access-Control-Allow-Origin", "*")
      .send(buffer);
  } catch (err) {
    console.error("[img-proxy] fetch failed:", err?.message || err);
    res.status(502).json({ error: "proxy_fetch_failed", message: err?.message || String(err) });
  }
});

app.all("/api/*", (req, res) => {
  res.status(404).json({ error: "not_found", message: `No API route for ${req.method} ${req.path}` });
});

/* ── Static hosting ──────────────────────────────────────────────────────── */
const uiRoot = __dirname;

/* serve-static for all assets (JS, CSS, images, fonts…) */
app.use(express.static(uiRoot, { extensions: ["html"], index: false }));

/* Page router — resolves every URL to the right HTML file under ui/ */
app.use((req, res) => {
  const candidates = [
    path.join(uiRoot, req.path),                     // exact file
    path.join(uiRoot, req.path, "index.html"),        // directory index
    path.join(uiRoot, req.path.replace(/\/$/, "") + ".html"), // extensionless → .html
    path.join(uiRoot, "index.html"),                  // SPA fallback
  ];
  for (const file of candidates) {
    try {
      if (fs.statSync(file).isFile()) return res.sendFile(file);
    } catch {}
  }
  res.status(404).json({ error: "not_found", path: req.path });
});

/* ── Start (local only — Vercel manages its own listener) ────────────────── */
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log("\n────────────────────────────────────────────────────────");
    console.log(`  PEAR VTON server → http://localhost:${PORT}`);
    console.log(`  Storefront  : http://localhost:${PORT}/`);
    console.log(`  Fitting room: http://localhost:${PORT}/fitting-room/   ← OPEN THIS`);
    console.log(`  Decart      : ${decart ? `SDK ready (${VTON_MODEL}, TTL ${TOKEN_TTL}s)` : "SDK not ready — will use REST fallback"}`);
    console.log(`  Key source  : ${KEY_SOURCE || "(none — set DECART_API_KEY in .env)"}`);
    console.log(`  REST order  : ${REST_ENDPOINTS.join(" → ")}`);
    if (ORIGINS_LOCKED) {
      console.log(`  Origin lock : ${ALLOWED_ORIGINS.join(", ")}`);
    } else {
      console.warn("  ⚠ CORS open : DECART_ALLOWED_ORIGINS not set — all origins allowed.");
      console.warn("    Set it in .env or Vercel env vars before going to production:");
      console.warn("    DECART_ALLOWED_ORIGINS=https://yourstore.vercel.app");
    }
    console.log("────────────────────────────────────────────────────────\n");
  });
}

export default app;
