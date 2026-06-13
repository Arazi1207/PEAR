/* Quick smoke-test: node scripts/test-sheets.js
   Verifies env-var parsing and writes one test row to the sheet. */
import "dotenv/config";
import { logTryOn } from "../lib/sheets.js";

const id    = process.env.GOOGLE_SHEET_ID;
const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const key   = process.env.GOOGLE_PRIVATE_KEY;

console.log("GOOGLE_SHEET_ID              :", id    ? `✓ (${id})`    : "✗ MISSING");
console.log("GOOGLE_SERVICE_ACCOUNT_EMAIL :", email ? `✓ (${email})` : "✗ MISSING");
console.log("GOOGLE_PRIVATE_KEY           :", key   ? "✓ present"    : "✗ MISSING");

if (!id || !email || !key) process.exit(1);

console.log("\nWriting test row to sheet…");
await logTryOn({ garmentId: 0, garmentName: "TEST", garmentType: "upper_body", subType: "short_sleeve", size: "M" });
console.log("Done — check the sheet for a TEST row.");
