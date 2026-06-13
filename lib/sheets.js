/* =============================================================================
   Google Sheets analytics — server-side only, zero PII
   Logs: Timestamp · Garment ID · Garment Name · Garment Type · Sub Type · Size
   Authentication: Google Cloud Service Account (credentials never reach browser)
   ============================================================================= */
import { google } from "googleapis";

const SHEET_ID  = process.env.GOOGLE_SHEETS_ID;
const SHEET_TAB = process.env.GOOGLE_SHEET_TAB || "TryOn Analytics";

let _sheetsClient = null;

function parseCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON env var is not set");
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: ${e.message}`);
  }
}

async function getSheetsClient() {
  if (_sheetsClient) {
    console.log("[sheets] reusing cached sheets client");
    return _sheetsClient;
  }
  console.log("[sheets] initialising new sheets client...");
  const credentials = parseCredentials();
  console.log("[sheets] credentials parsed — client_email:", credentials.client_email);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  _sheetsClient = google.sheets({ version: "v4", auth });
  console.log("[sheets] sheets client ready");
  return _sheetsClient;
}

/**
 * Append one analytics row to the configured Google Sheet.
 * Throws on failure — caller is responsible for catching.
 */
export async function logTryOn({ garmentId, garmentName, garmentType, subType, size }) {
  console.log("[sheets] logTryOn called");
  console.log("[sheets] GOOGLE_SHEETS_ID :", SHEET_ID  ? `✓ (${SHEET_ID})`  : "✗ MISSING");
  console.log("[sheets] GOOGLE_SHEET_TAB :", SHEET_TAB ? `✓ (${SHEET_TAB})` : "✗ MISSING");
  console.log("[sheets] GOOGLE_SERVICE_ACCOUNT_JSON:",
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? "✓ present" : "✗ MISSING");

  if (!SHEET_ID) {
    console.warn("[sheets] GOOGLE_SHEETS_ID not set — skipping analytics");
    return;
  }

  const row = [
    new Date().toISOString(),
    String(garmentId   ?? ""),
    String(garmentName ?? ""),
    String(garmentType ?? ""),
    String(subType     ?? ""),
    String(size        ?? ""),
  ];
  console.log("[sheets] row to append:", JSON.stringify(row));

  try {
    const sheets = await getSheetsClient();
    console.log("[sheets] calling spreadsheets.values.append...");
    const result = await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_TAB}!A:F`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });
    console.log("[sheets] ✓ append succeeded — updatedRange:",
      result.data?.updates?.updatedRange ?? "(unknown)");
  } catch (err) {
    console.error("[sheets] ✗ append FAILED:", err?.message || err);
    if (err?.message?.includes("invalid_grant")) {
      console.error("[sheets] → invalid_grant: service account key may be expired or revoked");
    }
    if (err?.message?.includes("PERMISSION_DENIED") || err?.message?.includes("403")) {
      console.error("[sheets] → 403: service account does NOT have Editor access to the sheet");
    }
    if (err?.message?.includes("404")) {
      console.error("[sheets] → 404: check GOOGLE_SHEETS_ID and GOOGLE_SHEET_TAB are correct");
    }
    console.error("[sheets] full error object:", JSON.stringify(err, Object.getOwnPropertyNames(err)));
    throw err; // re-throw so server.js route handler also logs it
  }
}
