/**
 * Idempotent: ensures the `ReviewFeedback` tab exists with the canonical headers.
 *
 * Why this exists: the prod sheet was never given a ReviewFeedback tab, so every
 * reviewer Approve/Counter/Reject has been silently dropped (BACKLOG BL-001).
 * `setup-sheets.ts` would create it but also overwrites sample data, so it can't be
 * re-run against a live sheet. This script does only the additive, safe part.
 *
 * Behavior:
 *   - tab missing            -> create it + write headers, exit 0
 *   - tab exists, headers OK  -> no-op, exit 0
 *   - tab exists, row 1 empty -> write headers (no data loss), exit 0
 *   - tab exists, row 1 wrong -> report mismatch, DO NOT overwrite, exit 1
 *
 * Usage:
 *   bun scripts/ensure-reviewfeedback-tab.ts                 # uses GOOGLE_SHEETS_ID from .env
 *   bun scripts/ensure-reviewfeedback-tab.ts --sheet-id <id> # target a specific sheet (e.g. dev)
 */
import { google } from "googleapis";
import { loadEnv } from "./_env";

const CANONICAL_HEADERS = [
  "agreementId",
  "reviewerId",
  "reviewerName",
  "decision",
  "suggestedRate",
  "qualitativeFeedback",
  "submittedAt",
];

const env = loadEnv();

const sheetIdIdx = process.argv.indexOf("--sheet-id");
const sheetIdOverride = sheetIdIdx >= 0 ? process.argv[sheetIdIdx + 1] : null;
const spreadsheetId = sheetIdOverride || env.GOOGLE_SHEETS_ID;
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

console.log(`Target sheet: ${spreadsheetId}${sheetIdOverride ? " (--sheet-id override)" : " (from .env)"}`);

const info = await sheets.spreadsheets.get({ spreadsheetId });
const exists = info.data.sheets?.some((s) => s.properties?.title === "ReviewFeedback") ?? false;

async function writeHeaders(): Promise<void> {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "ReviewFeedback!A1:G1",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [CANONICAL_HEADERS] },
  });
}

if (!exists) {
  console.log("ReviewFeedback tab missing — creating it.");
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: "ReviewFeedback" } } }] },
  });
  await writeHeaders();
  console.log("✓ Created ReviewFeedback tab with canonical headers.");
  process.exit(0);
}

// Tab exists — inspect row 1 without touching any data rows.
const res = await sheets.spreadsheets.values.get({
  spreadsheetId,
  range: "ReviewFeedback!A1:G1",
});
const current = (res.data.values?.[0] ?? []) as string[];

const isEmpty = current.length === 0 || current.every((c) => !c || !c.trim());
const matches =
  current.length === CANONICAL_HEADERS.length &&
  CANONICAL_HEADERS.every((h, i) => current[i] === h);

if (matches) {
  console.log("✓ ReviewFeedback tab already present with correct headers — nothing to do.");
  process.exit(0);
}

if (isEmpty) {
  console.log("ReviewFeedback tab present but header row empty — writing headers (no data rows touched).");
  await writeHeaders();
  console.log("✓ Headers written.");
  process.exit(0);
}

console.error("✗ ReviewFeedback tab exists but row 1 does not match the canonical headers.");
console.error(`  found:    ${JSON.stringify(current)}`);
console.error(`  expected: ${JSON.stringify(CANONICAL_HEADERS)}`);
console.error("Refusing to overwrite (possible data shape mismatch). Fix the header row by hand, then re-run.");
process.exit(1);
