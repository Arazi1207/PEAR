/* ============================================================================
   PEAR — Virtual fitting room (Lucy VTON realtime, LIVE-first)
   ----------------------------------------------------------------------------
   Screen 1  Size calculator (required) ─► Screen 2  Isolated try-on room.

   Engine: Decart Lucy VTON realtime ("lucy-vton-latest") over WebRTC (LiveKit).
   Verified against @decartai/sdk@0.1.5:
     • createDecartClient({ apiKey })  — apiKey is a short-lived ek_ token minted
       by the backend (/api/realtime-token); the permanent dct_ key never reaches
       the browser.
     • client.realtime.connect(stream, { model, mirror, onRemoteStream,
                                         onConnectionChange })
     • ConnectionState: connecting|connected|generating|disconnected|reconnecting
     • rtClient.set({ prompt, image, enhance })  — image may be an http(s) URL
     • rtClient.on("error", …)

   Flow: enter room → start camera → connect realtime (badge turns green when the
   session reports "connected"). "Capture & Try On" applies the garment via
   set() and freezes a frame of the AI-dressed output stream onto the canvas.

   A labelled mock remains ONLY behind ?demo=1 for offline dev.
   ============================================================================ */
"use strict";

/* ── configuration (Task 8/9) ─────────────────────────────────────────────────
   All timings and endpoints come from config.js — the single source of truth.
   The browser NEVER holds the permanent dct_ key: the secure proxy (server.js)
   mints a short-lived, scoped, origin-locked ek_ token on demand via
   TOKEN_ENDPOINT, fetched the instant the user goes live (see mintEphemeralToken).
   We destructure the derived constants so existing call sites read naturally.   */
import { CONFIG } from "./config.js";
const {
  CONNECT_TIMEOUT_MS,
  HEALTH_PROBE_TIMEOUT_MS,
  TOAST_DURATION_MS,
  TOKEN_ENDPOINT,
  HEALTH_ENDPOINT,
  SDK_URLS,
  PLAYOUT_DELAY_HINT,
  PREFER_LOW_LATENCY_CODEC,
  CODEC_PREFERENCE,
  VIDEO_TARGET_BITRATE_KBPS,
} = CONFIG;

const DEMO_FLAG = new URLSearchParams(location.search).get("demo") === "1";

/* ── Strict live-session lifecycle (token spend lives here) ──────────────────
   The live window is hard-capped at LIVE_DURATION_MS and the capture/inference
   rate at LIVE_FPS. Decart bills ≈ per processed frame (fps × seconds), so the
   token cost of a try-on is governed ENTIRELY by these two numbers:

      tokens ≈ LIVE_FPS × (LIVE_DURATION_MS / 1000) × ~0.39   (SDK per-frame est.)

   • 5s × 15fps ≈ 75 frames ≈ ~29 tokens  ← current setting (exact 5s, full 15fps)
   • 5s ×  4fps ≈ 20 frames ≈ ~10 tokens  ← lower LIVE_INFERENCE_FPS to hit a ~10 cap

   LIVE_FPS is the LOCAL camera-capture rate (kept at 15 for a smooth preview and
   low upload bandwidth). LIVE_INFERENCE_FPS is what the Decart MODEL actually
   processes — the only knob that changes the bill. Dial it down to trim tokens
   without touching the 5-second on-screen window. */
const LIVE_DURATION_MS    = 5000;   // strict live-session cap — EXACTLY 5 seconds, no token can leak past it
const LIVE_FPS            = 15;     // local getUserMedia capture rate (smooth preview, low upload bitrate)
const LIVE_INFERENCE_FPS  = 6;      // Decart-billed frame rate — 6fps × 5s = 30 frames ≈ ~12 tokens/session (hard ceiling).
                                    //   tokens = LIVE_INFERENCE_FPS × (LIVE_DURATION_MS/1000) × ~0.39 → 11.7 ≤ 12 "no matter what".
                                    //   NB: tokens scale with FRAMES (fps × seconds), NOT resolution — see LIVE_W/LIVE_H below.

/* Capture + inference resolution. LOWERED from 1088×624 to cut upload/encode time
   AND per-frame neural-inference time → faster first dressed frame + lower in-feed
   latency. Quality drops with the pixel count (the user's explicit speed-for-quality
   trade); 768×440 keeps the original ~1.745 aspect so nothing gets letter-boxed.
   This does NOT change the token count — only LIVE_INFERENCE_FPS / LIVE_DURATION_MS do. */
const LIVE_W = 768, LIVE_H = 440;

/* Mobile detection (Feature 2 / mobile download fix). Drives two choices:
   (1) the MediaRecorder container — phone galleries reliably ingest H.264 MP4 but
       frequently reject WebM; (2) the save path — iOS Safari ignores <a download>,
       so on mobile we hand the clip to the native share sheet ("Save Video" → gallery).
   iPadOS reports its platform as "Mac", so a touch-capable Mac counts as mobile too. */
const IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (/Mac/.test(navigator.platform) && navigator.maxTouchPoints > 1);

/* ──────────────────────────────────────────────────────────────────────────
   REAL-TIME LATENCY HOOK — client jitter-buffer trim (best-effort)
   ----------------------------------------------------------------------------
   WHY A HOOK: the Decart SDK (LiveKit under the hood) owns the RTCPeerConnection,
   its receivers, and the SDP. app.js only ever receives the finished MediaStream
   via onRemoteStream — a MediaStream exposes tracks, NOT RTCRtpReceivers or SDP.
   So the only way to reach the remote receiver (for playoutDelayHint) and the
   SDP (for the optional codec munge) is to wrap the *native* RTCPeerConnection
   ONCE, here at module load, BEFORE the SDK is dynamically imported in
   connectRealtime(). Every pc the SDK then creates is our patched instance.

   ⚠️ SCOPE: this only shrinks the CLIENT jitter buffer / decode latency (tens of
   ms). The ~1s a user perceives is dominated by server-side Lucy-VTON inference
   + network RTT, which is NOT addressable from the browser. Every step below is
   feature-detected and try-wrapped so it can never break the realtime session.
   ────────────────────────────────────────────────────────────────────────── */
(function installRealtimeLatencyHook() {
  const Native = typeof window !== "undefined" && window.RTCPeerConnection;
  if (!Native || Native.__pearLowLatencyPatched) return;

  // Move preferred (low-latency / hw-friendly) codecs to the front of the
  // m=video payload list. Conservative: codecs are only REORDERED, never
  // removed, so if the server ignores the hint the session still negotiates.
  // Inject b=AS:4000 (kbps, RFC 4566) + b=TIAS:4000000 (bps, RFC 3890) into the
  // m=video section, replacing any existing b= lines, to unlock 4 Mbps headroom.
  // Always applied to both setLocalDescription and setRemoteDescription.
  function mungeSdpBandwidth(sdp) {
    try {
      if (typeof sdp !== "string") return sdp;
      const lines = sdp.split(/\r\n|\n/);
      const mIdx = lines.findIndex((l) => l.startsWith("m=video"));
      if (mIdx === -1) return sdp;

      // Remove any pre-existing b= lines in the video section to avoid duplicates.
      const secEnd = (() => { const i = lines.findIndex((l, j) => j > mIdx && l.startsWith("m=")); return i === -1 ? lines.length : i; })();
      for (let i = mIdx + 1; i < secEnd; ) {
        if (lines[i].startsWith("b=")) lines.splice(i, 1);
        else i++;
      }

      // Insert after m=video and any immediately following c= line.
      let at = mIdx + 1;
      if (at < lines.length && lines[at].startsWith("c=")) at++;
      lines.splice(at, 0, "b=AS:4000", "b=TIAS:4000000");
      return lines.join("\r\n");
    } catch (_) {
      return sdp;
    }
  }

  function mungeSdpPreferCodec(sdp) {
    try {
      if (typeof sdp !== "string") return sdp;
      const lines = sdp.split(/\r\n|\n/);
      const mIdx = lines.findIndex((l) => l.startsWith("m=video"));
      if (mIdx === -1) return sdp;

      const wanted = [];
      for (const name of CODEC_PREFERENCE) {
        const re = new RegExp(`^a=rtpmap:(\\d+)\\s+${name}/`, "i");
        for (const l of lines) {
          const m = l.match(re);
          if (m && !wanted.includes(m[1])) wanted.push(m[1]);
        }
      }
      if (!wanted.length) return sdp;

      const parts = lines[mIdx].split(" ");           // m=video PORT PROTO pt pt …
      const header = parts.slice(0, 3);
      const pts = parts.slice(3);
      const reordered = [
        ...wanted.filter((p) => pts.includes(p)),
        ...pts.filter((p) => !wanted.includes(p)),
      ];
      lines[mIdx] = [...header, ...reordered].join(" ");
      return lines.join("\r\n");
    } catch (_) {
      return sdp;                                     // never let a munge error break negotiation
    }
  }

  function Patched(...args) {
    const pc = new Native(...args);

    // (1) playoutDelayHint = 0 — flush the client jitter buffer immediately on every
    //     incoming video track. Chromium-only; the `in` guard silently no-ops elsewhere.
    pc.addEventListener("track", (e) => {
      try {
        const r = e.receiver;
        if (r && "playoutDelayHint" in r && e.track && e.track.kind === "video") {
          r.playoutDelayHint = PLAYOUT_DELAY_HINT;
        }
      } catch (_) {}
    });

    // (2) SDP bandwidth munge (always ON) applied to both directions so the encoder
    //     on both ends is given 4 Mbps headroom instead of the browser default (~600 kbps).
    //     Codec-preference reorder is optional (gated by PREFER_LOW_LATENCY_CODEC).
    const origSetLocal = pc.setLocalDescription.bind(pc);
    pc.setLocalDescription = function (desc) {
      if (desc && desc.sdp) {
        try {
          let sdp = mungeSdpBandwidth(desc.sdp);
          if (PREFER_LOW_LATENCY_CODEC) sdp = mungeSdpPreferCodec(sdp);
          desc = { type: desc.type, sdp };
        } catch (_) {}
      }
      return origSetLocal(desc);
    };

    const origSetRemote = pc.setRemoteDescription.bind(pc);
    pc.setRemoteDescription = function (desc) {
      if (desc && desc.sdp) {
        try { desc = { type: desc.type, sdp: mungeSdpBandwidth(desc.sdp) }; } catch (_) {}
      }
      return origSetRemote(desc);
    };

    return pc;
  }

  Patched.prototype = Native.prototype;     // preserve instanceof + all instance methods
  Object.setPrototypeOf(Patched, Native);   // inherit statics (e.g. generateCertificate)
  Patched.__pearLowLatencyPatched = true;

  try {
    window.RTCPeerConnection = Patched;
    if (window.webkitRTCPeerConnection) window.webkitRTCPeerConnection = Patched;
  } catch (_) {}
})();

/* ── embedded catalog ──────────────────────────────────────────────────────── */
const PEAR_CATALOG = [
  /* ── Shirts ── */
  { id: 1,  name: "Halo Tank",         price: 88,  type: "shirt", subType: "sleeveless",   color: "#3f5a8a",
    img: "https://images.unsplash.com/photo-1556821840-3a63f15732ce?w=1600&q=90&auto=format&fit=crop&crop=top,center" },
  { id: 2,  name: "Vapor Sleeveless",  price: 72,  type: "shirt", subType: "sleeveless",   color: "#b8c0cc",
    img: "https://burst.shopifycdn.com/photos/grey-t-shirt.jpg?width=1600&format=pjpg&quality=90" },
  { id: 3,  name: "Ion Crew Tee",      price: 96,  type: "shirt", subType: "short_sleeve", color: "#c2452f",
    img: "https://burst.shopifycdn.com/photos/red-t-shirt.jpg?width=1600&format=pjpg&quality=90" },
  { id: 4,  name: "Pulse Tee",         price: 84,  type: "shirt", subType: "short_sleeve", color: "#1f6feb",
    img: "https://burst.shopifycdn.com/photos/cobalt-blue-t-shirt.jpg?width=1600&format=pjpg&quality=90" },
  { id: 5,  name: "Circuit Tee",       price: 90,  type: "shirt", subType: "short_sleeve", color: "#149c7a",
    img: "https://burst.shopifycdn.com/photos/teal-t-shirt.jpg?width=1600&format=pjpg&quality=90" },
  { id: 6,  name: "Strata Longsleeve", price: 128, type: "shirt", subType: "long_sleeve",  color: "#2b2b30",
    img: "https://www.universalcolours.com/cdn/shop/files/LongSleeveTee-CharcoalBlack-1.jpg?v=1732626199&width=2048" },
  { id: 7,  name: "Nimbus Henley",     price: 134, type: "shirt", subType: "long_sleeve",  color: "#8e7bd0",
    img: "https://cdn.shopify.com/s/files/1/0831/9103/products/DK_LS_Henley_Dark_Purple-Final-Web.jpg?v=1665703111" },
  { id: 8,  name: "Echo Longsleeve",   price: 118, type: "shirt", subType: "long_sleeve",  color: "#d8d4cb",
    img: "https://img.magnific.com/premium-photo/beige-long-sleeve-shirt-isolated-white-background_1166140-13287.jpg" },
  /* ── Pants ── */
  { id: 9,  name: "Glide Slim",        price: 142, type: "pants", subType: "slim",    color: "#2a2d34",
    img: "https://cdn.suitsupply.com/image/upload/b_rgb:efefef,bo_500px_solid_rgb:efefef,c_pad,w_2600/b_rgb:efefef,c_pad,dpr_1,w_850,h_1176,f_auto,q_auto,fl_progressive/products/Trousers/default/B6905_28.jpg" },
  { id: 10, name: "Mono Slim",         price: 118, type: "pants", subType: "slim",    color: "#6e7681",
    img: "https://cdn.suitsupply.com/image/upload/b_rgb:efefef,bo_500px_solid_rgb:efefef,c_pad,w_2600/b_rgb:efefef,c_pad,dpr_1,w_850,h_1176,f_auto,q_auto,fl_progressive/products/Trousers/default/B6906_28.jpg" },
  { id: 11, name: "Vector Regular",    price: 132, type: "pants", subType: "regular", color: "#3b5bdb",
    img: "https://image.hm.com/assets/hm/54/71/5471b01a9ccf7562c74cf7d8f0102228465f30b5.jpg?imwidth=2160" },
  { id: 12, name: "Apex Regular",      price: 124, type: "pants", subType: "regular", color: "#8a8f98",
    img: "https://image.hm.com/assets/hm/72/56/7256f227cb82ac834363dfb140f245652797d841.jpg?imwidth=2160" },
  { id: 13, name: "Drift Wide",        price: 156, type: "pants", subType: "wide",    color: "#1a1a1d",
    img: "https://cdn.suitsupply.com/image/upload/b_rgb:efefef,bo_300px_solid_rgb:efefef,c_pad,w_2600/b_rgb:efefef,c_pad,dpr_1,w_768,h_922,f_auto,q_auto,fl_progressive/products/Trousers/default/B25209_28.jpg" },
  { id: 14, name: "Terra Wide",        price: 148, type: "pants", subType: "wide",    color: "#a8794f",
    img: "https://cdn.suitsupply.com/image/upload/b_rgb:efefef,bo_500px_solid_rgb:efefef,c_pad,w_2600/b_rgb:efefef,c_pad,dpr_1,w_850,h_1176,f_auto,q_auto,fl_progressive/products/Trousers/default/B25212_28.jpg" },
  { id: 15, name: "Null Slim",         price: 138, type: "pants", subType: "slim",    color: "#22324f",
    img: "https://cdn.suitsupply.com/image/upload/b_rgb:efefef,bo_500px_solid_rgb:efefef,c_pad,w_2600/b_rgb:efefef,c_pad,dpr_1,w_850,h_1176,f_auto,q_auto,fl_progressive/products/Trousers/default/B9449_28.jpg" },
  { id: 16, name: "Cargo Wide",        price: 162, type: "pants", subType: "wide",    color: "#566b3e",
    img: "https://image.hm.com/assets/hm/31/ab/31ab5b52cc238aaad4d95fa3a79d2af741bf7192.jpg?imwidth=2160" },
];

const SUBTYPE_LABEL_HE = {
  sleeveless: "גופייה", short_sleeve: "שרוול קצר", long_sleeve: "שרוול ארוך",
  slim: "גזרה צמודה", regular: "גזרה רגילה", wide: "גזרה רחבה",
};
const SUBTYPE_PROMPT = {
  sleeveless: "sleeveless", short_sleeve: "short-sleeve", long_sleeve: "long-sleeve",
  slim: "slim-fit", regular: "regular-fit", wide: "wide-leg",
};
const SHIRT_NOUN = { sleeveless: "tank top", short_sleeve: "t-shirt", long_sleeve: "long-sleeve shirt" };

