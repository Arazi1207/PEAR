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
  LIVE_DURATION_MS,        // STRICT 5s live window — value owned by config.js
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

    // (1) playoutDelayHint — zero the anti-jitter buffer on the remote VIDEO
    //     receiver the instant its track arrives. Chromium-only; the `in` guard
    //     makes it a silent no-op on Firefox/Safari.
    pc.addEventListener("track", (e) => {
      try {
        const r = e.receiver;
        if (r && "playoutDelayHint" in r && e.track && e.track.kind === "video") {
          r.playoutDelayHint = PLAYOUT_DELAY_HINT;
        }
      } catch (_) {}
    });

    // (2) optional SDP codec-preference munge — OFF by default (see config.js).
    if (PREFER_LOW_LATENCY_CODEC) {
      const origSetLocal = pc.setLocalDescription.bind(pc);
      pc.setLocalDescription = function (desc) {
        if (desc && desc.sdp) {
          try { desc = { type: desc.type, sdp: mungeSdpPreferCodec(desc.sdp) }; } catch (_) {}
        }
        return origSetLocal(desc);
      };
    }

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
  { id: 1,  name: "Halo Tank",         price: 88,  type: "shirt", subType: "sleeveless",   color: "#3f5a8a", img: "https://live.staticflickr.com/8726/17084787712_8905988312_b.jpg" },
  { id: 2,  name: "Vapor Sleeveless",  price: 72,  type: "shirt", subType: "sleeveless",   color: "#b8c0cc", img: "https://burst.shopifycdn.com/photos/grey-t-shirt.jpg" },
  { id: 3,  name: "Ion Crew Tee",      price: 96,  type: "shirt", subType: "short_sleeve", color: "#c2452f", img: "https://burst.shopifycdn.com/photos/red-t-shirt.jpg" },
  { id: 4,  name: "Pulse Tee",         price: 84,  type: "shirt", subType: "short_sleeve", color: "#1f6feb", img: "https://burst.shopifycdn.com/photos/cobalt-blue-t-shirt.jpg" },
  { id: 5,  name: "Circuit Tee",       price: 90,  type: "shirt", subType: "short_sleeve", color: "#149c7a", img: "https://burst.shopifycdn.com/photos/teal-t-shirt.jpg" },
  { id: 6,  name: "Strata Longsleeve", price: 128, type: "shirt", subType: "long_sleeve",  color: "#2b2b30", img: "https://www.universalcolours.com/cdn/shop/files/LongSleeveTee-CharcoalBlack-1.jpg?v=1732626199&width=1024" },
  { id: 7,  name: "Nimbus Henley",     price: 134, type: "shirt", subType: "long_sleeve",  color: "#8e7bd0", img: "https://cdn.shopify.com/s/files/1/0831/9103/products/DK_LS_Henley_Dark_Purple-Final-Web.jpg?v=1665703111" },
  { id: 8,  name: "Echo Longsleeve",   price: 118, type: "shirt", subType: "long_sleeve",  color: "#d8d4cb", img: "https://img.magnific.com/premium-photo/beige-long-sleeve-shirt-isolated-white-background_1166140-13287.jpg" },
  { id: 9,  name: "Glide Slim",        price: 142, type: "pants", subType: "slim",    color: "#2a2d34", img: "https://cdn.suitsupply.com/image/upload/b_rgb:efefef,bo_500px_solid_rgb:efefef,c_pad,w_2600/b_rgb:efefef,c_pad,dpr_1,w_850,h_1176,f_auto,q_auto,fl_progressive/products/Trousers/default/B6905_28.jpg" },
  { id: 10, name: "Mono Slim",         price: 118, type: "pants", subType: "slim",    color: "#6e7681", img: "https://cdn.suitsupply.com/image/upload/b_rgb:efefef,bo_500px_solid_rgb:efefef,c_pad,w_2600/b_rgb:efefef,c_pad,dpr_1,w_850,h_1176,f_auto,q_auto,fl_progressive/products/Trousers/default/B6906_28.jpg" },
  { id: 11, name: "Vector Regular",    price: 132, type: "pants", subType: "regular", color: "#3b5bdb", img: "https://image.hm.com/assets/hm/54/71/5471b01a9ccf7562c74cf7d8f0102228465f30b5.jpg?imwidth=2160" },
  { id: 12, name: "Apex Regular",      price: 124, type: "pants", subType: "regular", color: "#8a8f98", img: "https://image.hm.com/assets/hm/72/56/7256f227cb82ac834363dfb140f245652797d841.jpg?imwidth=1536" },
  { id: 13, name: "Drift Wide",        price: 156, type: "pants", subType: "wide",    color: "#1a1a1d", img: "https://cdn.suitsupply.com/image/upload/b_rgb:efefef,bo_300px_solid_rgb:efefef,c_pad,w_2600/b_rgb:efefef,c_pad,dpr_1,w_768,h_922,f_auto,q_auto,fl_progressive/products/Trousers/default/B25209_28.jpg" },
  { id: 14, name: "Terra Wide",        price: 148, type: "pants", subType: "wide",    color: "#a8794f", img: "https://cdn.suitsupply.com/image/upload/b_rgb:efefef,bo_500px_solid_rgb:efefef,c_pad,w_2600/b_rgb:efefef,c_pad,dpr_1,w_850,h_1176,f_auto,q_auto,fl_progressive/products/Trousers/default/B25212_28.jpg" },
  { id: 15, name: "Null Slim",         price: 138, type: "pants", subType: "slim",    color: "#22324f", img: "https://cdn.suitsupply.com/image/upload/b_rgb:efefef,bo_500px_solid_rgb:efefef,c_pad,w_2600/b_rgb:efefef,c_pad,dpr_1,w_850,h_1176,f_auto,q_auto,fl_progressive/products/Trousers/default/B9449_28.jpg" },
  { id: 16, name: "Cargo Wide",        price: 162, type: "pants", subType: "wide",    color: "#566b3e", img: "https://image.hm.com/assets/hm/31/ab/31ab5b52cc238aaad4d95fa3a79d2af741bf7192.jpg?imwidth=1536" },
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
let liveTimer = null;
/* LIVE_DURATION_MS (the strict 5s window) is imported from config.js above. */

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

