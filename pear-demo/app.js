/* ============================================================================
   PEAR — Virtual fitting room (Lucy VTON realtime, LIVE-first)
   ----------------------------------------------------------------------------
   Screen 1  Size calculator (required) ─► Screen 2  Isolated try-on room.

   Engine: Decart Lucy VTON realtime ("lucy-vton-latest") over WebRTC (LiveKit).
   Verified against @decartai/sdk@0.1.5:
     • createDecartClient({ apiKey })  — direct browser call, no backend needed
     • client.realtime.connect(stream, { model, mirror, onRemoteStream,
                                         onConnectionChange })
     • ConnectionState: connecting|connected|generating|disconnected|reconnecting
     • rtClient.set({ prompt, image, enhance })  — image may be an http(s) URL
     • rtClient.on("error", …)

   API key מוגדר: dct_pear_…
       

   Flow: enter room → start camera → connect realtime (badge turns green when the
   session reports "connected"). "Capture & Try On" applies the garment via
   set() and freezes a frame of the AI-dressed output stream onto the canvas.

   A labelled mock remains ONLY behind ?demo=1 for offline dev.
   ============================================================================ */
"use strict";

/* ── ⚠️  PUT YOUR DECART API KEY HERE ─────────────────────────────────────── */
const DECART_API_KEY = "dct_pearnewapi_nCLklaEhNatXfxldAEXpMJVyTrMIOUJUAWPwvvsGzhGGIiluOOVwPWxIKDSEBGsv";
/* ────────────────────────────────────────────────────────────────────────── */

const SDK_URLS = [
  "https://esm.sh/@decartai/sdk@0.1.5",
  "https://cdn.jsdelivr.net/npm/@decartai/sdk@0.1.5/+esm",
];
const SETTLE_MS = 2600;
const CONNECT_TIMEOUT = 12000;
const DEMO_FLAG = new URLSearchParams(location.search).get("demo") === "1";

