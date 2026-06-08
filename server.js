/* =============================================================================
   PEAR / MERIDIAN — secure backend proxy for Decart Lucy VTON (realtime)
   -----------------------------------------------------------------------------
   The permanent Decart key (dct_…) lives ONLY here. The browser asks this
   server for a short-lived ephemeral client token (ek_…) and connects realtime
   with that token.

   HOW THE REAL DECART REALTIME FLOW WORKS (verified from @decartai/sdk@0.1.5):
     1. tokens.create()  →  POST https://api.decart.ai/v1/client/tokens
                            (header X-API-KEY)  →  { apiKey:"ek_…", expiresAt }
        ── this is what THIS server does, and it returns 200 + a real ek_ token.
     2. realtime.connect() opens a WebSocket to wss://api3.decart.ai DIRECTLY
        from the browser, authenticated with the ek_ token. This server is NOT
        in that path, and proxy mode does NOT reroute that socket.

   ABOUT "405 Method Not Allowed":
     A 405 on POST /api/realtime-token means the request never reached THIS
     Express server — it hit a plain static host (VS Code Live Server, `serve`,
     `file://`, etc.) which rejects POST to a static path with 405.
     FIX: open the app through THIS server →  http://localhost:<PORT>/pear-demo/
     (run `npm start`). Do NOT open index.html via Live Server / file://.

   This server is hardened so the token endpoint cannot 405 by accident:
     • answers BOTH POST and GET, returns 405 + Allow for other verbs
     • permissive CORS (works even if the frontend is on another origin)
     • logs every /api request, returns JSON (never HTML) for /api errors

   Endpoints:
     POST|GET /api/realtime-token   → { apiKey:"ek_…", expiresAt, model, permissions }
     POST|GET /api/tryon            → alias (blueprint-compatible name)
     GET      /api/health           → { ok, decart, model, keySource }
   ============================================================================ */

import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDecartClient } from "@decartai/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ── secure environment lookup (accept either name) ───────────────────────── */
const KEY_SOURCE =
  (process.env.DECART_API_KEY && "DECART_API_KEY") ||
  (process.env.DESCARTES_API_KEY && "DESCARTES_API_KEY") ||
  null;
const API_KEY = process.env.DECART_API_KEY || process.env.DESCARTES_API_KEY || "";

const PORT = Number(process.env.PORT) || 3000;
const VTON_MODEL = process.env.DECART_VTON_MODEL || "lucy-vton-latest";
const TOKEN_TTL = Math.min(3600, Math.max(1, Number(process.env.DECART_TOKEN_TTL) || 600));
/* Origin-locking realtime tokens silently breaks the WebRTC session on ANY
   origin mismatch. Opt-in only via DECART_ALLOWED_ORIGINS="https://a.com,…". */
const ALLOWED_ORIGINS = (process.env.DECART_ALLOWED_ORIGINS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

const app = express();
app.use(express.json({ limit: "8mb" }));
app.disable("x-powered-by");

/* ── CORS + request logging for the API surface ───────────────────────────── */
app.use("/api", (req, res, next) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.header("Vary", "Origin");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Max-Age", "600");
  console.log(`[api] ${req.method} ${req.originalUrl}`);
  if (req.method === "OPTIONS") return res.sendStatus(204); // CORS preflight
  next();
});

/* ── Decart client (holds the permanent key — server-side only) ───────────── */
let decart = null;
if (API_KEY && /^dct_/.test(API_KEY)) {
  try {
    decart = createDecartClient({ apiKey: API_KEY });
    console.log(`✓ Decart client initialised (key from ${KEY_SOURCE}).`);
  } catch (err) {
    console.error("✗ Failed to initialise Decart client:", err?.message || err);
  }
} else {
  console.warn(
    "⚠ No valid Decart key (expected a dct_… value in DECART_API_KEY or DESCARTES_API_KEY).\n" +
    "  /api/realtime-token will return 503 and the live try-on cannot engage."
  );
}

/* ── Token minting ─────────────────────────────────────────────────────────
   Real SDK call: decart.tokens.create({ expiresIn, allowedModels, allowedOrigins }).
   Internally POSTs https://api.decart.ai/v1/client/tokens with X-API-KEY and
   returns { apiKey:"ek_…", expiresAt, permissions }. */
async function mintToken(req, res) {
  if (!decart) {
    return res.status(503).json({
      error: "decart_unconfigured",
      message: "Server has no valid Decart API key (DECART_API_KEY / DESCARTES_API_KEY).",
    });
  }

  const opts = { expiresIn: TOKEN_TTL, allowedModels: [VTON_MODEL] };
  if (ALLOWED_ORIGINS.length) opts.allowedOrigins = ALLOWED_ORIGINS;

  try {
    let token;
    try {
      token = await decart.tokens.create(opts);
    } catch (errScoped) {
      console.warn("tokens.create(scoped) failed, retrying basic:", errScoped?.message || errScoped);
      token = await decart.tokens.create();
    }
    if (!token || !token.apiKey) throw new Error("Decart returned no apiKey");

    return res.json({
      apiKey: token.apiKey,             // ek_… ephemeral client token
      expiresAt: token.expiresAt ?? null,
      permissions: token.permissions ?? null,
      model: VTON_MODEL,
    });
  } catch (err) {
    console.error("token mint error:", err?.message || err);
    return res.status(502).json({
      error: "token_mint_failed",
      message: err?.message || "Could not mint a Decart client token.",
      code: err?.code || null,
    });
  }
}

/* Accept BOTH verbs; reject others with a proper 405 + Allow (never a silent
   static-host 405). Same handler powers the blueprint-compatible /api/tryon. */
function mountTokenRoute(p) {
  app.route(p)
    .get(mintToken)
    .post(mintToken)
    .all((req, res) => res.set("Allow", "GET, POST, OPTIONS").status(405).json({
      error: "method_not_allowed",
      message: `Use GET or POST on ${p}. (A 405 here usually means the page is served by a static host, not this Express server — open http://localhost:${PORT}/pear-demo/ instead.)`,
    }));
}
mountTokenRoute("/api/realtime-token");
mountTokenRoute("/api/tryon");

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, decart: !!decart, model: VTON_MODEL, keySource: KEY_SOURCE });
});

/* Any other /api/* path → clear JSON 404 (not the static HTML fallthrough). */
app.all("/api/*", (req, res) => {
  res.status(404).json({ error: "not_found", message: `No API route for ${req.method} ${req.path}` });
});

/* ── Static hosting (storefront + fitting room) ───────────────────────────── */
app.use(express.static(__dirname, { extensions: ["html"] }));

app.listen(PORT, () => {
  console.log("\n────────────────────────────────────────────────────────");
  console.log(`  PEAR VTON server → http://localhost:${PORT}`);
  console.log(`  Storefront  : http://localhost:${PORT}/`);
  console.log(`  Fitting room: http://localhost:${PORT}/pear-demo/   ← OPEN THIS`);
  console.log(`  Decart      : ${decart ? `LIVE (${VTON_MODEL}, expiresIn ${TOKEN_TTL}s)` : "NOT configured"}`);
  console.log(`  Key source  : ${KEY_SOURCE || "(none)"}`);
  if (ALLOWED_ORIGINS.length) console.log(`  Origin lock : ${ALLOWED_ORIGINS.join(", ")}`);
  console.log("  NOTE: open the app through THIS server — not VS Code Live Server / file://");
  console.log("────────────────────────────────────────────────────────\n");
});
