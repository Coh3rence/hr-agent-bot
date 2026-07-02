/** Dev diagnostic: dump Contributors rows (key cols) for a sheet. */
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

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});
const sheets = google.sheets({ version: "v4", auth });
const res = await sheets.spreadsheets.values.get({ spreadsheetId: spreadsheetId!, range: "Contributors!A1:P" });
const rows = (res.data.values ?? []) as string[][];
const h = rows[0] ?? [];
const col = (name: string) => h.indexOf(name);
for (const r of rows.slice(1)) {
  console.log("---");
  console.log("id:", r[col("id")], "telegramId:", r[col("telegramId")]);
  console.log("telegramHandle:", r[col("telegramHandle")]);
  console.log("name:", r[col("name")], "status:", r[col("status")]);
  console.log("walletAddress:", r[col("walletAddress")] ?? "(empty)");
  console.log("collabberryUserId:", r[col("collabberryUserId")] ?? "(empty)");
}
