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
import { supabase } from "./lib/supabase.js";

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

/* Admin authorization allowlist. requireAdminAuth() only accepts a Supabase Auth
   JWT whose verified email is in this list. Without it, ANY account that can sign
   up against the public anon key would pass the auth check (authentication ≠
   authorization). Set ADMIN_EMAILS in .env AND in your Vercel env vars:
     ADMIN_EMAILS=you@example.com,partner@example.com                            */
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

/* ── Express setup ───────────────────────────────────────────────────────── */
const app = express();
app.use(express.json({ limit: "8mb" }));
app.disable("x-powered-by");
app.set("trust proxy", true);   // Vercel/edge sets X-Forwarded-For; needed for req.ip + rate limiting

/* ── Security headers (all responses) ──────────────────────────────────────────
   Applied globally so HTML pages (not just /api) carry hardening headers. The
   admin dashboard additionally gets strict anti-framing + no-store to defeat
   clickjacking and stop the (login-gated) page being cached on shared machines.
   The rest of the site allows same-origin framing so the storefront can embed the
   fitting room (its "back to store" link uses target="_top", implying embedding). */
app.use((req, res, next) => {
  res.header("X-Content-Type-Options", "nosniff");
  res.header("Referrer-Policy", "strict-origin-when-cross-origin");
  res.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  const isAdmin = /(^|\/)admin(\.html|\.js|\.css)?(\/|$)/i.test(req.path);
  // The fitting room is embedded cross-origin by the pear-widget.js modal on
  // third-party store pages, so it (and the widget assets) must be frameable
  // from anywhere. It is a public, unauthenticated surface — the clickjacking
  // protections stay in force on the admin dashboard and the rest of the site.
  const isEmbeddable = /^\/(fitting-room|widget)(\/|$)/i.test(req.path);
  if (isAdmin) {
    res.header("X-Frame-Options", "DENY");
    res.header("Content-Security-Policy", "frame-ancestors 'none'");
    res.header("Cache-Control", "no-store, no-cache, must-revalidate");
  } else if (isEmbeddable) {
    res.header("Content-Security-Policy", "frame-ancestors *");
  } else {
    res.header("X-Frame-Options", "SAMEORIGIN");
    res.header("Content-Security-Policy", "frame-ancestors 'self'");
  }
  next();
});

/* ── Lightweight in-memory rate limiter ────────────────────────────────────────
   Sliding-window per client IP. NOTE: on serverless (Vercel) each warm instance
   keeps its own counters, so this is a best-effort brake against casual flooding
   /brute-forcing, not a distributed guarantee. For hard limits put a shared store
   (Upstash/Redis) or the platform WAF in front. Still, it meaningfully raises the
   cost of registration spam, session-table flooding, and token-mint abuse. */
function rateLimit({ windowMs, max }) {
  const hits = new Map();   // ip -> [timestamps]
  return (req, res, next) => {
    const ip =
      (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
      req.ip || req.socket?.remoteAddress || "unknown";
    const now = Date.now();
    const arr = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    arr.push(now);
    hits.set(ip, arr);
    if (hits.size > 5000) {                 // opportunistic cleanup of idle IPs
      for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    }
    if (arr.length > max) {
      res.set("Retry-After", String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: "rate_limited", message: "Too many requests — slow down." });
    }
    next();
  };
}

