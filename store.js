/* ════════════════════════════════════════════════════════════
   VANTA storefront — vanilla JS (no build, no deps)
   · product catalog (data objects)
   · generated SVG garments over animated mesh placeholders
   · SPA hash routing / view filtering
   · staggered IntersectionObserver reveals
   · glass selection drawer
   · PEAR Camera handoff → ./pear-demo/index.html (root-relative)
   ════════════════════════════════════════════════════════════ */
"use strict";

/* ── config ── */
const PEAR_PATH = "./pear-demo/index.html";   // store now lives at root
const LS_TRYON  = "pear_tryon";
const LS_BAG    = "vanta_bag";

/* ── catalog ──
   schema: id, name, price, category(line), type, subType, color, isNew */
const PRODUCTS = [
  // SHIRTS
  { id: 1,  name: "Halo",      price: 88,  category: "Aero",  type: "shirt", subType: "sleeveless",   color: "#e8ff59", isNew: true  },
  { id: 2,  name: "Vapor",     price: 72,  category: "Aero",  type: "shirt", subType: "sleeveless",   color: "#b8c0cc", isNew: false },
  { id: 3,  name: "Ion",       price: 96,  category: "Flux",  type: "shirt", subType: "short_sleeve", color: "#ff5e3a", isNew: true  },
  { id: 4,  name: "Pulse",     price: 84,  category: "Flux",  type: "shirt", subType: "short_sleeve", color: "#1f6feb", isNew: false },
  { id: 5,  name: "Circuit",   price: 90,  category: "Prism", type: "shirt", subType: "short_sleeve", color: "#14e0a0", isNew: false },
  { id: 6,  name: "Strata",    price: 128, category: "Noct",  type: "shirt", subType: "long_sleeve",  color: "#2b2b30", isNew: true  },
  { id: 7,  name: "Nimbus",    price: 134, category: "Prism", type: "shirt", subType: "long_sleeve",  color: "#c9b6ff", isNew: false },
  { id: 8,  name: "Echo",      price: 118, category: "Noct",  type: "shirt", subType: "long_sleeve",  color: "#e5e2da", isNew: false },
  // PANTS
  { id: 9,  name: "Glide",     price: 142, category: "Noct",  type: "pants", subType: "slim",    color: "#2a2d34", isNew: true  },
  { id: 10, name: "Mono",      price: 118, category: "Aero",  type: "pants", subType: "slim",    color: "#6e7681", isNew: false },
  { id: 11, name: "Vector",    price: 132, category: "Flux",  type: "pants", subType: "regular", color: "#3b5bdb", isNew: false },
  { id: 12, name: "Apex",      price: 124, category: "Aero",  type: "pants", subType: "regular", color: "#8a8f98", isNew: true  },
  { id: 13, name: "Drift",     price: 156, category: "Noct",  type: "pants", subType: "wide",    color: "#1a1a1d", isNew: false },
  { id: 14, name: "Terra",     price: 148, category: "Prism", type: "pants", subType: "wide",    color: "#b08968", isNew: true  },
  { id: 15, name: "Null",      price: 138, category: "Noct",  type: "pants", subType: "slim",    color: "#0f0f12", isNew: false },
  { id: 16, name: "Cargo",     price: 162, category: "Flux",  type: "pants", subType: "wide",    color: "#5c7c3e", isNew: false },
];

const LINE_INFO = {
  Aero:  { no: "01", desc: "Weightless technical layers tuned for motion and air." },
  Flux:  { no: "02", desc: "High-voltage pigments. Garments that refuse to whisper." },
  Prism: { no: "03", desc: "Iridescent surfaces that shift with the light around you." },
  Noct:  { no: "04", desc: "Vantablack staples for the architecture of the night." },
};

