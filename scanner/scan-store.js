#!/usr/bin/env node
/* =============================================================================
   PEAR — Store Scanner
   -----------------------------------------------------------------------------
   Standalone crawler (runs on Railway, independent of the main PEAR server).
   Crawls a storefront, finds every product page, collects garment images, and
   classifies each one as front/back via Gemini — caching results in Supabase's
   garment_cache table so repeat scans never re-classify the same image.

   No browser involved: product pages are fetched as plain HTML and image URLs
   are pulled out with regex (<img src>, <img data-src> for lazy-loaded images,
   <meta property="og:image" content>). This works on any host with no Chrome/
   Chromium install (Railway's Nix-based Chromium install proved unreliable) —
   the tradeoff is that images injected purely by client-side JavaScript after
   page load won't be found, since the HTML is never rendered. In practice most
   storefronts (Shopify, WooCommerce, etc.) put product images in the initial
   HTML, so this covers the common case.

   Usage:
     node scan-store.js https://fox.co.il
   ============================================================================= */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
// Node.js 20+ has built-in fetch — no node-fetch dependency needed.

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!GEMINI_API_KEY) {
  console.error("✗ GEMINI_API_KEY is not set — copy .env.example to .env and fill it in.");
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("✗ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set — copy .env.example to .env and fill them in.");
  process.exit(1);
}

const storeUrl = process.argv[2];
if (!storeUrl) {
  console.error("Usage: node scan-store.js <store-url>");
  console.error("Example: node scan-store.js https://fox.co.il");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  realtime: { enabled: false },
  global: {
    headers: {},
  },
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
const GEMINI_RATE_LIMIT_MS = 1100; // stay under 60 requests/minute

const PRODUCT_LINK_PATTERNS = ["/products/", "/product/", "/item/", "/p/", "/shop/"];
const EXCLUDE_IMG_SRC = ["logo", "icon", "sprite", "placeholder", "banner", "avatar"];
const FETCH_USER_AGENT = "Mozilla/5.0 (compatible; PEAR-StoreScanner/1.0)";

/* ── helpers ─────────────────────────────────────────────────────────────── */

function isExcludedSrc(src) {
  const s = (src || "").toLowerCase();
  return EXCLUDE_IMG_SRC.some((needle) => s.includes(needle));
}

function isProductLink(href) {
  if (!href) return false;
  const lower = href.toLowerCase();
  return PRODUCT_LINK_PATTERNS.some((p) => lower.includes(p));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHtml(url) {
  const resp = await fetch(url, { headers: { "User-Agent": FETCH_USER_AGENT } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return resp.text();
}

/* Pull a single attribute's value out of a raw HTML tag string, e.g.
   extractAttr('<img src="a.jpg">', 'src') -> "a.jpg". */
function extractAttr(tag, attr) {
  const re = new RegExp(attr + "\\s*=\\s*[\"']([^\"']+)[\"']", "i");
  const m = tag.match(re);
  return m ? m[1] : "";
}

/* Every <a> tag's href that matches a product-page pattern, de-duplicated and
   normalized to absolute URLs. */
function findProductLinks(html, baseUrl) {
  const aTags = html.match(/<a\b[^>]*>/gi) || [];
  const seen = new Set();
  const links = [];
  for (const tag of aTags) {
    const href = extractAttr(tag, "href");
    if (!href || !isProductLink(href)) continue;
    let abs;
    try {
      abs = new URL(href, baseUrl).href;
    } catch {
      continue;
    }
    if (seen.has(abs)) continue;
    seen.add(abs);
    links.push(abs);
  }
  return links;
}

/* Every garment image referenced in a product page's raw HTML:
     - <img src="...">
     - <img data-src="..."> (lazy-loaded images — most themes swap this into
       src via JS on scroll, so the real image only lives here pre-render)
     - <meta property="og:image" content="...">
   De-duplicated and filtered against EXCLUDE_IMG_SRC. Note: without rendering
   the page there's no way to read naturalWidth/naturalHeight, so — unlike a
   browser-driven crawl — this can't filter by rendered image size; it relies
   entirely on the src/filename exclusion list to skip decorative chrome. */
function findProductImages(html, baseUrl) {
  const urls = [];

  const imgTags = html.match(/<img\b[^>]*>/gi) || [];
  for (const tag of imgTags) {
    const src = extractAttr(tag, "data-src") || extractAttr(tag, "src");
    if (src) urls.push(src);
  }

  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metaTags) {
    if (/property\s*=\s*["']og:image["']/i.test(tag)) {
      const content = extractAttr(tag, "content");
      if (content) urls.push(content);
    }
  }

  const seen = new Set();
  const images = [];
  for (const raw of urls) {
    let abs;
    try {
      abs = new URL(raw, baseUrl).href;
    } catch {
      continue;
    }
    if (!/^https?:\/\//i.test(abs)) continue;
    if (isExcludedSrc(abs)) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);
    images.push(abs);
  }
  return images;
}

/* ── Supabase cache ──────────────────────────────────────────────────────── */

async function getCachedClassification(imageUrl) {
  const { data, error } = await supabase
    .from("garment_cache")
    .select("classification")
    .eq("image_url", imageUrl)
    .maybeSingle();
  if (error) {
    console.warn(`  ⚠ garment_cache read failed: ${error.message}`);
    return null;
  }
  return data ? data.classification : null;
}

async function saveClassification(imageUrl, classification) {
  const { error } = await supabase
    .from("garment_cache")
    .upsert([{ image_url: imageUrl, classification }], { onConflict: "image_url" });
  if (error) console.warn(`  ⚠ garment_cache write failed: ${error.message}`);
}

/* ── Gemini classification ───────────────────────────────────────────────── */

async function fetchImageAsBase64(imageUrl) {
  const resp = await fetch(imageUrl);
  if (!resp.ok) throw new Error(`image fetch failed: HTTP ${resp.status}`);
  const contentType = resp.headers.get("content-type") || "image/jpeg";
  const buffer = Buffer.from(await resp.arrayBuffer());
  return { base64: buffer.toString("base64"), mimeType: contentType };
}

async function classifyFrontBack(imageUrl) {
  const { base64, mimeType } = await fetchImageAsBase64(imageUrl);
  const resp = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: "Is this the front or the back of the garment? Answer with exactly one word: front or back" },
            { inline_data: { mime_type: mimeType, data: base64 } },
          ],
        },
      ],
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Gemini ${resp.status}: ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const answer = text.trim().toLowerCase();
  return answer.includes("back") ? "back" : "front";
}