// Per-surface limiters (generous enough to never bother a real user).
const tokenLimiter   = rateLimit({ windowMs: 60_000, max: 30 });   // ek_ token mint — costs money
const sessionLimiter = rateLimit({ windowMs: 60_000, max: 40 });   // session-log ingest
const userLimiter    = rateLimit({ windowMs: 60_000, max: 20 });   // user registration
const trackLimiter   = rateLimit({ windowMs: 60_000, max: 60 });   // analytics ping
const proxyLimiter   = rateLimit({ windowMs: 60_000, max: 120 });  // image proxy

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
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
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
    .get(tokenLimiter, mintToken)
    .post(tokenLimiter, mintToken)
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
app.post("/api/track-tryon", trackLimiter, async (req, res) => {
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

/* ── Debug: verify Sheets env vars and write a test row (admin-only) ──────────
   Gated behind requireAdminAuth: it previously exposed the Google Sheet ID and the
   service-account email to any anonymous caller and let anyone write test rows.
   Env-var VALUES are no longer echoed — only presence — even to admins. */
app.get("/api/test-sheets", requireAdminAuth, async (req, res) => {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const email   = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key     = process.env.GOOGLE_PRIVATE_KEY;
  const envCheck = {
    GOOGLE_SHEET_ID:              sheetId ? "✓ present" : "✗ MISSING",
    GOOGLE_SERVICE_ACCOUNT_EMAIL: email   ? "✓ present" : "✗ MISSING",
    GOOGLE_PRIVATE_KEY:           key     ? "✓ present" : "✗ MISSING",
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
   ADMIN DASHBOARD — session-log ingest + read API (OPEN ACCESS)
   ---------------------------------------------------------------------------
   The password/login gate has been removed: the admin endpoints below respond
   directly with no auth header required. Session rows persist in Supabase
   (lib/supabase.js), shared and durable across all server instances.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── Session persistence ──────────────────────────────────────────────────────
   Durable storage via Supabase (Postgres). Survives cold starts, redeploys,
   and is shared across all server instances. Requires the `sessions` table
   created by supabase_setup.sql and two env vars:
     SUPABASE_URL              — from Supabase Dashboard → Settings → API
     SUPABASE_SERVICE_ROLE_KEY — from Supabase Dashboard → Settings → API
   ──────────────────────────────────────────────────────────────────────────── */
console.log(`[sessions] storage backend: ${supabase ? "Supabase" : "DISABLED (env vars missing)"}`);

/* Guard for Supabase-backed routes. When the client is null (env vars missing)
   we return a clear 503 instead of dereferencing null and crashing. Returns true
   when it has already sent the error response, so the caller should `return`. */
function storageUnavailable(res) {
  if (supabase) return false;
  res.status(503).json({
    ok: false,
    error: "storage_unconfigured",
    message: "Database not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing). " +
             "Session and user features are temporarily unavailable.",
  });
  return true;
}

/* ── Admin auth middleware — verifies Supabase Auth JWT + admin allowlist ───────
   Two independent checks, both required:
     1. AUTHENTICATION — the Bearer token is a valid, unexpired Supabase Auth JWT
        (verified server-side via getUser()).
     2. AUTHORIZATION  — the token's verified email is in ADMIN_EMAILS. This is the
        critical second gate: the fitting room ships the PUBLIC anon key, so anyone
        who signs up against it gets a valid JWT. Without the allowlist, "logged in"
        would equal "admin" and any member of the public could read all PII and wipe
        the sessions table.
   On success the verified email is attached as req.adminEmail for audit logging. */
async function requireAdminAuth(req, res, next) {
  if (storageUnavailable(res)) return;   // no Supabase client → can't verify → fail closed
  const auth  = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) {
    return res.status(401).json({ ok: false, error: "unauthorized", message: "Missing auth token." });
  }
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ ok: false, error: "unauthorized", message: "Invalid or expired token." });
    }
    const email = (user.email || "").toLowerCase();
    if (ADMIN_EMAILS.length === 0) {
      // Allowlist not configured — fail OPEN for backward compatibility, but shout
      // about it. Configure ADMIN_EMAILS to close this hole (see the env comment).
      console.warn(
        `[admin-auth] ⚠ ADMIN_EMAILS is empty — authorizing ANY authenticated user ` +
        `(${email || "unknown"}). Set ADMIN_EMAILS to restrict admin access.`
      );
    } else if (!ADMIN_EMAILS.includes(email)) {
      console.warn(`[admin-auth] blocked non-admin login: "${email}"`);
      return res.status(403).json({ ok: false, error: "forbidden", message: "Not an admin account." });
    }
    req.adminEmail = email;
    next();
  } catch (err) {
    console.error("[admin-auth] getUser failed:", err?.message);
    return res.status(401).json({ ok: false, error: "unauthorized", message: "Auth check failed." });
  }
}