const $ = (s) => document.getElementById(s);

/* ── state ───────────────────────────────────────────────────────────────── */
let currentUserSize = null;
let activeTryOnSize = null;   // size the user has selected in the Screen 2 override selector
let activeItem = null;
let focusMode = false;

/* "Complete the Look" — incremental outfit state (the SINGLE source of truth).
   activeOutfit holds at most ONE upper-body garment (top) and ONE lower-body
   garment (bottom). Selecting/adding a garment fills its OWN slot and NEVER clears
   the opposite one, so "Add to Look" (הוסף ללוק) is purely additive: adding pants
   keeps the shirt, and vice-versa. When BOTH slots are filled, goLive bundles them
   into ONE realtime payload so the shirt and the pants render together in the same
   strict 5-second stream (see applyActive / applyLook). */
const activeOutfit = { top: null, bottom: null };
const slotOf = (item) => (item && item.garmentType === "lower_body" ? "bottom" : "top");
const outfitComplete = () => !!(activeOutfit.top && activeOutfit.bottom);
let localStream = null;
let rtClient = null;
let connState = "idle";
let connecting = false;
let busy = false;

/* Bug 3 — consecutive-session state.
   `sessionGen` is a monotonic generation counter bumped on every connect and
   every teardown. The realtime SDK fires callbacks (onConnectionChange /
   onRemoteStream) asynchronously, so a torn-down client can still emit a late
   "disconnected" that would poison the NEXT session's connState. Each set of
   callbacks captures the generation it was born in and no-ops once it's stale —
   this is what lets the room be re-entered infinitely without a page refresh.
   `realtimeInput` holds the per-session CLONE of the camera tracks handed to the
   SDK, so when the SDK stops ITS tracks on disconnect our persistent preview
   stream (localStream) survives for the next try-on. */
let sessionGen = 0;
let realtimeInput = null;

/* Feature 2 — MediaRecorder capture of the REMOTE Lucy-VTON output.
   We do NOT record the raw remote WebRTC track directly (Chromium often encodes
   a remote track as a black frame) nor the local camera. Instead we mirror the
   on-screen remote frames (#aiVideo) onto a canvas and record canvas.captureStream
   — guaranteeing real, encoded pixels in the downloaded clip. Video-only. */
let mediaRecorder = null;
let recordedChunks = [];
let recordedUrl = null;
let recordedBlob = null;     // the finalized clip Blob — kept so we can build a File for the share sheet
let recorderMime = null;     // the container/codec MediaRecorder actually negotiated (mp4 vs webm)
let recordCanvas = null;     // off-DOM canvas mirroring the remote VTON frames
let recordRaf = 0;           // requestAnimationFrame handle for the paint loop
let recordingActive = false; // guards the paint loop + single-start per session
let replayActive = false;   // true while the user is watching the cached local replay
let liveDurationTimer = null;  // auto-teardown handle for the strict 5s session limit
let liveCountdownInterval = null;  // 1s tick handle driving the on-screen countdown overlay

/** @returns {boolean} true while a billable realtime session is active. */
const isLive = () => connState === "connected" || connState === "generating";

/* =============================================================================
   SCREEN 1 — Size / measurement calculator
   ============================================================================= */
const ZARA_SIZE_CHART = [
  { size: "S",  minHeight: 160, maxHeight: 172, minWeight: 55, maxWeight: 65,  minChest: 88,  maxChest: 94,  minWaist: 74, maxWaist: 80,  minLegs: 94,  maxLegs: 98  },
  { size: "M",  minHeight: 170, maxHeight: 180, minWeight: 65, maxWeight: 76,  minChest: 94,  maxChest: 102, minWaist: 80, maxWaist: 88,  minLegs: 98,  maxLegs: 102 },
  { size: "L",  minHeight: 178, maxHeight: 186, minWeight: 75, maxWeight: 87,  minChest: 102, maxChest: 110, minWaist: 88, maxWaist: 96,  minLegs: 102, maxLegs: 106 },
  { size: "XL", minHeight: 184, maxHeight: 195, minWeight: 85, maxWeight: 100, minChest: 110, maxChest: 118, minWaist: 96, maxWaist: 106, minLegs: 106, maxLegs: 112 },
];

/* Ordered size scale — full range used by the override selector and delta math. */
const SIZE_SCALE = ["XS", "S", "M", "L", "XL", "XXL", "3XL"];

/* Task 6 — conditional input flow: the optional fields stay hidden until BOTH
   mandatory fields (height + weight) hold sane, in-range values. */
function setOptionalVisible(show) {
  const box = $("optionalFields");
  if (!box) return;
  const expanded = box.classList.contains("is-expanded");
  if (show === expanded) return;              // no-op if already in desired state
  // Pure CSS-driven expansion (see .optional-fields / .is-expanded in style.css):
  // toggling the class lets the panel stretch open / collapse fluidly rather than
  // snapping via a display toggle — no layout jump.
  if (show) {
    box.classList.add("is-expanded");
  } else {
    box.classList.remove("is-expanded");
    // collapsing → clear any optional values so a stale entry can't skew the result
    ["chest", "waist", "legs"].forEach((id) => { if ($(id)) $(id).value = ""; });
  }
}

/**
 * Recompute the recommended size from the form inputs (Zara chart, penalty-scored).
 * Drives the result box, the "continue" button enabled-state, and — via
 * setOptionalVisible — the conditional reveal of the optional measurement fields.
 * Re-run on every input event. Pure UI/state; no network.
 * @returns {void}
 */
function calculateSize() {
  const num = (id) => ($(id).value ? parseFloat($(id).value) : null);
  const height = num("height"), weight = num("weight");

  // Reveal optional fields only once both mandatory values are present and sane.
  const mandatoryReady = !!height && !!weight &&
    height >= 130 && height <= 240 && weight >= 35 && weight <= 220;
  setOptionalVisible(mandatoryReady);

  const chest = num("chest"), waist = num("waist"), legs = num("legs");

  const resultBox = $("resultBox"), sizeResult = $("sizeResult"), resultLabel = $("resultLabel");
  const nextBtn = $("btn-next-screen");
  const resultActions = $("resultActions");

  resultBox.classList.remove("show", "error-result");
  if (resultActions) resultActions.classList.remove("is-ready");   // collapse the tray
  resultLabel.innerText = "המידה המומלצת עבורך:";
  nextBtn.disabled = true;
  currentUserSize = null;
  updateProgress();

  if (!height || !weight) return;

  if (height > 240 || height < 130 || weight > 220 || weight < 35) {
    resultLabel.innerText = "שגיאה בנתונים:";
    sizeResult.innerText = "נתונים לא הגיוניים";
    resultBox.classList.add("show", "error-result");
    if (resultActions) resultActions.classList.add("is-ready");
    return;
  }

  let bestSize = "מידה מחוץ לטווח", minPenalty = Infinity;
  const MAX_ALLOWED_PENALTY = 35;

  ZARA_SIZE_CHART.forEach((row) => {
    let pen = 0;
    if (height < row.minHeight) pen += (row.minHeight - height) * 2;
    if (height > row.maxHeight) pen += (height - row.maxHeight) * 2;
    if (weight < row.minWeight) pen += (row.minWeight - weight) * 2;
    if (weight > row.maxWeight) pen += (weight - row.maxWeight) * 2;
    if (chest) { if (chest < row.minChest) pen += (row.minChest - chest) * 0.5; if (chest > row.maxChest) pen += (chest - row.maxChest) * 0.5; }
    if (waist) { if (waist < row.minWaist) pen += (row.minWaist - waist) * 0.5; if (waist > row.maxWaist) pen += (waist - row.maxWaist) * 0.5; }
    if (legs)  { if (legs  < row.minLegs)  pen += (row.minLegs  - legs)  * 0.5; if (legs  > row.maxLegs)  pen += (legs  - row.maxLegs)  * 0.5; }
    if (pen < minPenalty) { minPenalty = pen; bestSize = row.size; }
  });

  if (minPenalty > MAX_ALLOWED_PENALTY) {
    // Measurements don't match any chart row exactly, but we still let the user
    // proceed — the fitting room works without a size recommendation, it just
    // won't show a size badge. bestSize still holds the closest row found.
    resultLabel.innerText = "קירוב מידה מומלץ:";
    sizeResult.innerText = bestSize;
    resultBox.classList.add("show");
    if (resultActions) resultActions.classList.add("is-ready");
    currentUserSize = bestSize;   // use closest match rather than blocking
    nextBtn.disabled = false;
  } else {
    sizeResult.innerText = bestSize;
    resultBox.classList.add("show");
    if (resultActions) resultActions.classList.add("is-ready");
    currentUserSize = bestSize;
    nextBtn.disabled = false;
  }
  updateProgress();
}

function updateProgress() {
  const fields = ["height", "weight", "chest", "waist", "legs"];
  const filled = fields.filter((f) => $(f) && $(f).value).length;
  let pct = Math.round((filled / fields.length) * 70);
  if (currentUserSize) pct = 100;
  const fill = $("progressFill"), label = $("progressPercent");
  if (fill) fill.style.width = pct + "%";
  if (label) label.innerText = pct + "%";
}

/* Task 5 — Enter on any measurement input: if a size is ready, proceed straight to
   the virtual fitting room; otherwise advance focus to the next field so the user
   can keep filling the form naturally with the keyboard. */
function onMeasurementKeydown(e) {
  if (e.key !== "Enter") return;
  e.preventDefault();
  calculateSize();

  const nextBtn = $("btn-next-screen");
  if (nextBtn && !nextBtn.disabled) { goToFitting(); return; }

  const inputs = [...document.querySelectorAll("#sizeForm input")]
    // visible inputs only — and skip the optional panel while it's collapsed
    // (visibility:hidden keeps offsetParent set, so check the panel state too).
    .filter((el) => el.offsetParent !== null && !el.closest(".optional-fields:not(.is-expanded)"));
  const idx = inputs.indexOf(e.target);
  const next = inputs.slice(idx + 1).find((el) => !el.value) || inputs[idx + 1];
  if (next) next.focus();
  else e.target.blur();
}

/* =============================================================================
   URL handoff + focus mode
   ============================================================================= */
function parseHandoff() {
  const q = new URLSearchParams(location.search);
  const id = parseInt(q.get("id"), 10);
  const fromCatalog = !isNaN(id) ? PEAR_CATALOG.find((p) => p.id === id) : null;

  const type = (q.get("type") || q.get("itemType") || (fromCatalog && fromCatalog.type) || "").toLowerCase();

  console.group("[PEAR] parseHandoff() — URL params debug");
  console.log("full URL     :", location.href);
  console.log("id param     :", q.get("id"), "→ parsed:", id);
  console.log("type param   :", q.get("type") || "(none)");
  console.log("itemType     :", q.get("itemType") || "(none)", "→ resolved type:", type || "(EMPTY — focus mode disabled)");
  console.log("subType      :", q.get("subType") || "(none)");
  console.log("color        :", q.get("color") || "(none)");
  console.log("name         :", q.get("name") || "(none)");
  console.log("img          :", q.get("img") ? q.get("img").slice(0, 80) + "…" : "(none)");
  console.log("fromCatalog  :", fromCatalog ? fromCatalog.name : "(not found in PEAR_CATALOG)");
  if (!type) console.warn("[PEAR] parseHandoff() — no type resolved; focus mode OFF (catalog view will show)");
  console.groupEnd();

  if (!type) return null;

  const color = q.get("color") ? "#" + q.get("color").replace(/^#/, "") : (fromCatalog ? fromCatalog.color : "#0B3C95");
  const result = {
    id: isNaN(id) ? null : id,
    name: q.get("name") || (fromCatalog ? fromCatalog.name : "Garment"),
    type,
    subType: q.get("subType") || (fromCatalog ? fromCatalog.subType : (type === "pants" ? "regular" : "short_sleeve")),
    color,
    img: q.get("img") || (fromCatalog ? fromCatalog.img : ""),
  };
  console.log("[PEAR] parseHandoff() — resolved handoff:", result);
  return result;
}

function toItem(raw) {
  return { ...raw, garmentType: raw.type === "pants" ? "lower_body" : "upper_body" };
}

/* =============================================================================
   Screen transition
   ============================================================================= */
function goToFitting() {
  // Log to Sheets the moment the user presses the button — always fire, even without handoff
  const _handoff = parseHandoff();
  const _payload = {
    garmentId:   _handoff?.id      ?? "",
    garmentName: _handoff?.name    ?? "",
    garmentType: _handoff?.type    ?? "",
    subType:     _handoff?.subType ?? "",
    size:        currentUserSize   || "",
  };
  fetch("/api/track-tryon", {
    method:    "POST",
    headers:   { "Content-Type": "application/json" },
    body:      JSON.stringify(_payload),
    keepalive: true,
  })
    .then(r => r.json())
    .then(data => { if (!data.ok) console.error("[analytics] sheet write failed:", data.error); })
    .catch(err  => console.error("[analytics] fetch failed:", err));


  try {
    $("final-size-text").innerText = currentUserSize || "";
    $("screen-calculator").classList.remove("active");
    $("screen-fitting").classList.add("active");
    window.scrollTo(0, 0);
    enterRoom();
  } catch (err) {
    console.error("[goToFitting] screen transition failed:", err?.message || String(err), err);
    // Force the screen switch even if enterRoom() threw so the user isn't left on Screen 1
    try {
      $("screen-calculator").classList.remove("active");
      $("screen-fitting").classList.add("active");
    } catch (_) {}
    toast("שגיאה בטעינת חדר המדידה — " + (err?.message || "נסה לרענן את הדף"));
  }
}

function backToCalculator() {
  $("screen-fitting").classList.remove("active");
  $("screen-calculator").classList.add("active");
  window.scrollTo(0, 0);
}

/* =============================================================================
   Fitting-room setup
   ============================================================================= */
function enterRoom() {
  const handoff = parseHandoff();

  if (handoff) {
    focusMode = true;
    document.body.classList.add("focus-mode");
    setActiveItem(toItem(handoff), { silent: true });
    $("focusBar").hidden = false;
    $("catalogPanel").hidden = true;
    if (currentUserSize) $("focusSizeBadge").innerText = "מידה " + currentUserSize;
  } else {
    focusMode = false;
    $("focusBar").hidden = true;
    renderCatalogPanel();
    $("catalogPanel").hidden = false;
    setActiveItem(toItem(PEAR_CATALOG[0]), { silent: true });
  }

  $("completeLook").hidden = false;
  setConn("idle");

  // Reset the size override to the Screen-1 recommendation and rebuild the selector UI.
  activeTryOnSize = currentUserSize;
  injectSizeSelector();
}

function setActiveItem(item, opts = {}) {
  activeItem = item;

  // ADDITIVE write: fill ONLY this garment's slot (top|bottom) and leave the
  // opposite slot untouched. Picking a different shirt replaces the top; adding
  // pants fills the bottom while KEEPING the shirt — the whole point of the
  // incremental "Add to Look" outfit.
  activeOutfit[slotOf(item)] = item;

  $("focusItemName").innerText = item.name;
  renderActiveGarment();             // shows either the single item or the full look
  renderCompleteTheLook(item);
  highlightCatalog(item.id);

  if (!opts.silent) {
    toast(`עכשיו מודדים: <b>${item.name}</b>`);
    resetToLive();
    // applyActive() re-applies the FULL look when both slots are filled (so a mid-
    // session shirt/pants swap restyles the whole outfit), else just this garment.
    if (isLive()) applyActive().catch((e) => console.warn("pre-apply garment:", e?.message || e));
  }
}

/**
 * Paint the "active garment" chip. With a single garment it shows that piece; once
 * the outfit is complete (top + bottom) it shows BOTH halves so the user can SEE
 * that adding a piece kept the other one — the additive look is never hidden.
 * @returns {void}
 */
function renderActiveGarment() {
  const { top, bottom } = activeOutfit;
  const chip = $("activeGarment");
  chip.hidden = false;
  const eyebrow = chip.querySelector(".active-garment__eyebrow");

  if (top && bottom) {
    $("activeGarmentMedia").innerHTML = `<span class="ag-duo">${garmentThumb(top)}${garmentThumb(bottom)}</span>`;
    $("activeGarmentName").innerText = `${top.name} + ${bottom.name}`;
    $("activeGarmentType").innerText = "לוק מלא · חולצה + מכנסיים";
    if (eyebrow) eyebrow.innerText = "לוק מלא · Full look";
    chip.classList.add("is-duo");
  } else {
    const item = activeItem;
    $("activeGarmentMedia").innerHTML = garmentThumb(item);
    $("activeGarmentName").innerText = item.name;
    $("activeGarmentType").innerText =
      (item.garmentType === "lower_body" ? "מכנסיים · " : "חולצה · ") + (SUBTYPE_LABEL_HE[item.subType] || "");
    if (eyebrow) eyebrow.innerText = "פריט נמדד · Now fitting";
    chip.classList.remove("is-duo");
  }
}

/* =============================================================================
   "Complete the Look" — incremental "Add to Look" (הוסף ללוק)
   ─────────────────────────────────────────────────────────────────────────
   addToLook() is fired from a recommendation card. It drops the chosen complement
   into ITS slot (top|bottom) beside whatever is already on, WITHOUT clearing the
   opposite slot, then — if a session is already live — restyles the whole outfit
   in place. The strict 5s window, countdown, recording and reset logic are all
   untouched; this only changes WHICH garments the existing goLive flow applies.
   ============================================================================= */
function addToLook(piece) {
  if (!piece) return;

  // Additive slot write: setActiveItem fills activeOutfit[slotOf(piece)] = piece and
  // refreshes the chip + recommendations, leaving the opposite slot intact. silent so
  // we own the toast/apply below.
  setActiveItem(piece, { silent: true });
  resetToLive();

  if (outfitComplete()) {
    $("completeLook").classList.add("is-complete");
    toast(`לוק מלא: <b>${activeOutfit.top.name}</b> + <b>${activeOutfit.bottom.name}</b>`);
  } else {
    $("completeLook").classList.remove("is-complete");
    toast(`נוסף ללוק: <b>${piece.name}</b> — הוסף/י פריט מהקטגוריה המשלימה ללוק מלא`);
  }

  // Mid-session: restyle the live feed in place — the FULL look (both garments in
  // ONE payload) when complete, else just the updated garment. Same 5s session.
  if (isLive()) applyActive().catch((e) => console.warn("add to look:", e?.message || e));
}

/**
 * Validate the two outfit halves and return the verified {top, bottom} pair, or
 * null if the look is incomplete or mismatched (e.g. two tops, a missing half).
 * Reads activeOutfit directly so it is the single guard every full-look payload
 * passes through.
 * @returns {{top: object, bottom: object} | null}
 */
function resolveLook() {
  const { top, bottom } = activeOutfit;
  if (!top || !bottom) return null;
  if (top.garmentType !== "upper_body" || bottom.garmentType !== "lower_body") return null;
  return { top, bottom };
}

/* =============================================================================
   Camera + engine bootstrap
   ============================================================================= */
const card = () => $("cameraCard");

/* Task 10 — re-entrancy guard: getUserMedia is async, so two quick callers
   (e.g. the "enable camera" button AND Go Live) could each open a separate
   camera stream before localStream is assigned. We cache the in-flight promise
   so concurrent callers share ONE permission prompt and ONE MediaStream. */
let cameraStartPromise = null;

/**
 * Open the front camera exactly once and bind it to the #webcam element.
 * Idempotent and re-entrancy-safe: concurrent/repeat calls reuse the same
 * stream (or the same pending request) instead of prompting twice.
 * @returns {Promise<boolean>} true once the camera is live, false on failure/denial.
 */
/* 🍐 Pear loader — a juicy bouncing pear shown over the camera card whenever the
   app is busy loading (opening the camera, etc). Purely a visual cue; additive
   DOM, removed as soon as the load resolves. The go-live render reuses the pear
   baked into #scanOverlay. */
function showPearLoader(label) {
  const cc = $("cameraCard");
  if (!cc || document.getElementById("pearCamLoader")) return;
  const el = document.createElement("div");
  el.id = "pearCamLoader";
  el.className = "pear-cam-loader";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML =
    `<div class="pear-loader">` +
      `<div class="pear-loader__fruit">🍐</div>` +
      `<div class="pear-loader__shadow"></div>` +
      (label ? `<div class="pear-loader__label">${label}</div>` : "") +
    `</div>`;
  cc.appendChild(el);
}
function hidePearLoader() {
  const el = document.getElementById("pearCamLoader");
  if (el) el.remove();
}

async function startCamera() {
  if (localStream) return true;
  if (cameraStartPromise) return cameraStartPromise;   // a request is already in flight

  cameraStartPromise = (async () => {
    showPearLoader("מפעיל מצלמה…");        // 🍐 loading cue while permission/stream opens
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          // Optimized capture: matches the Decart inference size (LIVE_W×LIVE_H) and
          // caps the rate at LIVE_FPS. A smaller, slower stream means less to
          // encode + upload → faster connect/first-frame AND lower in-feed latency.
          width:  { ideal: LIVE_W },
          height: { ideal: LIVE_H },
          frameRate: { ideal: LIVE_FPS, max: LIVE_FPS },
        },
        audio: false,
      });
      localStream.getVideoTracks().forEach((t) => {
        if ("contentHint" in t) t.contentHint = "motion";
      });
      const v = $("webcam");
      v.srcObject = localStream;
      await v.play().catch(() => {});
      card().classList.add("live");
      $("camError").hidden = true;
      $("captureBtn").disabled = false;
      return true;
    } catch (err) {
      showCamError("לא ניתן לגשת למצלמה: " + (err && err.message ? err.message : err) +
        " — ודא הרשאת מצלמה ושהאתר מוגש מ-localhost/https.");
      return false;
    } finally {
      hidePearLoader();
    }
  })();

  try { return await cameraStartPromise; }
  finally { cameraStartPromise = null; }
}

