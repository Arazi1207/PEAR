/* ============================================================
   VANTA storefront — vanilla JS
   - product catalog (data objects)
   - generated SVG garments (no image assets)
   - SPA-style hash routing / view switching
   - PEAR Camera try-on handoff via URL params + localStorage
   ============================================================ */
"use strict";

/* ---------- 0. config ---------- */
const PEAR_PATH = "../pear-demo/index.html"; // out of /store into the fitting room
const LS_TRYON  = "pear_tryon";              // handoff payload
const LS_BAG     = "vanta_bag";              // local bag count

/* ---------- 1. catalog ----------
   schema: id, name, price, category(collection), type, subType, color, isNew  */
const PRODUCTS = [
  // ── SHIRTS ───────────────────────────────────────────────
  { id: 1,  name: "Halo Sleeveless",  price: 88,  category: "Aero",  type: "shirt", subType: "sleeveless",   color: "#e8ff59", isNew: true  },
  { id: 2,  name: "Vapor Tank",       price: 72,  category: "Aero",  type: "shirt", subType: "sleeveless",   color: "#b8c0cc", isNew: false },
  { id: 3,  name: "Ion Crew Tee",     price: 96,  category: "Flux",  type: "shirt", subType: "short_sleeve", color: "#ff5e3a", isNew: true  },
  { id: 4,  name: "Pulse Tee",        price: 84,  category: "Flux",  type: "shirt", subType: "short_sleeve", color: "#1f6feb", isNew: false },
  { id: 5,  name: "Circuit Tee",      price: 90,  category: "Prism", type: "shirt", subType: "short_sleeve", color: "#14e0a0", isNew: false },
  { id: 6,  name: "Strata Longsleeve",price: 128, category: "Noct",  type: "shirt", subType: "long_sleeve",  color: "#2b2b30", isNew: true  },
  { id: 7,  name: "Nimbus Henley",    price: 134, category: "Prism", type: "shirt", subType: "long_sleeve",  color: "#c9b6ff", isNew: false },
  { id: 8,  name: "Echo Longsleeve",  price: 118, category: "Noct",  type: "shirt", subType: "long_sleeve",  color: "#e5e2da", isNew: false },

  // ── PANTS ────────────────────────────────────────────────
  { id: 9,  name: "Glide Slim",       price: 142, category: "Noct",  type: "pants", subType: "slim",    color: "#2a2d34", isNew: true  },
  { id: 10, name: "Mono Slim",        price: 118, category: "Aero",  type: "pants", subType: "slim",    color: "#6e7681", isNew: false },
  { id: 11, name: "Vector Regular",   price: 132, category: "Flux",  type: "pants", subType: "regular", color: "#3b5bdb", isNew: false },
  { id: 12, name: "Apex Regular",     price: 124, category: "Aero",  type: "pants", subType: "regular", color: "#8a8f98", isNew: true  },
  { id: 13, name: "Drift Wide",       price: 156, category: "Noct",  type: "pants", subType: "wide",    color: "#1a1a1d", isNew: false },
  { id: 14, name: "Terra Wide",       price: 148, category: "Prism", type: "pants", subType: "wide",    color: "#b08968", isNew: true  },
  { id: 15, name: "Null Slim",        price: 138, category: "Noct",  type: "pants", subType: "slim",    color: "#0f0f12", isNew: false },
  { id: 16, name: "Cargo Flux",       price: 162, category: "Flux",  type: "pants", subType: "wide",    color: "#5c7c3e", isNew: false },
];

const COLLECTION_INFO = {
  Aero:  { no: "01", desc: "Weightless technical layers tuned for motion and air." },
  Flux:  { no: "02", desc: "High-voltage pigments. Garments that refuse to whisper." },
  Prism: { no: "03", desc: "Iridescent surfaces that shift with the light around you." },
  Noct:  { no: "04", desc: "Vantablack staples for the architecture of the night." },
};

