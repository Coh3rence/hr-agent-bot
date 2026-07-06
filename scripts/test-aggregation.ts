/**
 * Harness for ClaudeService.aggregateFeedback + aggregateForAgreement.
 * Seeds Agreement + ReviewFeedback rows for each scenario, calls the
 * orchestrator, checks the result against expectations, prints pass/fail,
 * then deletes the rows it created.
 *
 * Usage: bun scripts/test-aggregation.ts
 *   --keep    leave rows in the sheet (skip cleanup) for manual inspection
 *   --only N  run only scenario N (e.g. --only 7)
 *
 * Skips scenario 13 (sheet-write failure) — needs failure injection.
 */
import { google, sheets_v4 } from "googleapis";
import { loadEnv } from "./_env";
import { SheetsService } from "../src/services/sheets";
import { ClaudeService } from "../src/services/claude";
import { aggregateForAgreement } from "../src/services/aggregation";
import type { CounterOffer } from "../src/models/types";

const env = loadEnv();

const keep = process.argv.includes("--keep");
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx >= 0 ? Number(process.argv[onlyIdx + 1]) : null;
const sheetIdIdx = process.argv.indexOf("--sheet-id");
const sheetIdOverride = sheetIdIdx >= 0 ? process.argv[sheetIdIdx + 1] : null;

const cfg = {
  BOT_TOKEN: "x",
  ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY!,
  GOOGLE_SHEETS_ID: sheetIdOverride ?? env.GOOGLE_SHEETS_ID!,
  GOOGLE_SERVICE_ACCOUNT_EMAIL: env.GOOGLE_SERVICE_ACCOUNT_EMAIL!,
  GOOGLE_PRIVATE_KEY: env.GOOGLE_PRIVATE_KEY!,
  ADMIN_TELEGRAM_ID: "0",
} as any;

console.log(`Target sheet: ${cfg.GOOGLE_SHEETS_ID}${sheetIdOverride ? " (override)" : " (from .env)"}`);

const sheets = new SheetsService(cfg);
await sheets.initialize();
const claude = new ClaudeService(cfg);

// Raw client for direct ops the service doesn't expose (row deletes, agreement row insert with timestamp).
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: cfg.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: cfg.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const raw = google.sheets({ version: "v4", auth });

async function getGid(name: string): Promise<number> {
  const info = await raw.spreadsheets.get({ spreadsheetId: cfg.GOOGLE_SHEETS_ID });
  const s = info.data.sheets?.find((s) => s.properties?.title === name);
  if (!s || s.properties?.sheetId === undefined || s.properties?.sheetId === null) {
    const tabs = info.data.sheets?.map((s) => s.properties?.title).join(", ") || "(none)";
    throw new Error(`tab "${name}" not found; existing tabs: ${tabs}`);
  }
  return s.properties.sheetId;
}

// Self-healing precondition: ensure ReviewFeedback tab exists with the canonical headers.
async function ensureReviewFeedbackTab(): Promise<void> {
  const info = await raw.spreadsheets.get({ spreadsheetId: cfg.GOOGLE_SHEETS_ID });
  const exists = info.data.sheets?.some((s) => s.properties?.title === "ReviewFeedback");
  if (exists) return;
  console.log('ReviewFeedback tab missing — creating with headers');
  await raw.spreadsheets.batchUpdate({
    spreadsheetId: cfg.GOOGLE_SHEETS_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: "ReviewFeedback" } } }] },
  });
  await raw.spreadsheets.values.update({
    spreadsheetId: cfg.GOOGLE_SHEETS_ID,
    range: "ReviewFeedback!A1:G1",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        "agreementId", "reviewerId", "reviewerName", "decision",
        "suggestedRate", "qualitativeFeedback", "submittedAt",
      ]],
    },
  });
}
await ensureReviewFeedbackTab();

const agreementsGid = await getGid("Agreements");
const feedbackGid = await getGid("ReviewFeedback");

async function seedAgreement(id: string, hourlyRate: number): Promise<void> {
  await raw.spreadsheets.values.append({
    spreadsheetId: cfg.GOOGLE_SHEETS_ID,
    range: "Agreements!A:L",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        id, "opp_test", "contrib_test", "TestRole", "responsibilities",
        hourlyRate, 50, 3, 80, "under_review", 1, new Date().toISOString(),
      ]],
    },
  });
}

async function seedFeedback(
  agreementId: string,
  reviewerId: string,
  decision: "approve" | "counter" | "reject",
  suggestedRate: number | null,
  qualitativeFeedback: string,
  submittedAt?: string,
): Promise<void> {
  await raw.spreadsheets.values.append({
    spreadsheetId: cfg.GOOGLE_SHEETS_ID,
    range: "ReviewFeedback!A:G",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        agreementId, reviewerId, `Reviewer-${reviewerId}`, decision,
        suggestedRate ?? "", qualitativeFeedback, submittedAt ?? new Date().toISOString(),
      ]],
    },
  });
}