function showCamError(msg) {
  const el = $("camError");
  el.textContent = msg;
  el.hidden = false;
}

function resetToLive() {
  if (!isLive()) clearRecording();   // revoke replay URL + hide post-session buttons when no active API session
  exitClipReplay();                  // drop any history-clip playing in #aiVideo
  card().classList.remove("show-result");
  $("scanOverlay").hidden = true;
  // #retakeBtn now lives in the .pear-interaction-pod; its visibility is governed
  // by the pod (shown once history exists), so it's no longer toggled here.
  $("captureBtn").disabled = !localStream;
}

/* =============================================================================
   Decart Lucy VTON realtime — connection
   ─────────────────────────────────────
   SECURITY: the browser never holds the permanent dct_ key. At the moment the
        user goes live we fetch a short-lived, scoped ek_ token from the secure
        proxy (/api/realtime-token) and hand THAT to createDecartClient().

   NOTE: models.realtime() does not exist in @decartai/sdk@0.1.5 — the model is
        passed as the plain object below (name "lucy-vton-latest" + stream opts).
   ============================================================================= */
async function loadSDK() {
  let lastErr;
  for (const url of SDK_URLS) {
    try { return await import(/* @vite-ignore */ url); }
    catch (e) { lastErr = e; console.warn("SDK load failed from", url, e?.message || e); }
  }
  throw new Error("SDK load failed: " + (lastErr?.message || lastErr));
}

/**
 * Mint a short-lived ek_ token from the secure proxy (TOKEN_ENDPOINT).
 * Called ONLY at go-live (never on page load) so no token is minted/wasted while
 * the user is just browsing. The permanent dct_ key stays server-side.
 * @returns {Promise<string>} the ephemeral ek_ token string.
 * @throws {Error} if the proxy is unreachable or returns no valid token.
 */
async function mintEphemeralToken() {
  console.log("[PEAR] mintEphemeralToken() — POST", TOKEN_ENDPOINT);
  let resp;
  try {
    resp = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[PEAR] mintEphemeralToken() — network error (server unreachable?):", e?.message || e);
    throw new Error("לא ניתן להגיע לשרת הטוקנים (" + (e?.message || e) + ")");
  }

  let data = {};
  try { data = await resp.json(); } catch (_) {}

  if (resp.status === 405) {
    const port = window.location.port;
    const where = port && port !== "3000"
      ? `port ${port} — open the fitting room at http://localhost:3000/fitting-room/ instead`
      : "a separate file server — open the fitting room via the Express server on port 3000";
    throw new Error(`HTTP 405: fitting room is served by ${where}.`);
  }

  console.log("[PEAR] mintEphemeralToken() — server responded HTTP", resp.status, "|",
    resp.ok ? "OK" : "FAILED",
    "| body keys:", Object.keys(data).join(", ") || "(empty)");

  if (!resp.ok || data.error) {
    const detail = data.message || data.error || `HTTP ${resp.status}`;
    console.error("[PEAR] mintEphemeralToken() — token mint failed:", detail,
      "\n  Full server response:", data,
      resp.status !== 405
        ? "\n  → Check that DECART_API_KEY in .env is set to a valid dct_… key from platform.decart.ai"
        : "\n  → Open the fitting room via http://localhost:3000/fitting-room/ (the Express server)");
    throw new Error("מינטינג טוקן נכשל: " + detail);
  }
  if (!data.apiKey) {
    console.error("[PEAR] mintEphemeralToken() — response OK but no apiKey field:", data);
    throw new Error("השרת לא החזיר טוקן ek_ תקין.");
  }
  const preview = data.apiKey.slice(0, 8);
  console.log("[PEAR] mintEphemeralToken() — token received, starts with:", preview + "…",
    "| model:", data.model || "(not in response)",
    "| expiresAt:", data.expiresAt || "(not in response)");
  return data.apiKey;
}

/**
 * Task 2 — graceful pre-use connectivity check.
 * Lucy VTON is realtime/online-only. Before the user initiates a live fitting we
 * confirm the network path to our own server is up (a fast, same-origin probe of
 * HEALTH_ENDPOINT, bounded by HEALTH_PROBE_TIMEOUT_MS). This turns a cryptic
 * mid-connect SDK/WebRTC failure into a calm, actionable message. It does NOT
 * touch the proxy, token, or 5s teardown logic.
 * @returns {Promise<boolean>} true if the server is reachable, false if offline/timed-out.
 */
async function ensureOnline() {
  if (!navigator.onLine) return false;          // browser already knows it's offline
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), HEALTH_PROBE_TIMEOUT_MS);
    const resp = await fetch(HEALTH_ENDPOINT, { method: "GET", cache: "no-store", signal: ctrl.signal });
    clearTimeout(timer);
    return resp.ok;
  } catch (_) {
    return false;                               // unreachable / timed out → treat as offline
  }
}

/**
 * Mint an ephemeral ek_ token and open ONE Decart Lucy VTON realtime session
 * over WebRTC. Any stale/dropped client is disconnected first so no orphaned
 * server-side session keeps billing. SECURITY: the permanent dct_ key never
 * reaches the browser — only the short-lived ek_ token from the proxy does.
 * @returns {Promise<void>}
 */
async function connectRealtime() {
  if (rtClient && isLive()) return;
  if (connecting) return;

  // Bug 3 fix: explicitly close any stale/dropped session before opening a new one
  // so the old server-side WebRTC session is terminated and stops billing immediately.
  if (rtClient) {
    try { rtClient.disconnect(); } catch (_) {}
    rtClient = null;
  }
  // Free the previous session's cloned camera tracks (if any) so they don't leak.
  if (realtimeInput) {
    try { realtimeInput.getTracks().forEach((t) => t.stop()); } catch (_) {}
    realtimeInput = null;
  }

  // Bug 3 fix: claim a fresh generation. Callbacks below capture `gen` and bail
  // out the moment a teardown/new-connect bumps sessionGen — so a late callback
  // from a previous client can never stomp this session's state. We also reset
  // connState to "connecting" here so waitConnected() can't observe a stale
  // terminal value ("disconnected") left behind by the prior session.
  const gen = ++sessionGen;
  connState = "connecting";
  connecting = true;
  setConn("connecting");

  console.log("[PEAR] connectRealtime() — stage 1/4: loading SDK from CDN…");
  try {
    /* ── load SDK ─────────────────────────────────────────────────────────── */
    const { createDecartClient } = await loadSDK();
    console.log("[PEAR] connectRealtime() — stage 2/4: SDK loaded. Minting ephemeral token…");

    /* ── mint a short-lived ek_ token from the secure proxy (only now, never on
          page load) — the permanent dct_ key stays server-side ─────────────── */
    const ekToken = await mintEphemeralToken();

    // A teardown may have fired while we were awaiting the SDK/token — abort.
    if (gen !== sessionGen) return;
    console.log("[PEAR] connectRealtime() — stage 3/4: token OK. Creating Decart client…");

    /* ── create client with the ephemeral token ───────────────────────────── */
    const client = createDecartClient({ apiKey: ekToken });
    console.log("[PEAR] connectRealtime() — stage 4/4: opening WebRTC session (waiting for 'connected')…");

    /* Bug 3 fix: hand the SDK a CLONE of the camera tracks. The realtime SDK
       (LiveKit under the hood) stops the tracks it publishes when the session
       disconnects; cloning means it stops its OWN copies, leaving localStream
       (our persistent preview) alive and reusable for the next try-on. */
    realtimeInput = new MediaStream(localStream.getTracks().map((t) => t.clone()));
    realtimeInput.getVideoTracks().forEach((t) => { if ("contentHint" in t) t.contentHint = "motion"; });

    /* ── connect realtime ─────────────────────────────────────────────────── */
    // FIX: model passed as a plain string, NOT via models.realtime()
    rtClient = await client.realtime.connect(realtimeInput, {
      model: {
        name: "lucy-vton-latest",
        urlPath: "/v1/stream",
        // TOKEN COST: Decart bills per processed frame (≈ fps × seconds). This is
        // THE billing knob — see LIVE_INFERENCE_FPS / LIVE_DURATION_MS up top.
        // 5s × 15fps ≈ ~29 tokens; drop LIVE_INFERENCE_FPS to ~4 for a ~10 cap.
        fps: { ideal: LIVE_INFERENCE_FPS, max: LIVE_INFERENCE_FPS },
        width: LIVE_W,
        height: LIVE_H,
      },
      mirror: "auto",
      onRemoteStream: (editedStream) => {
        if (gen !== sessionGen) return;    // stale callback from a torn-down session
        // Official pattern: map the live edited WebRTC stream straight to the
        // video element so the garment warps/tracks the user in realtime.
        const aiVideo = document.querySelector("#aiVideo");
        aiVideo.srcObject = editedStream;
        aiVideo.style.display = "block";   // make sure it's visible
        aiVideo.style.transform = "none";  // edited feed is already correctly oriented
        aiVideo.play().catch(() => {});
        // NOTE: recording is NOT started here — it is armed in goLive() at the exact
        // go-live instant so its duration matches the strict 5s window (see Feature 2).
      },
      onConnectionChange: (state) => {
        if (gen !== sessionGen) return;    // stale callback from a torn-down session
        connState = state;
        setConn(state);
      },
    });

    // If a teardown landed during connect(), immediately close this orphan.
    if (gen !== sessionGen) {
      try { rtClient.disconnect(); } catch (_) {}
      rtClient = null;
      return;
    }

    rtClient.on("error", (err) => {
      console.error("[session] Decart error:", err?.message || String(err));
      showCamError("שגיאת Decart: " + (err?.message || err));
    });

    connState = (rtClient.getConnectionState && rtClient.getConnectionState()) || "connected";
    setConn(connState);
    console.log("[PEAR] connectRealtime() — WebRTC session open. connState:", connState);

  } catch (err) {
    console.error("[connectRealtime] failed at stage:", err?.message || String(err), err);
    throw err;   // re-throw so goLive()'s catch block can show the user-facing error
  } finally {
    connecting = false;
  }
}

/**
 * Single teardown that kills the server-side Decart session immediately so
 * billing stops at once (rather than running until token TTL expiry). Called by
 * stopLive (the manual billing kill-switch) and on beforeunload, pagehide, and visibilitychange.
 * @returns {void}
 */
function teardown() {
  // Cancel the 5s auto-teardown timer before bumping the generation — order matters:
  // clearing first means the timer callback (which checks sessionGen) can never fire
  // concurrently with this teardown, even on the same tick.
  if (liveDurationTimer) { clearTimeout(liveDurationTimer); liveDurationTimer = null; }
  // Same leak guard for the visual countdown ticker + overlay.
  hideLiveCountdown();

  // Bug 3 fix: bump the generation FIRST so any in-flight callbacks from the
  // client we're about to disconnect become no-ops (see connectRealtime).
  sessionGen++;

  // Feature 2 — flush the recorder while the edited tracks are still live, so the
  // download clip is finalized before disconnect ends the stream.
  stopRecording();

  if (rtClient) {
    try { rtClient.disconnect(); } catch (_) {}
    rtClient = null;
  }

  // Bug 3 fix: stop this session's cloned camera tracks (the WebRTC sender side).
  // localStream — the real camera/preview — is intentionally left running.
  if (realtimeInput) {
    try { realtimeInput.getTracks().forEach((t) => t.stop()); } catch (_) {}
    realtimeInput = null;
  }

  // Hide AND detach the now-dead edited stream so the CSS state classes govern the
  // view again (otherwise the inline display:block from onRemoteStream would freeze
  // it on top, and a stale srcObject would block the next session's first frame).
  const ai = $("aiVideo");
  if (ai) { ai.style.display = "none"; ai.srcObject = null; }

  // Bug 3 fix: clear every guard so the next try-on starts from a pristine state.
  connState = "idle";
  connecting = false;
  setConn("idle");
}

