/* =============================================================================
   Google Sheets analytics — server-side only
   Logs: Timestamp · Garment ID · Garment Name · Garment Type · Sub Type · Size · IP
   Authentication: Google Cloud Service Account (GOOGLE_SERVICE_ACCOUNT_JSON)
   ============================================================================= */
import { google } from "googleapis";

let _sheetsClient = null;

async function getSheetsClient() {
  if (_sheetsClient) return _sheetsClient;

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON env var is not set");

  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch (e) {
    throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: ${e.message}`);
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  _sheetsClient = google.sheets({ version: "v4", auth });
  console.log("[sheets] client ready — service account:", credentials.client_email);
  return _sheetsClient;
}

export async function logTryOn({ garmentId, garmentName, garmentType, subType, size, ip }) {
  const sheetId  = process.env.GOOGLE_SHEETS_ID;
  const sheetTab = process.env.GOOGLE_SHEET_TAB || "TryOn Analytics";

  console.log("[sheets] logTryOn called");
  console.log("[sheets] GOOGLE_SHEETS_ID:", sheetId ? `✓ (${sheetId})` : "✗ MISSING");
  console.log("[sheets] GOOGLE_SERVICE_ACCOUNT_JSON:", process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? "✓ present" : "✗ MISSING");

  if (!sheetId) {
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
    String(ip          ?? ""),
  ];
  console.log("[sheets] appending row:", JSON.stringify(row));

  try {
    const sheets = await getSheetsClient();
    const result = await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range:         `${sheetTab}!A:G`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });
    console.log("[sheets] ✓ append succeeded — updatedRange:",
      result.data?.updates?.updatedRange ?? "(unknown)");
  } catch (err) {
    console.error("[sheets] ✗ append FAILED:", err?.message || err);
    if (err?.message?.includes("403") || err?.message?.includes("PERMISSION_DENIED")) {
      console.error("[sheets] → 403: share the sheet with the service account email as Editor");
    }
    throw err;
  }
}