async function deleteRowsMatching(tab: "Agreements" | "ReviewFeedback", gid: number, prefix: string): Promise<void> {
  const range = tab === "Agreements" ? "Agreements!A2:A" : "ReviewFeedback!A2:A";
  const res = await raw.spreadsheets.values.get({ spreadsheetId: cfg.GOOGLE_SHEETS_ID, range });
  const rows = res.data.values || [];
  const indices: number[] = [];
  rows.forEach((r, i) => { if (r[0] && String(r[0]).startsWith(prefix)) indices.push(i + 1); });
  if (indices.length === 0) return;
  indices.sort((a, b) => b - a); // delete from bottom to keep indices stable
  const requests: sheets_v4.Schema$Request[] = indices.map((rowIdx) => ({
    deleteDimension: {
      range: { sheetId: gid, dimension: "ROWS", startIndex: rowIdx, endIndex: rowIdx + 1 },
    },
  }));
  await raw.spreadsheets.batchUpdate({ spreadsheetId: cfg.GOOGLE_SHEETS_ID, requestBody: { requests } });
}

interface ScenarioResult { n: number; name: string; ok: boolean; detail: string }
const results: ScenarioResult[] = [];

async function scenario(
  n: number,
  name: string,
  setup: (agreementId: string) => Promise<void>,
  check: (r: CounterOffer | null) => { ok: boolean; detail: string },
  agreementRate = 60,
): Promise<CounterOffer | null> {
  if (only !== null && n !== only) return null;
  const aid = `test_agg_s${n}_${Date.now()}`;
  await seedAgreement(aid, agreementRate);
  await setup(aid);
  const result = await aggregateForAgreement(aid, sheets, claude);
  const { ok, detail } = check(result);
  console.log(`  [${ok ? "PASS" : "FAIL"}] #${n} ${name}: ${detail}`);
  results.push({ n, name, ok, detail });
  return result;
}

console.log("Running aggregation harness…\n");

await scenario(1, "3 counter @ 55/60/65", async (aid) => {
  await seedFeedback(aid, "R1", "counter", 55, "rate seems high");
  await seedFeedback(aid, "R2", "counter", 60, "needs more senior depth");
  await seedFeedback(aid, "R3", "counter", 65, "ok but tight");
}, (r) => ({
  ok: r?.suggestedRate === 60 && r?.outcome === "mixed" && (r?.qualitativeSummary?.length ?? 0) > 20,
  detail: `rate=${r?.suggestedRate} outcome=${r?.outcome} summaryLen=${r?.qualitativeSummary?.length}`,
}));

await scenario(2, "all approve", async (aid) => {
  await seedFeedback(aid, "R1", "approve", null, "");
  await seedFeedback(aid, "R2", "approve", null, "");
}, (r) => ({
  ok: r?.suggestedRate === 60 && r?.outcome === "all_approve" && r?.qualitativeSummary === "All reviewers approved.",
  detail: `rate=${r?.suggestedRate} outcome=${r?.outcome} summary=${JSON.stringify(r?.qualitativeSummary)}`,
}));

await scenario(3, "all reject", async (aid) => {
  await seedFeedback(aid, "R1", "reject", null, "rate too high");
  await seedFeedback(aid, "R2", "reject", null, "skills don't match");
}, (r) => ({
  ok: r?.suggestedRate === null
    && r?.outcome === "all_reject"
    && (r?.qualitativeSummary ?? "").includes("rate too high")
    && (r?.qualitativeSummary ?? "").includes("skills don't match"),
  detail: `rate=${r?.suggestedRate} outcome=${r?.outcome} summary=${JSON.stringify(r?.qualitativeSummary)}`,
}));

await scenario(4, "mixed 1A/1C@55/1R", async (aid) => {
  await seedFeedback(aid, "R1", "approve", null, "");
  await seedFeedback(aid, "R2", "counter", 55, "lower would be fairer");
  await seedFeedback(aid, "R3", "reject", null, "not the right fit");
}, (r) => ({
  ok: r?.suggestedRate === 55 && r?.outcome === "mixed",
  detail: `rate=${r?.suggestedRate} outcome=${r?.outcome} summaryLen=${r?.qualitativeSummary?.length}`,
}));

