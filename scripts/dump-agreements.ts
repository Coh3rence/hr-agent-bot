/** Dev diagnostic: dump all Agreements rows (key columns) for a sheet. */
import { google } from "googleapis";
import { loadEnv } from "./_env";

const env = loadEnv();
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
const res = await sheets.spreadsheets.values.get({ spreadsheetId: spreadsheetId!, range: "Agreements!A1:P" });
const rows = (res.data.values ?? []) as string[][];
const h = rows[0] ?? [];
const col = (name: string) => h.indexOf(name);
for (const r of rows.slice(1)) {
  console.log("---");
  console.log("id:", r[col("id")]);
  console.log("status:", r[col("status")]);
  console.log("hourlyRate:", r[col("hourlyRate")], "commit:", r[col("commitmentPercent")]);
  console.log("aggregatedRate:", r[col("aggregatedRate")]);
  console.log("candidateNotifiedAt:", r[col("candidateNotifiedAt")]);
  console.log("betaAppAgreementId:", r[col("betaAppAgreementId")] ?? "(no such col)");
}
