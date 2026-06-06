/* ============================================================
   MERIDIAN storefront — vanilla JS (no build, no dependencies)
   Modules: announcement ticker · hero ticker · New Arrivals grid ·
   Lookbook collage · filterable catalog · Customer Favorites carousel ·
   PEAR Camera handoff → ./pear-demo/index.html (root-relative)
   ============================================================ */
"use strict";

/* ── config ── */
const PEAR_PATH = "./pear-demo/index.html"; // store lives at root
const LS_TRYON  = "pear_tryon";
const LS_BAG    = "meridian_bag";

/* ── catalog ──
   schema: id, name, price, category, type, subType, color, isNew, fav */
const PRODUCTS = [
  // SHIRTS
  { id: 1,  name: "Halo Tank",         price: 88,  category: "Shirts", type: "shirt", subType: "sleeveless",   color: "#3f5a8a", isNew: true,  fav: true  },
  { id: 2,  name: "Vapor Sleeveless",  price: 72,  category: "Shirts", type: "shirt", subType: "sleeveless",   color: "#b8c0cc", isNew: false, fav: false },
  { id: 3,  name: "Ion Crew Tee",      price: 96,  category: "Shirts", type: "shirt", subType: "short_sleeve", color: "#c2452f", isNew: true,  fav: true  },
  { id: 4,  name: "Pulse Tee",         price: 84,  category: "Shirts", type: "shirt", subType: "short_sleeve", color: "#1f6feb", isNew: false, fav: true  },
  { id: 5,  name: "Circuit Tee",       price: 90,  category: "Shirts", type: "shirt", subType: "short_sleeve", color: "#149c7a", isNew: false, fav: false },
  { id: 6,  name: "Strata Longsleeve", price: 128, category: "Shirts", type: "shirt", subType: "long_sleeve",  color: "#2b2b30", isNew: true,  fav: true  },
  { id: 7,  name: "Nimbus Henley",     price: 134, category: "Shirts", type: "shirt", subType: "long_sleeve",  color: "#8e7bd0", isNew: false, fav: false },
  { id: 8,  name: "Echo Longsleeve",   price: 118, category: "Shirts", type: "shirt", subType: "long_sleeve",  color: "#d8d4cb", isNew: false, fav: false },
  // PANTS
  { id: 9,  name: "Glide Slim",        price: 142, category: "Pants",  type: "pants", subType: "slim",    color: "#2a2d34", isNew: true,  fav: true  },
  { id: 10, name: "Mono Slim",         price: 118, category: "Pants",  type: "pants", subType: "slim",    color: "#6e7681", isNew: false, fav: false },
  { id: 11, name: "Vector Regular",    price: 132, category: "Pants",  type: "pants", subType: "regular", color: "#3b5bdb", isNew: false, fav: true  },
  { id: 12, name: "Apex Regular",      price: 124, category: "Pants",  type: "pants", subType: "regular", color: "#8a8f98", isNew: true,  fav: false },
  { id: 13, name: "Drift Wide",        price: 156, category: "Pants",  type: "pants", subType: "wide",    color: "#1a1a1d", isNew: false, fav: true  },
  { id: 14, name: "Terra Wide",        price: 148, category: "Pants",  type: "pants", subType: "wide",    color: "#a8794f", isNew: true,  fav: false },
  { id: 15, name: "Null Slim",         price: 138, category: "Pants",  type: "pants", subType: "slim",    color: "#22324f", isNew: false, fav: false },
  { id: 16, name: "Cargo Wide",        price: 162, category: "Pants",  type: "pants", subType: "wide",    color: "#566b3e", isNew: false, fav: true  },
];

const SUBTYPE_LABEL = {
  sleeveless: "Sleeveless", short_sleeve: "Short Sleeve", long_sleeve: "Long Sleeve",
  slim: "Slim Fit", regular: "Regular Fit", wide: "Wide Leg",
};

const FILTERS = {
  all:   { title: "All Products", sub: "Our complete range of premium essentials.",         test: () => true },
  shirt: { title: "Shirts",       sub: "Tailored upper-body essentials for every day.",      test: (p) => p.type === "shirt" },
  pants: { title: "Pants",        sub: "Refined trousers cut for comfort and movement.",      test: (p) => p.type === "pants" },
  new:   { title: "New Arrivals", sub: "The latest additions to the Spring 2026 collection.", test: (p) => p.isNew },
};

/* ── color helper ── */
function shade(hex, p) {
  const f = parseInt(hex.slice(1), 16);
  const t = p < 0 ? 0 : 255, a = Math.abs(p);
  const R = f >> 16, G = (f >> 8) & 0xff, B = f & 0xff;
  const mix = (c) => Math.round((t - c) * a) + c;
  return "#" + (0x1000000 + mix(R) * 0x10000 + mix(G) * 0x100 + mix(B)).toString(16).slice(1);
}