/* ── main crawl ──────────────────────────────────────────────────────────── */

async function main() {
  console.log(`Scanning store: ${storeUrl}\n`);

  let totalImages = 0;
  let frontCount = 0;
  let backCount = 0;
  let cachedCount = 0;

  const homeHtml = await fetchHtml(storeUrl);
  const productLinks = findProductLinks(homeHtml, storeUrl);
  console.log(`Found ${productLinks.length} product page(s).\n`);

  for (let i = 0; i < productLinks.length; i++) {
    const url = productLinks[i];
    console.log(`Scanning page ${i + 1}/${productLinks.length}: ${url}`);

    let html;
    try {
      html = await fetchHtml(url);
    } catch (err) {
      console.warn(`  ⚠ failed to load page: ${err.message}`);
      continue;
    }

    const images = findProductImages(html, url);
    console.log(`Found ${images.length} image(s) — classifying...`);

    for (let j = 0; j < images.length; j++) {
      const imageUrl = images[j];
      totalImages++;
      try {
        let classification = await getCachedClassification(imageUrl);
        let cached = !!classification;

        if (!classification) {
          classification = await classifyFrontBack(imageUrl);
          await saveClassification(imageUrl, classification);
          await sleep(GEMINI_RATE_LIMIT_MS);
        }

        if (cached) cachedCount++;
        if (classification === "back") backCount++; else frontCount++;

        console.log(`Image ${j + 1}: ${classification}${cached ? " (cached)" : " (new)"}`);
      } catch (err) {
        console.warn(`Image ${j + 1}: classification failed — ${err.message}`);
      }
    }
  }

  console.log(
    `\nDone. Total: ${totalImages} images | ${frontCount} front | ${backCount} back | ${cachedCount} cached`
  );
}

main().catch((err) => {
  console.error("✗ Scan failed:", err?.message || err);
  process.exit(1);
});