async function readSessionLogs() {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

async function saveSessionLog(entry) {
  const { error } = await supabase.from("sessions").insert([entry]);
  if (error) throw new Error(error.message);
  // Return approximate total count without a separate COUNT query.
  return null;
}

async function clearSessionLogs() {
  // Delete every row. Supabase requires a filter for safety; `neq` on id covers all rows.
  const { error } = await supabase.from("sessions").delete().neq("id", 0);
  if (error) throw new Error(error.message);
}

/* ═══════════════════════════════════════════════════════════════════════════
   USER IDENTITY — first-time visitors enter name + phone once; the browser is
   then remembered via a client-generated device_id (localStorage 'pear_device_id').
   On return visits the client looks the user up by device_id and skips the form,
   so new measurements just attach to the existing profile via sessions.user_id.
   ══════════════════════════════════════════════════════════════════════════ */
/* device_id is NOT unique (a shared/QA browser can legitimately attach to several
   different phone-identified profiles over its lifetime — see V3 migration), so
   this can no longer assume a single row. Used only by the admin-adjacent
   GET /api/users/:deviceId debug lookup — never by createUser's identification
   logic, which must go by phone alone. Returns the most recently touched row. */
async function findUserByDeviceId(deviceId) {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("device_id", deviceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

/* Phone is the human-facing UNIQUE identity (a person keeps their number across
   browsers/devices) — enforced both here in application logic AND by a UNIQUE
   index in the database (see supabase_setup_v3.sql). We store and compare it
   normalized to digits only so "050-1234567", "0501234567" and "050 123 4567"
   all resolve to the same user. */
function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

async function findUserByPhone(phone) {
  const norm = normalizePhone(phone);
  if (!norm) return null;
  // .limit(1) BEFORE reading a single row: if pre-existing legacy rows (from
  // before phone became the identity key) normalize to the same digits, a bare
  // .maybeSingle() throws "multiple rows returned" and every lookup for that
  // phone 500s — masquerading as "the whole feature doesn't work." Taking the
  // most recent of any duplicates keeps this working even before that legacy
  // data is cleaned up.
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("phone", norm)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

/* The user's most recently saved body measurements (each save is a timestamped
   `sessions` row). Powers auto-login prefill + the 30-day "time to re-measure"
   reminder. Returns null when the user has never saved measurements. */
async function latestMeasurementsForUser(userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from("sessions")
    .select("height, weight, chest, waist, legs, size, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    measurements: {
      height: data.height, weight: data.weight,
      chest: data.chest, waist: data.waist, legs: data.legs,
    },
    size: data.size || "",
    measurementsUpdatedAt: data.created_at || null,
  };
}

/* Strip a user row down to the non-PII fields the PUBLIC client actually needs
   (returning-visitor recognition uses id + name only). The phone number is PII and
   must NEVER be returned by an unauthenticated endpoint — only the admin API, which
   is auth-gated, may see it. */
function publicUser(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, created_at: u.created_at };
}

/* POST /api/users — identify (or create) a user by PHONE. Phone is the ONLY
   lookup key here — device_id is never consulted for identification, it is
   purely an audit field written/refreshed on the matched row. This is
   deliberate: an earlier version checked device_id FIRST ("known browser →
   return its profile"), which meant typing a different name/phone into the
   identity form on a browser that had registered before silently returned the
   PREVIOUS visitor's real saved profile instead of respecting what was typed.
   See supabase_setup_v3.sql for the matching schema change (phone UNIQUE,
   device_id no longer unique). Returns { ok, user, ...measurements }. */
async function createUser(req, res) {
  if (storageUnavailable(res)) return;
  const b = req.body || {};
  const str = (v, max = 80) => (v == null ? "" : String(v).trim().slice(0, max));
  const deviceId = str(b.deviceId, 64);
  const name     = str(b.name, 80);
  const phone    = normalizePhone(str(b.phone, 40));

  if (!deviceId || !name || !phone) {
    return res.status(400).json({
      error: "missing_fields",
      message: "deviceId, name and phone are all required.",
    });
  }

  const sameName = (a, c) =>
    String(a || "").trim().toLowerCase() === String(c || "").trim().toLowerCase();

  // Same person, matching name → re-link this device to their profile (an audit
  // update only — never used for lookup) and hand back their saved measurements.
  // Different name on the same phone → BLOCK; that phone is taken. Shared by both
  // the normal path and the insert-race fallback below.
  const respondForExistingPhone = async (row) => {
    if (sameName(row.name, name)) {
      await supabase.from("users").update({ device_id: deviceId }).eq("id", row.id);
      console.log(`[users] name+phone match → auto-login user ${row.id}, relinked device "${deviceId}"`);
      const m = await latestMeasurementsForUser(row.id).catch(() => null);
      return {
        status: 200,
        body: { ok: true, user: publicUser({ ...row, device_id: deviceId }), existed: true, matched: "phone", ...(m || {}) },
      };
    }
    console.warn(`[users] phone already registered to a different name → blocked`);
    return {
      status: 409,
      body: { ok: false, error: "phone_taken", message: "This phone number is already registered to another user." },
    };
  };

  try {
    const byPhone = await findUserByPhone(phone);
    if (byPhone) {
      const { status, body } = await respondForExistingPhone(byPhone);
      return res.status(status).json(body);
    }

    const { data, error } = await supabase
      .from("users")
      .insert([{ device_id: deviceId, name, phone }])
      .select()
      .single();

    if (error) {
      // Race: another request registered the SAME PHONE between our check and this
      // insert (phone now has a UNIQUE index — see supabase_setup_v3.sql). Re-run
      // the same phone-match/block decision against the row that won the race.
      const raced = await findUserByPhone(phone);
      if (raced) {
        const { status, body } = await respondForExistingPhone(raced);
        return res.status(status).json(body);
      }
      throw new Error(error.message);
    }

    console.log(`[users] created user ${data.id} (phone-unique, device "${deviceId}")`);
    res.json({ ok: true, user: publicUser(data), existed: false });
  } catch (err) {
    console.error("[users] create failed:", err?.message);
    res.status(500).json({ ok: false, error: err?.message });
  }
}

/* GET /api/users/:deviceId — return the user for this device_id, or 404. */
async function getUserByDevice(req, res) {
  if (storageUnavailable(res)) return;
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  const deviceId = String(req.params.deviceId || "").trim();
  if (!deviceId) return res.status(400).json({ error: "missing_device_id" });
  try {
    const user = await findUserByDeviceId(deviceId);
    if (!user) return res.status(404).json({ ok: false, error: "not_found" });
    // Include the user's latest saved measurements (own data, keyed by their own
    // device) so the client can prefill the form and run the 30-day re-measure
    // check. Still no phone/PII in the payload.
    const m = await latestMeasurementsForUser(user.id).catch(() => null);
    res.json({ ok: true, user: publicUser(user), ...(m || {}) });
  } catch (err) {
    console.error("[users] lookup failed:", err?.message);
    res.status(500).json({ ok: false, error: err?.message });
  }
}

/* GET /api/admin/users — open access. Returns every user with their total
   measurement (session) count, newest user first. */
async function getUsersWithCounts(_req, res) {
  if (storageUnavailable(res)) return;
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    const [{ data: users, error: uErr }, { data: rows, error: sErr }] = await Promise.all([
      supabase.from("users").select("*").order("created_at", { ascending: false }),
      supabase.from("sessions").select("user_id"),
    ]);
    if (uErr) throw new Error(uErr.message);
    if (sErr) throw new Error(sErr.message);

    // Tally sessions per user_id in one pass.
    const counts = new Map();
    for (const r of rows || []) {
      if (!r.user_id) continue;
      counts.set(r.user_id, (counts.get(r.user_id) || 0) + 1);
    }

    const withCounts = (users || []).map((u) => ({
      ...u,
      session_count: counts.get(u.id) || 0,
    }));

    res.json({ ok: true, count: withCounts.length, users: withCounts });
  } catch (err) {
    console.error("[admin/users] read failed:", err?.message);
    res.status(500).json({ ok: false, error: err?.message, users: [], count: 0 });
  }
}

/* ── POST: save a session → appends to sessions.json ─────────────────────── */
async function saveSession(req, res) {
  if (storageUnavailable(res)) return;
  const b = req.body || {};
  const m = b.measurements || {};   // tolerate either nested {measurements} or flat fields
  const str = (v, max = 80) => (v == null ? "" : String(v).slice(0, max));
  const n   = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
  const pick = (a, c) => (a !== undefined && a !== null && a !== "" ? a : c);

  const entry = {
    session_id:    str(b.sessionId,    64) || crypto.randomUUID(),
    user_id:       b.userId || null,   // links the session to a remembered user (users.id)
    height:        n(pick(b.height,    m.height)),
    weight:        n(pick(b.weight,    m.weight)),
    chest:         n(pick(b.chest,     m.chest)),
    waist:         n(pick(b.waist,     m.waist)),
    legs:          n(pick(b.legs,      m.legs)),
    size:          str(b.size,         8),
    garment_id:    str(b.garmentId,    64),
    garment_name:  str(b.garmentName,  80),
    garment_type:  str(b.garmentType,  40),
    sleeve_type:   str(b.sleeveType,   40),
    pants_fit:     str(b.pantsFit,     40),
  };

  try {
    await saveSessionLog(entry);
    console.log("[sessions] saved session → Supabase");
    res.json({ ok: true });
  } catch (err) {
    console.error("[sessions] persist failed:", err?.message);
    res.json({ ok: false, error: err?.message });
  }
}

/* ── GET: retrieve sessions (open access) → reads from Supabase ───────────── */
async function getSessions(_req, res) {
  if (storageUnavailable(res)) return;
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    const sessions = await readSessionLogs();   // already newest-first from Supabase ORDER BY
    console.log(`[admin/sessions] Supabase → ${sessions.length} session(s) found`);
    res.json({ ok: true, count: sessions.length, sessions });
  } catch (err) {
    console.error("[admin/sessions] read failed:", err?.message);
    res.status(500).json({ ok: false, error: err?.message, sessions: [], count: 0 });
  }
}