function waitConnected(timeout) {
  return new Promise((resolve, reject) => {
    if (isLive()) return resolve();
    const start = Date.now();
    (function poll() {
      if (isLive()) return resolve();
      if (connState === "error" || connState === "disconnected") return reject(new Error("session " + connState));
      if (Date.now() - start > timeout) return reject(new Error("timeout מחכה לחיבור (" + connState + ")"));
      setTimeout(poll, 150);
    })();
  });
}

/**
 * Fetch a garment image via /api/img-proxy so the Decart SDK receives a Blob
 * rather than a raw CDN URL.  The SDK's imageToBase64() calls fetch(url) on any
 * http/https string — which fails for CDNs (suitsupply, magnific, etc.) that don't
 * send CORS headers.  Routing through our same-origin proxy avoids that entirely.
 * Returns null on any error so the caller can fall back to the raw URL or prompt-only.
 */
async function fetchGarmentBlob(imgUrl) {
  if (!imgUrl) return null;
  try {
    const resp = await fetch(`/api/img-proxy?url=${encodeURIComponent(imgUrl)}`);
    if (!resp.ok) {
      console.warn("[PEAR] img-proxy returned", resp.status, "for", imgUrl);
      return null;
    }
    return await resp.blob();
  } catch (e) {
    console.warn("[PEAR] img-proxy fetch error:", e?.message || e);
    return null;
  }
}

/**
 * Return an absolute URL that the Decart server can reliably fetch.
 * Raw CDN URLs (suitsupply, magnific, etc.) can take 20-25 s for Decart's
 * server to fetch, inflating billing from ~10 to ~60 tokens per session.
 * Routing through /api/img-proxy (our own Vercel endpoint) is fast, public,
 * and already sets Cache-Control so repeated fetches are instant.
 * On localhost the proxy URL isn't reachable from Decart's servers, so we
 * fall back to the raw CDN URL (acceptable for local dev only).
 */
function garmentImageRef(cdnUrl) {
  if (!cdnUrl) return undefined;
  const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if (isLocal) return cdnUrl;
  return `${location.origin}/api/img-proxy?url=${encodeURIComponent(cdnUrl)}`;
}

async function applyGarment(item) {
  if (!rtClient) throw new Error("not connected");

  const imageRef = garmentImageRef(item.img);
  const payload = {
    prompt: buildPrompt(item),
    enhance: true,
    ...(imageRef ? { image: imageRef } : {}),
  };

  console.group("[PEAR] applyGarment() — VTON payload debug");
  console.log("garment  :", item.name, `(id=${item.id}, type=${item.garmentType})`);
  console.log("subType  :", item.subType, "| color:", item.color);
  console.log("img URL  :", item.img || "(none)");
  console.log("img ref  :", imageRef || "(none — prompt-only)");
  console.log("prompt   :", payload.prompt);
  console.groupEnd();

  if (!imageRef) console.warn("[PEAR] applyGarment() — no img URL; prompt-only.");

  await rtClient.set(payload);
}

/**
 * Reads the Screen 1 physical inputs and returns a forceful anatomical anchor
 * sentence. This pins the AI's body model to real measurements so it cannot
 * hallucinate a generic body shape.
 * @returns {string}
 */
function getAnatomicalAnchor() {
  const num = (id) => { const el = $(id); return el && el.value ? parseFloat(el.value) : null; };
  const height = num("height"), weight = num("weight");
  const chest  = num("chest"),  waist  = num("waist"),  legs = num("legs");

  if (!height && !weight) {
    return "Fit the garment to a realistic human body with accurate anatomical proportions and photorealistic fabric physics.";
  }

  let sentence = "The person has ";
  if (height && weight) sentence += `an exact height of ${height}cm and weighs ${weight}kg`;
  else if (height)      sentence += `an exact height of ${height}cm`;
  else                  sentence += `a weight of ${weight}kg`;
  sentence += ".";

  const details = [];
  if (chest) details.push(`chest ${chest}cm`);
  if (waist) details.push(`waist ${waist}cm`);
  if (legs)  details.push(`inseam ${legs}cm`);
  if (details.length) sentence += ` Exact body measurements: ${details.join(", ")}.`;

  sentence += " Fit the garment strictly to these specific anatomical proportions — zero generic guessing, maximum physical fidelity.";
  return sentence;
}

/**
 * Return the signed delta between activeTryOnSize and currentUserSize in the
 * SIZE_SCALE ladder. Positive = user chose larger; negative = user chose smaller.
 * Returns 0 when either size is absent or not in the scale.
 * @returns {number}
 */
function getSizeDelta() {
  if (!currentUserSize || !activeTryOnSize) return 0;
  const baseIdx = SIZE_SCALE.indexOf(currentUserSize);
  const pickIdx = SIZE_SCALE.indexOf(activeTryOnSize);
  if (baseIdx === -1 || pickIdx === -1) return 0;
  return pickIdx - baseIdx;
}

/**
 * Translate a numeric size delta into a highly descriptive, textile-specific fit
 * modifier. The language is intentionally dense so the VTON engine has minimal
 * room for interpretation.
 * @param {number} delta    — getSizeDelta() result (negative = smaller, positive = larger)
 * @param {string} garmentType — "upper_body" | "lower_body"
 * @returns {string}
 */
function getFitModifier(delta, garmentType) {
  if (garmentType === "upper_body") {
    if (delta <= -2) return "sleek athletic compression fit, form-fitting tailored silhouette with a snug contour seamlessly hugging the torso, structurally intact fabric lying smooth and flat against the body, cropped hem sitting cleanly at the natural waistline";
    if (delta === -1) return "slim tailored athletic fit, close contour following the torso with clean structural drape, fabric lying taut but smooth with no distortion";
    if (delta === 0)  return "perfectly tailored true-to-size fit, flawless natural drape with no excess fabric";
    if (delta === 1)  return "relaxed fit, slightly loose drape, comfortable room across the shoulders and chest";
    /* delta >= 2 */  return "oversized fashion-forward fit, generously dropped shoulders, easy relaxed volume through the torso, elongated hem with natural gravity drape";
  }
  /* lower_body */
  if (delta <= -2) return "high-compression slim silhouette, fabric lying smooth and continuous from waist to ankle in a seamlessly fitted contour, structurally clean at the knee and thigh with no creasing or distortion, full-length inseam with a tailored ankle cuff";
  if (delta === -1) return "slim tailored fit, close through the thigh and knee with a clean tapered leg, fabric draping smoothly to a narrow ankle opening";
  if (delta === 0)  return "perfectly tailored true-to-size fit, clean break at the ankle with no pooling";
  if (delta === 1)  return "relaxed wide fit, comfortable room through the thighs, natural break at the ankle";
  /* delta >= 2 */  return "wide-leg fashion silhouette, generous volume through the thigh with a sweeping leg that breaks softly over the shoe, clean continuous fabric geometry";
}

/* Appended to every VTON prompt to lock the engine into photorealistic output.
   Kept as a module constant so changing it in one place affects all call sites. */
const QUALITY_SUFFIX = ", photorealistic real-world fabric texture, visible seams and stitching, micro-detailed weave, natural environmental lighting matching the user's room, cinematic shading, ultra-realistic physical garment appearance, strictly maintain flawless fabric integrity, continuous realistic 3D mesh, and natural material physics without any glitching, strange horizontal bands, tearing, or unnatural structural folds";

function buildPrompt(item) {
  const colorWord = colorName(item.color);
  const sub    = SUBTYPE_PROMPT[item.subType] || "";
  const anchor = getAnatomicalAnchor();
  const delta  = getSizeDelta();
  const fitMod = getFitModifier(delta, item.garmentType);

  if (item.garmentType === "lower_body") {
    return `Substitute the current bottoms with ${colorWord} ${sub} trousers. ${anchor} Render a ${fitMod}${QUALITY_SUFFIX}.`
      .replace(/\s+/g, " ").trim();
  }
  const noun = SHIRT_NOUN[item.subType] || "top";
  return `Substitute the current top with a ${colorWord} ${sub} ${noun}. ${anchor} Render a ${fitMod}${QUALITY_SUFFIX}.`
    .replace(/\s+/g, " ").trim();
}

/**
 * Apply whatever the user is currently trying on: the FULL look (shirt + pants in
 * ONE payload) when BOTH outfit slots are filled, otherwise the single active
 * garment. The single entry point goLive() and mid-session swaps call, so the live
 * flow stays identical for both modes.
 * @returns {Promise<void>}
 */
async function applyActive() {
  const look = resolveLook();        // non-null only when activeOutfit has top AND bottom
  if (look) return applyLook(look.top, look.bottom);
  return applyGarment(activeItem);
}

/**
 * Render BOTH garments of a verified look in ONE realtime set() call — never two
 * sequential requests (that would double-spend the strict 5s window). The unified
 * prompt names the shirt AND the pants, so the model renders the full outfit in a
 * single pass / one stream.
 *
 * SDK reality (verified against @decartai/sdk@0.1.5 `setInputSchema`): realtime
 * set() accepts exactly { prompt, enhance, image } and STRIPS unknown keys, so only
 * ONE reference image reaches the model today. We send the top as that reference and
 * bundle BOTH image URLs + their categories alongside it (images / garments) so they
 * are forward-compatible the day the model accepts multi-garment input — and both
 * garments already render now via the combined prompt. The try/catch falls back to
 * the minimal documented shape so a full look can never break the live session.
 * @returns {Promise<void>}
 */
async function applyLook(top, bottom) {
  if (!rtClient) throw new Error("not connected");

  const prompt = buildLookPrompt(top, bottom);
  const primaryImage = garmentImageRef(top.img) ?? null;   // proxy URL — fast Decart-side fetch

  // ONE combined payload — both garments, one pass, same session.
  const payload = {
    prompt,
    enhance: true,
    image: primaryImage,              // SDK single-image reference (the top, as URL)
    images,                           // both verified URLs, bundled together
    garments: [                       // per-slot metadata incl. category (top|bottom)
      { category: "top",    type: top.garmentType,    image: top.img,    color: top.color,    subType: top.subType,    name: top.name },
      { category: "bottom", type: bottom.garmentType, image: bottom.img, color: bottom.color, subType: bottom.subType, name: bottom.name },
    ],
  };

  try {
    await rtClient.set(payload);
  } catch (e) {
    // A stricter SDK build may reject the enriched shape — retry with the minimal contract.
    console.warn("look payload rejected, retrying minimal:", e?.message || e);
    await rtClient.set({ prompt, image: primaryImage, enhance: true });
  }
}

/**
 * Build ONE prompt that instructs the model to overlay the shirt AND the pants
 * simultaneously (a single pass), so a full outfit is rendered together rather
 * than as two separate substitutions.
 */
function buildLookPrompt(top, bottom) {
  const tColor = colorName(top.color), tSub = SUBTYPE_PROMPT[top.subType] || "";
  const tNoun  = SHIRT_NOUN[top.subType] || "top";
  const bColor = colorName(bottom.color), bSub = SUBTYPE_PROMPT[bottom.subType] || "";
  const anchor = getAnatomicalAnchor();
  const delta  = getSizeDelta();
  const topFit = getFitModifier(delta, top.garmentType);
  const botFit = getFitModifier(delta, bottom.garmentType);
  return (
    `Dress the person in one complete outfit in a single pass: ` +
    `replace the top with a ${tColor} ${tSub} ${tNoun} rendered as a ${topFit}, ` +
    `and at the same time replace the bottoms with ${bColor} ${bSub} trousers rendered as a ${botFit}. ` +
    `${anchor} Render both garments together in a single photorealistic pass${QUALITY_SUFFIX}.`
  ).replace(/\s+/g, " ").trim();
}

/* =============================================================================
   Size Override Selector — Screen 2 (Try-On room)
   ─────────────────────────────────────────────────────────────────────────
   A glassmorphism button row (XS / S / M / L / XL / XXL / 3XL) injected below
   the active-garment chip. The button matching currentUserSize is highlighted by default.
   Selecting a different size sets activeTryOnSize, which buildFitModifier() then
   uses to append tight-fit or oversized descriptors to the VTON prompt. If a
   WebRTC session is already live, applyActive() is called immediately so the
   garment resizes without restarting the connection.
   ============================================================================= */
function injectSizeSelector() {
  // Remove any stale selector from a previous room entry before rebuilding.
  const old = $("pearSizeSelector");
  if (old) old.remove();

  if (!$("pearSizeSelectorStyles")) {
    const s = document.createElement("style");
    s.id = "pearSizeSelectorStyles";
    s.textContent = `
      /* Liquid-glass size selector — matches the blue glass theme in style.css.
         Light refractive pod, glass pill tiles, royal-blue active glow. */
      #pearSizeSelector {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 14px 0 4px;
        padding: 10px 16px;
        background: linear-gradient(135deg, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0.18) 100%);
        border: 1px solid rgba(255,255,255,0.55);
        border-radius: 100px;
        backdrop-filter: blur(25px) saturate(210%);
        -webkit-backdrop-filter: blur(25px) saturate(210%);
        box-shadow: 0 8px 32px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,0.6);
      }
      .pear-sz-label {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: .12em;
        text-transform: uppercase;
        color: #5f7d00;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .pear-sz-btns {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .pear-sz-btn {
        min-width: 40px;
        padding: 7px 13px;
        border-radius: 100px;
        border: 1px solid rgba(255,255,255,0.55);
        background: rgba(255,255,255,0.42);
        -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
        color: #1c2536;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: .04em;
        cursor: pointer;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.5);
        transition: all .5s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .pear-sz-btn:hover {
        transform: translateY(-2px);
        background: rgba(255,255,255,0.7);
        border-color: rgba(141,182,0,0.45);
        color: #0a0a0b;
        box-shadow: 0 8px 22px rgba(0,0,0,0.12);
      }
      .pear-sz-btn:active { transform: scale(0.94); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); }
      .pear-sz-btn.is-active {
        background: rgba(141,182,0,0.16);
        border-color: rgba(141,182,0,0.55);
        color: #5f7d00;
        box-shadow: 0 0 0 1px rgba(141,182,0,0.25), 0 6px 20px rgba(141,182,0,0.25),
                    inset 0 0 12px rgba(141,182,0,0.18);
        animation: pearSzPulse 2s cubic-bezier(0.16, 1, 0.3, 1) infinite;
      }
      @keyframes pearSzPulse {
        0%, 100% { box-shadow: 0 0 0 1px rgba(141,182,0,0.22), 0 6px 20px rgba(141,182,0,0.22), inset 0 0 12px rgba(141,182,0,0.16); }
        50%      { box-shadow: 0 0 0 3px rgba(141,182,0,0.30), 0 10px 28px rgba(141,182,0,0.34), inset 0 0 18px rgba(141,182,0,0.28); }
      }
      .pear-sz-hint {
        margin-left: auto;
        font-size: 10px;
        font-weight: 600;
        color: #6b6b70;
        white-space: nowrap;
        flex-shrink: 0;
      }
      @media (prefers-reduced-motion: reduce) {
        .pear-sz-btn.is-active { animation: none; }
      }
    `;
    document.head.appendChild(s);
  }

  const row = document.createElement("div");
  row.id = "pearSizeSelector";
  row.setAttribute("aria-label", "Size override selector");

  const current = activeTryOnSize || currentUserSize;
  const btnHtml = SIZE_SCALE.map((sz) => {
    const isActive = sz === current;
    const isRec    = sz === currentUserSize;
    return `<button class="pear-sz-btn${isActive ? " is-active" : ""}" data-sz="${sz}" type="button" aria-pressed="${isActive}">${sz}${isRec ? " ★" : ""}</button>`;
  }).join("");

  row.innerHTML =
    `<span class="pear-sz-label">מידה · Size</span>` +
    `<div class="pear-sz-btns">${btnHtml}</div>` +
    (currentUserSize ? `<span class="pear-sz-hint">★ מומלצת</span>` : "");

  row.addEventListener("click", (e) => {
    const btn = e.target.closest(".pear-sz-btn");
    if (btn) setSizeOverride(btn.dataset.sz);
  });

  // Insert directly below the active-garment chip; fall back to #cameraCard.
  const anchor = $("activeGarment");
  if (anchor && anchor.parentNode) {
    anchor.parentNode.insertBefore(row, anchor.nextSibling);
  } else {
    const cc = $("cameraCard");
    if (cc) cc.appendChild(row);
  }
}

