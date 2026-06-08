/* =============================================================================
   PEAR / MERIDIAN — secure backend proxy for Decart Lucy VTON (realtime)
   -----------------------------------------------------------------------------
   The permanent Decart key (dct_…) lives ONLY here. The browser asks this
   server for a short-lived ephemeral client token (ek_…) and connects realtime
   with that. Verified against @decartai/sdk@0.1.5 type definitions:

     • tokens.create({ expiresIn, allowedModels, allowedOrigins })  ← real fields
       (NOTE: the SDK's zod schema is $strip — wrong field names are silently
        dropped, so getting these names right actually matters.)
     • returns { apiKey: "ek_…", expiresAt, permissions? }

   Endpoints:
     POST /api/realtime-token   → { apiKey:"ek_…", expiresAt, model, permissions }
     POST /api/tryon            → alias (blueprint-compatible name)
     GET  /api/health           → { ok, decart, model, keySource }

   Ref: https://docs.platform.decart.ai/getting-started/client-tokens
   ============================================================================ */

import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDecartClient } from "@decartai/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* Accept either name so the key is found regardless of which the operator used. */
const KEY_SOURCE =
  (process.env.DECART_API_KEY && "DECART_API_KEY") ||
  (process.env.DESCARTES_API_KEY && "DESCARTES_API_KEY") ||
  null;
const API_KEY = process.env.DECART_API_KEY || process.env.DESCARTES_API_KEY || "";

const PORT = Number(process.env.PORT) || 3000;
const VTON_MODEL = process.env.DECART_VTON_MODEL || "lucy-vton-latest";
const TOKEN_TTL = Math.min(3600, Math.max(1, Number(process.env.DECART_TOKEN_TTL) || 600));
/* Origin-locking realtime tokens silently breaks the WebRTC session on ANY
   origin mismatch (127.0.0.1 vs localhost, different port, etc). It is opt-in
   only — set DECART_ALLOWED_ORIGINS="https://app.example.com,..." to enable. */
const ALLOWED_ORIGINS = (process.env.DECART_ALLOWED_ORIGINS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

const app = express();
app.use(express.json({ limit: "8mb" }));
app.disable("x-powered-by");

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
   Uses the REAL option names. Falls back to a basic token only if the scoped
   call genuinely throws (not just because a field was stripped). */
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
      apiKey: token.apiKey,
      expiresAt: token.expiresAt ?? null,
      permissions: token.permissions ?? null,
      model: VTON_MODEL,
    });
  } catch (err) {
    console.error("token mint error:", err);
    return res.status(502).json({
      error: "token_mint_failed",
      message: err?.message || "Could not mint a Decart client token.",
      code: err?.code || null,
    });
  }
}

app.post("/api/realtime-token", mintToken);
app.post("/api/tryon", mintToken); // blueprint-compatible alias

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, decart: !!decart, model: VTON_MODEL, keySource: KEY_SOURCE });
});

/* ── Static hosting (storefront + fitting room) ───────────────────────────── */
app.use(express.static(__dirname, { extensions: ["html"] }));

app.listen(PORT, () => {
  console.log("\n────────────────────────────────────────────────────────");
  console.log(`  PEAR VTON server → http://localhost:${PORT}`);
  console.log(`  Storefront  : http://localhost:${PORT}/`);
  console.log(`  Fitting room: http://localhost:${PORT}/pear-demo/`);
  console.log(`  Decart      : ${decart ? `LIVE (${VTON_MODEL}, expiresIn ${TOKEN_TTL}s)` : "NOT configured"}`);
  if (ALLOWED_ORIGINS.length) console.log(`  Origin lock : ${ALLOWED_ORIGINS.join(", ")}`);
  console.log("────────────────────────────────────────────────────────\n");
});
