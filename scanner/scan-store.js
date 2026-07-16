#!/usr/bin/env node
/* =============================================================================
   PEAR — Store Scanner
   -----------------------------------------------------------------------------
   Standalone crawler (runs on Railway, independent of the main PEAR server).
   Crawls a storefront, finds every product page, collects garment images, and
   classifies each one as front/back via Gemini — caching results in Supabase's
   garment_cache table so repeat scans never re-classify the same image.

   Usage:
     node scan-store.js https://fox.co.il
   ============================================================================= */

import "dotenv/config";
import fs from "node:fs";
import puppeteer from "puppeteer-core";
import { createClient } from "@supabase/supabase-js";
// Node.js 20 has built-in fetch — no node-fetch dependency needed.

/* Railway/Nixpacks installs a system Chromium rather than letting Puppeteer
   download its own (see nixpacks.toml + the postinstall no-op in package.json).
   PUPPETEER_EXECUTABLE_PATH wins when set; otherwise pick the first of these
   well-known install locations that actually exists on disk. */
function resolveChromePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const candidates = [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

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
const MIN_IMG_SIZE = 200;

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

/* Resolve every <a> on the homepage whose href matches a product-page pattern,
   de-duplicated and normalized to absolute URLs. */
async function findProductLinks(page, baseUrl) {
  const hrefs = await page.$$eval("a", (as) => as.map((a) => a.getAttribute("href") || ""));
  const seen = new Set();
  const links = [];
  for (const href of hrefs) {
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

/* Collect every <img> on a product page whose rendered size exceeds
   MIN_IMG_SIZE x MIN_IMG_SIZE and whose src isn't decorative chrome. */
async function findProductImages(page) {
  const raw = await page.$$eval("img", (imgs) =>
    imgs.map((img) => ({
      src: img.currentSrc || img.src || "",
      width: img.naturalWidth || img.width || 0,
      height: img.naturalHeight || img.height || 0,
    }))
  );
  const seen = new Set();
  const images = [];
  for (const { src, width, height } of raw) {
    if (!src || width < MIN_IMG_SIZE || height < MIN_IMG_SIZE) continue;
    if (isExcludedSrc(src)) continue;
    if (seen.has(src)) continue;
    seen.add(src);
    images.push(src);
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

  const browser = await puppeteer.launch({
    executablePath: resolveChromePath(),
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
    ],
    headless: true,
  });

  let totalImages = 0;
  let frontCount = 0;
  let backCount = 0;
  let cachedCount = 0;

  try {
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (compatible; PEAR-StoreScanner/1.0)");
    await page.goto(storeUrl, { waitUntil: "networkidle2", timeout: 60_000 });

    const productLinks = await findProductLinks(page, storeUrl);
    console.log(`Found ${productLinks.length} product page(s).\n`);

    for (let i = 0; i < productLinks.length; i++) {
      const url = productLinks[i];
      console.log(`Scanning page ${i + 1}/${productLinks.length}: ${url}`);

      try {
        await page.goto(url, { waitUntil: "networkidle2", timeout: 60_000 });
      } catch (err) {
        console.warn(`  ⚠ failed to load page: ${err.message}`);
        continue;
      }

      const images = await findProductImages(page);
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
  } finally {
    await browser.close();
  }

  console.log(
    `\nDone. Total: ${totalImages} images | ${frontCount} front | ${backCount} back | ${cachedCount} cached`
  );
}

main().catch((err) => {
  console.error("✗ Scan failed:", err?.message || err);
  process.exit(1);
});