const SUBTYPE_LABEL = {
  sleeveless: "Sleeveless", short_sleeve: "Short Sleeve", long_sleeve: "Long Sleeve",
  slim: "Slim", regular: "Regular", wide: "Wide Leg",
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
  const lite = shade(p.color, 0.24), base = p.color, dark = shade(p.color, -0.34), ink = shade(p.color, -0.5);
  const isShirt = p.type === "shirt";
  const d = isShirt ? SHIRT_PATHS[p.subType] : PANT_PATHS[p.subType];

  let detail = "";
  if (isShirt) {
    detail += `<ellipse cx="110" cy="55" rx="19" ry="7" fill="none" stroke="${ink}" stroke-width="3" opacity="0.5"/>`;
    detail += `<path d="M110 60 L110 232" stroke="${ink}" stroke-width="1.6" opacity="0.3" fill="none"/>`;
    if (p.subType === "long_sleeve")
      detail += `<path d="M186 196 L172 200 M48 196 L34 200" stroke="${ink}" stroke-width="2.4" opacity="0.4"/>`;
  } else {
    detail += `<path d="M64 60 H156" stroke="${ink}" stroke-width="3" opacity="0.4"/>`;
    detail += `<path d="M110 60 L110 ${p.subType === "wide" ? 126 : 122}" stroke="${ink}" stroke-width="2" opacity="0.3"/>`;
    detail += `<path d="M78 228 H96 M124 228 H146" stroke="${ink}" stroke-width="2" opacity="0.3"/>`;
  }

  return `<svg viewBox="0 0 220 260" role="img" aria-label="${p.name}">
    <defs>
      <linearGradient id="${gid}" x1="0" y1="0" x2="0.25" y2="1">
        <stop offset="0" stop-color="${lite}"/><stop offset="0.55" stop-color="${base}"/><stop offset="1" stop-color="${dark}"/>
      </linearGradient>
      <linearGradient id="${sid}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0.22"/><stop offset="0.4" stop-color="#ffffff" stop-opacity="0"/>
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

const grid      = $("#grid");
const linesView = $("#lines");
const hero      = $("#hero");
const cataTitle = $("#cataTitle");
const cataNo    = $("#cataNo");
const cataNote  = $("#cataNote");
const cataCount = $("#cataCount");
const navLinks  = $$("#nav a");
const toastEl   = $("#toast");
const bagCountEl = $("#bagCount");
const launchEl  = $("#launch");
const launchSub = $("#launchSub");
const drawerEl  = $("#drawer");
const drawerItems = $("#drawerItems");
const drawerTotal = $("#drawerTotal");

/* ── editorial layout rhythm ── */
function tileClass(i) {
  const m = i % 6;
  if (m === 0) return "tile tile--feature"; // tall, span 3
  if (m === 3) return "tile tile--wide";    // landscape, span 4
  return "tile";                            // span 2
}

/* ── tile template ── */
function tileHTML(p, i) {
  const sku = `VN-${String(p.id).padStart(3, "0")}`;
  return `
  <article class="${tileClass(i)}" style="--c:${p.color}" data-rev="${i}">
    <div class="tile__media">
      <div class="tile__mesh"></div>
      <div class="tile__grid"></div>
      <div class="tile__art">${garmentSVG(p)}</div>
      <div class="tile__sweep"></div>
      <div class="tile__flags">
        <span class="tile__sub">${SUBTYPE_LABEL[p.subType]}</span>
        <span class="tile__new"${p.isNew ? "" : " hidden"}>New</span>
      </div>
    </div>
    <div class="tile__body">
      <div class="tile__row">
        <h3 class="tile__name">${p.name}</h3>
        <span class="tile__price">$${p.price}</span>
      </div>
      <div class="tile__line">
        <i style="background:${p.color}"></i>${p.color.toUpperCase()}
        <span class="sku">${sku}</span>
      </div>
      <div class="tile__act">
        <button class="btn btn--try" data-try="${p.id}">
          <span class="label">Try on via PEAR Camera</span><span class="cam">👕</span>
        </button>
        <button class="btn btn--add" data-bag="${p.id}" aria-label="Add ${p.name} to selection"><span>+</span></button>
      </div>
    </div>
  </article>`;
}

/* ── staggered reveal ── */
let io;
function observeTiles(scope) {
  if (!io) {
    io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) {
          const i = +en.target.dataset.rev || 0;
          en.target.style.transitionDelay = `${Math.min(i, 9) * 70}ms`;
          en.target.classList.add("is-in");
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.08, rootMargin: "0px 0px -8% 0px" });
  }
  $$(".tile", scope).forEach((t) => io.observe(t));
}

/* ── render helpers ── */
function renderGrid(list) {
  if (!list.length) { grid.innerHTML = `<div class="empty">// NO GARMENTS MATCH THIS SIGNAL</div>`; return; }
  grid.innerHTML = list.map((p, i) => tileHTML(p, i)).join("");
  observeTiles(grid);
}

