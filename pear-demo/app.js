/* ============================================================================
   PEAR — Virtual fitting room (Lucy VTON realtime, LIVE-first)
   ----------------------------------------------------------------------------
   Screen 1  Size calculator (required) ─► Screen 2  Isolated try-on room.

   Engine: Decart Lucy VTON realtime ("lucy-vton-latest") over WebRTC (LiveKit).
   Verified against @decartai/sdk@0.1.5:
     • backend POST /api/realtime-token → { apiKey:"ek_…", expiresAt, model }
     • models.realtime("lucy-vton-latest")            (valid realtime literal)
     • client.realtime.connect(stream, { model, mirror, onRemoteStream,
                                         onConnectionChange })
     • ConnectionState: connecting|connected|generating|disconnected|reconnecting
     • rtClient.set({ prompt, image, enhance })  — image may be an http(s) URL
     • rtClient.on("error", …)

   Flow: enter room → start camera → connect realtime (badge turns green when the
   session reports "connected"). "Capture & Try On" applies the garment via
   set() and freezes a frame of the AI-dressed output stream onto the canvas.

   The mock/sticker overlay is GONE from the normal path — failures surface a
   real error. A labelled mock remains ONLY behind ?demo=1 for offline dev.
   ============================================================================ */
"use strict";

const SDK_URLS = [
  "https://esm.sh/@decartai/sdk@0.1.5",
  "https://cdn.jsdelivr.net/npm/@decartai/sdk@0.1.5/+esm",
];
const TOKEN_ENDPOINT = "/api/realtime-token";
const SETTLE_MS = 2600;     // let the model converge on the new garment
const CONNECT_TIMEOUT = 12000;
const DEMO_FLAG = new URLSearchParams(location.search).get("demo") === "1";

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
let localStream = null;
let rtClient = null;
let connState = "idle";        // mirrors Decart ConnectionState (+ idle/error)
let connecting = false;
let busy = false;

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
  // Engage camera + live Decart session immediately so the badge can verify.
  initEngine();
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
  if (!ok) return;                 // camera blocked → user can retry via button
  try {
    await connectRealtime();       // badge goes green on "connected"
  } catch (e) {
    console.warn("live connect failed:", e?.message || e);
    setConn("error");
    if (!DEMO_FLAG) showCamError("לא ניתן להתחבר ל-Lucy VTON: " + (e?.message || e) +
      "  — בדוק קרדיטים/הרשאות בחשבון Decart. (להדגמה לא מקוונת: הוסף ?demo=1 לכתובת)");
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
   ============================================================================= */
async function loadSDK() {
  let lastErr;
  for (const url of SDK_URLS) {
    try { return await import(/* @vite-ignore */ url); }
    catch (e) { lastErr = e; console.warn("SDK load failed from", url, e?.message || e); }
  }
  throw new Error("SDK load failed: " + (lastErr?.message || lastErr));
}

async function connectRealtime() {
  if (rtClient && isLive()) return;
  if (connecting) return;
  connecting = true;
  setConn("connecting");

  try {
    // 1. ephemeral client token from our backend (permanent key stays server-side)
    const res = await fetch(TOKEN_ENDPOINT, { method: "POST" });
    if (!res.ok) {
      let detail = ""; try { detail = JSON.stringify(await res.json()); } catch (_) {}
      throw new Error(`token endpoint ${res.status} ${detail}`);
    }
    const token = await res.json();
    if (!token || !token.apiKey) throw new Error("token response had no apiKey");
    if (!/^ek_/.test(token.apiKey)) console.warn("token apiKey is not an ek_ ephemeral key:", token.apiKey.slice(0, 6));

    // 2. load SDK + connect realtime
    const { createDecartClient, models } = await loadSDK();
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
      onConnectionChange: (state) => {
        connState = state;
        setConn(state);
      },
    });

    rtClient.on("error", (err) => {
      console.error("Decart realtime error:", err);
      showCamError("שגיאת Decart: " + (err?.message || err));
    });

    // connect() resolves once connected; reflect it even if the callback lagged
    connState = (rtClient.getConnectionState && rtClient.getConnectionState()) ||
                (rtClient.isConnected && rtClient.isConnected() ? "connected" : "connected");
    setConn(connState);
  } finally {
    connecting = false;
  }
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
  if (item.img) payload.image = item.img;   // SDK accepts an http(s) URL string
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
   Capture flow — LIVE ONLY (mock gated behind ?demo=1)
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
    // ensure a live realtime session
    if (!isLive()) { await connectRealtime(); }
    await waitConnected(CONNECT_TIMEOUT);

    // apply the active garment and let the model converge, then freeze a frame
    await applyGarment(activeItem);
    await waitForAiFrame(SETTLE_MS);
    if (!freezeFrom($("aiVideo"), { mirror: false })) {
      throw new Error("לא התקבל פריים פלט מהמודל (אין וידאו ערוך).");
    }

    card().classList.add("show-result");
    $("retakeBtn").hidden = false;
    toast("✨ מדידה חיה נוצרה ע\"י Lucy VTON");
  } catch (err) {
    console.error("live capture failed:", err);
    if (DEMO_FLAG) {
      // offline dev only — clearly labelled, never on the real path
      await renderMockDemo(activeItem);
      card().classList.add("show-result");
      $("retakeBtn").hidden = false;
    } else {
      showCamError("המדידה החיה נכשלה: " + (err?.message || err));
      setConn(isLive() ? "connected" : "error");
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
      if (elapsed >= settle + 6000) return resolve(); // hard cap
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

/* header badge driven by the REAL Decart ConnectionState */
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

  $("startCamBtn").addEventListener("click", initEngine);
  $("captureBtn").addEventListener("click", capture);
  $("retakeBtn").addEventListener("click", () => { resetToLive(); });

  document.addEventListener("click", (e) => {
    const sw = e.target.closest("[data-swap]");
    if (sw) { const p = PEAR_CATALOG.find((x) => x.id === +sw.dataset.swap); if (p) setActiveItem(toItem(p)); return; }
    const pk = e.target.closest("[data-pick]");
    if (pk) { const p = PEAR_CATALOG.find((x) => x.id === +pk.dataset.pick); if (p) { setActiveItem(toItem(p)); $("cameraCard").scrollIntoView({ behavior: "smooth", block: "center" }); } return; }
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