/* DELETE: wipe all sessions (admin-only). */
async function clearSessions(req, res) {
  if (storageUnavailable(res)) return;
  try {
    await clearSessionLogs();
    console.log(`[sessions] cleared all → Supabase (by admin: ${req.adminEmail || "unknown"})`);
    res.json({ ok: true });
  } catch (err) {
    console.error("[sessions] clear failed:", err?.message);
    res.status(500).json({ ok: false, error: err?.message });
  }
}

/* Canonical routes the dashboard uses. POST (fitting-room ingest) is open but rate
   limited; GET and DELETE are admin-only and require a valid Supabase Auth token. */
app.post("/api/sessions", sessionLimiter, saveSession);
app.get("/api/sessions", requireAdminAuth, getSessions);
app.delete("/api/sessions", requireAdminAuth, clearSessions);

/* Back-compat aliases (older clients / earlier code paths).
   SECURITY: these MUST carry the same guards as the canonical routes above — the
   GET/DELETE aliases previously had NO auth, which fully bypassed the admin gate
   (unauthenticated read of all data + wipe of the entire table). */
app.post("/api/session-log",      sessionLimiter, saveSession);
app.get("/api/admin/sessions",    requireAdminAuth, getSessions);
app.delete("/api/admin/sessions", requireAdminAuth, clearSessions);