await scenario(5, "single counter (pass-through)", async (aid) => {
  await seedFeedback(aid, "R1", "counter", 70, "go a bit lower");
}, (r) => ({
  ok: r?.suggestedRate === 70 && r?.outcome === "mixed" && r?.qualitativeSummary === "go a bit lower",
  detail: `rate=${r?.suggestedRate} outcome=${r?.outcome} summary=${JSON.stringify(r?.qualitativeSummary)}`,
}));

await scenario(6, "empty input", async () => {
  // seed nothing
}, (r) => ({
  ok: r === null,
  detail: `result=${r === null ? "null" : "non-null"}`,
}));

// Scenario 7: idempotency — run aggregation twice on the same input, compare sigs and rate.
if (only === null || only === 7) {
  const aid = `test_agg_s7_${Date.now()}`;
  await seedAgreement(aid, 60);
  await seedFeedback(aid, "R1", "counter", 55, "a");
  await seedFeedback(aid, "R2", "counter", 60, "b");
  await seedFeedback(aid, "R3", "counter", 65, "c");
  const r1 = await aggregateForAgreement(aid, sheets, claude);
  const r2 = await aggregateForAgreement(aid, sheets, claude);
  const ok = r1?.aggregationSig === r2?.aggregationSig
    && r1?.suggestedRate === r2?.suggestedRate
    && r1?.suggestedRate === 60;
  console.log(`  [${ok ? "PASS" : "FAIL"}] #7 idempotency: sig1=${r1?.aggregationSig} sig2=${r2?.aggregationSig} rate1=${r1?.suggestedRate} rate2=${r2?.suggestedRate}`);
  results.push({ n: 7, name: "idempotency", ok, detail: `sigs match=${r1?.aggregationSig === r2?.aggregationSig}` });
}

// Scenario 8: reviewer revote — same reviewerId, two rows, later wins.
if (only === null || only === 8) {
  const aid = `test_agg_s8_${Date.now()}`;
  await seedAgreement(aid, 60);
  await seedFeedback(aid, "R1", "counter", 55, "first take", "2026-06-01T10:00:00.000Z");
  await seedFeedback(aid, "R1", "counter", 70, "revised", "2026-06-02T10:00:00.000Z");
  const r = await aggregateForAgreement(aid, sheets, claude);
  const ok = r?.suggestedRate === 70 && r?.reviewerCount === 1;
  console.log(`  [${ok ? "PASS" : "FAIL"}] #8 reviewer revote: rate=${r?.suggestedRate} count=${r?.reviewerCount}`);
  results.push({ n: 8, name: "reviewer revote", ok, detail: `rate=${r?.suggestedRate} count=${r?.reviewerCount}` });
}

await scenario(10, "counter rate null", async (aid) => {
  await seedFeedback(aid, "R1", "counter", null, "lower it");
  await seedFeedback(aid, "R2", "counter", 60, "ok");
}, (r) => ({
  ok: r?.suggestedRate === 60 && r?.outcome === "mixed",
  detail: `rate=${r?.suggestedRate} outcome=${r?.outcome}`,
}));

await scenario(11, "all counter rates equal", async (aid) => {
  await seedFeedback(aid, "R1", "counter", 60, "fine");
  await seedFeedback(aid, "R2", "counter", 60, "fine");
  await seedFeedback(aid, "R3", "counter", 60, "fine");
}, (r) => ({
  ok: r?.suggestedRate === 60 && r?.outcome === "mixed",
  detail: `rate=${r?.suggestedRate} outcome=${r?.outcome}`,
}));

await scenario(12, "outlier 10/60/65 (D-001 limitation)", async (aid) => {
  await seedFeedback(aid, "R1", "counter", 10, "way too high");
  await seedFeedback(aid, "R2", "counter", 60, "ok");
  await seedFeedback(aid, "R3", "counter", 65, "ok");
}, (r) => ({
  ok: r?.suggestedRate === 45 && r?.outcome === "mixed",
  detail: `rate=${r?.suggestedRate} (mean per D-001) outcome=${r?.outcome}`,
}));

// Scenario 14: missing id — no setup needed.
if (only === null || only === 14) {
  const r = await aggregateForAgreement("nope_does_not_exist", sheets, claude);
  const ok = r === null;
  console.log(`  [${ok ? "PASS" : "FAIL"}] #14 missing agreementId: result=${r === null ? "null" : "non-null"}`);
  results.push({ n: 14, name: "missing id", ok, detail: r === null ? "null" : "non-null" });
}

// Cleanup
if (!keep) {
  console.log("\nCleaning up seeded rows…");
  await deleteRowsMatching("ReviewFeedback", feedbackGid, "test_agg_");
  await deleteRowsMatching("Agreements", agreementsGid, "test_agg_");
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed} / ${results.length} pass`);
process.exit(passed === results.length ? 0 : 1);