const SUBTYPE_LABEL = {
  sleeveless: "Sleeveless", short_sleeve: "Short Sleeve", long_sleeve: "Long Sleeve",
  slim: "Slim Fit", regular: "Regular Fit", wide: "Wide Leg",
};

/* ---------- 2. color helpers ---------- */
function shade(hex, p) {
  // p in [-1,1]; negative darkens toward black, positive lightens toward white
  const f = parseInt(hex.slice(1), 16);
  const t = p < 0 ? 0 : 255, a = Math.abs(p);
  const R = f >> 16, G = (f >> 8) & 0xff, B = f & 0xff;
  const mix = (c) => Math.round((t - c) * a) + c;
  return "#" + (0x1000000 + mix(R) * 0x10000 + mix(G) * 0x100 + mix(B)).toString(16).slice(1);
}

/* ---------- 3. garment SVG generation ---------- */
const SHIRT_PATHS = {
  sleeveless:   "M92 50 Q110 64 128 50 L144 62 Q151 92 151 122 L151 236 L69 236 L69 122 Q69 92 76 62 Z",
  short_sleeve: "M88 50 Q110 66 132 50 L170 68 L188 122 L166 130 L152 106 L152 236 L68 236 L68 106 L54 130 L32 122 L50 68 Z",
  long_sleeve:  "M88 50 Q110 66 132 50 L170 68 L198 204 L170 212 L152 108 L152 236 L68 236 L68 108 L50 212 L22 204 L50 68 Z",
};
const PANT_PATHS = {
  slim:    "M66 44 L154 44 L150 238 L124 238 L111 120 L96 238 L70 238 Z",
  regular: "M62 44 L158 44 L156 238 L120 238 L110 124 L100 238 L64 238 Z",
  wide:    "M58 44 L162 44 L172 238 L138 238 L112 126 L108 126 L82 238 L48 238 Z",
};

function garmentSVG(p) {
  const gid = "grad" + p.id;
  const sid = "sheen" + p.id;
  const base = p.color;
  const lite = shade(base, 0.24);
  const dark = shade(base, -0.34);
  const ink  = shade(base, -0.5);
  const isShirt = p.type === "shirt";
  const d = isShirt ? SHIRT_PATHS[p.subType] : PANT_PATHS[p.subType];

  // stylized seam / detail lines per garment
  let detail = "";
  if (isShirt) {
    detail += `<ellipse cx="110" cy="55" rx="19" ry="7" fill="none" stroke="${ink}" stroke-width="3" opacity="0.55"/>`; // collar
    detail += `<path d="M110 60 L110 232" stroke="${ink}" stroke-width="1.6" opacity="0.32" fill="none"/>`;             // placket
    if (p.subType === "long_sleeve") {
      detail += `<path d="M186 196 L172 200 M48 196 L34 200" stroke="${ink}" stroke-width="2.4" opacity="0.4"/>`;       // cuffs
    }
  } else {
    detail += `<path d="M64 60 H156" stroke="${ink}" stroke-width="3" opacity="0.4" fill="none"/>`;        // waistband
    detail += `<path d="M110 60 L110 ${p.subType === "wide" ? 126 : 122}" stroke="${ink}" stroke-width="2" opacity="0.3"/>`; // rise seam
    detail += `<path d="M78 228 H96 M124 228 H146" stroke="${ink}" stroke-width="2" opacity="0.3"/>`;      // hems
  }

  return `
  <svg viewBox="0 0 220 260" role="img" aria-label="${p.name}">
    <defs>
      <linearGradient id="${gid}" x1="0" y1="0" x2="0.25" y2="1">
        <stop offset="0"    stop-color="${lite}"/>
        <stop offset="0.55" stop-color="${base}"/>
        <stop offset="1"    stop-color="${dark}"/>
      </linearGradient>
      <linearGradient id="${sid}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0.22"/>
        <stop offset="0.4" stop-color="#ffffff" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${d}" fill="url(#${gid})" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="${d}" fill="url(#${sid})"/>
    ${detail}
  </svg>`;
}

