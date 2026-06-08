/* ============================================================
   MERIDIAN — shared catalog data + garment SVG generator.
   Loaded before store.js (homepage) and product.js (product page)
   so both render from a single source of truth. Plain globals,
   no build step.
   ============================================================ */
"use strict";

/* ── real product imagery ──
   Premium apparel shots served from Unsplash's CDN (CORS-enabled, hotlink-ok).
   Every URL below was verified to resolve. If any ever 404s, garmentImg() falls
   back to the procedural garmentSVG() so the layout never breaks. Swap these for
   your own product-CDN URLs in production. */
const _UIMG = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=700&q=80`;

/* ── catalog ──
   schema: id, name, price, category, type, subType, color, isNew, fav, imageUrl */
const PRODUCTS = [
  // SHIRTS
  { id: 1,  name: "Halo Tank",         price: 88,  category: "Shirts", type: "shirt", subType: "sleeveless",   color: "#3f5a8a", isNew: true,  fav: true,  imageUrl: _UIMG("photo-1503342217505-b0a15ec3261c") },
  { id: 2,  name: "Vapor Sleeveless",  price: 72,  category: "Shirts", type: "shirt", subType: "sleeveless",   color: "#b8c0cc", isNew: false, fav: false, imageUrl: _UIMG("photo-1521572163474-6864f9cf17ab") },
  { id: 3,  name: "Ion Crew Tee",      price: 96,  category: "Shirts", type: "shirt", subType: "short_sleeve", color: "#c2452f", isNew: true,  fav: true,  imageUrl: _UIMG("photo-1583743814966-8936f5b7be1a") },
  { id: 4,  name: "Pulse Tee",         price: 84,  category: "Shirts", type: "shirt", subType: "short_sleeve", color: "#1f6feb", isNew: false, fav: true,  imageUrl: _UIMG("photo-1576566588028-4147f3842f27") },
  { id: 5,  name: "Circuit Tee",       price: 90,  category: "Shirts", type: "shirt", subType: "short_sleeve", color: "#149c7a", isNew: false, fav: false, imageUrl: _UIMG("photo-1618354691373-d851c5c3a990") },
  { id: 6,  name: "Strata Longsleeve", price: 128, category: "Shirts", type: "shirt", subType: "long_sleeve",  color: "#2b2b30", isNew: true,  fav: true,  imageUrl: _UIMG("photo-1593030761757-71fae45fa0e7") },
  { id: 7,  name: "Nimbus Henley",     price: 134, category: "Shirts", type: "shirt", subType: "long_sleeve",  color: "#8e7bd0", isNew: false, fav: false, imageUrl: _UIMG("photo-1551537482-f2075a1d41f2") },
  { id: 8,  name: "Echo Longsleeve",   price: 118, category: "Shirts", type: "shirt", subType: "long_sleeve",  color: "#d8d4cb", isNew: false, fav: false, imageUrl: _UIMG("photo-1593030761757-71fae45fa0e7") },
  // PANTS
  { id: 9,  name: "Glide Slim",        price: 142, category: "Pants",  type: "pants", subType: "slim",    color: "#2a2d34", isNew: true,  fav: true,  imageUrl: _UIMG("photo-1542272604-787c3835535d") },
  { id: 10, name: "Mono Slim",         price: 118, category: "Pants",  type: "pants", subType: "slim",    color: "#6e7681", isNew: false, fav: false, imageUrl: _UIMG("photo-1624378439575-d8705ad7ae80") },
  { id: 11, name: "Vector Regular",    price: 132, category: "Pants",  type: "pants", subType: "regular", color: "#3b5bdb", isNew: false, fav: true,  imageUrl: _UIMG("photo-1602293589930-45aad59ba3ab") },
  { id: 12, name: "Apex Regular",      price: 124, category: "Pants",  type: "pants", subType: "regular", color: "#8a8f98", isNew: true,  fav: false, imageUrl: _UIMG("photo-1473966968600-fa801b869a1a") },
  { id: 13, name: "Drift Wide",        price: 156, category: "Pants",  type: "pants", subType: "wide",    color: "#1a1a1d", isNew: false, fav: true,  imageUrl: _UIMG("photo-1594633312681-425c7b97ccd1") },
  { id: 14, name: "Terra Wide",        price: 148, category: "Pants",  type: "pants", subType: "wide",    color: "#a8794f", isNew: true,  fav: false, imageUrl: _UIMG("photo-1506629082955-511b1aa562c8") },
  { id: 15, name: "Null Slim",         price: 138, category: "Pants",  type: "pants", subType: "slim",    color: "#22324f", isNew: false, fav: false, imageUrl: _UIMG("photo-1624378439575-d8705ad7ae80") },
  { id: 16, name: "Cargo Wide",        price: 162, category: "Pants",  type: "pants", subType: "wide",    color: "#566b3e", isNew: false, fav: true,  imageUrl: _UIMG("photo-1506629082955-511b1aa562c8") },
];

const SUBTYPE_LABEL = {
  sleeveless: "Sleeveless", short_sleeve: "Short Sleeve", long_sleeve: "Long Sleeve",
  slim: "Slim Fit", regular: "Regular Fit", wide: "Wide Leg",
};

const SIZES = ["S", "M", "L", "XL"];

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

/* ── real-photo renderer with procedural-SVG fallback ──
   Renders the product's real imageUrl. If the CDN image fails to load (404,
   offline, blocked), the inline garmentSVG() is revealed instead so the
   storefront layout never breaks. Fully inline-styled so it fills whatever
   media box the SVG previously occupied — no storefront CSS changes needed.
   `fit` = object-fit (default "cover"). */
function garmentImg(p, opts = {}) {
  const fit = opts.fit || "cover";
  const wrapStyle = "display:block;width:100%;height:100%;position:relative;overflow:hidden;background:#f3f4f6";
  const imgStyle = `width:100%;height:100%;object-fit:${fit};display:block`;
  const svgStyle = "width:100%;height:100%;display:block";
  return `<span class="gimg" data-pid="${p.id}" style="${wrapStyle}">`
    + `<img class="gimg__img" src="${p.imageUrl}" alt="${p.name}" loading="lazy" decoding="async" style="${imgStyle}"`
    + ` onerror="this.style.display='none';var s=this.parentNode.querySelector('.gimg__svg');if(s)s.style.display='block';">`
    + `<span class="gimg__svg" style="${svgStyle};display:none">${garmentSVG(p)}</span>`
    + `</span>`;
}
