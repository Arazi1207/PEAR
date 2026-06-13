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
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON — check Vercel env var formatting");
  }
}

async function getSheetsClient() {
  if (_sheetsClient) return _sheetsClient;
  const credentials = parseCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  _sheetsClient = google.sheets({ version: "v4", auth });
  return _sheetsClient;
}

/**
 * Append one analytics row to the configured Google Sheet.
 * Silently skips (with a console warning) if GOOGLE_SHEETS_ID is not configured.
 * Never throws — a tracking failure must never affect the try-on session.
 */
export async function logTryOn({ garmentId, garmentName, garmentType, subType, size }) {
  if (!SHEET_ID) {
    console.warn("[sheets] GOOGLE_SHEETS_ID not set — analytics skipped");
    return;
  }
  try {
    const sheets = await getSheetsClient();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_TAB}!A:F`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[
          new Date().toISOString(),
          String(garmentId   ?? ""),
          String(garmentName ?? ""),
          String(garmentType ?? ""),
          String(subType     ?? ""),
          String(size        ?? ""),
        ]],
      },
    });
    console.log(`[sheets] logged try-on: ${garmentName} (${size})`);
  } catch (err) {
    console.error("[sheets] append failed:", err?.message || err);
  }
}