/* ---------- 4. DOM refs ---------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const grid        = $("#grid");
const collView    = $("#collectionsView");
const hero        = $("#hero");
const catTitle    = $("#catTitle");
const catKicker   = $("#catKicker");
const catCount    = $("#catCount");
const navLinks    = $$("#navLinks a");
const toastEl     = $("#toast");
const bagCountEl   = $("#bagCount");
const launchEl    = $("#launch");
const launchSub   = $("#launchSub");

/* ---------- 5. card template ---------- */
function cardHTML(p, i) {
  const sku = `VN-${String(p.id).padStart(3, "0")}-${p.subType.slice(0, 2).toUpperCase()}`;
  return `
  <article class="card" style="--c:${p.color}; --i:${i}">
    <div class="card__media">
      <span class="card__tag">${SUBTYPE_LABEL[p.subType]}</span>
      ${p.isNew ? `<span class="card__new">NEW</span>` : ``}
      <div class="card__glow"></div>
      <span class="card__scan"></span>
      ${garmentSVG(p)}
    </div>
    <div class="card__body">
      <div class="card__row">
        <h3>${p.name}</h3>
        <span class="card__price">$${p.price}</span>
      </div>
      <div class="card__meta">
        <span class="chip"><i style="background:${p.color}"></i>${p.color.toUpperCase()}</span>
        <span class="card__sku">${sku}</span>
      </div>
      <div class="card__actions">
        <button class="btn btn--try" data-try="${p.id}">Try on via PEAR Camera <span>👕</span></button>
        <button class="btn btn--ghost" data-bag="${p.id}" aria-label="Add ${p.name} to bag">+</button>
      </div>
    </div>
  </article>`;
}

function renderCards(list) {
  if (!list.length) {
    grid.innerHTML = `<div class="empty">// NO GARMENTS MATCH THIS SIGNAL</div>`;
    return;
  }
  grid.innerHTML = list.map((p, i) => cardHTML(p, i)).join("");
}

/* ---------- 6. views / routing ---------- */
const VIEWS = {
  new: {
    kicker: "DROP / 026",
    title: "New Arrivals",
    hero: true,
    list: () => PRODUCTS.filter((p) => p.isNew),
  },
  shirts: {
    kicker: "CATALOG / UPPER",
    title: "Shirts",
    hero: false,
    list: () => PRODUCTS.filter((p) => p.type === "shirt"),
  },
  pants: {
    kicker: "CATALOG / LOWER",
    title: "Pants",
    hero: false,
    list: () => PRODUCTS.filter((p) => p.type === "pants"),
  },
  collections: {
    kicker: "ARCHIVE / 04",
    title: "Collections",
    hero: false,
    list: () => PRODUCTS,
  },
};

function setActiveNav(view) {
  navLinks.forEach((a) => a.classList.toggle("is-active", a.dataset.view === view));
}

function renderCollections() {
  grid.hidden = true;
  collView.hidden = false;
  const order = ["Aero", "Flux", "Prism", "Noct"];
  collView.innerHTML = order
    .map((name) => {
      const items = PRODUCTS.filter((p) => p.category === name);
      const info = COLLECTION_INFO[name];
      const cards = items.map((p, i) => cardHTML(p, i)).join("");
      return `
      <section class="collection">
        <div class="collection__head">
          <span class="collection__no">${info.no}</span>
          <h3 class="collection__name">${name}</h3>
          <p class="collection__desc">${info.desc}</p>
        </div>
        <div class="grid">${cards}</div>
      </section>`;
    })
    .join("");
}

