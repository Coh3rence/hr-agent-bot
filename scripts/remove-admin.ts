/**
 * Removes a telegramId from AuthorizedUsers (any role) in the target sheet, then
 * rewrites the tab so no gap rows remain. Header row is preserved.
 *
 * Usage:
 *   bun scripts/remove-admin.ts --sheet-id <id> --id <telegramId>
 */
import { google } from "googleapis";
import { readFileSync } from "fs";
import { resolve } from "path";

const envPath = resolve(import.meta.dir, "../.env");
const env: Record<string, string> = {};
for (const line of readFileSync(envPath, "utf-8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i === -1) continue;
  let v = t.slice(i + 1);
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[t.slice(0, i)] = v;
}

const idIdx = process.argv.indexOf("--sheet-id");
const spreadsheetId = idIdx >= 0 ? process.argv[idIdx + 1] : env.GOOGLE_SHEETS_ID;
const tIdx = process.argv.indexOf("--id");
const targetId = tIdx >= 0 ? process.argv[tIdx + 1] : "";
if (!spreadsheetId || !targetId) {
  console.error("Usage: bun scripts/remove-admin.ts --sheet-id <id> --id <telegramId>");
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
const kept = rows.slice(1).filter((r) => (r[0] ?? "").trim() !== targetId);

await sheets.spreadsheets.values.clear({ spreadsheetId, range: "AuthorizedUsers!A2:B" });
if (kept.length > 0) {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "AuthorizedUsers!A2:B",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: kept },
  });
}

console.log(`Removed ${targetId}. Remaining AuthorizedUsers:`);
console.log([header, ...kept].map((r) => r.join(" | ")).join("\n"));