/* ── garment SVG generation ── */
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
  const gid = "g" + p.id, sid = "s" + p.id;
  const lite = shade(p.color, 0.22), base = p.color, dark = shade(p.color, -0.32), ink = shade(p.color, -0.48);
  const isShirt = p.type === "shirt";
  const d = isShirt ? SHIRT_PATHS[p.subType] : PANT_PATHS[p.subType];

  let detail = "";
  if (isShirt) {
    detail += `<ellipse cx="110" cy="55" rx="19" ry="7" fill="none" stroke="${ink}" stroke-width="3" opacity="0.45"/>`;
    detail += `<path d="M110 60 L110 232" stroke="${ink}" stroke-width="1.6" opacity="0.28" fill="none"/>`;
    if (p.subType === "long_sleeve")
      detail += `<path d="M186 196 L172 200 M48 196 L34 200" stroke="${ink}" stroke-width="2.4" opacity="0.38"/>`;
  } else {
    detail += `<path d="M64 60 H156" stroke="${ink}" stroke-width="3" opacity="0.38"/>`;
    detail += `<path d="M110 60 L110 ${p.subType === "wide" ? 126 : 122}" stroke="${ink}" stroke-width="2" opacity="0.28"/>`;
    detail += `<path d="M78 228 H96 M124 228 H146" stroke="${ink}" stroke-width="2" opacity="0.28"/>`;
  }

  return `<svg viewBox="0 0 220 260" role="img" aria-label="${p.name}">
    <defs>
      <linearGradient id="${gid}" x1="0" y1="0" x2="0.25" y2="1">
        <stop offset="0" stop-color="${lite}"/><stop offset="0.55" stop-color="${base}"/><stop offset="1" stop-color="${dark}"/>
      </linearGradient>
      <linearGradient id="${sid}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0.25"/><stop offset="0.45" stop-color="#ffffff" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${d}" fill="url(#${gid})" stroke="${ink}" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="${d}" fill="url(#${sid})"/>
    ${detail}
  </svg>`;
}

/* ── DOM refs ── */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const grid     = $("#grid");
const newGrid  = $("#newGrid");
const lookGrid = $("#lookGrid");
const favTrack = $("#favTrack");
const catTitle = $("#catTitle");
const catSub   = $("#catSub");
const navLinks = $$("#nav a");
const chips    = $$("#filters .chip");
const bagCount = $("#bagCount");
const toastEl  = $("#toast");

/* ── card template ── */
function cardHTML(p, i) {
  return `
  <article class="card" style="--i:${i}">
    <div class="card__media">
      <span class="card__badge"${p.isNew ? "" : " hidden"}>New</span>
      ${garmentSVG(p)}
    </div>
    <div class="card__body">
      <span class="card__cat">${p.category} · ${SUBTYPE_LABEL[p.subType]}</span>
      <h3 class="card__name">${p.name}</h3>
      <span class="card__price">$${p.price}</span>
      <div class="card__actions">
        <button class="btn--try" data-try="${p.id}">Try on via PEAR Camera <span>👕</span></button>
        <button class="btn--add" data-bag="${p.id}" aria-label="Add ${p.name} to bag">+</button>
      </div>
    </div>
  </article>`;
}

/* ── catalog (filterable) ── */
function renderCatalog(filterKey) {
  const cfg = FILTERS[filterKey] || FILTERS.all;
  const list = PRODUCTS.filter(cfg.test);
  catTitle.textContent = cfg.title;
  catSub.textContent = cfg.sub;
  grid.innerHTML = list.length
    ? list.map((p, i) => cardHTML(p, i)).join("")
    : `<div class="empty">No products found in this category.</div>`;
  navLinks.forEach((a) => a.classList.toggle("is-active", a.dataset.filter === filterKey));
  chips.forEach((c) => c.classList.toggle("is-active", c.dataset.filter === filterKey));
}

/* ── New Arrivals (static) ── */
function renderNew() {
  newGrid.innerHTML = PRODUCTS.filter((p) => p.isNew).slice(0, 4).map((p, i) => cardHTML(p, i)).join("");
}

/* ── Lookbook collage (static, editorial spans) ── */
function renderLookbook() {
  const picks = [1, 9, 3, 13, 6, 11].map((id) => PRODUCTS.find((p) => p.id === id));
  const spans = ["tall", "", "wide", "", "", ""]; // first tall, third wide → editorial rhythm
  lookGrid.innerHTML = picks.map((p, i) => `
    <div class="look__tile ${spans[i]}" data-filter="${p.type}">
      ${garmentSVG(p)}
      <div class="look__cap"><b>${p.name}</b><span>${p.category}</span></div>
    </div>`).join("");
}