/**
 * Switch the active try-on size, refresh button highlight states, and — if a
 * WebRTC session is currently live — push a new prompt payload immediately so
 * the garment resizes in real-time without restarting the connection.
 * @param {string} size — one of SIZE_SCALE ('S'|'M'|'L'|'XL'|'XXL')
 */
function setSizeOverride(size) {
  activeTryOnSize = size;

  document.querySelectorAll(".pear-sz-btn").forEach((btn) => {
    const on = btn.dataset.sz === size;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });

  if (isLive()) {
    applyActive().catch((e) => console.warn("size override apply:", e?.message || e));
  }

  const baseIdx = SIZE_SCALE.indexOf(currentUserSize);
  const pickIdx = SIZE_SCALE.indexOf(size);
  if (!currentUserSize || baseIdx === -1) {
    toast(`מידה שנבחרה: <b>${size}</b>`);
  } else if (pickIdx < baseIdx) {
    toast(`מידה <b>${size}</b> — הלבוש יראה הדוק יותר`);
  } else if (pickIdx > baseIdx) {
    toast(`מידה <b>${size}</b> — הלבוש יראה גדול יותר`);
  } else {
    toast(`מידה <b>${size}</b> — התאמה מדויקת`);
  }
}

/* =============================================================================
   Analytics — fire-and-forget try-on event (backend appends to Google Sheets)
   No PII is sent: only garment metadata and the recommended size.
   ============================================================================= */
function logTryOnAnalytics(item, size) {
  if (!item) return;
  const payload = {
    garmentId:   item.id          ?? "",
    garmentName: item.name        ?? "",
    garmentType: item.garmentType ?? "",
    subType:     item.subType     ?? "",
    size:        size             ?? "",
  };
  console.log("[analytics] firing /api/track-tryon →", payload);
  fetch("/api/track-tryon", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  })
    .then(r => {
      console.log("[analytics] /api/track-tryon response:", r.status, r.ok ? "ok" : "ERROR");
      return r.json().then(body => console.log("[analytics] response body:", JSON.stringify(body)));
    })
    .catch(err => console.error("[analytics] /api/track-tryon fetch failed:", err));
}

/* =============================================================================
   Capture flow
   ============================================================================= */
/* One button toggles the live session: Go Live ⇄ Stop. */
function onLiveToggle() {
  if (isLive()) stopLive();
  else goLive();
}

/**
 * Open ONE realtime session, apply the active garment, and stream the live
 * AI-edited video so the garment warps/tracks the user dynamically. The session
 * stays open until the user presses Stop (stopLive). Switching items reuses this
 * session via set() without reconnecting.
 *
 * Re-entrancy (Task 10): `busy` is claimed BEFORE the first await (the pre-use
 * connectivity probe and the camera prompt), so rapid double-clicks cannot open
 * two concurrent capture flows / billable sessions. The finally clause is the
 * single release point for `busy` and the capture button.
 * @returns {Promise<void>}
 */
async function goLive() {
  if (busy || isLive()) return;
  busy = true;                         // Task 10 — claim the flow before ANY await
  $("captureBtn").disabled = true;
  $("camError").hidden = true;
  exitClipReplay();                    // clear any history clip before a real session takes #aiVideo
  clearRecording();                    // Feature 2 — drop any previous clip + button
  card().classList.remove("show-result");  // drop any frozen snapshot so the live feed isn't covered by #resultCanvas

  try {
    // Task 2 — graceful pre-use internet check, BEFORE opening any billable session.
    // NOTE: treated as a soft warning only — a failed probe (false-negative, e.g.
    // the server is slow to respond) must NOT block the live session attempt.
    // If the network is genuinely down the subsequent WebRTC / token steps will
    // fail with a real error that is caught below and shown to the user.
    const online = await ensureOnline();
    if (!online) {
      console.warn("[go-live] health probe returned offline — proceeding anyway (may be false negative)");
      toast("בדיקת קישוריות לא הצליחה — ממשיכים בניסיון חיבור");
    }

    if (!localStream) { const ok = await startCamera(); if (!ok) return; }

    $("scanOverlay").hidden = false;
    $("scanSub").textContent = "Lucy VTON · photorealistic render";

    // 1) mint ek_ token + open the WebRTC session (billing starts here)
    await connectRealtime();
    await waitConnected(CONNECT_TIMEOUT_MS);

    // 2) apply on the live stream — the full look (shirt + pants, ONE payload) when
    //    activeOutfit has both slots filled, else the single active garment. Same session.
    await applyActive();               // rtClient.set({ prompt, image(s), enhance:false })
    // Log every garment being worn — both top AND bottom when a full look is active.
    const _trackSize = activeTryOnSize || currentUserSize;
    const _look = resolveLook();
    if (_look) {
      logTryOnAnalytics(_look.top,    _trackSize);
      logTryOnAnalytics(_look.bottom, _trackSize);
    } else {
      logTryOnAnalytics(activeItem, _trackSize);
    }

    // 3) reveal the live edited feed (onRemoteStream also reveals it as frames arrive)
    $("scanOverlay").hidden = true;
    card().classList.add("show-live");
    setLiveControls(true);
    startRecording();                  // Feature 2 — record while the session is live

    // Strict 5-second session limit — auto-freezes + stops billing automatically.
    // Captures sessionGen so a manual Stop before expiry (which bumps the gen) makes
    // both callbacks no-ops, protecting any subsequent session from being torn down.
    const timerGen = sessionGen;
    const totalSec = Math.round(LIVE_DURATION_MS / 1000);

    // Visual countdown overlay on the #aiVideo container — ticks 5→1 each second.
    showLiveCountdown(totalSec);
    let remaining = totalSec;
    liveCountdownInterval = setInterval(() => {
      if (sessionGen !== timerGen) { hideLiveCountdown(); return; }
      remaining -= 1;
      tickLiveCountdown(Math.max(remaining, 0));
    }, 1000);

    // Hard stop at EXACTLY LIVE_DURATION_MS — independent of tick drift, so no token
    // can ever leak past the 5-second window even if the interval is throttled.
    liveDurationTimer = setTimeout(() => {
      if (sessionGen !== timerGen) return;
      console.log("[PEAR] 5s live limit reached — auto-freezing + stopping session");
      autoStopAndFreeze();
    }, LIVE_DURATION_MS);

    toast("✨ מדידה חיה · 5 שניות — לחץ עצור לסיום מוקדם");
  } catch (err) {
    stopLive();                        // close any partial session — no idle billing
    console.error("[go-live] failed:", err?.message || String(err));
    if (DEMO_FLAG) {
      await renderMockDemo(activeItem);
      card().classList.add("show-result");
    } else {
      showCamError("המדידה החיה נכשלה: " + (err?.message || err));
      setConn("error");
    }
  } finally {
    $("scanOverlay").hidden = true;
    busy = false;
    if (!isLive()) $("captureBtn").disabled = !localStream;
  }
}

/**
 * Manual/early hard-stop (Stop button or tab hidden). Cancels the 5s timer and
 * disconnects immediately so billing stops the instant it's called.
 * @returns {void}
 */
function stopLive() {
  // 🖼 Freeze the final dressed frame onto the on-screen #resultCanvas and save it
  // as the high-quality "masterpiece" BEFORE teardown() detaches #aiVideo. Wrapped
  // so a capture hiccup can never delay the billing kill-switch below.
  let frozen = null;
  try {
    if (isLive()) {
      frozen = freezeFinalFrame();                 // paints #resultCanvas, returns its dataURL
      const size = activeTryOnSize || currentUserSize || "—";
      lastFitTs = saveFitToGallery(frozen || captureLiveFrame(), currentLookName(), size,
                                   activeItem && activeItem.id);
    }
  } catch (_) {}

  teardown();                          // rtClient.disconnect() → billing stops now (also hides #aiVideo)
  card().classList.remove("show-live");
  if (frozen) card().classList.add("show-result");   // surface the frozen snapshot as the final result
  setLiveControls(false);
  $("captureBtn").disabled = !localStream;
}

/* Strict-5s auto-teardown. Freezes the final frame, kills billing, surfaces the
   frozen result — a thin wrapper over stopLive() so the manual Stop and the
   automatic 5s stop share ONE freeze → save → teardown path. */
function autoStopAndFreeze() {
  toast("⏱ 5 שניות הושלמו — הלוק הוקפא ונשמר");
  stopLive();
}

/* Paint the final dressed frame onto the on-screen #resultCanvas at full capture
   resolution and return its JPEG dataURL. Doubles as (1) the frozen "masterpiece"
   shown via .show-result and (2) the high-quality poster saved to Previous Fits.
   Prefers the AI-edited feed; falls back to the mirrored webcam. Returns null if
   no frame is paintable — must NEVER throw into the teardown path. */
function freezeFinalFrame() {
  const ai = $("aiVideo");
  const webcam = $("webcam");
  let src = null, mirror = false, w = 0, h = 0;
  if (ai && ai.videoWidth > 0 && ai.style.display !== "none") {
    src = ai; w = ai.videoWidth; h = ai.videoHeight;            // already correctly oriented
  } else if (webcam && webcam.videoWidth > 0) {
    src = webcam; w = webcam.videoWidth; h = webcam.videoHeight; mirror = true;  // selfie-mirror
  }
  if (!src || !w || !h) return null;
  const cv = $("resultCanvas");
  if (!cv) return null;
  cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d", { alpha: false });
  ctx.save();
  if (mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
  try { ctx.drawImage(src, 0, 0, w, h); } catch (_) { ctx.restore(); return null; }
  ctx.restore();
  try { return cv.toDataURL("image/jpeg", 0.85); } catch (_) { return null; }
}

/* ── Live countdown overlay (the strict 5s window) ──────────────────────────
   A circular pill on the #aiVideo container counts the session down to zero, so
   the user always knows the live (billable) window is about to close. */
function showLiveCountdown(sec) {
  const el = $("liveCountdown");
  if (!el) return;
  el.hidden = false;
  tickLiveCountdown(sec);
}
function tickLiveCountdown(sec) {
  const numEl = $("liveCountdownNum");
  if (numEl) numEl.textContent = String(sec);
  const el = $("liveCountdown");
  if (el) {
    // sweep the conic ring from full → empty as the seconds drain
    const total = Math.max(1, Math.round(LIVE_DURATION_MS / 1000));
    el.style.setProperty("--cd-frac", String(Math.max(0, sec) / total));
    el.classList.toggle("is-final", sec <= 1);
  }
}
function hideLiveCountdown() {
  if (liveCountdownInterval) { clearInterval(liveCountdownInterval); liveCountdownInterval = null; }
  const el = $("liveCountdown");
  if (el) { el.hidden = true; el.classList.remove("is-final"); }
}

/* Swap the single capture button between "Go Live" and "Stop" states. */
function setLiveControls(live) {
  const btn = $("captureBtn");
  if (!btn) return;
  const icon  = btn.querySelector(".btn-capture__icon");
  const label = btn.querySelector(".btn-capture__label");
  const en    = btn.querySelector(".btn-capture__en");
  btn.classList.toggle("is-live", live);
  btn.disabled = false;
  if (icon)  icon.textContent  = live ? "⏹" : "📸";
  if (label) label.textContent = live ? "עצור מדידה חיה" : "התחל מדידה חיה";
  if (en)    en.textContent    = live ? "Stop" : "Go Live";
}

/* =============================================================================
   Feature 2 — Download the 5-second fitting clip (MediaRecorder)
   ─────────────────────────────────────────────────────────────────────────
   We record the INCOMING AI-edited WebRTC stream (the dressed output the user
   actually wants), not the raw webcam. Recording starts when the first edited
   frame arrives (onRemoteStream) and is flushed by teardown() the instant the
   5s window closes. On flush we build a Blob → object URL and reveal a clean
   "Download Video" button. Everything is torn down/revoked on the next session.
   ============================================================================= */
/* Codec selection is platform-aware (mobile download fix):
   • MOBILE — try H.264 MP4 first. iOS Photos / Android galleries natively save MP4,
     and the MP4 container carries a correct duration header, which kills the
     "broken 14-second clip" bug WebM exhibits (WebM from MediaRecorder ships no
     top-level duration, so phone players show a bogus/black length).
   • DESKTOP — keep the proven VP8/WebM path (Chrome/Firefox encode the canvas track
     into .webm most reliably; a missing/unsupported codec is what left the file
     black). MP4 stays as a tail fallback either way.
   Every candidate is feature-tested via isTypeSupported before use. */
function pickRecorderMime() {
  if (typeof MediaRecorder === "undefined") return null;
  const mp4  = ["video/mp4;codecs=h264", "video/mp4;codecs=avc1.42E01E", "video/mp4"];
  const webm = ["video/webm;codecs=vp8", "video/webm", "video/webm;codecs=vp9"];
  const candidates = IS_MOBILE ? [...mp4, ...webm] : [...webm, ...mp4];
  for (const t of candidates) {
    try { if (MediaRecorder.isTypeSupported(t)) return t; } catch (_) {}
  }
  return null;
}

/**
 * Start recording the REMOTE Lucy-VTON output shown in #aiVideo (NOT the local
 * camera). We continuously paint the remote frames onto an off-DOM canvas and
 * record canvas.captureStream(), which guarantees real encoded pixels — recording
 * a raw remote WebRTC track directly produces a black video in Chromium. The clip
 * is video-only and is force-stopped by stopRecording() when the user presses Stop.
 * Idempotent within a session.
 */
function startRecording() {
  if (recordingActive || mediaRecorder || typeof MediaRecorder === "undefined") return;
  const video = $("aiVideo");
  if (!video) return;

  recordingActive = true;
  recordedChunks = [];

  // Off-DOM canvas mirroring the remote VTON frames. Seed a sane size so the
  // captureStream track is valid immediately (real frames overwrite it at once).
  recordCanvas = document.createElement("canvas");
  recordCanvas.width  = video.videoWidth  || LIVE_W;
  recordCanvas.height = video.videoHeight || LIVE_H;
  const ctx = recordCanvas.getContext("2d", { alpha: false });

  // iOS Safari only stabilised canvas.captureStream in 15.4 — if it's missing, bail
  // cleanly so the live try-on itself is unaffected (we just skip the downloadable clip).
  if (typeof recordCanvas.captureStream !== "function") {
    console.warn("canvas.captureStream unsupported — clip recording disabled on this device");
    stopPaintLoop();
    return;
  }

  // BLACK-FRAME FIX: the Decart server takes ~1s to warm up before the first
  // dressed frame arrives. If we start the recorder at go-live, the clip begins
  // with ~1s of solid black canvas, so any looped replay (gallery tile / modal)
  // opens on a black screen — this was the "Previous Fits black screen" symptom.
  // Instead we ARM the recorder lazily — only once the first REAL frame has been
  // painted — so the saved Live Photo contains dressed frames exclusively.
  const beginRecorder = () => {
    if (mediaRecorder) return;
    const captured = recordCanvas.captureStream(30);   // 30 fps, video-only
    try {
      const mime = pickRecorderMime();
      mediaRecorder = new MediaRecorder(captured, mime ? { mimeType: mime } : undefined);
      // Record what the recorder ACTUALLY negotiated so the Blob/File + filename carry
      // the true container (the browser may pick something other than our request).
      recorderMime = (mediaRecorder.mimeType || mime || "").toLowerCase() || null;
    } catch (e) {
      console.warn("MediaRecorder unavailable:", e?.message || e);
      stopPaintLoop();
      return;
    }
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) recordedChunks.push(e.data); };
    mediaRecorder.onstop = finalizeRecording;          // fires after stop() flushes the buffer
    // 200ms timeslice → proper WebM cluster timecodes, so the clip reports its TRUE
    // duration instead of the broken/inflated length a single-blob start() gives.
    try { mediaRecorder.start(200); }
    catch (e) { console.warn("recorder start failed:", e?.message || e); stopPaintLoop(); mediaRecorder = null; }
  };

  const paint = () => {
    if (!recordingActive) return;
    const w = video.videoWidth, h = video.videoHeight;
    if (w && h) {
      if (recordCanvas.width !== w || recordCanvas.height !== h) {
        recordCanvas.width = w; recordCanvas.height = h;
      }
      try { ctx.drawImage(video, 0, 0, w, h); beginRecorder(); } catch (_) {}
    }
    recordRaf = requestAnimationFrame(paint);
  };
  paint();
}