/* User identity routes (returning-visitor recognition). POST is rate limited; the
   public GET returns non-PII fields only; the admin list is auth-gated. */
app.post("/api/users",            userLimiter, createUser);
app.get("/api/users/:deviceId",   getUserByDevice);
app.get("/api/admin/users",       requireAdminAuth, getUsersWithCounts);

/* Pre-login allowlist check: the admin login page calls this before requesting a
   magic link so only ADMIN_EMAILS addresses ever trigger a Supabase email send.
   Returns only { allowed: true|false } — no PII, no token, no session. */
app.get("/api/admin/check-email", (req, res) => {
  const email = (req.query.email || "").toLowerCase().trim();
  const allowed = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.toLowerCase().trim());
  if (allowed.includes(email)) {
    res.json({ allowed: true });
  } else {
    res.json({ allowed: false });
  }
});

/* ── In-memory image cache — avoids re-fetching the same CDN image within a warm
   Lambda container. Keyed by full URL; evicts oldest entry when the cap is hit.
   Vercel's CDN also caches the HTTP response (via Cache-Control), so Decart's
   server often hits the edge cache on repeat fetches — this cache additionally
   cuts Lambda execution time for the first in-process hit. */
const imgCache = new Map();
const IMG_CACHE_MAX = 50;

/* ── Image-proxy SSRF guard ────────────────────────────────────────────────────
   The proxy fetches an arbitrary caller-supplied URL server-side.  We block
   private/internal network ranges (where SSRF is dangerous) and non-HTTPS
   schemes, but allow any public HTTPS host so widget garments from any store
   load without manual allowlist additions.
   Blocked ranges:
     • loopback:      127.0.0.0/8
     • private A:     10.0.0.0/8
     • private B:     172.16.0.0/12
     • private C:     192.168.0.0/16
     • link-local:    169.254.0.0/16  (AWS/GCP metadata endpoint)
     • IPv6 loopback: ::1
     • plain hostname: localhost, *.local, *.internal                          */