/* ── embedded catalog ──────────────────────────────────────────────────────── */
const _UIMG = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=700&q=80`;
const PEAR_CATALOG = [
  { id: 1,  name: "Halo Tank",         price: 88,  type: "shirt", subType: "sleeveless",   color: "#3f5a8a", img: _UIMG("photo-1503342217505-b0a15ec3261c") },
  { id: 2,  name: "Vapor Sleeveless",  price: 72,  type: "shirt", subType: "sleeveless",   color: "#b8c0cc", img: _UIMG("photo-1521572163474-6864f9cf17ab") },
  { id: 3,  name: "Ion Crew Tee",      price: 96,  type: "shirt", subType: "short_sleeve", color: "#c2452f", img: _UIMG("photo-1583743814966-8936f5b7be1a") },
  { id: 4,  name: "Pulse Tee",         price: 84,  type: "shirt", subType: "short_sleeve", color: "#1f6feb", img: _UIMG("photo-1576566588028-4147f3842f27") },
  { id: 5,  name: "Circuit Tee",       price: 90,  type: "shirt", subType: "short_sleeve", color: "#149c7a", img: _UIMG("photo-1618354691373-d851c5c3a990") },
  { id: 6,  name: "Strata Longsleeve", price: 128, type: "shirt", subType: "long_sleeve",  color: "#2b2b30", img: _UIMG("photo-1593030761757-71fae45fa0e7") },
  { id: 7,  name: "Nimbus Henley",     price: 134, type: "shirt", subType: "long_sleeve",  color: "#8e7bd0", img: _UIMG("photo-1551537482-f2075a1d41f2") },
  { id: 8,  name: "Echo Longsleeve",   price: 118, type: "shirt", subType: "long_sleeve",  color: "#d8d4cb", img: _UIMG("photo-1529374255404-311a2a4f1fd9") },
  { id: 9,  name: "Glide Slim",        price: 142, type: "pants", subType: "slim",    color: "#2a2d34", img: _UIMG("photo-1542272604-787c3835535d") },
  { id: 10, name: "Mono Slim",         price: 118, type: "pants", subType: "slim",    color: "#6e7681", img: _UIMG("photo-1624378439575-d8705ad7ae80") },
  { id: 11, name: "Vector Regular",    price: 132, type: "pants", subType: "regular", color: "#3b5bdb", img: _UIMG("photo-1602293589930-45aad59ba3ab") },
  { id: 12, name: "Apex Regular",      price: 124, type: "pants", subType: "regular", color: "#8a8f98", img: _UIMG("photo-1473966968600-fa801b869a1a") },
  { id: 13, name: "Drift Wide",        price: 156, type: "pants", subType: "wide",    color: "#1a1a1d", img: _UIMG("photo-1594633312681-425c7b97ccd1") },
  { id: 14, name: "Terra Wide",        price: 148, type: "pants", subType: "wide",    color: "#a8794f", img: _UIMG("photo-1506629082955-511b1aa562c8") },
  { id: 15, name: "Null Slim",         price: 138, type: "pants", subType: "slim",    color: "#22324f", img: _UIMG("photo-1490114538077-0a7f8cb49891") },
  { id: 16, name: "Cargo Wide",        price: 162, type: "pants", subType: "wide",    color: "#566b3e", img: _UIMG("photo-1559563458-527698bf5295") },
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
let localStream = null;
let rtClient = null;
let connState = "idle";
let connecting = false;
let busy = false;
let snapshotStream = null; // single-frame MediaStream built from a canvas snapshot, passed to Decart

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

function renderSizeTable() {
  const tbody = $("sizeTableBody");
  if (!tbody) return;
  tbody.innerHTML = ZARA_SIZE_CHART.map((r) => `
    <tr>
      <td><strong>${r.size}</strong></td>
      <td>${r.minHeight}</td><td>${r.maxHeight}</td>
      <td>${r.minWeight}</td><td>${r.maxWeight}</td>
      <td>${r.minChest}</td><td>${r.maxChest}</td>
      <td>${r.minWaist}</td><td>${r.maxWaist}</td>
      <td>${r.minLegs}</td><td>${r.maxLegs}</td>
    </tr>`).join("");
}

function calculateSize() {
  const num = (id) => ($(id).value ? parseFloat($(id).value) : null);
  const height = num("height"), weight = num("weight");
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
  $("focusItemName").innerText = item.name;

  $("activeGarment").hidden = false;
  $("activeGarmentMedia").innerHTML = garmentThumb(item);
  $("activeGarmentName").innerText = item.name;
  $("activeGarmentType").innerText =
    (item.garmentType === "lower_body" ? "מכנסיים · " : "חולצה · ") + (SUBTYPE_LABEL_HE[item.subType] || "");

  renderCompleteTheLook(item);
  highlightCatalog(item.id);

  if (!opts.silent) {
    toast(`עכשיו מודדים: <b>${item.name}</b>`);
    resetToLive();
    if (isLive()) applyGarment(item).catch((e) => console.warn("pre-apply garment:", e?.message || e));
  }
}

/* =============================================================================
   Camera + engine bootstrap
   ============================================================================= */
const card = () => $("cameraCard");

async function initEngine() {
  const ok = await startCamera();
  if (!ok) return;
  try {
    await connectRealtime();
  } catch (e) {
    console.warn("live connect failed:", e?.message || e);
    setConn("error");
    if (!DEMO_FLAG) showCamError("לא ניתן להתחבר ל-Lucy VTON: " + (e?.message || e) +
      "  — בדוק שה-API key נכון בקובץ app.js. (להדגמה לא מקוונת: הוסף ?demo=1 לכתובת)");
  }
}

async function startCamera() {
  if (localStream) return true;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 960 } },
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
   FIX: removed the /api/realtime-token backend call entirely.
        We call createDecartClient({ apiKey }) directly from the browser,
        using the key defined at the top of this file.

   FIX: models.realtime() does not exist in @decartai/sdk@0.1.5.
        The model is passed as a plain string: "lucy-vton-latest".
   ============================================================================= */
async function loadSDK() {
  let lastErr;
  for (const url of SDK_URLS) {
    try { return await import(/* @vite-ignore */ url); }
    catch (e) { lastErr = e; console.warn("SDK load failed from", url, e?.message || e); }
  }
  throw new Error("SDK load failed: " + (lastErr?.message || lastErr));
}

// stream: the MediaStream to pipe into Decart (always a snapshot MediaStream, never localStream).
async function connectRealtime(stream) {
  if (rtClient && isLive()) return;
  if (connecting) return;

  // Kill any stale session before opening a new one.
  if (rtClient) killSession();

  connecting = true;
  setConn("connecting");

  try {
    /* ── validate key ─────────────────────────────────────────────────────── */
    if (!DECART_API_KEY || DECART_API_KEY.length < 10) {
      throw new Error("לא הוגדר API key — ערוך את DECART_API_KEY בתחילת app.js");
    }

    /* ── load SDK ─────────────────────────────────────────────────────────── */
    const { createDecartClient } = await loadSDK();

    /* ── create client directly (no backend token endpoint needed) ─────────── */
    const client = createDecartClient({ apiKey: DECART_API_KEY });

    /* ── connect using the caller-supplied snapshot stream ────────────────── */
    rtClient = await client.realtime.connect(stream, {
      model: {
        name: "lucy-vton-latest",
        urlPath: "/v1/stream",
        fps: { ideal: 30, max: 30 },
        width: 1088,
        height: 624,
      },
      mirror: "auto",
      onRemoteStream: (editedStream) => {
        const ai = $("aiVideo");
        ai.srcObject = editedStream;
        ai.play().catch(() => {});
      },
      onConnectionChange: (state) => {
        connState = state;
        setConn(state);
      },
    });

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

// Force-kill the Decart session by stopping the snapshot stream tracks.
// Because rtClient.disconnect() does not exist in @decartai/sdk@0.1.5, stopping the
// MediaStream tracks that were handed to Decart severs the WebRTC peer connection from
// our side, which causes the server to detect a closed connection and end billing.
// Also tries every plausible SDK teardown name so the code stays correct if a future
// SDK version does expose a close method.
function killSession() {
  if (snapshotStream) {
    snapshotStream.getTracks().forEach((t) => { try { t.stop(); } catch (_) {} });
    snapshotStream = null;
  }
  const ai = $("aiVideo");
  if (ai) ai.srcObject = null;
  if (rtClient) {
    try { rtClient.disconnect(); } catch (_) {}
    try { rtClient.close();      } catch (_) {}
    try { rtClient.stop();       } catch (_) {}
    rtClient = null;
  }
  connState = "idle";
  setConn("idle");
}

function waitConnected(timeout) {
  return new Promise((resolve, reject) => {
    if (isLive()) return resolve();
    const start = Date.now();
    (function poll() {
      if (isLive()) return resolve();
      // Reject immediately if the session was killed externally (e.g. visibilitychange)
      // so the capture() promise chain doesn't hang for the full CONNECT_TIMEOUT.
      if (!rtClient) return reject(new Error("session killed"));
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

/* =============================================================================
   Capture flow
   ============================================================================= */
async function capture() {
  if (busy) return;
  if (!localStream) { const ok = await startCamera(); if (!ok) return; }
  busy = true;
  $("captureBtn").disabled = true;
  $("camError").hidden = true;
  $("scanOverlay").hidden = false;
  $("scanSub").textContent = "Lucy VTON · photorealistic render";

  try {
    // ── Step 1: freeze a single frame from the live webcam into an offscreen canvas.
    // This is the ONLY frame that will ever be sent to Decart — no live streaming.
    const webcam = $("webcam");
    const snapCanvas = document.createElement("canvas");
    snapCanvas.width  = webcam.videoWidth  || 720;
    snapCanvas.height = webcam.videoHeight || 960;
    snapCanvas.getContext("2d").drawImage(webcam, 0, 0);

    // ── Step 2: wrap the snapshot in a static MediaStream (0 fps = no autonomous
    // frame emissions after the initial draw) and store it so killSession() can
    // stop its tracks to force-close the WebRTC connection from our side.
    snapshotStream = snapCanvas.captureStream(0);

    // ── Step 3: open the Decart session with the snapshot stream, NOT localStream.
    // Billing starts here and must end the moment we have the result.
    await connectRealtime(snapshotStream);
    await waitConnected(CONNECT_TIMEOUT);

    // ── Step 4: send garment payload immediately after connection is ready.
    await applyGarment(activeItem);
    await waitForAiFrame(SETTLE_MS);

    if (!freezeFrom($("aiVideo"), { mirror: false })) {
      throw new Error("לא התקבל פריים פלט מהמודל (אין וידאו ערוך).");
    }

    // ── Step 5: result is on canvas — kill the session this exact millisecond.
    // Stopping snapshotStream tracks severs the WebRTC media pipe and forces the
    // Decart server to detect a closed peer connection, ending billing immediately.
    killSession();

    card().classList.add("show-result");
    $("retakeBtn").hidden = false;
    toast("✨ מדידה חיה נוצרה ע\"י Lucy VTON");
  } catch (err) {
    killSession(); // also terminates any partial session on failure
    console.error("live capture failed:", err);
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
    $("captureBtn").disabled = false;
    busy = false;
  }
}

function waitForAiFrame(settle) {
  return new Promise((resolve) => {
    const ai = $("aiVideo");
    const start = Date.now();
    (function check() {
      const hasFrame = ai.videoWidth > 0 && ai.readyState >= 2;
      const elapsed = Date.now() - start;
      if (hasFrame && elapsed >= settle) return resolve();
      if (elapsed >= settle + 6000) return resolve();
      requestAnimationFrame(check);
    })();
  });
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
      <button class="cl-card__swap" data-swap="${r.id}">החלף פריט · Quick Swap</button>
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
function toast(html) {
  const t = $("toast");
  t.innerHTML = html; t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
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
function init() {
  renderSizeTable();
  updateProgress();

  const handoff = parseHandoff();
  if (handoff) {
    const hint = $("focusCalcHint");
    if (hint) { hint.hidden = false; hint.innerHTML = `נבחר הפריט <strong>${handoff.name}</strong> — מלא מידות כדי להמשיך למדידה הוירטואלית.`; }
  }

  document.querySelectorAll("#sizeForm input").forEach((i) => i.addEventListener("input", calculateSize));
  $("btn-next-screen").addEventListener("click", goToFitting);
  $("btn-back").addEventListener("click", backToCalculator);

  $("startCamBtn").addEventListener("click", () => startCamera());
  $("captureBtn").addEventListener("click", capture);
  $("retakeBtn").addEventListener("click", () => { resetToLive(); });

  document.addEventListener("click", (e) => {
    const sw = e.target.closest("[data-swap]");
    if (sw) { const p = PEAR_CATALOG.find((x) => x.id === +sw.dataset.swap); if (p) setActiveItem(toItem(p)); return; }
    const pk = e.target.closest("[data-pick]");
    if (pk) { const p = PEAR_CATALOG.find((x) => x.id === +pk.dataset.pick); if (p) { setActiveItem(toItem(p)); $("cameraCard").scrollIntoView({ behavior: "smooth", block: "center" }); } return; }
  });

  // Bug 1 fix: terminate the Decart WebRTC session when the user leaves the page
  // so the server-side session closes immediately instead of billing until TTL expiry.
  window.addEventListener("beforeunload", killSession);
  window.addEventListener("pagehide", killSession);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") killSession();
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();