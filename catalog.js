/* ============================================================
   MERIDIAN — shared catalog data + garment SVG generator.
   Loaded before store.js (homepage) and product.js (product page)
   so both render from a single source of truth. Plain globals,
   no build step.
   ============================================================ */
"use strict";

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
