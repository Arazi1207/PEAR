/* =============================================================================
   PEAR / MERIDIAN — secure backend proxy for Decart Lucy VTON (realtime)
   -----------------------------------------------------------------------------
   Why a backend at all?
     The permanent Decart key (dct_…) must NEVER ship to the browser. Lucy VTON
     is a realtime WebRTC model, so the documented secure pattern is:

       1. Browser asks THIS server for a short-lived client token.
       2. Server uses the permanent dct_ key (from .env) to mint an ephemeral
          ek_… token via the Decart SDK (`client.tokens.create()`).
       3. Server returns ONLY the ephemeral token to the browser.
       4. Browser connects to Lucy VTON realtime with the ek_ token.

     The dct_ key stays on the server. The ek_ token is short-lived (default
     600s here), scoped to the VTON model, and optionally origin-locked.

   Endpoints:
     POST /api/realtime-token   → { apiKey: "ek_…", expiresAt, model }
     POST /api/tryon            → alias of the above (blueprint-compatible name)
     GET  /api/health           → { ok, decart, model }

   Static hosting:
     Serves the MERIDIAN storefront (/) and the PEAR fitting room (/pear-demo/)
     from the same origin, so `fetch("/api/realtime-token")` is same-origin.

   Ref: https://docs.platform.decart.ai/getting-started/client-tokens
   ============================================================================ */

import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDecartClient } from "@decartai/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.DECART_API_KEY;
const VTON_MODEL = process.env.DECART_VTON_MODEL || "lucy-vton-latest";
const TOKEN_TTL = Math.min(3600, Math.max(1, Number(process.env.DECART_TOKEN_TTL) || 600));

const app = express();
app.use(express.json({ limit: "8mb" })); // generous: snapshots may be posted for logging/mock
app.disable("x-powered-by");

/* ── Decart client (holds the permanent key — server-side only) ───────────── */
let decart = null;
if (API_KEY && /^dct_/.test(API_KEY)) {
  try {
    decart = createDecartClient({ apiKey: API_KEY });
    console.log("✓ Decart client initialised.");
  } catch (err) {
    console.error("✗ Failed to initialise Decart client:", err?.message || err);
  }
} else {
  console.warn(
    "⚠ DECART_API_KEY missing or not a dct_ key — token endpoint will return 503.\n" +
    "  The frontend will automatically fall back to MOCK try-on so the demo still runs.\n" +
    "  Set DECART_API_KEY in .env to enable real Lucy VTON."
  );
}

/* ── Token minting ─────────────────────────────────────────────────────────
   Tries scoped options first (TTL + model scope + origin lock). If the SDK
   rejects the option shape on this version, falls back to a basic token. */
async function mintToken(req, res) {
  if (!decart) {
    return res.status(503).json({
      error: "decart_unconfigured",
      message: "Server has no valid DECART_API_KEY. Frontend should use mock mode.",
    });
  }

  // Build the origin lock from the request (browser-enforced defence-in-depth).
  const origin = req.headers.origin;
  const scoped = { ttlSeconds: TOKEN_TTL, models: [VTON_MODEL] };
  if (origin && /^https?:\/\//.test(origin)) scoped.allowedOrigins = [origin];

  let token;
  try {
    token = await decart.tokens.create(scoped);
  } catch (errScoped) {
    // Option shape may differ across SDK versions — retry a plain token.
    console.warn("tokens.create(scoped) failed, retrying basic token:", errScoped?.message || errScoped);
    try {
      token = await decart.tokens.create();
    } catch (errBasic) {
      console.error("tokens.create() failed:", errBasic?.message || errBasic);
      return res.status(502).json({
        error: "token_mint_failed",
        message: errBasic?.message || "Could not mint a Decart client token.",
      });
    }
  }

  // SDK returns at least { apiKey: "ek_…" }; expiresAt may or may not be present.
  return res.json({
    apiKey: token.apiKey ?? token.token ?? token,
    expiresAt: token.expiresAt ?? null,
    model: VTON_MODEL,
  });
}

app.post("/api/realtime-token", mintToken);
// Blueprint-compatible alias. Under realtime VTON the "/api/tryon" proxy mints a
// scoped ephemeral token instead of forwarding a still image (no such still-image
// VTON REST endpoint exists in the Decart API).
app.post("/api/tryon", mintToken);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, decart: !!decart, model: VTON_MODEL });
});

/* ── Static hosting (storefront + fitting room) ───────────────────────────── */
app.use(express.static(__dirname, { extensions: ["html"] }));

app.listen(PORT, () => {
  console.log("\n────────────────────────────────────────────────────────");
  console.log(`  PEAR VTON server running → http://localhost:${PORT}`);
  console.log(`  Storefront :  http://localhost:${PORT}/`);
  console.log(`  Fitting room: http://localhost:${PORT}/pear-demo/`);
  console.log(`  Decart      : ${decart ? "configured (" + VTON_MODEL + ", TTL " + TOKEN_TTL + "s)" : "NOT configured → mock mode"}`);
  console.log("────────────────────────────────────────────────────────\n");
});
