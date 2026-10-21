/**
 * Changes a telegramId's role in AuthorizedUsers from `admin` to `contributor`.
 * The row is kept (audit trail) — only column B changes. Fails loudly if the id
 * is not present or is not currently `admin`, so this cannot silently create a
 * contributor seat where there was none.
 *
 * Usage:
 *   bun scripts/demote-admin.ts --sheet-id <id> --id <telegramId>
 */
import { google } from "googleapis";
import { loadEnv } from "./_env";

const env = loadEnv();

const idIdx = process.argv.indexOf("--sheet-id");
const spreadsheetId = idIdx >= 0 ? process.argv[idIdx + 1] : env.GOOGLE_SHEETS_ID;
const tIdx = process.argv.indexOf("--id");
const targetId = tIdx >= 0 ? process.argv[tIdx + 1] : "";
if (!spreadsheetId || !targetId) {
  console.error("Usage: bun scripts/demote-admin.ts --sheet-id <id> --id <telegramId>");
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

const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "AuthorizedUsers!A1:B" });
const rows = (res.data.values ?? []) as string[][];
const header = rows[0] ?? ["telegramId", "role"];
const body = rows.slice(1);

const matches = body.filter((r) => (r[0] ?? "").trim() === targetId);
if (matches.length === 0) {
  console.error(`No AuthorizedUsers row for telegramId ${targetId}. Nothing changed.`);
  process.exit(2);
}
if (!matches.some((r) => (r[1] ?? "").trim() === "admin")) {
  console.error(`telegramId ${targetId} is not currently 'admin'. Nothing changed.`);
  process.exit(3);
}

const updated = body.map((r) =>
  (r[0] ?? "").trim() === targetId && (r[1] ?? "").trim() === "admin" ? [r[0], "contributor"] : r,
);

await sheets.spreadsheets.values.clear({ spreadsheetId, range: "AuthorizedUsers!A2:B" });
if (updated.length > 0) {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "AuthorizedUsers!A2:B",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: updated },
  });
}

console.log(`Demoted ${targetId} to contributor. AuthorizedUsers now:`);
console.log([header, ...updated].map((r) => r.join(" | ")).join("\n"));
