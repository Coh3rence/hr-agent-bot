/**
 * Adds a telegramId to AuthorizedUsers with the given role (default admin),
 * unless it's already present. Header row preserved.
 *
 * Usage:
 *   bun scripts/add-admin.ts --sheet-id <id> --id <telegramId> [--role admin|contributor]
 */
import { google } from "googleapis";
import { loadEnv } from "./_env";

const env = loadEnv();

const idIdx = process.argv.indexOf("--sheet-id");
const spreadsheetId = idIdx >= 0 ? process.argv[idIdx + 1] : env.GOOGLE_SHEETS_ID;
const tIdx = process.argv.indexOf("--id");
const targetId = tIdx >= 0 ? process.argv[tIdx + 1] : "";
const rIdx = process.argv.indexOf("--role");
const role = rIdx >= 0 ? process.argv[rIdx + 1] : "admin";
if (!spreadsheetId || !targetId) {
  console.error("Usage: bun scripts/add-admin.ts --sheet-id <id> --id <telegramId> [--role admin|contributor]");
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
const exists = rows.slice(1).some((r) => (r[0] ?? "").trim() === targetId);
if (exists) {
  console.log(`${targetId} already present; nothing to do.`);
} else {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "AuthorizedUsers!A:B",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[targetId, role]] },
  });
  console.log(`Added ${targetId} as ${role}.`);
}

const after = await sheets.spreadsheets.values.get({ spreadsheetId, range: "AuthorizedUsers!A1:B" });
console.log("AuthorizedUsers now:");
console.log((after.data.values ?? []).map((r) => (r as string[]).join(" | ")).join("\n"));