/* ── Customer Favorites carousel (static) ── */
function renderFavs() {
  favTrack.innerHTML = PRODUCTS.filter((p) => p.fav).map((p, i) => cardHTML(p, i)).join("");
}

/* ── routing (hash ↔ catalog filter) ── */
const HASH_TO_FILTER = { home: "all", all: "all", shirts: "shirt", shirt: "shirt", pants: "pants", new: "new" };
function currentFilter() {
  const h = location.hash.replace("#", "").toLowerCase();
  if (h === "lookbook" || h === "catalog") return null; // anchor-only, keep current catalog state
  return HASH_TO_FILTER[h] || "all";
}
function routeFromHash() {
  const f = currentFilter();
  if (f) renderCatalog(f);
}

/* ── PEAR try-on handoff ── */
function tryOn(p) {
  const color = p.color.replace("#", "");
  try { localStorage.setItem(LS_TRYON, JSON.stringify({ itemType: p.type, subType: p.subType, color, name: p.name })); } catch (_) {}
  const qs = new URLSearchParams({ itemType: p.type, subType: p.subType, color }).toString();
  const url = `${PEAR_PATH}?${qs}`;
  showToast(`Launching <b>PEAR Camera</b> — ${p.name}…`);
  setTimeout(() => { window.location.href = url; }, 650);
}

/* ── bag ── */
function getBag() { return parseInt(localStorage.getItem(LS_BAG) || "0", 10); }
function setBag(n) { localStorage.setItem(LS_BAG, String(n)); bagCount.textContent = n; bagCount.classList.toggle("show", n > 0); }
function addToBag(p) {
  setBag(getBag() + 1);
  bagCount.animate([{ transform: "scale(1.4)" }, { transform: "scale(1)" }], { duration: 260, easing: "ease-out" });
  showToast(`<b>${p.name}</b> added to bag`);
}

/* ── toast ── */
let toastTimer;
function showToast(html) {
  toastEl.innerHTML = html; toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2400);
}

/* ── tickers ── */
function buildTickers() {
  const ann = ["Free shipping & returns on every order", "Try on instantly via PEAR Camera 👕", "New Spring 2026 collection now live", "Members get early access to drops"];
  const a = ann.map((t) => `<span>${t}</span>`).join("");
  $("#announce").innerHTML = a + a;
  const tk = ["Made to move", "Fitted in seconds", "Premium essentials", "Engineered tailoring", "Spring 2026"];
  const t = tk.map((x) => `<span>${x}</span>`).join("");
  $("#ticker").innerHTML = t + t + t;
}

/* ── init ── */
function init() {
  setBag(getBag());
  buildTickers();
  renderNew();
  renderLookbook();
  renderFavs();

  // delegated clicks
  document.addEventListener("click", (e) => {
    const f = e.target.closest("[data-filter]");
    if (f) {
      const key = f.dataset.filter;
      const hash = key === "all" ? "home" : key === "shirt" ? "shirts" : key;
      if (location.hash.replace("#", "") === hash) renderCatalog(HASH_TO_FILTER[hash]);
      else location.hash = hash;
      if (key !== "all" || f.closest(".look__tile") || f.closest(".lookbook")) {
        $("#catalog").scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }
    const t = e.target.closest("[data-try]");
    if (t) { const p = PRODUCTS.find((x) => x.id === +t.dataset.try); if (p) tryOn(p); return; }
    const a = e.target.closest("[data-bag]");
    if (a) { const p = PRODUCTS.find((x) => x.id === +a.dataset.bag); if (p) addToBag(p); return; }
  });

  // favorites carousel controls
  const step = () => Math.min(favTrack.clientWidth * 0.8, 360);
  $("#favPrev").addEventListener("click", () => favTrack.scrollBy({ left: -step(), behavior: "smooth" }));
  $("#favNext").addEventListener("click", () => favTrack.scrollBy({ left: step(), behavior: "smooth" }));

  $("#bagBtn").addEventListener("click", () => {
    const n = getBag();
    showToast(n ? `Your bag holds <b>${n}</b> ${n === 1 ? "item" : "items"}` : "Your bag is empty");
  });

  $("#newsForm").addEventListener("submit", (e) => { e.preventDefault(); e.target.reset(); showToast("Thanks — you're <b>subscribed</b>!"); });

  window.addEventListener("hashchange", routeFromHash);

  // initial catalog state from hash (default all)
  renderCatalog(currentFilter() || "all");
}

document.addEventListener("DOMContentLoaded", init);
