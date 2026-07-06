/**
 * Read-only snapshot of a sheet's tabs: header presence + data-row counts.
 * Useful for confirming a test sheet is set up / cleared correctly.
 *
 * Usage:
 *   bun scripts/check-sheet.ts                 # uses GOOGLE_SHEETS_ID from .env
 *   bun scripts/check-sheet.ts --sheet-id <id> # target a specific sheet (e.g. dev)
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
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});
const sheets = google.sheets({ version: "v4", auth });

console.log(`Sheet: ${spreadsheetId}\n`);

const info = await sheets.spreadsheets.get({ spreadsheetId });
const tabs = (info.data.sheets ?? []).map((s) => s.properties?.title).filter(Boolean) as string[];
console.log(`Tabs present: ${tabs.join(", ") || "(none)"}\n`);

for (const tab of tabs) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tab}!A1:Z`,
  });
  const rows = res.data.values ?? [];
  const header = (rows[0] ?? []) as string[];
  const dataRows = Math.max(0, rows.length - 1);
  console.log(`${tab}: ${dataRows} data row(s)`);
  console.log(`  header: ${header.join(" | ") || "(empty)"}`);
  if (dataRows > 0) {
    if (tab === "AuthorizedUsers") {
      rows.slice(1).forEach((r, i) => console.log(`  row ${i + 1}: ${(r as string[]).join(" | ")}`));
    } else {
      const firstId = (rows[1]?.[0] ?? "").toString();
      console.log(`  first data row id/col A: ${firstId}`);
    }
  }
  console.log("");
}