/** Halt the canvas paint loop (does not touch the recorder). */
function stopPaintLoop() {
  recordingActive = false;
  if (recordRaf) { cancelAnimationFrame(recordRaf); recordRaf = 0; }
  recordCanvas = null;
}

/** Stop any in-progress local replay without touching the recorder or API state. */
function stopReplay() {
  if (!replayActive) return;
  replayActive = false;
  const vid = $("pearReplayVideo");
  if (vid) { vid.onended = null; try { vid.pause(); } catch (_) {} }
}

/**
 * Force-stop the recorder. Called by teardown (on Stop / tab-hide / unload) —
 * idempotent. onstop → finalizeRecording builds the downloadable clip.
 */
function stopRecording() {
  stopPaintLoop();
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    try { mediaRecorder.stop(); } catch (_) {}
  }
  mediaRecorder = null;
}

/* =============================================================================
   Replay Zone — dedicated, premium UI injected below the camera card
   ─────────────────────────────────────────────────────────────────────────
   Once the 5-second clip is finalised we surface a glassmorphism "Replay Zone"
   directly below #cameraCard. It holds a proper <video> element with native
   controls so the user can scrub, replay, and download without any extra taps.
   The Watch-Again quick-button in the capture controls area scrolls them here.
   ============================================================================= */

/** Inject the Replay Zone CSS exactly once into <head>. */
function injectReplayStyles() {
  if ($("pearReplayStyles")) return;
  const s = document.createElement("style");
  s.id = "pearReplayStyles";
  s.textContent = `
    /* ── PEAR Replay Zone — "Your Try-On" review card (pear-green theme) ── */
    #pearReplayZone {
      margin-top: 20px;
      border-radius: 24px;
      background: linear-gradient(180deg, rgba(24,24,28,.93), rgba(11,11,13,.95));
      -webkit-backdrop-filter: blur(22px) saturate(150%);
      backdrop-filter: blur(22px) saturate(150%);
      border: 1px solid rgba(141,182,0,.30);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,.06),
        inset 0 0 0 1px rgba(141,182,0,.06),
        0 26px 64px rgba(0,0,0,.52);
      padding: 16px 16px 15px;
      opacity: 0;
      transform: translateY(14px) scale(.99);
      transition: opacity .55s cubic-bezier(.16,1,.3,1),
                  transform .55s cubic-bezier(.16,1,.3,1);
      display: none;
    }
    #pearReplayZone.is-visible { display: block; }
    #pearReplayZone.is-ready   { opacity: 1; transform: none; }

    .pear-rz-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin: 2px 4px 14px;
    }
    /* garment name — now the prominent title (left, in RTL flow) */
    .pear-rz-title {
      font-family: "Urbanist", sans-serif;
      font-size: 1.06rem;
      font-weight: 800;
      letter-spacing: .005em;
      color: #fff;
      max-width: 58%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pear-rz-badge {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      font-family: "Inter", sans-serif;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: .12em;
      text-transform: uppercase;
      color: #b6e000;
      background: rgba(141,182,0,.13);
      border: 1px solid rgba(141,182,0,.36);
      border-radius: 9999px;
      padding: 5px 12px;
      white-space: nowrap;
    }
    .pear-rz-badge::before {
      content: '';
      width: 7px; height: 7px; border-radius: 50%;
      background: #8DB600;
      box-shadow: 0 0 9px rgba(141,182,0,.7);
      animation: pearRzPulse 1.8s ease-in-out infinite;
    }
    @keyframes pearRzPulse { 0%,100% { opacity:1; } 50% { opacity:.25; } }

    #pearReplayVideo {
      width: 100%;
      max-height: 60vh;
      border-radius: 16px;
      display: block;
      background: #000;
      object-fit: contain;
      border: 1px solid rgba(255,255,255,.09);
      box-shadow: 0 12px 32px rgba(0,0,0,.42);
    }

    .pear-rz-actions {
      display: flex;
      gap: 10px;
      margin-top: 14px;
    }
    .pear-rz-btn {
      flex: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 13px 16px;
      border-radius: 9999px;
      font-family: "Urbanist", sans-serif;
      font-size: .92rem;
      font-weight: 800;
      cursor: pointer;
      border: 1px solid transparent;
      white-space: nowrap;
      transition: transform .35s cubic-bezier(.16,1,.3,1),
                  background .35s cubic-bezier(.16,1,.3,1),
                  box-shadow .35s cubic-bezier(.16,1,.3,1);
    }
    .pear-rz-btn:hover  { transform: translateY(-2px); }
    .pear-rz-btn:active { transform: translateY(0) scale(.97); }
    .pear-rz-btn__en {
      font-size: .68rem;
      font-weight: 700;
      opacity: .6;
      letter-spacing: .04em;
    }
    .pear-rz-btn--replay {
      background: rgba(255,255,255,.08);
      color: #fff;
      border-color: rgba(255,255,255,.16);
    }
    .pear-rz-btn--replay:hover {
      background: rgba(255,255,255,.16);
      box-shadow: 0 8px 22px rgba(0,0,0,.3);
    }
    .pear-rz-btn--dl {
      background: #8DB600;
      color: #0a0a0b;
      box-shadow: 0 12px 36px rgba(141,182,0,.26);
    }
    .pear-rz-btn--dl:hover {
      background: #9cca00;
      box-shadow: 0 12px 30px rgba(141,182,0,.42);
    }
    .pear-rz-btn--dl .pear-rz-btn__en { opacity: .55; }
  `;
  document.head.appendChild(s);
}

/**
 * Lazily create (once) the Replay Zone DOM and insert it directly below
 * #cameraCard. Returns the zone element. Buttons are wired at construction.
 */
function ensureReplayZone() {
  let zone = $("pearReplayZone");
  if (!zone) {
    zone = document.createElement("div");
    zone.id = "pearReplayZone";
    zone.setAttribute("aria-label", "Replay zone");
    zone.innerHTML =
      `<div class="pear-rz-header">` +
        `<span class="pear-rz-badge">Your Try-On · ההקלטה שלך</span>` +
        `<span id="pearRzTitle" class="pear-rz-title"></span>` +
      `</div>` +
      `<video id="pearReplayVideo" class="pear-rz-video"` +
             ` controls loop playsinline muted preload="metadata"></video>` +
      `<div class="pear-rz-actions">` +
        `<button id="pearRzReplayBtn" class="pear-rz-btn pear-rz-btn--replay" type="button">` +
          `<span aria-hidden="true">↺</span>` +
          `<span>צפה שוב</span>` +
          `<span class="pear-rz-btn__en">Replay</span>` +
        `</button>` +
        `<button id="pearRzDlBtn" class="pear-rz-btn pear-rz-btn--dl" type="button">` +
          `<span aria-hidden="true">⬇</span>` +
          `<span>הורד</span>` +
          `<span class="pear-rz-btn__en">Download</span>` +
        `</button>` +
      `</div>`;

    zone.querySelector("#pearRzReplayBtn").addEventListener("click", () => {
      const v = $("pearReplayVideo");
      if (!v) return;
      replayActive = true;
      try { v.currentTime = 0; } catch (_) {}
      v.play().catch(() => {});
    });
    zone.querySelector("#pearRzDlBtn").addEventListener("click", downloadRecording);

    const anchor = card();
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(zone, anchor.nextSibling);
    } else {
      document.body.appendChild(zone);
    }
  }
  return zone;
}

/** Build the downloadable clip from the buffered chunks and reveal the Replay Zone. */
function finalizeRecording() {
  if (!recordedChunks.length) return;
  const raw = (recordedChunks[0] && recordedChunks[0].type) || recorderMime || "video/webm";
  const type = raw.split(";")[0] || "video/webm";
  const blob = new Blob(recordedChunks, { type });
  recordedChunks = [];
  recordedBlob = blob;

  // 🎞 Live-Action gallery: hand the SAME clip to the most-recent saved fit as
  // its own object URL (independent of recordedUrl, so the revoke below is safe).
  try { attachClipToLastFit(blob); } catch (_) {}

  if (recordedUrl) { try { URL.revokeObjectURL(recordedUrl); } catch (_) {} }
  recordedUrl = URL.createObjectURL(blob);

  // Populate the dedicated Replay Zone and fade it in below the camera card.
  const zone = ensureReplayZone();
  const vid = $("pearReplayVideo");
  if (vid) { vid.src = recordedUrl; vid.muted = true; vid.load(); }
  const titleEl = $("pearRzTitle");
  if (titleEl) titleEl.textContent = activeItem ? activeItem.name : "";

  zone.classList.add("is-visible");
  // Two-rAF trick: browser paints display:block first, then transition fires.
  requestAnimationFrame(() => requestAnimationFrame(() => zone.classList.add("is-ready")));
}

/**
 * Save the recorded clip locally — mobile-first (mobile download fix).
 *
 * On phones the classic `<a download>` is unreliable: iOS Safari ignores the
 * download attribute entirely (it just navigates to the blob, often playing it
 * inline), so the clip never lands in Photos. The robust path is the Web Share API
 * with a File — that opens the native share sheet whose "Save Video" action drops
 * the clip straight into the iOS/Android gallery. We only reach for it when the
 * platform reports it can actually share THIS file, and we fall back to the anchor
 * download on desktop or when sharing is unavailable/declined.
 *
 * Must run inside the click gesture: the File is built synchronously and
 * navigator.share() is invoked before any real async gap, preserving the gesture.
 * @returns {Promise<void>}
 */
async function downloadRecording() {
  if (!recordedBlob && !recordedUrl) return;
  const type = (recordedBlob && recordedBlob.type) || (recorderMime || "").split(";")[0] || "video/webm";
  const ext = type.indexOf("mp4") > -1 ? "mp4" : "webm";
  const base = (activeItem && activeItem.name ? activeItem.name : "session").replace(/\s+/g, "-");
  const filename = `pear-fitting-${base}.${ext}`;

  // 1) Native gallery save via the share sheet (the reliable mobile path).
  if (recordedBlob && typeof navigator.canShare === "function" && typeof navigator.share === "function") {
    try {
      const file = new File([recordedBlob], filename, { type });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: "PEAR — מדידה וירטואלית",
          text: "הלוק שלי מ-PEAR · PEAR virtual fitting",
        });
        return;                                   // saved/shared — done
      }
    } catch (err) {
      if (err && err.name === "AbortError") return;   // user dismissed the sheet — not an error
      console.warn("share failed, falling back to download:", err?.message || err);
      // fall through to the anchor download below
    }
  }

  // 2) Desktop / fallback: object-URL anchor download. Keep the URL alive (no
  //    immediate revoke) so mobile browsers that open it in a new tab can still
  //    read the blob and let the user long-press → "Save Video"; it is revoked on
  //    the next session (clearRecording / finalizeRecording).
  if (!recordedUrl && recordedBlob) recordedUrl = URL.createObjectURL(recordedBlob);
  const a = document.createElement("a");
  a.href = recordedUrl;
  a.download = filename;
  a.rel = "noopener";
  if (IS_MOBILE) a.target = "_blank";             // iOS w/o canShare: open so it can be saved manually
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Drop the current clip, stop any replay, and hide post-session buttons. */
function clearRecording() {
  stopPaintLoop();                     // ensure no stale paint loop leaks into the next session
  stopReplay();                        // abort any in-progress local blob replay
  if (recordedUrl) { try { URL.revokeObjectURL(recordedUrl); } catch (_) {} recordedUrl = null; }
  recordedChunks = [];
  recordedBlob = null;
  recorderMime = null;

  // Reset and hide the dedicated Replay Zone so the next session starts clean.
  const zone = $("pearReplayZone");
  if (zone) {
    zone.classList.remove("is-ready", "is-visible");
    const vid = $("pearReplayVideo");
    if (vid) {
      vid.onended = null;
      try { vid.pause(); } catch (_) {}
      vid.removeAttribute("src");
      try { vid.load(); } catch (_) {}
    }
    const titleEl = $("pearRzTitle");
    if (titleEl) titleEl.textContent = "";
  }
}

/* ── offline-dev mock (ONLY via ?demo=1) ─────────────────────────────────── */
async function renderMockDemo(item) {
  const webcam = $("webcam");
  const vw = webcam.videoWidth || 720, vh = webcam.videoHeight || 960;
  const cv = $("resultCanvas");
  cv.width = vw; cv.height = vh;
  const c = cv.getContext("2d");
  c.save(); c.translate(vw, 0); c.scale(-1, 1); c.drawImage(webcam, 0, 0, vw, vh); c.restore();
  try {
    const img = await loadImage(item.img);
    const upper = item.garmentType !== "lower_body";
    const gw = vw * (upper ? 0.54 : 0.46), gh = gw * (img.height / img.width || 1.2);
    const gx = (vw - gw) / 2, gy = upper ? vh * 0.24 : vh * 0.52;
    c.globalAlpha = 0.92;
    c.drawImage(img, gx, gy, gw, gh);
    c.globalAlpha = 1;
  } catch (_) {}
  c.fillStyle = "rgba(11,60,149,.92)";
  c.fillRect(vw - 192, 14, 178, 30);
  c.fillStyle = "#fff"; c.font = "700 15px Inter, sans-serif"; c.textBaseline = "middle";
  c.fillText("DEMO · ?demo=1 (no live API)", vw - 188, 29);
}

/* =============================================================================
   Complete the Look + catalog
   ============================================================================= */
