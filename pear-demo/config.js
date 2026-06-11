/**
 * config.js — Single source of truth for the PEAR fitting room.
 * ----------------------------------------------------------------------------
 * Every configurable timing and endpoint the client uses lives HERE and nowhere
 * else. `app.js` imports these derived constants; it must not redefine them.
 *
 * ⚠️ DO NOT CHANGE `LIVE_DURATION_MS`. It is the strict 5-second live-session
 *    window that caps Decart token consumption. The automatic teardown
 *    (`autoStopAndFreeze`) is built around this exact value.
 *
 * ⚠️ Endpoints are served by the secure proxy in `../server.js`. The browser
 *    only ever talks to these same-origin paths — it never holds the permanent
 *    `dct_` key; it receives short-lived `ek_` tokens from `TOKEN_ENDPOINT`.
 *
 * @typedef {Object} PearConfig
 * @property {number}   LIVE_DURATION_MS        Strict live window per capture (ms). DO NOT CHANGE.
 * @property {number}   CONNECT_TIMEOUT_MS      Max wait for the realtime session to report "connected" (ms).
 * @property {number}   HEALTH_PROBE_TIMEOUT_MS Abort window for the pre-use connectivity probe (ms).
 * @property {number}   TOAST_DURATION_MS       On-screen toast lifetime (ms).
 * @property {string}   TOKEN_ENDPOINT          Same-origin proxy route that mints the ephemeral ek_ token.
 * @property {string}   HEALTH_ENDPOINT         Same-origin proxy health route used by the pre-use check.
 * @property {string[]} SDK_URLS                Ordered Decart SDK CDN fallbacks.
 */

/** @type {Readonly<PearConfig>} */
export const CONFIG = Object.freeze({
  /* ── timings (milliseconds) ─────────────────────────────────────────────── */
  LIVE_DURATION_MS:        5000,   // STRICT live window — DO NOT CHANGE (caps token spend)
  CONNECT_TIMEOUT_MS:      12000,  // max wait for the WebRTC session to reach "connected"
  HEALTH_PROBE_TIMEOUT_MS: 4000,   // pre-use /api/health probe abort window
  TOAST_DURATION_MS:       2600,   // toast visible duration

  /* ── secure proxy endpoints (same-origin; see ../server.js) ─────────────── */
  TOKEN_ENDPOINT:  "/api/realtime-token",
  HEALTH_ENDPOINT: "/api/health",

  /* ── Decart SDK CDN fallbacks (tried in order) ──────────────────────────── */
  SDK_URLS: Object.freeze([
    "https://esm.sh/@decartai/sdk@0.1.5",
    "https://cdn.jsdelivr.net/npm/@decartai/sdk@0.1.5/+esm",
  ]),
});
