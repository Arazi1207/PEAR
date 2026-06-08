/* ============================================================
   MERIDIAN — Product Detail View (product.html)
   Reads ?id=N, renders the garment, and hands off to the PEAR
   Camera (calculator-first flow) via URL query parameters.
   Depends on catalog.js (PRODUCTS, SUBTYPE_LABEL, SIZES, shade, garmentSVG).
   ============================================================ */
"use strict";

const PEAR_PATH = "./pear-demo/index.html";
const LS_BAG    = "meridian_bag";
const LS_TRYON  = "pear_tryon";

const $ = (s, r = document) => r.querySelector(s);

/* ── bag ── */
function getBag() { return parseInt(localStorage.getItem(LS_BAG) || "0", 10); }
function setBag(n) {
  localStorage.setItem(LS_BAG, String(n));
  const el = $("#bagCount");
  if (el) { el.textContent = n; el.classList.toggle("show", n > 0); }
}

/* ── toast ── */
let toastTimer;
function showToast(html) {
  const t = $("#toast");
  if (!t) return;
  t.innerHTML = html; t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
}

/* ── color swatches: base tone + tonal variants from one source color ── */
function swatchesFor(base) {
  return [
    { hex: base,             label: "Signature" },
    { hex: shade(base, 0.26), label: "Light" },
    { hex: shade(base, -0.3), label: "Deep" },
    { hex: shade(base, -0.55), label: "Ink" },
  ];
}

/* ── PEAR handoff URL (full redirect → no embed → calculator runs first) ── */
function pearUrl(p, color) {
  const params = {
    id: p.id,
    itemType: p.type,
    subType: p.subType,
    color: color.replace("#", ""),
    name: p.name,
    img: p.imageUrl || "",
  };
  return `${PEAR_PATH}?${new URLSearchParams(params).toString()}`;
}

/* ── state ── */
let product = null;
let activeColor = null;
let activeSize = "M";

function findProduct() {
  const id = parseInt(new URLSearchParams(location.search).get("id"), 10);
  return PRODUCTS.find((p) => p.id === id) || null;
}

/* ── render ── */
function render() {
  const grid = $("#pdpGrid");
  const display = { ...product, color: activeColor };

  grid.innerHTML = `
    <section class="pdp__media">
      <span class="pdp__badge"${product.isNew ? "" : " hidden"}>New Arrival</span>
      <div class="pdp__svg" id="pdpSvg">${garmentImg(display)}</div>
    </section>

    <section class="pdp__info">
      <span class="pdp__cat">${product.category} · ${SUBTYPE_LABEL[product.subType]}</span>
      <h1 class="pdp__name">${product.name}</h1>
      <div class="pdp__price">$${product.price}</div>
      <p class="pdp__desc">
        Engineered premium ${product.type === "shirt" ? "upper-body essential" : "trouser"},
        cut for comfort and movement. Preview the exact fit on yourself with the PEAR Camera.
      </p>

      <div class="pdp__field">
        <span class="pdp__label">Color</span>
        <div class="pdp__swatches" id="swatches"></div>
      </div>

      <div class="pdp__field">
        <span class="pdp__label">Size</span>
        <div class="pdp__sizes" id="sizes"></div>
      </div>

      <!-- Prominent Virtual Try-On CTA, directly below the product image column -->
      <button class="pdp__tryon" id="tryonBtn">
        <span class="pdp__tryon-he">מדידה וירטואלית</span>
        <span class="pdp__tryon-en">Virtual Try-On · PEAR Camera</span>
        <span class="pdp__tryon-icon" aria-hidden="true">👕</span>
      </button>

      <button class="pdp__add" id="addBtn">Add to Bag</button>

      <ul class="pdp__perks">
        <li>Free shipping &amp; returns</li>
        <li>Try before you buy — virtually</li>
        <li>Spring 2026 collection</li>
      </ul>
    </section>`;

  renderSwatches();
  renderSizes();

  $("#crumbs").innerHTML =
    `<a href="index.html#home">Home</a>` +
    `<span>/</span><a href="index.html#${product.type === "shirt" ? "shirts" : "pants"}">${product.category}</a>` +
    `<span>/</span><b>${product.name}</b>`;

  $("#tryonBtn").addEventListener("click", launchPear);
  $("#addBtn").addEventListener("click", () => {
    setBag(getBag() + 1);
    showToast(`<b>${product.name}</b> (${activeSize}) added to bag`);
  });
}

function renderSwatches() {
  const wrap = $("#swatches");
  wrap.innerHTML = swatchesFor(product.color).map((s) => `
    <button class="swatch${s.hex === activeColor ? " is-active" : ""}"
            style="--c:${s.hex}" data-color="${s.hex}" title="${s.label}"
            aria-label="${s.label}"></button>`).join("");
  wrap.querySelectorAll(".swatch").forEach((b) => {
    b.addEventListener("click", () => {
      activeColor = b.dataset.color;
      $("#pdpSvg").innerHTML = garmentImg({ ...product, color: activeColor });
      wrap.querySelectorAll(".swatch").forEach((x) => x.classList.toggle("is-active", x === b));
    });
  });
}

function renderSizes() {
  const wrap = $("#sizes");
  wrap.innerHTML = SIZES.map((s) => `
    <button class="size-pill${s === activeSize ? " is-active" : ""}" data-size="${s}">${s}</button>`).join("");
  wrap.querySelectorAll(".size-pill").forEach((b) => {
    b.addEventListener("click", () => {
      activeSize = b.dataset.size;
      wrap.querySelectorAll(".size-pill").forEach((x) => x.classList.toggle("is-active", x === b));
    });
  });
}

/* ── handoff to PEAR (remembers the garment; PEAR runs the calculator first) ── */
function launchPear() {
  try {
    localStorage.setItem(LS_TRYON, JSON.stringify({
      id: product.id, itemType: product.type, subType: product.subType,
      color: activeColor.replace("#", ""), name: product.name, size: activeSize,
    }));
  } catch (_) {}
  showToast(`Launching <b>PEAR Camera</b> — ${product.name}…`);
  setTimeout(() => { location.href = pearUrl(product, activeColor); }, 600);
}

/* ── not found ── */
function renderNotFound() {
  $("#pdpGrid").innerHTML = `
    <div class="pdp__missing">
      <h1>Product not found</h1>
      <p>We couldn't find that item. Browse the full collection instead.</p>
      <a class="btn btn--primary" href="index.html#catalog">Back to shop</a>
    </div>`;
}

/* ── init ── */
function init() {
  setBag(getBag());
  $("#bagBtn").addEventListener("click", () => {
    const n = getBag();
    showToast(n ? `Your bag holds <b>${n}</b> ${n === 1 ? "item" : "items"}` : "Your bag is empty");
  });

  product = findProduct();
  if (!product) { renderNotFound(); return; }
  activeColor = product.color;
  render();
}

document.addEventListener("DOMContentLoaded", init);