function renderLines() {
  grid.hidden = true; linesView.hidden = false;
  const order = ["Aero", "Flux", "Prism", "Noct"];
  linesView.innerHTML = order.map((name) => {
    const items = PRODUCTS.filter((p) => p.category === name);
    const info = LINE_INFO[name];
    return `
    <section class="line">
      <header class="line__head">
        <span class="line__no">${info.no}</span>
        <h3 class="line__name">${name}</h3>
        <p class="line__desc">${info.desc}</p>
      </header>
      <div class="grid">${items.map((p, i) => tileHTML(p, i)).join("")}</div>
    </section>`;
  }).join("");
  observeTiles(linesView);
}

/* ── views / routing ── */
const VIEWS = {
  new:         { no: "03 — 026", title: "New Arrivals", note: "Freshly transmitted, configured for instant fitting.", hero: true,  list: () => PRODUCTS.filter((p) => p.isNew) },
  shirts:      { no: "01 — UPPER", title: "Shirts",       note: "Upper-body silhouettes — sleeveless to long sleeve.", hero: false, list: () => PRODUCTS.filter((p) => p.type === "shirt") },
  pants:       { no: "02 — LOWER", title: "Pants",        note: "Lower-body cuts — slim, regular and wide leg.",       hero: false, list: () => PRODUCTS.filter((p) => p.type === "pants") },
  collections: { no: "04 — ARCHIVE", title: "Collections", note: "Four lines, sixteen pieces, one signal.",             hero: false, list: () => PRODUCTS },
};

function setActiveNav(view) { navLinks.forEach((a) => a.classList.toggle("is-active", a.dataset.view === view)); }

function renderView(view) {
  const cfg = VIEWS[view] || VIEWS.new;
  setActiveNav(view);
  hero.hidden = !cfg.hero;
  cataNo.textContent = cfg.no;
  cataTitle.innerHTML = cfg.title;
  cataNote.textContent = cfg.note;

  if (view === "collections") {
    cataCount.textContent = `${PRODUCTS.length} PIECES · 4 LINES`;
    renderLines();
  } else {
    linesView.hidden = true; grid.hidden = false;
    const list = cfg.list();
    renderGrid(list);
    cataCount.textContent = `${String(list.length).padStart(2, "0")} PIECES`;
  }

  if (cfg.hero) window.scrollTo({ top: 0, behavior: "smooth" });
  else $(".cata").scrollIntoView({ behavior: "smooth", block: "start" });
}

function routeFromHash() {
  const v = (location.hash.replace("#", "") || "new").toLowerCase();
  renderView(VIEWS[v] ? v : "new");
}

/* ── PEAR try-on handoff ── */
function tryOn(p) {
  const color = p.color.replace("#", "");

  // serialize for handoff (localStorage backup)
  try {
    localStorage.setItem(LS_TRYON, JSON.stringify({ itemType: p.type, subType: p.subType, color, name: p.name }));
  } catch (_) {}

  // query string → root-relative path into the fitting room
  const qs = new URLSearchParams({ itemType: p.type, subType: p.subType, color }).toString();
  const url = `${PEAR_PATH}?${qs}`;

  // premium launch sequence, then redirect
  launchSub.textContent = `routing ${p.name.toLowerCase()}…`;
  launchEl.classList.add("show");
  launchEl.setAttribute("aria-hidden", "false");
  setTimeout(() => { launchSub.textContent = `calibrating fit · ${p.type} · ${color}`; }, 480);
  setTimeout(() => { window.location.href = url; }, 1080);
}

