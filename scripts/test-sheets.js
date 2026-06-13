/* Quick smoke-test: node scripts/test-sheets.js
   Verifies env-var parsing and writes one test row to the sheet. */
import "dotenv/config";
import { logTryOn } from "../lib/sheets.js";

const id   = process.env.GOOGLE_SHEETS_ID;
const cred = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

console.log("GOOGLE_SHEETS_ID       :", id   ? `✓ (${id})` : "✗ MISSING");
console.log("GOOGLE_SERVICE_ACCOUNT :", cred ? "✓ present" : "✗ MISSING");

if (cred) {
  try { JSON.parse(cred); console.log("JSON parse              : ✓"); }
  catch (e) { console.error("JSON parse              : ✗", e.message); process.exit(1); }
}

if (!id || !cred) process.exit(1);

console.log("\nWriting test row to sheet…");
await logTryOn({ garmentId: 0, garmentName: "TEST", garmentType: "upper_body", subType: "short_sleeve", size: "M" });
console.log("Done — check the sheet for a TEST row.");
