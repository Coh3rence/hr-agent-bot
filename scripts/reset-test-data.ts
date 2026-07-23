/**
 * Clears transactional test data so a fresh end-to-end run starts clean.
 *
 * Wipes the data rows (row 2 down) of Contributors, Agreements, and
 * ReviewFeedback, leaving the header row intact. Never touches Opportunities
 * (the roles you apply to) or AuthorizedUsers (who can log in) — those are the
 * fixtures a test run reads from, not the data it produces.
 *
 * NOTE: the Sheet and the backend (Collabberry fork) DB are SEPARATE stores. If
 * only one is cleared they drift, and leftover Collabberry users squat on the
 * email/wallet/handle a fresh signup tries to reuse. Pass --with-backend to reset
 * BOTH in one shot (calls reset-backend-test-data.sh with BETA_APP_ORG_ID +
 * SERVICE_ADMIN_WALLET from the env), so you can't forget one.
 *
 * Usage:
 *   bun scripts/reset-test-data.ts                    # sheet only, GOOGLE_SHEETS_ID from .env
 *   bun scripts/reset-test-data.ts --sheet-id <id>    # sheet only, target a specific sheet (dev)
 *   bun scripts/reset-test-data.ts --with-backend     # sheet + backend DB (no drift)
 */
import { google } from "googleapis";
import { loadEnv } from "./_env";

const env = loadEnv();

const withBackend = process.argv.includes("--with-backend");

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

if (withBackend) {
  const orgId = env.BETA_APP_ORG_ID;
  const adminWallet = env.SERVICE_ADMIN_WALLET;
  if (!orgId || !adminWallet) {
    console.error(
      "\n--with-backend needs BETA_APP_ORG_ID and SERVICE_ADMIN_WALLET in the env " +
        "(base .env / .env.<NODE_ENV>). Sheet was cleared; backend was NOT."
    );
    process.exit(1);
  }

  const script = `${import.meta.dir}/reset-backend-test-data.sh`;
  console.log(`\nClearing backend DB for org ${orgId} (preserving admin ${adminWallet})...`);
  const proc = Bun.spawnSync([script, "--org", orgId, "--admin-wallet", adminWallet], {
    stdout: "inherit",
    stderr: "inherit",
  });
  if (proc.exitCode !== 0) {
    console.error("Backend reset failed (see output above). Sheet was cleared; backend may be partial.");
    process.exit(proc.exitCode ?? 1);
  }
}

console.log(
  `\nDone. ${withBackend ? "Sheet + backend DB are" : "Tabs are"} clean and ready for a fresh test run.`
);