/* ── selection (bag) + glass drawer ── */
function getBag() { try { return JSON.parse(localStorage.getItem(LS_BAG)) || []; } catch (_) { return []; } }
function setBag(arr) { localStorage.setItem(LS_BAG, JSON.stringify(arr)); syncBag(); }
function syncBag() {
  const n = getBag().length;
  bagCountEl.textContent = n;
  bagCountEl.style.color = n ? "var(--neon)" : "var(--bone-dim)";
}
function addToBag(p) {
  const bag = getBag(); bag.push(p.id); setBag(bag);
  bagCountEl.animate([{ transform: "scale(1.5)" }, { transform: "scale(1)" }], { duration: 280, easing: "cubic-bezier(.19,1,.22,1)" });
  showToast(`<b>${p.name}</b> added to selection`);
}
function removeFromBag(id) {
  const bag = getBag(); const i = bag.indexOf(id);
  if (i > -1) bag.splice(i, 1);
  setBag(bag); renderDrawer();
}

function renderDrawer() {
  const ids = getBag();
  const counts = ids.reduce((m, id) => (m[id] = (m[id] || 0) + 1, m), {});
  const entries = Object.keys(counts).map(Number);

  if (!entries.length) {
    drawerItems.innerHTML = `<div class="drawer__empty">// YOUR SELECTION IS EMPTY</div>`;
    drawerTotal.textContent = "$0";
    return;
  }
  let total = 0;
  drawerItems.innerHTML = entries.map((id) => {
    const p = PRODUCTS.find((x) => x.id === id); const qty = counts[id];
    total += p.price * qty;
    return `
    <div class="drawer__item" style="--c:${p.color}">
      <div class="drawer__thumb"><div class="m"></div>${garmentSVG(p)}</div>
      <div class="drawer__meta">
        <b>${p.name}${qty > 1 ? ` ×${qty}` : ""}</b>
        <span>${p.type} · ${SUBTYPE_LABEL[p.subType]}</span>
      </div>
      <div class="drawer__right">
        <span class="p">$${p.price * qty}</span>
        <button class="drawer__rm" data-rm="${p.id}">Remove</button>
      </div>
    </div>`;
  }).join("");
  drawerTotal.textContent = `$${total}`;
}
function openDrawer() { renderDrawer(); drawerEl.classList.add("open"); drawerEl.setAttribute("aria-hidden", "false"); }
function closeDrawer() { drawerEl.classList.remove("open"); drawerEl.setAttribute("aria-hidden", "true"); }

/* ── toast ── */
let toastTimer;
function showToast(html) {
  toastEl.innerHTML = html; toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
}

/* ── init ── */
function init() {
  syncBag();
  $("#heroStage").innerHTML = garmentSVG(PRODUCTS[0]); // feature the acid Halo

  // delegated actions
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-try]");
    if (t) { const p = PRODUCTS.find((x) => x.id === +t.dataset.try); if (p) tryOn(p); return; }
    const a = e.target.closest("[data-bag]");
    if (a) { const p = PRODUCTS.find((x) => x.id === +a.dataset.bag); if (p) addToBag(p); return; }
    const r = e.target.closest("[data-rm]");
    if (r) { removeFromBag(+r.dataset.rm); return; }
    if (e.target.closest("[data-close]")) { closeDrawer(); return; }
  });

  $("#bagBtn").addEventListener("click", openDrawer);
  $("#checkoutBtn").addEventListener("click", () => {
    if (!getBag().length) return showToast("Your selection is empty");
    showToast("Fitting reserved — open the <b>PEAR Camera</b> to confirm");
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

  $("#newsForm").addEventListener("submit", (e) => { e.preventDefault(); e.target.reset(); showToast("You're on the <b>transmission</b> list ✦"); });

  window.addEventListener("hashchange", routeFromHash);
  routeFromHash();
}

document.addEventListener("DOMContentLoaded", init);
