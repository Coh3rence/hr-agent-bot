/**
 * Read-only check: confirms Agreements!M1 = "aggregatedRate" and N1 = "aggregatedSummary".
 * Usage: bun scripts/verify-aggregation-cols.ts
 */
import { google } from "googleapis";
import { loadEnv } from "./_env";

const env = loadEnv();

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});
const sheets = google.sheets({ version: "v4", auth });

const res = await sheets.spreadsheets.values.get({
  spreadsheetId: env.GOOGLE_SHEETS_ID,
  range: "Agreements!A1:N1",
});

const headers = (res.data.values?.[0] ?? []) as string[];
console.log("Agreements row 1 headers:");
headers.forEach((h, i) => console.log(`  ${String.fromCharCode(65 + i)}: ${h}`));

const m = headers[12];
const n = headers[13];
const ok = m === "aggregatedRate" && n === "aggregatedSummary";
console.log(`\nM1 = "${m}" (expected "aggregatedRate")`);
console.log(`N1 = "${n}" (expected "aggregatedSummary")`);
console.log(ok ? "\n✓ Headers correct" : "\n✗ Headers NOT correct — please fix before proceeding");
process.exit(ok ? 0 : 1);