function recommendFor(item) {
  const want = item.garmentType === "lower_body" ? "shirt" : "pants";
  const lum = (hex) => { const f = parseInt(hex.slice(1), 16); return (0.299 * (f >> 16) + 0.587 * ((f >> 8) & 255) + 0.114 * (f & 255)) / 255; };
  const base = lum(item.color);
  return PEAR_CATALOG
    .filter((x) => x.type === want && x.id !== item.id)
    .map((x) => ({ x, score: Math.abs(lum(x.color) - base) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((r) => r.x);
}

function renderCompleteTheLook(item) {
  const recs = recommendFor(item);
  const he = item.garmentType === "lower_body" ? "חולצות שמשלימות את המכנסיים" : "מכנסיים שמשלימים את החולצה";
  $("clSub").textContent = he + " · Complete the Look";
  $("clTrack").innerHTML = recs.map((r, i) => `
    <article class="cl-card" style="--i:${i}">
      <div class="cl-card__media">${garmentThumb(r)}</div>
      <div class="cl-card__body">
        <span class="cl-card__cat">${r.type === "pants" ? "Pants" : "Shirt"} · ${SUBTYPE_LABEL_HE[r.subType] || ""}</span>
        <div class="cl-card__name">${r.name}</div>
        <span class="cl-card__price">$${r.price}</span>
      </div>
      <button class="cl-card__look" data-look="${r.id}">הוסף ללוק · Add to Look</button>
    </article>`).join("");
}

function renderCatalogPanel() {
  $("catalogGrid").innerHTML = PEAR_CATALOG.map((p) => `
    <div class="cat-item" data-pick="${p.id}">
      <div class="cat-item__media">${garmentThumb(p)}</div>
      <div class="cat-item__body">
        <span class="cat-item__name">${p.name}</span>
        <span class="cat-item__price">$${p.price}</span>
      </div>
    </div>`).join("");
}

function highlightCatalog(id) {
  document.querySelectorAll(".cat-item").forEach((el) =>
    el.classList.toggle("is-active", +el.dataset.pick === id));
}

/* ── self-contained studio garment SVG ───────────────────────────────────────
   catalog.js is not loaded in the PEAR demo, so this duplicates the same
   shape data and rendering logic locally.  Output is always a white-background
   flat-lay with a CSS drop-shadow — no Unsplash, no model, no background. */
const _SHIRT_PATHS = {
  sleeveless:   "M92 50 Q110 64 128 50 L144 62 Q151 92 151 122 L151 236 L69 236 L69 122 Q69 92 76 62 Z",
  short_sleeve: "M88 50 Q110 66 132 50 L170 68 L188 122 L166 130 L152 106 L152 236 L68 236 L68 106 L54 130 L32 122 L50 68 Z",
  long_sleeve:  "M88 50 Q110 66 132 50 L170 68 L198 204 L170 212 L152 108 L152 236 L68 236 L68 108 L50 212 L22 204 L50 68 Z",
};
const _PANT_PATHS = {
  slim:    "M66 44 L154 44 L150 238 L124 238 L111 120 L96 238 L70 238 Z",
  regular: "M62 44 L158 44 L156 238 L120 238 L110 124 L100 238 L64 238 Z",
  wide:    "M58 44 L162 44 L172 238 L138 238 L112 126 L108 126 L82 238 L48 238 Z",
};

function _mix(hex, p) {
  const f = parseInt(hex.slice(1), 16), t = p < 0 ? 0 : 255, a = Math.abs(p);
  const R = f >> 16, G = (f >> 8) & 0xff, B = f & 0xff;
  const m = (c) => Math.round((t - c) * a) + c;
  return "#" + (0x1000000 + m(R) * 0x10000 + m(G) * 0x100 + m(B)).toString(16).slice(1);
}

function _garmentSVG(item) {
  const isShirt = item.type === "shirt";
  const d = isShirt ? _SHIRT_PATHS[item.subType] : _PANT_PATHS[item.subType];
  if (!d) return `<svg viewBox="0 0 220 260"><rect width="220" height="260" fill="${item.color}"/></svg>`;

  const lite = _mix(item.color,  0.30);
  const base = item.color;
  const mid  = _mix(item.color, -0.15);
  const dark = _mix(item.color, -0.38);
  const ink  = _mix(item.color, -0.54);
  const pid  = "t" + item.id;

  let det = "";
  if (isShirt) {
    det += `<ellipse cx="110" cy="55" rx="20" ry="7" fill="${mid}" stroke="${ink}" stroke-width="1.5" opacity="0.55"/>`;
    if (item.subType === "sleeveless") {
      det += `<path d="M91 52 Q76 62 69 86" stroke="${ink}" stroke-width="1.3" opacity="0.28" fill="none"/>`;
      det += `<path d="M129 52 Q144 62 151 86" stroke="${ink}" stroke-width="1.3" opacity="0.28" fill="none"/>`;
    } else {
      det += `<path d="M88 52 L50 68" stroke="${ink}" stroke-width="1.4" opacity="0.26" fill="none"/>`;
      det += `<path d="M132 52 L170 68" stroke="${ink}" stroke-width="1.4" opacity="0.26" fill="none"/>`;
      det += `<path d="M152 108 Q151 120 152 132" stroke="${ink}" stroke-width="1.3" opacity="0.18" fill="none"/>`;
      det += `<path d="M68 108 Q69 120 68 132" stroke="${ink}" stroke-width="1.3" opacity="0.18" fill="none"/>`;
    }
    if (item.subType === "short_sleeve") {
      det += `<path d="M33 120 Q43 124 55 128" stroke="${ink}" stroke-width="1.8" opacity="0.32" fill="none"/>`;
      det += `<path d="M166 128 Q178 124 187 120" stroke="${ink}" stroke-width="1.8" opacity="0.32" fill="none"/>`;
    }
    if (item.subType === "long_sleeve") {
      det += `<path d="M192 142 Q189 150 186 158" stroke="${ink}" stroke-width="1.6" opacity="0.20" fill="none"/>`;
      det += `<path d="M28 142 Q31 150 34 158" stroke="${ink}" stroke-width="1.6" opacity="0.20" fill="none"/>`;
      det += `<path d="M166 208 L174 204" stroke="${ink}" stroke-width="2.2" opacity="0.38"/>`;
      det += `<path d="M44 208 L36 204" stroke="${ink}" stroke-width="2.2" opacity="0.38"/>`;
      det += `<path d="M163 212 L175 207" stroke="${ink}" stroke-width="1.1" opacity="0.22"/>`;
      det += `<path d="M45 212 L33 207" stroke="${ink}" stroke-width="1.1" opacity="0.22"/>`;
    }
    det += `<path d="M110 62 L110 232" stroke="${ink}" stroke-width="0.9" opacity="0.15"/>`;
    det += `<path d="M72 232 H148" stroke="${ink}" stroke-width="1.6" opacity="0.28"/>`;
    det += `<path d="M70 118 Q67 158 70 198" stroke="${ink}" stroke-width="3" opacity="0.07" fill="none"/>`;
    det += `<path d="M150 118 Q153 158 150 198" stroke="${ink}" stroke-width="3" opacity="0.07" fill="none"/>`;
  } else {
    const wl = item.subType === "wide" ? 58 : item.subType === "regular" ? 62 : 66;
    const wr = item.subType === "wide" ? 162 : item.subType === "regular" ? 158 : 154;
    const fly = item.subType === "wide" ? 128 : 124;
    const ky  = item.subType === "wide" ? 156 : 152;
    det += `<path d="M${wl} 44 H${wr}" stroke="${ink}" stroke-width="2.5" opacity="0.38"/>`;
    det += `<path d="M${wl+1} 58 H${wr-1}" stroke="${ink}" stroke-width="1.3" opacity="0.28"/>`;
    det += `<rect x="80"  y="44" width="5" height="15" rx="1" fill="${dark}" opacity="0.36"/>`;
    det += `<rect x="107" y="44" width="6" height="15" rx="1" fill="${dark}" opacity="0.36"/>`;
    det += `<rect x="135" y="44" width="5" height="15" rx="1" fill="${dark}" opacity="0.36"/>`;
    det += `<path d="M110 60 L110 ${fly}" stroke="${ink}" stroke-width="1.6" opacity="0.28"/>`;
    det += `<path d="M73 70 Q69 80 72 93" stroke="${ink}" stroke-width="1.3" opacity="0.22" fill="none"/>`;
    det += `<path d="M147 70 Q151 80 148 93" stroke="${ink}" stroke-width="1.3" opacity="0.22" fill="none"/>`;
    det += `<path d="M77 ${ky} Q86 ${ky+4} 96 ${ky}" stroke="${ink}" stroke-width="1.1" opacity="0.18" fill="none"/>`;
    det += `<path d="M124 ${ky} Q133 ${ky+4} 143 ${ky}" stroke="${ink}" stroke-width="1.1" opacity="0.18" fill="none"/>`;
    det += `<path d="M70 232 H97" stroke="${ink}" stroke-width="1.7" opacity="0.28"/>`;
    det += `<path d="M123 232 H150" stroke="${ink}" stroke-width="1.7" opacity="0.28"/>`;
  }

  return `<svg viewBox="0 0 220 260" role="img" aria-label="${item.name}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="gf${pid}" x1="0.15" y1="0" x2="0.38" y2="1">
        <stop offset="0%"   stop-color="${lite}"/>
        <stop offset="45%"  stop-color="${base}"/>
        <stop offset="100%" stop-color="${dark}"/>
      </linearGradient>
      <linearGradient id="hl${pid}" x1="0.05" y1="0" x2="0.9" y2="1">
        <stop offset="0%"   stop-color="#fff" stop-opacity="0.28"/>
        <stop offset="50%"  stop-color="#fff" stop-opacity="0.05"/>
        <stop offset="100%" stop-color="#000" stop-opacity="0.05"/>
      </linearGradient>
    </defs>
    <rect width="220" height="260" fill="#ffffff"/>
    <g style="filter:drop-shadow(0px 5px 14px rgba(0,0,0,0.13))">
      <path d="${d}" fill="url(#gf${pid})" stroke="${ink}" stroke-width="2" stroke-linejoin="round"/>
      <path d="${d}" fill="url(#hl${pid})"/>
    </g>
    ${det}
  </svg>`;
}

function garmentThumb(item) {
  const base = "display:block;width:100%;height:100%;overflow:hidden;";
  if (item.img) {
    return `<span style="${base}"><img src="${item.img}" alt="${item.name}" loading="lazy" decoding="async"></span>`;
  }
  return `<span style="${base}background:#f7f7f8;">${_garmentSVG(item)}</span>`;
}

/* =============================================================================
   helpers
   ============================================================================= */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function setConn(state) {
  const b = $("engineBadge");
  if (!b) return;
  b.classList.remove("live", "mock");
  b.style.color = "";
  if (state === "connected" || state === "generating") {
    b.classList.add("live");
    b.textContent = "● מחובר ל-API חי";
  } else if (state === "connecting" || state === "reconnecting") {
    b.style.color = "#d08a17";
    b.textContent = "● מתחבר…";
  } else if (state === "error" || state === "disconnected") {
    b.classList.add("mock");
    b.textContent = "● לא מחובר";
  } else {
    b.textContent = "●";
  }
}

let toastTimer;
/**
 * Show a transient toast message (auto-dismissed after TOAST_DURATION_MS).
 * @param {string} html Inner HTML for the toast (simple markup like <b> allowed).
 */
function toast(html) {
  const t = $("toast");
  t.innerHTML = html; t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), TOAST_DURATION_MS);
}

const COLOR_NAMES = [
  ["black", 0x111114], ["charcoal", 0x2b2b30], ["navy", 0x22324f], ["royal blue", 0x0b3c95],
  ["blue", 0x1f6feb], ["cobalt", 0x3b5bdb], ["teal", 0x149c7a], ["green", 0x566b3e],
  ["red", 0xc2452f], ["lavender", 0x8e7bd0], ["tan", 0xa8794f], ["grey", 0x8a8f98],
  ["light grey", 0xb8c0cc], ["slate blue", 0x3f5a8a], ["off-white", 0xd8d4cb], ["steel", 0x6e7681],
];
function colorName(hex) {
  const f = parseInt(hex.replace("#", ""), 16);
  const r = (f >> 16) & 255, g = (f >> 8) & 255, b = f & 255;
  let best = "neutral", bd = Infinity;
  for (const [name, c] of COLOR_NAMES) {
    const dr = ((c >> 16) & 255) - r, dg = ((c >> 8) & 255) - g, db = (c & 255) - b;
    const d = dr * dr + dg * dg + db * db;
    if (d < bd) { bd = d; best = name; }
  }
  return best;
}

/* =============================================================================
   wiring
   ============================================================================= */
/**
 * Bootstrap: wire form inputs (live recalc + Enter-to-proceed), navigation
 * buttons, catalog/swap delegation, and the page-lifecycle teardown listeners
 * that stop billing the moment the user leaves or hides the tab.
 * @returns {void}
 */
/* =============================================================================
   PEAR Live-Action Gallery — client-side "Live Photo" history (zero server cost)
   ─────────────────────────────────────────────────────────────────────────
   Each fit stores TWO things:
     • a tiny JPEG poster  → persisted to localStorage (survives reload)
     • the 5s VTON clip    → an in-memory object URL built from the SAME
                              MediaRecorder blob the Replay Zone already records
                              (see finalizeRecording). No second recorder, no
                              upload/download, so LIVE_DURATION_MS is untouched.
   Blob URLs can't be serialized, so on reload tiles gracefully fall back to the
   static poster (Apple Live Photos degrade the same way). Render is pure DOM.
   ============================================================================= */
const GALLERY_KEY = "pear_fit_gallery";
const GALLERY_MAX = 18;                 // poster cap — stays well under the localStorage quota
const CLIP_MAX = 12;                    // in-memory clip cap — bounds blob memory per session

const liveClips = new Map();            // ts → object URL of the 5s clip (this session only)
let lastFitTs = null;                   // ts of the entry awaiting its clip from finalizeRecording
const compareSel = new Set();           // ts of fits picked for the Compare overlay (max 2)
let activeClipTs = null;                // ts of the clip currently replaying in #aiVideo

const escHtml = (s) => String(s == null ? "" : s)
  .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function readGallery() {
  try { const a = JSON.parse(localStorage.getItem(GALLERY_KEY)); return Array.isArray(a) ? a : []; }
  catch (_) { return []; }
}
function writeGallery(arr) {
  try { localStorage.setItem(GALLERY_KEY, JSON.stringify(arr)); return true; }
  catch (_) {
    // quota exceeded → drop oldest entries until it fits
    while (arr.length > 1) {
      arr.shift();
      try { localStorage.setItem(GALLERY_KEY, JSON.stringify(arr)); return true; } catch (_) {}
    }
    return false;
  }
}

/* Revoke + forget a clip URL for a given timestamp (frees blob memory). */
function dropClip(ts) {
  const url = liveClips.get(ts);
  if (url) { try { URL.revokeObjectURL(url); } catch (_) {} liveClips.delete(ts); }
}

/* Grab the current dressed frame as a small JPEG data-URL (the poster). Prefers
   the live AI-edited stream; falls back to the (mirrored) raw webcam. Returns
   null if no frame is available — capture must never throw into teardown. */
function captureLiveFrame() {
  const ai = $("aiVideo");
  const webcam = $("webcam");
  let src = null, mirror = false, w = 0, h = 0;
  if (ai && ai.videoWidth > 0 && ai.style.display !== "none") {
    src = ai; w = ai.videoWidth; h = ai.videoHeight;            // already correctly oriented
  } else if (webcam && webcam.videoWidth > 0) {
    src = webcam; w = webcam.videoWidth; h = webcam.videoHeight; mirror = true;  // selfie-mirror
  }
  if (!src || !w || !h) return null;

  const maxW = 360;
  const scale = Math.min(1, maxW / w);
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const cnv = document.createElement("canvas");
  cnv.width = cw; cnv.height = ch;
  const ctx = cnv.getContext("2d");
  if (mirror) { ctx.translate(cw, 0); ctx.scale(-1, 1); }
  try { ctx.drawImage(src, 0, 0, cw, ch); } catch (_) { return null; }
  try { return cnv.toDataURL("image/jpeg", 0.7); } catch (_) { return null; }
}

/* Friendly name for the look currently being worn (full outfit when present). */
function currentLookName() {
  const look = resolveLook();
  if (look) return `${look.top.name} + ${look.bottom.name}`;
  return activeItem && activeItem.name ? activeItem.name : "Look";
}

/* Public helper: push a look (poster) into history + persist + re-render.
   Returns the new entry's ts so the recorder can attach its clip afterwards. */
function saveFitToGallery(imageSrc, garmentName, size, itemId) {
  if (!imageSrc) return null;
  const ts = Date.now();
  const arr = readGallery();
  // itemId lets the gallery modal's "Try again live" restore the exact garment
  // and open a fresh 5s session. null when the look isn't a single catalog item.
  arr.push({ img: imageSrc, name: garmentName || "Look", size: size || "—", ts,
             itemId: (itemId == null ? null : itemId) });
  while (arr.length > GALLERY_MAX) { const old = arr.shift(); dropClip(old.ts); }
  writeGallery(arr);
  renderGallery(arr);
  toast("👗 הלוק נשמר בגלריית המדידות");
  return ts;
}

/* Capture the poster + save the current live look. Wrapped by callers in
   try/catch so a capture failure can never delay billing teardown. The matching
   5s clip is attached later by finalizeRecording → attachClipToLastFit. */
function addFitFromLive() {
  const img = captureLiveFrame();
  if (!img) return;
  const size = activeTryOnSize || currentUserSize || "—";
  lastFitTs = saveFitToGallery(img, currentLookName(), size);
}

/* Reuse the Replay Zone's recorded Blob as the gallery's Live Photo. We mint a
   SEPARATE object URL so clearRecording()'s revoke of recordedUrl can't break it. */
function attachClipToLastFit(blob) {
  if (lastFitTs == null || !blob || !blob.size) { lastFitTs = null; return; }
  let url = null;
  try { url = URL.createObjectURL(blob); } catch (_) { lastFitTs = null; return; }
  liveClips.set(lastFitTs, url);
  // bound in-memory clips: revoke the oldest beyond CLIP_MAX
  while (liveClips.size > CLIP_MAX) dropClip(liveClips.keys().next().value);
  lastFitTs = null;
  renderGallery();                       // upgrade the just-saved tile: poster → Live Photo
}

/* Build the swipe tray (newest first) and toggle the pod visibility. Tiles with
   a live clip render an autoplay-on-hover <video>; the rest show the poster. */
function renderGallery(arr) {
  const pod = $("pearGallery"), track = $("galleryTrack");
  if (!pod || !track) return;
  const data = arr || readGallery();
  if (!data.length) { track.innerHTML = ""; pod.hidden = true; return; }
  pod.hidden = false;
  track.innerHTML = data.map((it, idx) => ({ it, idx })).reverse().map(({ it, idx }, i) => {
    const clip = liveClips.get(it.ts);
    // Live Photo tiles autoplay-loop like animated badges; poster-only tiles
    // (after a reload, when the in-memory clip is gone) fall back to the image.
    const media = clip
      ? `<video class="lgi-video" src="${clip}" poster="${it.img}" autoplay loop muted playsinline preload="auto"></video>`
      : `<img src="${it.img}" alt="${escHtml(it.name)} ${escHtml(it.size)}" loading="lazy">`;
    const cls = "live-gallery-item" + (clip ? " has-clip" : "") +
      (it.ts === activeClipTs ? " is-playing" : "") + (compareSel.has(it.ts) ? " is-selected" : "");
    return `<button class="${cls}" type="button" data-idx="${idx}" data-ts="${it.ts}"${clip ? ` data-video-src="${clip}"` : ""} style="--gi:${i}">
       <span class="live-gallery-item__media">${media}</span>
       <span class="lgi-select" role="checkbox" aria-checked="${compareSel.has(it.ts)}" title="בחר להשוואה">✓</span>
       <span class="live-gallery-item__badge">
         <span class="live-gallery-item__name">${escHtml(it.name)}</span>
         <span class="live-gallery-item__size">${escHtml(it.size)}</span>
       </span>
     </button>`;
  }).join("");

  // reconcile selection with the freshly built DOM: drop picks that no longer exist
  [...compareSel].forEach((ts) => { if (!data.some((d) => d.ts === ts)) compareSel.delete(ts); });
  syncCompareUI();
}

/* Toggle whether the tile's clip is playing-highlighted (no re-render → no flash). */
function markActiveTile() {
  document.querySelectorAll(".live-gallery-item").forEach((el) =>
    el.classList.toggle("is-playing", Number(el.dataset.ts) === activeClipTs));
}

/* Compare selection (max two). Updates tile state + the floating Compare pill. */
function toggleCompareSelect(ts) {
  if (compareSel.has(ts)) compareSel.delete(ts);
  else if (compareSel.size >= 2) { toast("ניתן להשוות שתי מדידות בלבד"); return; }
  else compareSel.add(ts);
  syncCompareUI();
  // Open the split-screen comparison the instant a 2nd look is picked — no extra
  // tap on the "Compare" pill (which now just acts as a re-open affordance).
  if (compareSel.size === 2) openCompareOverlay();
}
function syncCompareUI() {
  document.querySelectorAll(".live-gallery-item").forEach((el) => {
    const on = compareSel.has(Number(el.dataset.ts));
    el.classList.toggle("is-selected", on);
    const sb = el.querySelector(".lgi-select");
    if (sb) sb.setAttribute("aria-checked", on ? "true" : "false");
  });
  const bar = $("compareBar");
  if (bar) bar.hidden = compareSel.size !== 2;
}

/* Build + reveal the side-by-side Compare overlay from the two selected fits. */
function openCompareOverlay() {
  const data = readGallery();
  const picks = [...compareSel].map((ts) => data.find((d) => d.ts === ts)).filter(Boolean);
  if (picks.length !== 2) return;
  const split = $("compareSplit"), ov = $("pearCompare");
  if (!split || !ov) return;
  split.innerHTML = picks.map((it) => {
    const clip = liveClips.get(it.ts);
    const media = clip
      ? `<video src="${clip}" autoplay loop muted playsinline></video>`
      : `<img src="${it.img}" alt="${escHtml(it.name)}">`;
    return `<div class="pcmp__cell">
       <div class="pcmp__media">${media}</div>
       <div class="pcmp__label"><b>${escHtml(it.name)}</b><span class="pcmp__size">${escHtml(it.size)}</span></div>
     </div>`;
  }).join("");
  ov.hidden = false;
  requestAnimationFrame(() => ov.classList.add("show"));
}
function closeCompare() {
  const ov = $("pearCompare");
  if (!ov || ov.hidden) return;
  ov.classList.remove("show");
  ov.hidden = true;
  const split = $("compareSplit");
  if (split) split.innerHTML = "";        // stop the two playing clips
}

/* Render function: read persisted history on init and build the DOM. */
function loadGallery() { renderGallery(readGallery()); }

function clearGallery() {
  liveClips.forEach((url) => { try { URL.revokeObjectURL(url); } catch (_) {} });
  liveClips.clear();
  compareSel.clear();
  activeClipTs = null;
  const bar = $("compareBar"); if (bar) bar.hidden = true;
  try { localStorage.removeItem(GALLERY_KEY); } catch (_) {}
  renderGallery([]);
  toast("גלריית המדידות נוקתה");
}

/* Leave the clip-replay view: pause + detach the history clip from #aiVideo and
   drop the .show-clip state so the CSS state classes govern the camera again. */
function exitClipReplay() {
  const ai = $("aiVideo");
  if (ai && ai.getAttribute("src")) {
    try { ai.pause(); } catch (_) {}
    ai.removeAttribute("src");
    try { ai.load(); } catch (_) {}
  }
  card().classList.remove("show-clip");
  activeClipTs = null;
  markActiveTile();
}

/* Inter-capsule replay: load a history clip into the MAIN top player (#aiVideo)
   and loop it. Refuses to hijack a paid live session. Poster-only items (no clip
   after reload) fall back to the lightbox image. */
function playClipInMainPlayer(url, idx, ts) {
  if (isLive()) { toast("עצור מדידה חיה כדי לצפות בהיסטוריה"); return; }
  const ai = $("aiVideo");
  if (!ai || !url) { if (idx != null) openFitLightbox(idx); return; }

  resetToLive();                       // clean any frozen result / stale replay first (clears activeClipTs)
  ai.srcObject = null;                 // detach any (dead) WebRTC stream
  ai.src = url;
  ai.loop = true; ai.muted = true; ai.playsInline = true;
  card().classList.remove("show-result");
  card().classList.add("show-clip");   // CSS reveals #aiVideo without live billing semantics
  ai.play().catch(() => {});

  activeClipTs = (ts == null ? null : ts);   // glow the source tile in the tray
  markActiveTile();

  const cc = $("cameraCard");
  if (cc) cc.scrollIntoView({ behavior: "smooth", block: "center" });
  toast("▶ מציג מדידה קודמת");
}

/* The fit currently open in the large modal (so the delegated action buttons
   know which history entry they act on). */
let lightboxIt = null;

/* Close the large fit modal: stop any inline clip + forget the open entry. */
function closeFitLightbox() {
  const lb = $("pearLightbox");
  if (!lb) return;
  lb.classList.remove("show");
  const stage = lb.querySelector(".pear-lightbox__stage");
  if (stage) stage.innerHTML = "";     // stop any playing clip on close
  lightboxIt = null;
}

/* Tap a history card → the large interactive modal (Image 1 layout): the saved
   high-quality snapshot/clip, garment name, size badge, and the action row:
     • צפה שוב · Replay      — loop the saved clip for FREE (zero tokens)
     • מדוד שוב · Try again live — restore the garment + open a fresh 5s session
     • הורד · Download       — save the recorded clip (only when one exists) */
function openFitLightbox(idx) {
  const it = readGallery()[idx];
  if (!it) return;
  lightboxIt = it;
  let lb = $("pearLightbox");
  if (!lb) {
    lb = document.createElement("div");
    lb.id = "pearLightbox";
    lb.className = "pear-lightbox";
    lb.innerHTML =
      `<div class="pear-lightbox__backdrop" data-lb-close></div>` +
      `<figure class="pear-lightbox__fig">` +
        `<button class="pear-lightbox__close" type="button" aria-label="סגור" data-lb-close>×</button>` +
        `<div class="pear-lightbox__stage"></div>` +
        `<figcaption class="pear-lightbox__cap">` +
          `<span class="pear-lightbox__name"></span>` +
          `<span class="pear-lightbox__size"></span>` +
        `</figcaption>` +
        `<div class="pear-lightbox__actions">` +
          `<button class="plb-btn plb-btn--replay" type="button" data-lb-replay hidden>` +
            `<span class="plb-btn__icon" aria-hidden="true">↺</span><span>צפה שוב</span><span class="plb-btn__en">Replay</span></button>` +
          `<button class="plb-btn plb-btn--live" type="button" data-lb-live>` +
            `<span class="plb-btn__icon" aria-hidden="true">▶</span><span>מדוד שוב</span><span class="plb-btn__en">Try again live</span></button>` +
          `<a class="plb-btn plb-btn--dl" data-lb-dl hidden download>` +
            `<span class="plb-btn__icon" aria-hidden="true">⤓</span><span>הורד</span><span class="plb-btn__en">Download</span></a>` +
        `</div>` +
      `</figure>`;
    document.body.appendChild(lb);
    lb.addEventListener("click", (e) => {
      if (e.target.closest("[data-lb-close]"))  { closeFitLightbox(); return; }
      if (e.target.closest("[data-lb-replay]")) {
        // FREE replay — loop the saved clip in the main player, then close the modal.
        const cur = lightboxIt; const url = cur ? liveClips.get(cur.ts) : null;
        if (url) { closeFitLightbox(); playClipInMainPlayer(url, readGallery().findIndex((g) => g.ts === cur.ts), cur.ts); }
        return;
      }
      if (e.target.closest("[data-lb-live]"))   { const cur = lightboxIt; closeFitLightbox(); replayFitLive(cur); return; }
      // [data-lb-dl] is a plain <a download> — let the browser handle it.
    });
  }
  const clip = liveClips.get(it.ts);
  lb.querySelector(".pear-lightbox__stage").innerHTML = clip
    ? `<video class="pear-lightbox__video" src="${clip}" autoplay loop muted playsinline controls></video>`
    : `<img class="pear-lightbox__img" src="${it.img}" alt="${escHtml(it.name)}">`;
  lb.querySelector(".pear-lightbox__name").textContent = it.name;
  lb.querySelector(".pear-lightbox__size").textContent = it.size;

  // Replay + Download only make sense when the in-memory clip still exists
  // (it's gone after a reload — posters survive, blobs don't).
  const replayBtn = lb.querySelector("[data-lb-replay]");
  if (replayBtn) replayBtn.hidden = !clip;
  const dlBtn = lb.querySelector("[data-lb-dl]");
  if (dlBtn) {
    if (clip) {
      dlBtn.hidden = false; dlBtn.href = clip;
      dlBtn.download = `PEAR-fit-${it.ts}.${(recorderMime && recorderMime.includes("mp4")) ? "mp4" : "webm"}`;
      if (IS_MOBILE) dlBtn.target = "_blank";
    } else { dlBtn.hidden = true; dlBtn.removeAttribute("href"); }
  }
  lb.classList.add("show");
}

/* "Try again live" — restore the exact garment this fit was captured with (when
   still in the catalog) and open a fresh, optimized 5-second live session. */
function replayFitLive(it) {
  if (isLive()) { toast("עצור מדידה חיה כדי להתחיל מחדש"); return; }
  if (it && it.itemId != null) {
    const p = PEAR_CATALOG.find((x) => x.id === it.itemId);
    if (p) setActiveItem(toItem(p));               // sets active garment + resets to live standby
  }
  if (!activeItem) { toast("בחר בגד מהקטלוג כדי למדוד שוב"); return; }
  const cc = $("cameraCard");
  if (cc) cc.scrollIntoView({ behavior: "smooth", block: "center" });
  goLive();                                         // fresh 5s WebRTC try-on (billing starts here)
}

/* Retake — stop a running session (auto-saving the look) or clear a frozen
   result, then return to the live-camera standby. */
function onRetake() {
  if (isLive()) stopLive();
  else resetToLive();
  const cc = $("cameraCard");
  if (cc) cc.scrollIntoView({ behavior: "smooth", block: "center" });
}

function init() {
  injectReplayStyles();
  updateProgress();

  const handoff = parseHandoff();
  console.group("[PEAR] init() — fitting room startup");
  console.log("mode    :", handoff ? `focus (garment: ${handoff.name})` : "catalog (no garment in URL)");
  console.log("SDK URLs:", CONFIG.SDK_URLS);
  console.log("token @ :", CONFIG.TOKEN_ENDPOINT, "| health @:", CONFIG.HEALTH_ENDPOINT);
  if (handoff) {
    console.log("garment :", handoff.name, "| type:", handoff.type, "| subType:", handoff.subType);
    console.log("color   :", handoff.color, "| img:", handoff.img ? handoff.img.slice(0, 60) + "…" : "(none)");
  }
  console.groupEnd();

  if (handoff) {
    const hint = $("focusCalcHint");
    if (hint) { hint.hidden = false; hint.innerHTML = `נבחר הפריט <strong>${handoff.name}</strong> — מלא מידות כדי להמשיך למדידה הוירטואלית.`; }
  }

  document.querySelectorAll("#sizeForm input").forEach((i) => {
    i.addEventListener("input", calculateSize);
    i.addEventListener("keydown", onMeasurementKeydown);   // Task 5 — Enter to proceed
  });
  $("btn-next-screen").addEventListener("click", goToFitting);
  $("btn-back").addEventListener("click", backToCalculator);

  $("startCamBtn").addEventListener("click", () => startCamera());
  $("captureBtn").addEventListener("click", onLiveToggle);
  $("retakeBtn").addEventListener("click", onRetake);

  // PEAR Live-Action Gallery — render persisted looks + wire tray/clear/retake
  loadGallery();
  const galleryTrack = $("galleryTrack");
  if (galleryTrack) {
    galleryTrack.addEventListener("click", (e) => {
      // the corner select toggle (Compare mode) takes priority over replay
      const selBtn = e.target.closest(".lgi-select");
      if (selBtn) {
        e.preventDefault();
        const host = selBtn.closest(".live-gallery-item");
        if (host) toggleCompareSelect(Number(host.dataset.ts));
        return;
      }
      const item = e.target.closest(".live-gallery-item");
      if (!item) return;
      const idx = Number(item.dataset.idx);
      // Always open the large interactive modal (Image 1): snapshot/clip + name +
      // size badge + Replay (free) / Try again live / Download. The modal's own
      // buttons drive the free clip replay and the fresh live session.
      openFitLightbox(idx);
    });
  }
  const galleryClear = $("galleryClear");
  if (galleryClear) galleryClear.addEventListener("click", clearGallery);

  // Compare mode — open the split-screen overlay; close via ✕ / backdrop / Esc
  const compareBar = $("compareBar");
  if (compareBar) compareBar.addEventListener("click", openCompareOverlay);
  const compareOverlay = $("pearCompare");
  if (compareOverlay) compareOverlay.addEventListener("click", (e) => {
    if (e.target.closest("[data-compare-close]")) closeCompare();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeCompare(); closeFitLightbox(); } });

  document.addEventListener("click", (e) => {
    // "Add to Look" (הוסף ללוק) — drop this recommendation into its slot beside the
    // active garment (additive; keeps the opposite category). toItem() rebuilds the
    // full record from the catalog so image URL, metadata AND category (garmentType →
    // top|bottom) are always extracted, regardless of where on the card the user tapped.
    const lk = e.target.closest("[data-look]");
    if (lk) {
      const p = PEAR_CATALOG.find((x) => x.id === Number(lk.dataset.look));
      if (p) addToLook(toItem(p));
      return;
    }
    const pk = e.target.closest("[data-pick]");
    if (pk) {
      const p = PEAR_CATALOG.find((x) => x.id === Number(pk.dataset.pick));
      if (p) { setActiveItem(toItem(p)); $("cameraCard").scrollIntoView({ behavior: "smooth", block: "center" }); }
      return;
    }
  });

  // Terminate the Decart WebRTC session the moment the user leaves or hides the
  // page so billing stops immediately instead of running until TTL expiry.
  // beforeunload/pagehide: page is dying → bare teardown (disconnect) is enough.
  // visibilitychange→hidden: page may return → stopLive() also resets the UI.
  window.addEventListener("beforeunload", teardown);
  window.addEventListener("pagehide", teardown);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") stopLive();
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();

/* ════════════════════════════════════════════════════════════════════════
   UI ONLY — subtle 3D parallax tilt on the Screen-1 size card.
   Purely decorative; does not touch the try-on flow, tokens, or live window.
   Tracks the pointer across #screen-calculator .container and maps it to a
   gentle rotateX/rotateY, resetting smoothly on leave / touchend. Disabled
   for touch-primary devices and when the user prefers reduced motion.
   ════════════════════════════════════════════════════════════════════════ */
(function initCardTilt() {
  const start = () => {
    const card = document.querySelector("#screen-calculator .container");
    if (!card) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(hover: none), (pointer: coarse)").matches;
    if (reduce || coarse) return;

    const MAX = 6; // degrees of tilt at the card edges
    let raf = 0;

    const reset = () => {
      cancelAnimationFrame(raf);
      card.classList.remove("is-tilting");
      card.style.transform = "";
    };

    card.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = card.getBoundingClientRect();
        const fx = (e.clientX - r.left) / r.width;   // 0 … 1
        const fy = (e.clientY - r.top) / r.height;   // 0 … 1
        const px = fx - 0.5;                          // -0.5 … 0.5
        const py = fy - 0.5;
        const rotX = (-py * MAX).toFixed(2);
        const rotY = (px * MAX).toFixed(2);
        card.classList.add("is-tilting");
        // 3D parallax tilt
        card.style.transform =
          `perspective(1200px) rotateX(${rotX}deg) rotateY(${rotY}deg) translateY(-2px)`;
        // environment mapping: move the specular highlight to the cursor
        card.style.setProperty("--mx", (fx * 100).toFixed(1) + "%");
        card.style.setProperty("--my", (fy * 100).toFixed(1) + "%");
      });
    });
    card.addEventListener("pointerleave", reset);
    card.addEventListener("touchend", reset, { passive: true });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();