function renderView(view) {
  const cfg = VIEWS[view] || VIEWS.new;
  setActiveNav(view);

  hero.hidden = !cfg.hero;
  catKicker.textContent = cfg.kicker;
  catTitle.textContent = cfg.title;

  if (view === "collections") {
    catCount.textContent = `${PRODUCTS.length} PIECES · 4 LINES`;
    renderCollections();
  } else {
    collView.hidden = true;
    grid.hidden = false;
    const list = cfg.list();
    renderCards(list);
    catCount.textContent = `${String(list.length).padStart(2, "0")} PIECES`;
  }

  // jump to catalog if arriving on a filtered view (not the landing hero)
  if (!cfg.hero) {
    document.querySelector(".catalog").scrollIntoView({ behavior: "smooth", block: "start" });
  } else {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function routeFromHash() {
  const view = (location.hash.replace("#", "") || "new").toLowerCase();
  renderView(VIEWS[view] ? view : "new");
}

/* ---------- 7. PEAR try-on handoff ---------- */
function tryOn(product) {
  const colorHex = product.color.replace("#", "");

  // 1) serialize for handoff
  const payload = {
    itemType: product.type,
    subType: product.subType,
    color: colorHex,
    name: product.name,
  };
  try { localStorage.setItem(LS_TRYON, JSON.stringify(payload)); } catch (_) {}

  // 2) build the query string → into the existing fitting room
  const qs = new URLSearchParams({
    itemType: product.type,
    subType: product.subType,
    color: colorHex,
  }).toString();
  const url = `${PEAR_PATH}?${qs}`;

  // 3) premium launch sequence, then redirect
  launchSub.textContent = `routing ${product.name.toLowerCase()}…`;
  launchEl.classList.add("show");
  launchEl.setAttribute("aria-hidden", "false");

  setTimeout(() => { launchSub.textContent = "calibrating fit · color " + colorHex; }, 450);
  setTimeout(() => { window.location.href = url; }, 1050);
}

/* ---------- 8. bag (local polish) ---------- */
function getBag() { return parseInt(localStorage.getItem(LS_BAG) || "0", 10); }
function setBag(n) {
  localStorage.setItem(LS_BAG, String(n));
  bagCountEl.textContent = n;
  bagCountEl.classList.toggle("show", n > 0);
}
function addToBag(product) {
  setBag(getBag() + 1);
  bagCountEl.style.transform = "scale(1.4)";
  setTimeout(() => (bagCountEl.style.transform = ""), 180);
  showToast(`<b>${product.name}</b> added to bag`);
}

/* ---------- 9. toast ---------- */
let toastTimer;
function showToast(html) {
  toastEl.innerHTML = html;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
}

/* ---------- 10. marquee ---------- */
function buildMarquee() {
  const words = [
    "FUTURE FABRIC", "PEAR CAMERA READY", "ZERO RETURNS", "RENDERED LIVE",
    "SS/26 DROP", "FITTED BY AI", "SYNTHETIC COUTURE",
  ];
  const run = words.map((w) => `<span>${w}</span>`).join("");
  $("#marquee").innerHTML = run + run; // duplicated for seamless loop
}

/* ---------- 11. wiring ---------- */
function init() {
  buildMarquee();
  setBag(getBag());

  // feature the acid Halo piece in the hero stage
  $("#heroStage").innerHTML = garmentSVG(PRODUCTS[0]);

  // delegated clicks: try-on, add-to-bag
  document.addEventListener("click", (e) => {
    const tryBtn = e.target.closest("[data-try]");
    if (tryBtn) {
      const p = PRODUCTS.find((x) => x.id === +tryBtn.dataset.try);
      if (p) tryOn(p);
      return;
    }
    const bagItem = e.target.closest("[data-bag]");
    if (bagItem) {
      const p = PRODUCTS.find((x) => x.id === +bagItem.dataset.bag);
      if (p) addToBag(p);
      return;
    }
  });

  // bag button feedback
  $("#bagBtn").addEventListener("click", () => {
    const n = getBag();
    showToast(n ? `Bag holds <b>${n}</b> ${n === 1 ? "piece" : "pieces"}` : "Your bag is empty");
  });

  // newsletter (styled, no backend)
  $("#newsForm").addEventListener("submit", (e) => {
    e.preventDefault();
    e.target.reset();
    showToast("You're on the <b>signal</b> ✦");
  });

  // routing
  window.addEventListener("hashchange", routeFromHash);
  routeFromHash();
}

document.addEventListener("DOMContentLoaded", init);
