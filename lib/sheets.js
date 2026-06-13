/* =============================================================================
   Google Sheets analytics — server-side only, zero PII
   Logs: Timestamp · Garment ID · Garment Name · Garment Type · Sub Type · Size
   Authentication: Google Cloud Service Account via individual env vars
   ============================================================================= */
import { google } from "googleapis";

let _sheetsClient = null;

async function getSheetsClient() {
  if (_sheetsClient) return _sheetsClient;

  const email      = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  console.log("[sheets] GOOGLE_SERVICE_ACCOUNT_EMAIL:", email      ? `✓ (${email})` : "✗ MISSING");
  console.log("[sheets] GOOGLE_PRIVATE_KEY           :", privateKey ? "✓ present"    : "✗ MISSING");

  if (!email || !privateKey) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY env vars");
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: email,
      private_key:  privateKey,
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  _sheetsClient = google.sheets({ version: "v4", auth });
  console.log("[sheets] client ready");
  return _sheetsClient;
}

/**
 * Append one analytics row to the configured Google Sheet.
 * Throws on failure — caller (server.js route) catches and logs.
 */
export async function logTryOn({ garmentId, garmentName, garmentType, subType, size }) {
  const sheetId  = process.env.GOOGLE_SHEET_ID;
  const sheetTab = "TryOn Analytics";

  console.log("[sheets] logTryOn called");
  console.log("[sheets] GOOGLE_SHEET_ID:", sheetId ? `✓ (${sheetId})` : "✗ MISSING");

  if (!sheetId) {
    console.warn("[sheets] GOOGLE_SHEET_ID not set — skipping analytics");
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
  console.log("[sheets] appending row:", JSON.stringify(row));

  try {
    const sheets = await getSheetsClient();
    const result = await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range:         `${sheetTab}!A:F`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });
    console.log("[sheets] ✓ append succeeded — updatedRange:",
      result.data?.updates?.updatedRange ?? "(unknown)");
  } catch (err) {
    console.error("[sheets] ✗ append FAILED:", err?.message || err);
    if (err?.message?.includes("invalid_grant")) {
      console.error("[sheets] → invalid_grant: check GOOGLE_PRIVATE_KEY is complete and unmodified");
    }
    if (err?.message?.includes("403") || err?.message?.includes("PERMISSION_DENIED")) {
      console.error("[sheets] → 403: share the sheet with", process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, "as Editor");
    }
    if (err?.message?.includes("404")) {
      console.error("[sheets] → 404: check GOOGLE_SHEET_ID value");
    }
    throw err;
  }
}
