/* ============================================================================
   PEAR — Virtual fitting room (Lucy VTON realtime snapshot flow)
   ----------------------------------------------------------------------------
   ES module. Flow:
     Screen 1  Size calculator (required) ─► Screen 2  Isolated try-on room.

   Engine: Decart Lucy VTON realtime (model "lucy-vton-latest") over WebRTC.
     • The browser NEVER sees the permanent dct_ key. It asks our backend
       (POST /api/realtime-token) for a short-lived ek_ token, then connects.
     • "Capture & Try On" applies the garment (rtClient.set) and freezes a
       frame of the AI-dressed output stream onto the result canvas.
     • If the token endpoint / SDK / camera is unavailable, we fall back to a
       clearly-labelled MOCK render so the whole journey is always demoable.

   Docs: https://docs.platform.decart.ai/models/realtime/virtual-try-on
         https://docs.platform.decart.ai/getting-started/client-tokens
   ============================================================================ */
"use strict";

const SDK_URL = "https://esm.sh/@decartai/sdk@0.1.5";
const TOKEN_ENDPOINT = "/api/realtime-token";
const SETTLE_MS = 2800; // time we let the model converge before grabbing a frame

/* ── embedded catalog (mirrors the MERIDIAN storefront) ──────────────────── */
const _UIMG = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=700&q=80`;
const PEAR_CATALOG = [
  { id: 1,  name: "Halo Tank",         price: 88,  type: "shirt", subType: "sleeveless",   color: "#3f5a8a", img: _UIMG("photo-1503342217505-b0a15ec3261c") },
  { id: 2,  name: "Vapor Sleeveless",  price: 72,  type: "shirt", subType: "sleeveless",   color: "#b8c0cc", img: _UIMG("photo-1521572163474-6864f9cf17ab") },
  { id: 3,  name: "Ion Crew Tee",      price: 96,  type: "shirt", subType: "short_sleeve", color: "#c2452f", img: _UIMG("photo-1583743814966-8936f5b7be1a") },
  { id: 4,  name: "Pulse Tee",         price: 84,  type: "shirt", subType: "short_sleeve", color: "#1f6feb", img: _UIMG("photo-1576566588028-4147f3842f27") },
  { id: 5,  name: "Circuit Tee",       price: 90,  type: "shirt", subType: "short_sleeve", color: "#149c7a", img: _UIMG("photo-1618354691373-d851c5c3a990") },
  { id: 6,  name: "Strata Longsleeve", price: 128, type: "shirt", subType: "long_sleeve",  color: "#2b2b30", img: _UIMG("photo-1593030761757-71fae45fa0e7") },
  { id: 7,  name: "Nimbus Henley",     price: 134, type: "shirt", subType: "long_sleeve",  color: "#8e7bd0", img: _UIMG("photo-1551537482-f2075a1d41f2") },
  { id: 8,  name: "Echo Longsleeve",   price: 118, type: "shirt", subType: "long_sleeve",  color: "#d8d4cb", img: _UIMG("photo-1593030761757-71fae45fa0e7") },
  { id: 9,  name: "Glide Slim",        price: 142, type: "pants", subType: "slim",    color: "#2a2d34", img: _UIMG("photo-1542272604-787c3835535d") },
  { id: 10, name: "Mono Slim",         price: 118, type: "pants", subType: "slim",    color: "#6e7681", img: _UIMG("photo-1624378439575-d8705ad7ae80") },
  { id: 11, name: "Vector Regular",    price: 132, type: "pants", subType: "regular", color: "#3b5bdb", img: _UIMG("photo-1602293589930-45aad59ba3ab") },
  { id: 12, name: "Apex Regular",      price: 124, type: "pants", subType: "regular", color: "#8a8f98", img: _UIMG("photo-1473966968600-fa801b869a1a") },
  { id: 13, name: "Drift Wide",        price: 156, type: "pants", subType: "wide",    color: "#1a1a1d", img: _UIMG("photo-1594633312681-425c7b97ccd1") },
  { id: 14, name: "Terra Wide",        price: 148, type: "pants", subType: "wide",    color: "#a8794f", img: _UIMG("photo-1506629082955-511b1aa562c8") },
  { id: 15, name: "Null Slim",         price: 138, type: "pants", subType: "slim",    color: "#22324f", img: _UIMG("photo-1624378439575-d8705ad7ae80") },
  { id: 16, name: "Cargo Wide",        price: 162, type: "pants", subType: "wide",    color: "#566b3e", img: _UIMG("photo-1506629082955-511b1aa562c8") },
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
let engineMode = "idle";       // idle | live | mock
let localStream = null;
let rtClient = null;
let decartConnected = false;
let busy = false;

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
  if (!type) return null; // direct entry, no product → catalog mode

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
}

function setActiveItem(item, opts = {}) {
  activeItem = item;

  // focus bar
  $("focusItemName").innerText = item.name;

  // active garment chip
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
    // If already connected live, pre-apply the new garment for the next capture.
    if (engineMode === "live" && decartConnected) applyGarment(item).catch(() => {});
  }
}

/* =============================================================================
   Camera
   ============================================================================= */
const card = () => $("cameraCard");

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
   Decart Lucy VTON realtime
   ============================================================================= */
async function connectRealtime() {
  // 1. mint an ephemeral client token from our backend (key stays server-side)
  let token;
  try {
    const res = await fetch(TOKEN_ENDPOINT, { method: "POST" });
    if (!res.ok) throw new Error("token endpoint " + res.status);
    token = await res.json();
    if (!token || !token.apiKey) throw new Error("no apiKey in token response");
  } catch (e) {
    throw new Error("token: " + e.message);
  }

  // 2. load the Decart SDK (browser ESM) and connect realtime
  const { createDecartClient, models } = await import(/* @vite-ignore */ SDK_URL);
  const model = models.realtime(token.model || "lucy-vton-latest");
  const client = createDecartClient({ apiKey: token.apiKey });

  rtClient = await client.realtime.connect(localStream, {
    model,
    mirror: "auto",
    onRemoteStream: (editedStream) => {
      const ai = $("aiVideo");
      ai.srcObject = editedStream;
      ai.play().catch(() => {});
    },
    onError: (err) => console.warn("Decart realtime error:", err),
    onDisconnect: (reason) => { decartConnected = false; console.log("Decart disconnected:", reason); },
  });
  decartConnected = true;
}

async function applyGarment(item) {
  if (!rtClient) return;
  const prompt = buildPrompt(item);
  let image = null;
  try { image = await fetchGarmentBlob(item.img); } catch (_) { /* prompt-only fallback */ }
  const payload = { prompt, enhance: false };
  if (image) payload.image = image;
  await rtClient.set(payload);
}

async function fetchGarmentBlob(url) {
  if (!url) return null;
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error("garment fetch " + res.status);
  const blob = await res.blob();
  return new File([blob], "garment.jpg", { type: blob.type || "image/jpeg" });
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
  $("scanOverlay").hidden = false;
  $("scanSub").textContent = "Lucy VTON · photorealistic render";

  try {
    // Lazily establish the realtime engine on first capture.
    if (engineMode === "idle") {
      try {
        await connectRealtime();
        engineMode = "live";
        setEngineBadge("live");
      } catch (e) {
        console.warn("Realtime unavailable → mock mode:", e.message);
        engineMode = "mock";
        setEngineBadge("mock");
        $("scanSub").textContent = "מצב הדגמה · DEMO (no live API)";
        toast("מצב הדגמה — אין חיבור חי ל-Lucy VTON");
      }
    }

    if (engineMode === "live") {
      await applyGarment(activeItem);
      await waitForAiFrame(SETTLE_MS);
      if (!freezeFrom($("aiVideo"), { mirror: false })) freezeFrom($("webcam"), { mirror: true });
    } else {
      // labelled mock render
      $("scanSub").textContent = "מצב הדגמה · DEMO (no live API)";
      await sleep(2000);
      await renderMock(activeItem);
    }

    card().classList.add("show-result");
    $("retakeBtn").hidden = false;
  } catch (err) {
    console.error("capture failed:", err);
    showCamError("המדידה נכשלה: " + (err && err.message ? err.message : err));
  } finally {
    $("scanOverlay").hidden = true;
    $("captureBtn").disabled = false;
    busy = false;
  }
}

function waitForAiFrame(maxWait) {
  return new Promise((resolve) => {
    const ai = $("aiVideo");
    const start = Date.now();
    (function check() {
      if (ai.videoWidth > 0 && Date.now() - start > maxWait) return resolve();
      if (Date.now() - start > maxWait) return resolve();
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

/* ── mock render (clearly labelled; used when no live engine) ────────────── */
async function renderMock(item) {
  const webcam = $("webcam");
  const vw = webcam.videoWidth || 720, vh = webcam.videoHeight || 960;
  const cv = $("resultCanvas");
  cv.width = vw; cv.height = vh;
  const c = cv.getContext("2d");

  // frozen, mirrored selfie frame
  c.save();
  c.translate(vw, 0); c.scale(-1, 1);
  c.drawImage(webcam, 0, 0, vw, vh);
  c.restore();

  // overlay garment image onto the relevant body region
  try {
    const img = await loadImage(item.img);
    const upper = item.garmentType !== "lower_body";
    const gw = vw * (upper ? 0.54 : 0.46);
    const gh = gw * (img.height / img.width || 1.2);
    const gx = (vw - gw) / 2;
    const gy = upper ? vh * 0.24 : vh * 0.52;
    c.globalAlpha = 0.92;
    roundedImage(c, img, gx, gy, gw, gh, 16);
    c.globalAlpha = 1;
  } catch (_) { /* garment image blocked — frame only */ }

  // "DEMO" ribbon so the mock is never mistaken for a real AI render
  c.fillStyle = "rgba(11,60,149,.92)";
  const bw = 178, bh = 30;
  c.fillRect(vw - bw - 14, 14, bw, bh);
  c.fillStyle = "#fff";
  c.font = "700 15px Inter, sans-serif";
  c.textBaseline = "middle";
  c.fillText("DEMO · ללא API חי", vw - bw - 2, 14 + bh / 2);
}

function roundedImage(c, img, x, y, w, h, r) {
  c.save();
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
  c.clip();
  c.drawImage(img, x, y, w, h);
  c.restore();
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

/* garment thumbnail: real photo with a colored-block fallback (no SVG dep) */
function garmentThumb(item) {
  const fallback = `display:flex;align-items:center;justify-content:center;background:${item.color};color:#fff;font:700 12px Inter,sans-serif;text-align:center;padding:6px`;
  return `<span style="display:block;width:100%;height:100%;position:relative;background:${item.color}">`
    + `<img src="${item.img}" alt="${item.name}" loading="lazy" decoding="async"`
    + ` style="width:100%;height:100%;object-fit:cover;display:block"`
    + ` onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">`
    + `<span style="position:absolute;inset:0;${fallback};display:none">${item.name}</span>`
    + `</span>`;
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
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function setEngineBadge(mode) {
  const b = $("engineBadge");
  b.classList.remove("live", "mock");
  if (mode === "live") { b.classList.add("live"); b.title = "Lucy VTON · LIVE"; }
  else if (mode === "mock") { b.classList.add("mock"); b.title = "Demo mode · no live API"; }
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

  // focus-mode hint on the calculator screen
  const handoff = parseHandoff();
  if (handoff) {
    const hint = $("focusCalcHint");
    if (hint) { hint.hidden = false; hint.innerHTML = `נבחר הפריט <strong>${handoff.name}</strong> — מלא מידות כדי להמשיך למדידה הוירטואלית.`; }
  }

  document.querySelectorAll("#sizeForm input").forEach((i) => i.addEventListener("input", calculateSize));
  $("btn-next-screen").addEventListener("click", goToFitting);
  $("btn-back").addEventListener("click", backToCalculator);

  $("startCamBtn").addEventListener("click", startCamera);
  $("captureBtn").addEventListener("click", capture);
  $("retakeBtn").addEventListener("click", () => { resetToLive(); });

  // delegated: quick-swap + catalog pick
  document.addEventListener("click", (e) => {
    const sw = e.target.closest("[data-swap]");
    if (sw) {
      const p = PEAR_CATALOG.find((x) => x.id === +sw.dataset.swap);
      if (p) setActiveItem(toItem(p));
      return;
    }
    const pk = e.target.closest("[data-pick]");
    if (pk) {
      const p = PEAR_CATALOG.find((x) => x.id === +pk.dataset.pick);
      if (p) { setActiveItem(toItem(p)); $("cameraCard").scrollIntoView({ behavior: "smooth", block: "center" }); }
      return;
    }
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
