/* ============================================================
   MERIDIAN — Product Detail View (product.html)
   Reads ?id=N, renders the garment, and hands off to the PEAR
   Camera (calculator-first flow) via URL query parameters.
   Depends on catalog.js (PRODUCTS, SUBTYPE_LABEL, SIZES, shade, garmentSVG).
   ============================================================ */
"use strict";

const PEAR_PATH = "/fitting-room/";
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

/* ── product-page color display ──────────────────────────────────────────────
   garmentSVG() (from catalog.js) generates a procedural garment in any hex
   color. It always shows the correct garment shape (subType) and the exact
   selected color — same composition every time, zero jarring image swaps.
   The canonical imageUrl is reserved for the VTON reference payload only. */
function pdpSvgOf(color) {
  const wrap = "display:flex;align-items:center;justify-content:center;"
    + "width:100%;height:100%;background:#f3f4f6;padding:32px;box-sizing:border-box";
  return `<span style="${wrap}">${garmentSVG({ ...product, color })}</span>`;
}

/* ── PEAR handoff URL ────────────────────────────────────────────────────────
   Always sends the canonical imageUrl so PEAR receives the correct
   garment-shape reference regardless of which color variant is active.
   Color is communicated separately via the `color` query param (and the
   PEAR text prompt uses colorName() to describe it to the VTON model). */
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
let product = null;         // the selected product object == the spec's `activeGarment`
let activeColor = null;
let activeSize = "M";
let activeAngle = "front";  // which gallery angle the main viewport is showing

function findProduct() {
  const id = parseInt(new URLSearchParams(location.search).get("id"), 10);
  return PRODUCTS.find((p) => p.id === id) || null;
}

/* ── render ── */
function render() {
  const grid = $("#pdpGrid");

  grid.innerHTML = `
    <section class="pdp__media${hasPhotoGallery(product) ? " pdp__media--gallery" : ""}">
      ${hasPhotoGallery(product)
        ? `<div class="pdp__gallery" id="pdpGallery"></div>`
        : `<span class="pdp__badge"${product.isNew ? "" : " hidden"}>New Arrival</span>
           <div class="pdp__svg" id="pdpSvg">${pdpSvgOf(activeColor)}</div>`}
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
  if (hasPhotoGallery(product)) renderProductGallery(product);

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
  const variants = product.variants || [];
  wrap.innerHTML = variants.map((v) => `
    <button class="swatch${v.color === activeColor ? " is-active" : ""}"
            style="--c:${v.color}" data-color="${v.color}" title="${v.label}"
            aria-label="${v.label}"></button>`).join("");
  wrap.querySelectorAll(".swatch").forEach((b) => {
    b.addEventListener("click", () => {
      activeColor = b.dataset.color;
      $("#pdpSvg").innerHTML = pdpSvgOf(activeColor);
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

/* ── Multi-angle product gallery (main viewport + vertical thumbnail strip) ───
   Only rendered for products with a real photo set (hasPhotoGallery). Clicking a
   thumbnail crossfades the main viewport to that angle and moves the active
   border — a real retail PDP gallery. The exact same angle model (activeAngle +
   product.gallery) drives the fitting-room live rail, so the storefront and the
   live try-on stay in lock-step. */
function galleryUrl(p, angle) {
  const hit = productGallery(p).find((i) => i.angle === angle);
  return hit ? hit.url : (p.imageUrl || "");
}

function renderProductGallery(p) {
  const host = $("#pdpGallery");
  if (!host) return;
  const items = productGallery(p);
  if (!items.length) return;
  if (!items.some((i) => i.angle === activeAngle)) activeAngle = items[0].angle;

  host.innerHTML = `
    <ul class="product-thumbnails" id="pdpThumbs" role="listbox" aria-label="Product views">
      ${items.map((i) => `
        <li role="presentation">
          <button type="button" class="product-thumb${i.angle === activeAngle ? " is-active" : ""}"
                  data-angle="${i.angle}" role="option" aria-selected="${i.angle === activeAngle}"
                  aria-label="${i.label} view">
            <img src="${i.url}" alt="${p.name} — ${i.label}" loading="lazy" decoding="async">
            <span class="product-thumb__label">${i.label}</span>
          </button>
        </li>`).join("")}
    </ul>
    <div class="pdp__stage">
      <span class="pdp__badge"${p.isNew ? "" : " hidden"}>New Arrival</span>
      <img class="pdp__main" id="pdpMain" src="${galleryUrl(p, activeAngle)}"
           alt="${p.name} — ${ANGLE_LABEL[activeAngle]}" decoding="async">
    </div>`;

  host.querySelectorAll(".product-thumb").forEach((btn) => {
    btn.addEventListener("click", () => setProductAngle(p, btn.dataset.angle));
  });
}

function setProductAngle(p, angle) {
  if (!angle || angle === activeAngle) return;
  activeAngle = angle;                                    // == updates the spec's activeAngle

  // active border on the clicked thumb
  document.querySelectorAll("#pdpThumbs .product-thumb").forEach((b) => {
    const on = b.dataset.angle === angle;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-selected", String(on));
  });

  // crossfade the main viewport: preload → fade out → swap cached src → fade in.
  // Preloading first guarantees no flicker / blank frame during the swap.
  const main = $("#pdpMain");
  if (!main) return;
  const url = galleryUrl(p, angle);
  const pre = new Image();
  pre.decoding = "async";
  pre.onload = () => {
    main.classList.add("is-fade");
    setTimeout(() => {
      main.src = url;
      main.alt = `${p.name} — ${ANGLE_LABEL[angle]}`;
      main.classList.remove("is-fade");
    }, 170);                                              // matches .pdp__main opacity transition
  };
  pre.onerror = () => { main.src = url; };                // still swap even if preload fails
  pre.src = url;
}

/* ── handoff to PEAR (remembers the garment; PEAR runs the calculator first) ── */
function launchPear() {
  const url = pearUrl(product, activeColor);
  const payload = {
    id:       product.id,
    itemType: product.type,
    subType:  product.subType,
    color:    activeColor.replace("#", ""),
    name:     product.name,
    size:     activeSize,
    img:      product.imageUrl || "(none)",
  };

  console.group("[PEAR] launchPear() — handoff debug");
  console.log("product :", product.name, `(id=${product.id})`);
  console.log("type    :", product.type, "| subType:", product.subType);
  console.log("color   :", activeColor, "| size:", activeSize);
  console.log("img URL :", product.imageUrl || "(no imageUrl on this product)");
  console.log("target  :", url);
  console.log("payload :", payload);
  console.groupEnd();

  if (!product.imageUrl) {
    console.warn("[PEAR] launchPear() — product.imageUrl is empty; the VTON model will have no garment reference image.");
  }

  try {
    localStorage.setItem(LS_TRYON, JSON.stringify(payload));
  } catch (_) {}
  showToast(`Launching <b>PEAR Camera</b> — ${product.name}…`);
  setTimeout(() => { location.href = url; }, 600);
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
  activeColor = product.variants?.[0]?.color || product.color;
  render();
}

document.addEventListener("DOMContentLoaded", init);
