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
 * @property {number}   PLAYOUT_DELAY_HINT      Chromium RTCRtpReceiver.playoutDelayHint (seconds). 0 = render ASAP.
 * @property {boolean}  PREFER_LOW_LATENCY_CODEC Opt-in SDP codec-preference munge (default OFF — see note below).
 * @property {string[]} CODEC_PREFERENCE        Codec order tried when the munge flag is ON (reorder only, never remove).
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

  /* ── realtime latency tuning (CLIENT-side only) ─────────────────────────────
     ⚠️ Scope reality check: the ~1s a user perceives in the Lucy-VTON feed is
     dominated by SERVER-SIDE neural inference + network RTT, neither of which is
     tunable from the browser. The knobs below only trim the CLIENT jitter buffer
     / decode path — a real but bounded win (tens of ms). They are applied via a
     native-RTCPeerConnection hook in app.js because the SDK (LiveKit) owns the
     peer connection; app.js never sees the receiver or SDP directly. */
  PLAYOUT_DELAY_HINT: 0,            // seconds; 0 = decode+render immediately, no anti-jitter buffering (Chromium only)
  PREFER_LOW_LATENCY_CODEC: false,  // SDP munge OFF by default: reordering LiveKit's negotiated codecs risks breaking
                                    // the Decart session for ~0 latency gain. Flip to true only to experiment.
  CODEC_PREFERENCE: Object.freeze(["VP8", "H264"]), // when the munge is ON, these are MOVED to the front of m=video (never removed)
});