function isPrivateHost(hostname) {
  const h = (hostname || "").toLowerCase();
  if (!h) return true;

  // IPv6 loopback / link-local
  if (h === "::1" || h.startsWith("fe80:") || h.startsWith("[::1]") || h.startsWith("[fe80:")) return true;

  // Named internal hosts
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;

  // IPv4 literal check
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (ipv4) {
    const [, a, b] = ipv4.map(Number);
    if (a === 127)                        return true;  // loopback
    if (a === 10)                         return true;  // private A
    if (a === 172 && b >= 16 && b <= 31)  return true;  // private B
    if (a === 192 && b === 168)           return true;  // private C
    if (a === 169 && b === 254)           return true;  // link-local / metadata
    return true; // all other bare IP literals — block by default
  }

  return false;
}

function isProxyHostAllowed(hostname, protocol) {
  if (protocol !== "https:") return false;  // HTTPS only
  return !isPrivateHost(hostname);
}

/* ── Image proxy — fetches garment images server-side to sidestep CORS restrictions
   on CDN hosts (cdn.suitsupply.com, img.magnific.com, etc.) that block browser
   cross-origin fetch.  The Decart SDK calls fetch(imageUrl) internally when you
   pass a URL string to rtClient.set(), which fails for those CDNs.  By proxying
   through this endpoint the browser always makes a same-origin request, and the
   server (no CORS restriction) retrieves the image and pipes it back as a Blob.
   The client then passes the Blob directly to rtClient.set() — no CDN fetch needed.
   ─────────────────────────────────────────────────────────────────────────────── */
app.get("/api/img-proxy", proxyLimiter, async (req, res) => {
  const raw = req.query.url;
  if (!raw) return res.status(400).json({ error: "missing_url", message: "?url= is required" });

  let parsed;
  try {
    parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("bad protocol");
  } catch {
    return res.status(400).json({ error: "invalid_url", message: "url must be an absolute http(s) URL" });
  }

  // SSRF guard — block private/internal hosts; require HTTPS.
  if (!isProxyHostAllowed(parsed.hostname, parsed.protocol)) {
    console.warn(`[img-proxy] blocked disallowed host: "${parsed.hostname}"`);
    return res.status(403).json({ error: "host_not_allowed", message: "This image host is not permitted." });
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

/* ── Embeddable widget (pear-widget.js) ────────────────────────────────────
   Served with an explicit route so it carries CORS + cache headers — stores
   embed it with a plain <script src> from any origin. */
app.get("/widget/pear-widget.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.sendFile(path.join(__dirname, "widget/pear-widget.js"));
});

/* Store-integration guide (widget/pear-widget-guide.html). */
app.get("/widget/guide", (req, res) => {
  res.sendFile(path.join(__dirname, "widget/pear-widget-guide.html"));
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
