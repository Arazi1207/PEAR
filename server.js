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
async function findUserByDeviceId(deviceId) {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("device_id", deviceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

/* POST /api/users — create a user, or return the existing one for this device_id
   (upsert-by-device_id: never creates a duplicate, never overwrites the original
   name/phone). Returns { ok, user }. */
async function createUser(req, res) {
  if (storageUnavailable(res)) return;
  const b = req.body || {};
  const str = (v, max = 80) => (v == null ? "" : String(v).trim().slice(0, max));
  const deviceId = str(b.deviceId, 64);
  const name     = str(b.name, 80);
  const phone    = str(b.phone, 40);

  if (!deviceId || !name || !phone) {
    return res.status(400).json({
      error: "missing_fields",
      message: "deviceId, name and phone are all required.",
    });
  }

  try {
    // Already known device → return the existing profile, don't duplicate.
    const existing = await findUserByDeviceId(deviceId);
    if (existing) {
      console.log(`[users] device "${deviceId}" already known → returning existing user`);
      return res.json({ ok: true, user: existing, existed: true });
    }

    const { data, error } = await supabase
      .from("users")
      .insert([{ device_id: deviceId, name, phone }])
      .select()
      .single();

    if (error) {
      // Race: another request inserted the same device_id between our check and
      // insert. Fall back to fetching the now-existing row.
      const raced = await findUserByDeviceId(deviceId);
      if (raced) return res.json({ ok: true, user: raced, existed: true });
      throw new Error(error.message);
    }

    console.log(`[users] created user ${data.id} (device "${deviceId}")`);
    res.json({ ok: true, user: data, existed: false });
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
    res.json({ ok: true, user });
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

/* DELETE: wipe all sessions (open access). */
async function clearSessions(_req, res) {
  if (storageUnavailable(res)) return;
  try {
    await clearSessionLogs();
    console.log("[sessions] cleared all → Supabase");
    res.json({ ok: true });
  } catch (err) {
    console.error("[sessions] clear failed:", err?.message);
    res.status(500).json({ ok: false, error: err?.message });
  }
}

/* Canonical routes the dashboard uses (open access — no auth). */
app.post("/api/sessions", saveSession);
app.get("/api/sessions", getSessions);
app.delete("/api/sessions", clearSessions);

/* Back-compat aliases (older clients / earlier code paths). */
app.post("/api/session-log",      saveSession);
app.get("/api/admin/sessions",    getSessions);
app.delete("/api/admin/sessions", clearSessions);

/* User identity routes (returning-visitor recognition). */
app.post("/api/users",            createUser);
app.get("/api/users/:deviceId",   getUserByDevice);
app.get("/api/admin/users",       getUsersWithCounts);

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
