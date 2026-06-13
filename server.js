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
import { fileURLToPath } from "node:url";
import { createDecartClient } from "@decartai/sdk";
import { logTryOn } from "./lib/sheets.js";

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

const isOriginAllowed = (origin) => {
  if (!origin) return true;              // same-origin / server-to-server requests
  if (ORIGINS_LOCKED) return ALLOWED_ORIGINS.includes(origin);
  return true;                           // open fallback — env var not configured yet
};

app.use("/api", (req, res, next) => {
  const origin = req.headers.origin || "";
  const allowed = isOriginAllowed(origin);

  if (origin) res.header("Access-Control-Allow-Origin", allowed ? origin : "null");
  res.header("Vary",                          "Origin");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Max-Age",       "600");
  res.header("X-Content-Type-Options",       "nosniff");
  res.header("Referrer-Policy",              "strict-origin-when-cross-origin");

  if (req.method === "OPTIONS") return res.sendStatus(allowed ? 204 : 403);
  if (!allowed) {
    console.warn(`[cors] blocked: ${origin}`);
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

/* ── Analytics: log a garment try-on to Google Sheets (no PII) ──────────────── */
app.post("/api/track-tryon", (req, res) => {
  const { garmentId, garmentName, garmentType, subType, size } = req.body || {};
  res.json({ ok: true }); // respond instantly — don't block the browser
  logTryOn({ garmentId, garmentName, garmentType, subType, size }).catch(() => {});
});

app.all("/api/*", (req, res) => {
  res.status(404).json({ error: "not_found", message: `No API route for ${req.method} ${req.path}` });
});

/* ── Static hosting ──────────────────────────────────────────────────────── */
app.use(express.static(__dirname, { extensions: ["html"] }));

/* ── Wildcard fallback — maps any path to the correct on-disk file ────────
   express.static handles the common case; this catches anything it misses
   (e.g. /pear-demo/ when running inside the Vercel Lambda bundle).
   Resolution order:
     1. Try the exact path as a file (handles /style.css, /catalog.js, etc.)
     2. Append index.html for directory-style paths  (/pear-demo/ → pear-demo/index.html)
     3. Fall back to root index.html for anything else (SPA-style final safety net)
   ──────────────────────────────────────────────────────────────────────── */
app.get("*", (req, res) => {
  const rel = req.path.endsWith("/") ? `${req.path}index.html` : req.path;
  const target = path.join(__dirname, rel);
  res.sendFile(target, (err) => {
    if (!err) return;
    // Directory index fallback: /pear-demo (no slash) → pear-demo/index.html
    const dirIndex = path.join(__dirname, req.path, "index.html");
    res.sendFile(dirIndex, (e) => {
      if (!e) return;
      // Final fallback: serve root index.html
      res.sendFile(path.join(__dirname, "index.html"), (e2) => {
        if (e2) res.status(404).json({ error: "not_found", path: req.path });
      });
    });
  });
});

/* ── Start (local only — Vercel manages its own listener) ────────────────── */
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log("\n────────────────────────────────────────────────────────");
    console.log(`  PEAR VTON server → http://localhost:${PORT}`);
    console.log(`  Storefront  : http://localhost:${PORT}/`);
    console.log(`  Fitting room: http://localhost:${PORT}/ui/fitting-room/   ← OPEN THIS`);
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