/* Feature 1 — live countdown timer interval handle (top-left of the camera). */
let liveCountdownTimer = null;

/* Feature 2 — MediaRecorder capture of the REMOTE Lucy-VTON output.
   We do NOT record the raw remote WebRTC track directly (Chromium often encodes
   a remote track as a black frame) nor the local camera. Instead we mirror the
   on-screen remote frames (#aiVideo) onto a canvas and record canvas.captureStream
   — guaranteeing real, encoded pixels in the downloaded clip. Video-only. */
let mediaRecorder = null;
let recordedChunks = [];
let recordedUrl = null;
let replayUrl = null;        // "Watch Again": same blob-backed URL, cached for unlimited local replay (no network/billing)
let recordedBlob = null;     // the finalized clip Blob — kept so we can build a File for the share sheet
let recorderMime = null;     // the container/codec MediaRecorder actually negotiated (mp4 vs webm)
let recordCanvas = null;     // off-DOM canvas mirroring the remote VTON frames
let recordRaf = 0;           // requestAnimationFrame handle for the paint loop
let recordingActive = false; // guards the paint loop + single-start per session

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

/* Task 6 — conditional input flow: the optional fields stay hidden until BOTH
   mandatory fields (height + weight) hold sane, in-range values. */
function setOptionalVisible(show) {
  const box = $("optionalFields");
  if (!box) return;
  if (show === !box.hidden) return;           // no-op if already in desired state
  box.hidden = !show;
  if (!show) {
    // collapsing → clear any optional values so a stale entry can't skew the result
    ["chest", "waist", "legs"].forEach((id) => { if ($(id)) $(id).value = ""; });
  } else {
    box.classList.add("reveal");
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

  resultBox.classList.remove("show", "error-result");
  resultLabel.innerText = "המידה המומלצת עבורך:";
  nextBtn.disabled = true;
  currentUserSize = null;
  updateProgress();

  if (!height || !weight) return;

  if (height > 240 || height < 130 || weight > 220 || weight < 35) {
    resultLabel.innerText = "שגיאה בנתונים:";
    sizeResult.innerText = "נתונים לא הגיוניים";
    resultBox.classList.add("show", "error-result");
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
    resultLabel.innerText = "תוצאה:";
    sizeResult.innerText = "מידה מחוץ לטווח";
    resultBox.classList.add("show");
  } else {
    sizeResult.innerText = bestSize;
    resultBox.classList.add("show");
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
    .filter((el) => el.offsetParent !== null);   // visible (non-hidden) inputs only
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
  if (!type) return null;

  const color = q.get("color") ? "#" + q.get("color").replace(/^#/, "") : (fromCatalog ? fromCatalog.color : "#0B3C95");
  return {
    id: isNaN(id) ? null : id,
    name: q.get("name") || (fromCatalog ? fromCatalog.name : "Garment"),
    type,
    subType: q.get("subType") || (fromCatalog ? fromCatalog.subType : (type === "pants" ? "regular" : "short_sleeve")),
    color,
    img: q.get("img") || (fromCatalog ? fromCatalog.img : ""),
  };
}

function toItem(raw) {
  return { ...raw, garmentType: raw.type === "pants" ? "lower_body" : "upper_body" };
}

/* =============================================================================
   Screen transition
   ============================================================================= */
function goToFitting() {
  $("final-size-text").innerText = currentUserSize || "";
  $("screen-calculator").classList.remove("active");
  $("screen-fitting").classList.add("active");
  window.scrollTo(0, 0);
  enterRoom();
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
async function startCamera() {
  if (localStream) return true;
  if (cameraStartPromise) return cameraStartPromise;   // a request is already in flight

  cameraStartPromise = (async () => {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 720 },
          height: { ideal: 960 },
          frameRate: { ideal: 30, max: 30 },   // match Lucy-VTON's 30fps target — no capture-side cadence mismatch
        },
        audio: false,
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
  card().classList.remove("show-result");
  $("scanOverlay").hidden = true;
  $("retakeBtn").hidden = true;
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
  let resp;
  try {
    resp = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    throw new Error("לא ניתן להגיע לשרת הטוקנים (" + (e?.message || e) + ")");
  }

  let data = {};
  try { data = await resp.json(); } catch (_) {}

  if (!resp.ok || data.error) {
    const detail = data.message || data.error || `HTTP ${resp.status}`;
    throw new Error("מינטינג טוקן נכשל: " + detail);
  }
  if (!data.apiKey) throw new Error("השרת לא החזיר טוקן ek_ תקין.");
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

  try {
    /* ── load SDK ─────────────────────────────────────────────────────────── */
    const { createDecartClient } = await loadSDK();

    /* ── mint a short-lived ek_ token from the secure proxy (only now, never on
          page load) — the permanent dct_ key stays server-side ─────────────── */
    const ekToken = await mintEphemeralToken();

    // A teardown may have fired while we were awaiting the SDK/token — abort.
    if (gen !== sessionGen) return;

    /* ── create client with the ephemeral token ───────────────────────────── */
    const client = createDecartClient({ apiKey: ekToken });

    /* Bug 3 fix: hand the SDK a CLONE of the camera tracks. The realtime SDK
       (LiveKit under the hood) stops the tracks it publishes when the session
       disconnects; cloning means it stops its OWN copies, leaving localStream
       (our persistent preview) alive and reusable for the next try-on. */
    realtimeInput = new MediaStream(localStream.getTracks().map((t) => t.clone()));

    /* ── connect realtime ─────────────────────────────────────────────────── */
    // FIX: model passed as a plain string, NOT via models.realtime()
    rtClient = await client.realtime.connect(realtimeInput, {
      model: {
        name: "lucy-vton-latest",
        urlPath: "/v1/stream",
        fps: { ideal: 30, max: 30 },
        width: 1088,
        height: 624,
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
      console.error("Decart realtime error:", err);
      showCamError("שגיאת Decart: " + (err?.message || err));
    });

    connState = (rtClient.getConnectionState && rtClient.getConnectionState()) || "connected";
    setConn(connState);

  } finally {
    connecting = false;
  }
}

/**
 * Single teardown that kills the server-side Decart session immediately so
 * billing stops at once (rather than running until token TTL expiry). Called by
 * autoStopAndFreeze/stopLive and on beforeunload, pagehide, and visibilitychange.
 * @returns {void}
 */
function teardown() {
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

async function applyGarment(item) {
  if (!rtClient) throw new Error("not connected");
  const payload = { prompt: buildPrompt(item), enhance: false };
  if (item.img) payload.image = item.img;
  await rtClient.set(payload);
}

function buildPrompt(item) {
  const colorWord = colorName(item.color);
  const sub = SUBTYPE_PROMPT[item.subType] || "";
  if (item.garmentType === "lower_body") {
    return `Substitute the current bottoms with ${colorWord} ${sub} trousers, realistic fabric, natural drape and a true-to-life fit.`.replace(/\s+/g, " ").trim();
  }
  const noun = SHIRT_NOUN[item.subType] || "top";
  return `Substitute the current top with a ${colorWord} ${sub} ${noun}, realistic fabric, natural drape and a true-to-life fit.`.replace(/\s+/g, " ").trim();
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
  const images = [top.img, bottom.img].filter(Boolean);   // both verified URLs

  // ONE combined payload — both garments, one pass, same session.
  const payload = {
    prompt,
    enhance: false,
    image: images[0],                 // SDK single-image reference (the top)
    images,                           // both verified URLs, bundled together
    garments: [                       // per-slot metadata incl. category (top|bottom)
      { category: "top",    type: top.garmentType,    image: top.img,    color: top.color,    subType: top.subType,    name: top.name },
      { category: "bottom", type: bottom.garmentType, image: bottom.img, color: bottom.color, subType: bottom.subType, name: bottom.name },
    ],
  };

  try {
    await rtClient.set(payload);
  } catch (e) {
    // A stricter SDK build could reject the enriched shape — retry with the minimal
    // documented contract so a full look never breaks the live session.
    console.warn("look payload rejected, retrying minimal:", e?.message || e);
    await rtClient.set({ prompt, image: images[0], enhance: false });
  }
}

/**
 * Build ONE prompt that instructs the model to overlay the shirt AND the pants
 * simultaneously (a single pass), so a full outfit is rendered together rather
 * than as two separate substitutions.
 */
function buildLookPrompt(top, bottom) {
  const tColor = colorName(top.color), tSub = SUBTYPE_PROMPT[top.subType] || "";
  const tNoun = SHIRT_NOUN[top.subType] || "top";
  const bColor = colorName(bottom.color), bSub = SUBTYPE_PROMPT[bottom.subType] || "";
  return `Dress the person in one complete outfit in a single pass: replace the top with a ${tColor} ${tSub} ${tNoun} and at the same time replace the bottoms with ${bColor} ${bSub} trousers. Render both garments together with realistic fabric, natural drape and a true-to-life fit.`
    .replace(/\s+/g, " ").trim();
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
 * AI-edited video so the garment warps/tracks the user dynamically. A STRICT
 * 5-second timer (LIVE_DURATION_MS) then auto-disconnects so no tokens are spent
 * beyond the window. Switching items mid-window reuses this session via set().
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
  clearRecording();                    // Feature 2 — drop any previous clip + button

  try {
    // Task 2 — graceful pre-use internet check, BEFORE opening any billable session.
    const online = await ensureOnline();
    if (!online) {
      showCamError("נראה שאין חיבור אינטרנט יציב כרגע. בדוק את הרשת ונסה שוב — המדידה החיה מתבצעת בזמן אמת ודורשת חיבור.");
      toast("אין חיבור אינטרנט — בדוק את הרשת ונסה שוב");
      return;                          // finally releases busy + re-enables the button
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

    // 3) reveal the live edited feed (onRemoteStream also reveals it as frames arrive)
    $("scanOverlay").hidden = true;
    card().classList.add("show-live");
    setLiveControls(true);
    toast("✨ מדידה חיה — 5 שניות");

    // 4) STRICT 5s lifecycle: auto-teardown the instant the window elapses
    clearTimeout(liveTimer);
    liveTimer = setTimeout(autoStopAndFreeze, LIVE_DURATION_MS);
    startLiveCountdown();              // Feature 1 — visual 5→1 countdown, top-left
    startRecording();                 // Feature 2 — record the remote VTON output now
  } catch (err) {
    stopLive();                        // close any partial session — no idle billing
    console.error("go-live failed:", err);
    if (DEMO_FLAG) {
      await renderMockDemo(activeItem);
      card().classList.add("show-result");
      $("retakeBtn").hidden = false;
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
 * Fires exactly LIVE_DURATION_MS (5s) after the garment is applied. Freezes the
 * final live frame so the result persists, then hard-stops the session via
 * teardown() so zero extra tokens are consumed. This is the strict 5s lifecycle.
 * @returns {void}
 */
function autoStopAndFreeze() {
  clearTimeout(liveTimer);
  liveTimer = null;
  stopLiveCountdown();                 // Feature 1 — hide the countdown badge
  stopRecording();                     // Feature 2 — force-stop the clip at EXACTLY 5s
  const frozen = freezeFrom($("aiVideo"), { mirror: false });
  teardown();                          // rtClient.disconnect() → billing stops now
  card().classList.remove("show-live");
  if (frozen) {
    card().classList.add("show-result");
    $("retakeBtn").hidden = false;
  }
  setLiveControls(false);
  $("captureBtn").disabled = !localStream;
  toast("✨ הוקפאה לאחר 5 שניות — נחסכו טוקנים");
}

/**
 * Manual/early hard-stop (Stop button or tab hidden). Cancels the 5s timer and
 * disconnects immediately so billing stops the instant it's called.
 * @returns {void}
 */
function stopLive() {
  clearTimeout(liveTimer);
  liveTimer = null;
  stopLiveCountdown();                 // Feature 1 — hide the countdown badge
  teardown();                          // rtClient.disconnect() → billing stops now
  card().classList.remove("show-live");
  setLiveControls(false);
  $("captureBtn").disabled = !localStream;
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

function freezeFrom(video, { mirror }) {
  if (!video || !video.videoWidth) return false;
  const vw = video.videoWidth, vh = video.videoHeight;
  const cv = $("resultCanvas");
  cv.width = vw; cv.height = vh;
  const c = cv.getContext("2d");
  c.save();
  if (mirror) { c.translate(vw, 0); c.scale(-1, 1); }
  c.drawImage(video, 0, 0, vw, vh);
  c.restore();
  return true;
}

/* =============================================================================
   Feature 1 — Live countdown timer (top-left of the camera container)
   ─────────────────────────────────────────────────────────────────────────
   A lightweight badge injected into #cameraCard that counts the remaining live
   seconds down (5 → 1) so the user knows exactly when the strict LIVE_DURATION_MS
   window will end. Purely visual — the authoritative teardown is still the
   setTimeout(autoStopAndFreeze, LIVE_DURATION_MS) in goLive. We derive the digit
   from a wall-clock deadline so it stays in sync with that timer.
   ============================================================================= */
function ensureTimerEl() {
  let el = $("liveTimer");
  if (!el) {
    el = document.createElement("div");
    el.id = "liveTimer";
    el.className = "live-timer";
    el.hidden = true;
    el.setAttribute("aria-live", "polite");
    card().appendChild(el);
  }
  return el;
}

function startLiveCountdown() {
  const el = ensureTimerEl();
  const total = Math.ceil(LIVE_DURATION_MS / 1000);   // derived from config — stays in sync
  const deadline = Date.now() + LIVE_DURATION_MS;
  el.hidden = false;
  el.classList.add("show");

  const tick = () => {
    const remMs = Math.max(0, deadline - Date.now());
    const secs = Math.min(total, Math.ceil(remMs / 1000));
    el.textContent = String(secs);
    el.classList.toggle("is-urgent", secs <= 2);       // turn red in the final stretch
    if (remMs <= 0) stopLiveCountdown();
  };
  tick();
  clearInterval(liveCountdownTimer);
  liveCountdownTimer = setInterval(tick, 200);
}

function stopLiveCountdown() {
  clearInterval(liveCountdownTimer);
  liveCountdownTimer = null;
  const el = $("liveTimer");
  if (el) { el.classList.remove("show", "is-urgent"); el.hidden = true; }
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
 * is video-only and is force-stopped by stopRecording() at exactly LIVE_DURATION_MS.
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
  recordCanvas.width  = video.videoWidth  || 1088;
  recordCanvas.height = video.videoHeight || 624;
  const ctx = recordCanvas.getContext("2d", { alpha: false });

  const paint = () => {
    if (!recordingActive) return;
    const w = video.videoWidth, h = video.videoHeight;
    if (w && h) {
      if (recordCanvas.width !== w || recordCanvas.height !== h) {
        recordCanvas.width = w; recordCanvas.height = h;
      }
      try { ctx.drawImage(video, 0, 0, w, h); } catch (_) {}
    }
    recordRaf = requestAnimationFrame(paint);
  };
  paint();

  // iOS Safari only stabilised canvas.captureStream in 15.4 — if it's missing, bail
  // cleanly so the live try-on itself is unaffected (we just skip the downloadable clip).
  if (typeof recordCanvas.captureStream !== "function") {
    console.warn("canvas.captureStream unsupported — clip recording disabled on this device");
    stopPaintLoop();
    return;
  }
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
  // (~5s) duration instead of the broken/inflated length a single-blob start() gives.
  try { mediaRecorder.start(200); }
  catch (e) { console.warn("recorder start failed:", e?.message || e); stopPaintLoop(); mediaRecorder = null; }
}

/** Halt the canvas paint loop (does not touch the recorder). */
function stopPaintLoop() {
  recordingActive = false;
  if (recordRaf) { cancelAnimationFrame(recordRaf); recordRaf = 0; }
  recordCanvas = null;
}

/**
 * Force-stop the recorder. Called at EXACTLY LIVE_DURATION_MS (autoStopAndFreeze)
 * and again by teardown — idempotent. onstop → finalizeRecording builds the clip.
 */
function stopRecording() {
  stopPaintLoop();
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    try { mediaRecorder.stop(); } catch (_) {}
  }
  mediaRecorder = null;
}

/** Build the downloadable clip from the buffered chunks and reveal the button. */
function finalizeRecording() {
  if (!recordedChunks.length) return;
  // Prefer the negotiated container MIME so the Blob/File advertise the real codec
  // (mp4 vs webm) — mobile OSes key the "Save Video → gallery" affordance off a
  // correct, complete video/* type. Strip any ";codecs=…" so the Blob type is the
  // clean container the OS expects.
  const raw = (recordedChunks[0] && recordedChunks[0].type) || recorderMime || "video/webm";
  const type = raw.split(";")[0] || "video/webm";
  const blob = new Blob(recordedChunks, { type });
  recordedChunks = [];
  recordedBlob = blob;
  if (recordedUrl) { try { URL.revokeObjectURL(recordedUrl); } catch (_) {} }
  recordedUrl = URL.createObjectURL(blob);
  replayUrl = recordedUrl;             // cache the SAME blob-backed URL for local "Watch Again"
  showDownloadButton();
  showWatchAgainButton();              // sits right beside Download once the 5s session ends
}

/** Lazily create the side-by-side (flex-row) action row that holds Download +
 *  Watch-Again, so both capsules sit next to each other under the capture button. */
function resultActionsRow() {
  let row = $("resultActions");
  if (!row) {
    row = document.createElement("div");
    row.id = "resultActions";
    row.className = "result-actions";
    const controls = document.querySelector(".cam-controls");
    (controls || card()).appendChild(row);
  }
  return row;
}

/** Inject (once) and reveal the "Download Video" button inside the action row. */
function showDownloadButton() {
  const row = resultActionsRow();
  let btn = $("downloadBtn");
  if (!btn) {
    btn = document.createElement("button");
    btn.id = "downloadBtn";
    btn.className = "btn-download";
    btn.type = "button";
    btn.innerHTML = '<span class="btn-download__icon">⬇</span>' +
      '<span>הורד וידאו</span><span class="btn-download__en">Download Video</span>';
    btn.addEventListener("click", downloadRecording);
    row.appendChild(btn);
  }
  btn.hidden = false;
  row.classList.add("show");
}

/** Inject (once) and reveal the "צפה שוב / Watch Again" button beside Download.
 *  Replay is 100% local (cached blob URL) — never a network request or a new
 *  billable AI session. */
function showWatchAgainButton() {
  if (!replayUrl) return;
  const row = resultActionsRow();
  let btn = $("watchAgainBtn");
  if (!btn) {
    btn = document.createElement("button");
    btn.id = "watchAgainBtn";
    btn.className = "btn-watch";
    btn.type = "button";
    btn.innerHTML = '<span class="btn-watch__icon">↺</span>' +
      '<span>צפה שוב</span><span class="btn-watch__en">Watch Again</span>';
    btn.addEventListener("click", watchAgain);
    row.appendChild(btn);
  }
  btn.hidden = false;
  row.classList.add("show");
}

/** Replay the cached 5-second clip locally on #aiVideo — as many times as the
 *  user likes, with zero network/billing. Lifts the clip above the frozen result
 *  canvas for the duration of playback, then restores the frozen frame on end. */
function watchAgain() {
  if (!replayUrl) return;
  const ai = $("aiVideo");
  if (!ai) return;
  ai.srcObject = null;                 // detach the now-dead realtime stream
  if (ai.src !== replayUrl) ai.src = replayUrl;   // point at the cached local blob
  ai.muted = true;                     // stay within autoplay policy
  ai.loop = false;
  ai.onended = () => card().classList.remove("replaying");   // restore the frozen masterpiece
  card().classList.add("replaying");   // raise #aiVideo above #resultCanvas
  try { ai.currentTime = 0; } catch (_) {}
  ai.play().catch(() => {});
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

/** Drop the current clip + hide the button (called when a new session starts). */
function clearRecording() {
  stopPaintLoop();                     // ensure no stale paint loop leaks into the next session
  if (recordedUrl) { try { URL.revokeObjectURL(recordedUrl); } catch (_) {} recordedUrl = null; }
  replayUrl = null;                    // same underlying URL as recordedUrl — already revoked above
  recordedChunks = [];
  recordedBlob = null;
  recorderMime = null;

  // Detach the cached replay clip from #aiVideo and restore the frozen-result
  // layering, so the UI returns to a clean live-prep state for the next try-on.
  const ai = $("aiVideo");
  if (ai) { ai.onended = null; ai.removeAttribute("src"); try { ai.load(); } catch (_) {} }
  card().classList.remove("replaying");

  // Hide the side-by-side Download / Watch-Again row.
  const row = $("resultActions");
  if (row) row.classList.remove("show");
  const dl = $("downloadBtn"); if (dl) dl.hidden = true;
  const wa = $("watchAgainBtn"); if (wa) wa.hidden = true;
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
  const wrap = "display:block;width:100%;height:100%;overflow:hidden;background:#ffffff";
  return `<span style="${wrap}">${_garmentSVG(item)}</span>`;
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
function init() {
  updateProgress();

  const handoff = parseHandoff();
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
  $("retakeBtn").addEventListener("click", () => { resetToLive(); });

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