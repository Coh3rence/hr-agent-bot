/**
 * Clears transactional test data so a fresh end-to-end run starts clean.
 *
 * Wipes the data rows (row 2 down) of Contributors, Agreements, and
 * ReviewFeedback, leaving the header row intact. Never touches Opportunities
 * (the roles you apply to) or AuthorizedUsers (who can log in) — those are the
 * fixtures a test run reads from, not the data it produces.
 *
 * NOTE: this only clears the Google Sheet. The backend (Collabberry fork) DB is
 * a SEPARATE store — leftover Collabberry users there will squat on the
 * email/wallet/handle a fresh signup tries to reuse. To reset the backend too,
 * also run scripts/reset-backend-test-data.sh --org <BETA_APP_ORG_ID> --admin-wallet <SERVICE_ADMIN_WALLET>.
 *
 * Usage:
 *   bun scripts/reset-test-data.ts --sheet-id <id>   # target a specific sheet (dev)
 *   bun scripts/reset-test-data.ts                    # uses GOOGLE_SHEETS_ID from .env
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

const TABS_TO_CLEAR = ["Contributors", "Agreements", "ReviewFeedback"];

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

console.log(`Resetting test data on sheet: ${spreadsheetId}`);
console.log(`Preserving: Opportunities, AuthorizedUsers\n`);

for (const tab of TABS_TO_CLEAR) {
  const before = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tab}!A2:A`,
  });
  const rowCount = before.data.values?.length ?? 0;

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${tab}!A2:Z`,
  });

  console.log(`${tab}: cleared ${rowCount} data row(s) (header kept)`);
}

console.log("\nDone. Tabs are clean and ready for a fresh test run.");
