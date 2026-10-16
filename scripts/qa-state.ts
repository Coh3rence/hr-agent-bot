/**
 * QA diagnostic: one-screen view of the live review front.
 *
 * Answers the question every QA cycle starts with — what is open, who still
 * owes a response, and is quorum within reach. Imports the bot's own quorum
 * helpers rather than restating the rule, so a change to the threshold can
 * never leave this reporting a different answer than the bot acts on.
 */
import { google } from "googleapis";
import { loadEnv } from "./_env";
import type { ReviewerFeedback } from "../src/models/types";
import { outstandingReviewers, quorumThreshold, respondedWithinPool, reviewRecipients } from "../src/services/quorum";

const env = loadEnv();
const spreadsheetId = env.GOOGLE_SHEETS_ID!;

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});
const sheets = google.sheets({ version: "v4", auth });

async function tab(range: string): Promise<{ rows: string[][]; col: (name: string) => number }> {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const rows = (res.data.values ?? []) as string[][];
  const head = rows[0] ?? [];
  return { rows: rows.slice(1), col: (name: string) => head.indexOf(name) };
}

const [agreements, feedback, contributors, admins] = await Promise.all([
  tab("Agreements!A1:R"),
  tab("ReviewFeedback!A1:H"),
  tab("Contributors!A1:L"),
  tab("AuthorizedUsers!A1:B"),
]);

const adminIds = admins.rows.map((r) => r[0]!).filter(Boolean);
// Reviewers who never onboarded as contributors have no Contributors row, so
// fall back to the name they signed their feedback with.
const nameOf = new Map(contributors.rows.map((r) => [r[contributors.col("telegramId")]!, r[contributors.col("name")]!]));
for (const r of feedback.rows) {
  const id = r[feedback.col("reviewerId")];
  const name = r[feedback.col("reviewerName")];
  if (id && name && !nameOf.has(id)) nameOf.set(id, name);
}
const label = (id: string) => `${nameOf.get(id) ?? "?"} (${id})`;

const fCol = feedback.col;
const feedbackFor = (agreementId: string): ReviewerFeedback[] =>
  feedback.rows
    .filter((r) => r[fCol("agreementId")] === agreementId)
    .map((r) => ({
      reviewerId: r[fCol("reviewerId")] ?? "",
      reviewerName: r[fCol("reviewerName")] ?? "",
      decision: (r[fCol("decision")] ?? "") as ReviewerFeedback["decision"],
      suggestedRate: r[fCol("suggestedRate")] ? Number(r[fCol("suggestedRate")]) : null,
      suggestedCommitment: r[fCol("suggestedCommitment")] ? Number(r[fCol("suggestedCommitment")]) : null,
      qualitativeFeedback: r[fCol("qualitativeFeedback")] ?? "",
      submittedAt: r[fCol("submittedAt")] ?? "",
    }));

const aCol = agreements.col;
console.log(`sheet ${spreadsheetId}`);
console.log(`admins: ${adminIds.map(label).join(", ")}\n`);

const open = agreements.rows.filter((r) => r[aCol("status")] === "under_review");
console.log(`===== UNDER REVIEW (${open.length}) =====`);
for (const r of open) {
  const id = r[aCol("id")]!;
  const contributorId = r[aCol("contributorId")]!;
  const contributorRow = contributors.rows.find((c) => c[contributors.col("id")] === contributorId);
  const telegramId = contributorRow?.[contributors.col("telegramId")] ?? "";
  const pool = reviewRecipients(adminIds, telegramId);
  const fb = feedbackFor(id);
  const have = respondedWithinPool(pool, fb);
  const need = quorumThreshold(pool.length);

  console.log(`\n${id}  ${r[aCol("roleName")]}  (${nameOf.get(telegramId) ?? contributorId})`);
  console.log(`  $${r[aCol("hourlyRate")]}/hr, ${r[aCol("commitmentPercent")]}%, ${r[aCol("durationMonths")]}mo` +
    `  round ${r[aCol("negotiationRound")]}  submitted ${r[aCol("submittedAt")]}`);
  console.log(`  quorum ${have}/${need} of pool ${pool.length}${have >= need ? "  <-- REACHED" : ""}`);
  for (const f of fb) {
    const extra = [f.suggestedRate !== null ? `$${f.suggestedRate}` : "", f.suggestedCommitment !== null ? `${f.suggestedCommitment}%` : ""].filter(Boolean).join(" ");
    console.log(`    ${f.decision.toUpperCase().padEnd(7)} ${f.reviewerName} ${extra} ${f.qualitativeFeedback}`.trimEnd());
  }
  const waiting = outstandingReviewers(pool, fb);
  if (waiting.length) console.log(`  waiting on: ${waiting.map(label).join(", ")}`);
}

console.log(`\n===== COOLDOWNS =====`);
const now = new Date();
const cooling = contributors.rows.filter((r) => {
  const until = r[contributors.col("cooldownUntil")];
  return until && new Date(until) > now;
});
if (!cooling.length) console.log("  none active");
for (const r of cooling) {
  console.log(`  ${r[contributors.col("name")]} until ${r[contributors.col("cooldownUntil")]} (status ${r[contributors.col("status")]})`);
}

// A tap the bot refused writes no row, so the count is how we tell a rejected
// late tap apart from one that silently got through.
console.log(`\n===== FEEDBACK ROWS PER AGREEMENT =====`);
const perAgreement = new Map<string, string[]>();
for (const r of feedback.rows) {
  const id = r[fCol("agreementId")] ?? "";
  const entry = `${r[fCol("reviewerName")]}:${r[fCol("decision")]}`;
  perAgreement.set(id, [...(perAgreement.get(id) ?? []), entry]);
}
for (const [id, entries] of perAgreement) {
  console.log(`  ${id}  ${entries.length}  ${entries.join(", ")}`);
}

console.log(`\n===== LAST 5 AGREEMENTS =====`);
for (const r of agreements.rows.slice(-5)) {
  console.log(`  ${r[aCol("id")]}  ${String(r[aCol("status")]).padEnd(12)} ${r[aCol("roleName")]}  $${r[aCol("hourlyRate")]}/hr  round ${r[aCol("negotiationRound")]}`);
}
