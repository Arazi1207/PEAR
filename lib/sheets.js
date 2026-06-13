/* =============================================================================
   Google Sheets analytics — server-side only
   Logs: Timestamp · Garment ID · Garment Name · Garment Type · Sub Type · Size · IP
   Supports both individual env vars AND the JSON blob — whichever Vercel has.
   ============================================================================= */
import { google } from "googleapis";

let _sheetsClient = null;

function resolveCredentials() {
  // Try individual vars first (newer setup)
  const email      = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (email && privateKey) {
    console.log("[sheets] auth: using GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY");
    return { client_email: email, private_key: privateKey };
  }

  // Fall back to JSON blob (older setup)
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    console.log("[sheets] auth: using GOOGLE_SERVICE_ACCOUNT_JSON");
    try { return JSON.parse(raw); } catch (e) {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: " + e.message);
    }
  }

  throw new Error(
    "No Google credentials found. Set either:\n" +
    "  GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY\n" +
    "  or GOOGLE_SERVICE_ACCOUNT_JSON"
  );
}

function resolveSheetId() {
  // Try both naming conventions
  const id = process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SHEETS_ID;
  if (!id) throw new Error("No sheet ID found. Set GOOGLE_SHEET_ID in Vercel env vars.");
  return id;
}

async function getSheetsClient() {
  if (_sheetsClient) return _sheetsClient;
  const credentials = resolveCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  _sheetsClient = google.sheets({ version: "v4", auth });
  console.log("[sheets] client ready");
  return _sheetsClient;
}

export async function logTryOn({ garmentId, garmentName, garmentType, subType, size, ip }) {
  const sheetId  = resolveSheetId();
  const sheetTab = process.env.GOOGLE_SHEET_TAB || "TryOn Analytics";

  const row = [
    new Date().toISOString(),
    String(garmentId   ?? ""),
    String(garmentName ?? ""),
    String(garmentType ?? ""),
    String(subType     ?? ""),
    String(size        ?? ""),
    String(ip          ?? ""),
  ];
  console.log("[sheets] appending:", JSON.stringify(row));

  const sheets = await getSheetsClient();
  const result = await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range:         `${sheetTab}!A:G`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
  console.log("[sheets] ✓ row written:", result.data?.updates?.updatedRange ?? "(unknown)");
}
