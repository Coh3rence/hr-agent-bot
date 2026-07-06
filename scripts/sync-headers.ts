/**
 * Adds the M3-bridge header columns to an existing sheet WITHOUT reseeding data.
 * Only writes the new header cells (Contributors O1:P1, Agreements O1:P1); all
 * existing rows are left untouched. Safe to re-run (idempotent).
 *
 * Usage:
 *   bun scripts/sync-headers.ts                 # uses GOOGLE_SHEETS_ID from .env
 *   bun scripts/sync-headers.ts --sheet-id <id>
 */
import { google } from "googleapis";
import { loadEnv } from "./_env";

const env = loadEnv();

const idIdx = process.argv.indexOf("--sheet-id");
const spreadsheetId = idIdx >= 0 ? process.argv[idIdx + 1] : env.GOOGLE_SHEETS_ID;
if (!spreadsheetId) {
  console.error("No spreadsheet id: pass --sheet-id <id> or set GOOGLE_SHEETS_ID in .env");
  process.exit(1);
}

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

await sheets.spreadsheets.values.batchUpdate({
  spreadsheetId,
  requestBody: {
    valueInputOption: "USER_ENTERED",
    data: [
      { range: "Contributors!O1:Q1", values: [["walletAddress", "collabberryUserId", "collabberryInviteToken"]] },
      { range: "Agreements!O1:P1", values: [["candidateNotifiedAt", "betaAppAgreementId"]] },
    ],
  },
});

console.log("Synced M3 header columns (Contributors O1:Q1, Agreements O1:P1).");
