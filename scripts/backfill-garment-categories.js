#!/usr/bin/env node
/* =============================================================================
   PEAR — Garment Category Backfill (one-time job)
   -----------------------------------------------------------------------------
   Fetches every row in garment_cache where garment_category IS NULL, classifies
   each image via Gemini Vision (same prompt + model as server.js), and upserts
   the result back to Supabase.

   Requires in .env (or environment):
     SUPABASE_URL              - Supabase project URL
     SUPABASE_SERVICE_ROLE_KEY - Service-role key (bypasses RLS)
     GEMINI_API_KEY            - Google AI Studio key

   Optional:
     BACKFILL_DELAY_MS         - Delay between Gemini calls (default 5000ms = 12 RPM)
     BACKFILL_LIMIT            - Max rows to process (default: all)
     BACKFILL_DRY_RUN=1        - Classify but skip the Supabase upsert (for testing)

   Usage:
     node scripts/backfill-garment-categories.js
     node scripts/backfill-garment-categories.js --dry-run
     BACKFILL_LIMIT=5 node scripts/backfill-garment-categories.js
   ============================================================================= */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

// ── env validation ────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const DELAY_MS = parseInt(process.env.BACKFILL_DELAY_MS || "5000", 10);
const LIMIT = process.env.BACKFILL_LIMIT ? parseInt(process.env.BACKFILL_LIMIT, 10) : null;
const DRY_RUN = process.env.BACKFILL_DRY_RUN === "1" || process.argv.includes("--dry-run");

const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GEMINI_API_KEY}`;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("[backfill] ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  console.error("           Add them to .env or set them in the environment.");
  process.exit(1);
}
if (!GEMINI_API_KEY) {
  console.error("[backfill] ERROR: GEMINI_API_KEY is required.");
  console.error("           Add it to .env or set it in the environment.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

if (DRY_RUN) console.log("[backfill] DRY RUN mode - Supabase will NOT be updated");

// ── Gemini helpers (mirrors server.js exactly) ────────────────────────────────
async function fetchImageAsBase64(imageUrl) {
  const secureUrl = imageUrl.replace(/^http:\/\//, "https://");
  const resp = await fetch(secureUrl);
  if (!resp.ok) throw new Error(`image fetch failed: HTTP ${resp.status} ${resp.statusText}`);
  const contentType = resp.headers.get("content-type") || "image/jpeg";
  const buffer = Buffer.from(await resp.arrayBuffer());
  return { base64: buffer.toString("base64"), mimeType: contentType };
}

async function classifyGarmentFull(imageUrl) {
  const { base64, mimeType } = await fetchImageAsBase64(imageUrl);

  const prompt =
    `You are analysing a garment product photo for an e-commerce catalogue.\n` +
    `Return a JSON object with exactly two fields (no other text):\n` +
    `{\n` +
    `  "frontBack": "front" or "back" (which side of the garment faces the camera),\n` +
    `  "garmentCategory": "pants" if this is jeans, trousers, shorts, leggings or any legwear; ` +
    `"top" if this is a shirt, t-shirt, blouse, sweater, hoodie, jacket or any upper-body garment; ` +
    `"other" for dresses, shoes, accessories, bags, etc.\n` +
    `}\n` +
    `Respond ONLY with valid JSON. Example: {"frontBack":"front","garmentCategory":"top"}`;

  const resp = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data: base64 } },
        ],
      }],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Gemini ${resp.status}: ${text.slice(0, 200)}`);
  }

  const data = await resp.json();
  const raw = (data?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();

  let frontBack = "front", garmentCategory = "top";
  try {
    const parsed = JSON.parse(raw);
    const fb = String(parsed.frontBack || "").toLowerCase();
    frontBack = fb.includes("back") ? "back" : "front";
    const gc = String(parsed.garmentCategory || "").toLowerCase();
    garmentCategory = gc === "pants" ? "pants" : gc === "other" ? "other" : "top";
  } catch {
    const lower = raw.toLowerCase();
    frontBack = lower.includes("back") ? "back" : "front";
    garmentCategory =
      lower.includes("pant") || lower.includes("jean") || lower.includes("trouser")
        ? "pants" : "top";
  }
  return { frontBack, garmentCategory };
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  // Fetch all NULL rows
  let query = supabase
    .from("garment_cache")
    .select("image_url, classification")
    .is("garment_category", null)
    .order("image_url");

  if (LIMIT) query = query.limit(LIMIT);

  const { data: rows, error: fetchErr } = await query;
  if (fetchErr) {
    console.error("[backfill] Failed to query garment_cache:", fetchErr.message);
    process.exit(1);
  }

  if (!rows.length) {
    console.log("[backfill] No rows with garment_category = NULL. Nothing to do.");
    return;
  }

  console.log(`[backfill] ${rows.length} rows to process (delay ${DELAY_MS}ms between calls)\n`);

  let success = 0, failed = 0;
  const failures = [];

  for (let i = 0; i < rows.length; i++) {
    const { image_url, classification } = rows[i];
    const label = `[${i + 1}/${rows.length}]`;
    const shortUrl = image_url.length > 80 ? image_url.slice(0, 77) + "..." : image_url;
    process.stdout.write(`${label} ${shortUrl}\n  → `);

    try {
      const { frontBack, garmentCategory } = await classifyGarmentFull(image_url);
      process.stdout.write(`${garmentCategory} / ${frontBack}`);

      if (!DRY_RUN) {
        const { error: upsertErr } = await supabase
          .from("garment_cache")
          .upsert(
            [{
              image_url,
              classification: classification || frontBack,
              garment_category: garmentCategory,
            }],
            { onConflict: "image_url" }
          );
        if (upsertErr) throw new Error(`Supabase upsert failed: ${upsertErr.message}`);
        process.stdout.write(" [saved]\n");
      } else {
        process.stdout.write(" [dry-run, not saved]\n");
      }

      success++;
    } catch (err) {
      process.stdout.write(`\n  FAILED: ${err.message}\n`);
      failed++;
      failures.push({ url: image_url, reason: err.message });
    }

    if (i < rows.length - 1) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  console.log(`\n[backfill] Done. ${success} updated, ${failed} failed.`);
  if (failures.length) {
    console.log("\nFailed URLs:");
    failures.forEach((f) => console.log(`  ${f.url}\n    ${f.reason}`));
  }
}

main().catch((err) => {
  console.error("[backfill] Fatal:", err.message);
  process.exit(1);
});
