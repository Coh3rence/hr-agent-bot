import type { SheetsService } from "./sheets";
import type { ClaudeService } from "./claude";
import { aggregateForAgreement } from "./aggregation";

/**
 * Review timeout sweep (D-007, the "48h cutoff" branch of D-006).
 *
 * A review completes one of two ways: every notified reviewer responds (handled
 * on-tap in review.ts), or the 48h window elapses. This sweep handles the second
 * case. It re-reads the Agreements tab — the sheet is the source of truth, so the
 * deadline survives restarts and the sweep is safe to run on startup to catch up
 * on anything that expired while the process was down.
 *
 * Silence = approval (D-006): reviewers who never answered are treated as having
 * approved. Aggregating only the feedback that *did* arrive already encodes this —
 * an implicit approval carries no rate and no objection, so it never changes the
 * outcome. The one case the normal engine can't express is *every* reviewer
 * silent (no feedback at all): that is a full default-approval, written directly.
 *
 * Idempotent: an agreement is processed only while still `under_review` AND not
 * yet aggregated (column N empty). The first writer — this sweep or the on-tap
 * trigger — populates M/N; everyone else skips. Late firing therefore produces
 * the same result, so downtime costs bounded latency, never a lost/wrong decision.
 */

export const REVIEW_WINDOW_MS = 48 * 60 * 60 * 1000;
export const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

export async function sweepExpiredReviews(
  sheets: SheetsService,
  claude: ClaudeService,
  now: number = Date.now()
): Promise<void> {
  let states;
  try {
    states = await sheets.listAgreementReviewState();
  } catch (err) {
    console.error("sweepExpiredReviews: could not list agreements:", err);
    return;
  }

  for (const s of states) {
    if (s.status !== "under_review" || s.aggregated) continue;

    const submittedMs = Date.parse(s.submittedAt);
    if (Number.isNaN(submittedMs)) {
      console.warn(
        `sweepExpiredReviews: agreement ${s.id} under_review with unparseable submittedAt "${s.submittedAt}"; skipping`
      );
      continue;
    }
    if (now - submittedMs < REVIEW_WINDOW_MS) continue;

    try {
      await completeExpiredReview(s.id, sheets, claude);
    } catch (err) {
      console.error(`sweepExpiredReviews: failed to complete ${s.id}:`, err);
    }
  }
}

async function completeExpiredReview(
  agreementId: string,
  sheets: SheetsService,
  claude: ClaudeService
): Promise<void> {
  const feedbacks = await sheets.getReviewFeedbacks(agreementId);

  if (feedbacks.length === 0) {
    // Every reviewer stayed silent → approve by default (D-006 silence=approval).
    // The aggregation engine returns null on empty input, so write it directly.
    const agreement = await sheets.getAgreement(agreementId);
    if (!agreement || agreement.status !== "under_review") return;
    await sheets.updateAgreementAggregation(
      agreementId,
      agreement.hourlyRate,
      "No reviewer responded within 48 hours; approved by default."
    );
    console.log(`sweepExpiredReviews: ${agreementId} approved by default (no responses)`);
    return;
  }

  const result = await aggregateForAgreement(agreementId, sheets, claude);
  console.log(
    `sweepExpiredReviews: ${agreementId} aggregated on timeout (outcome=${result?.outcome ?? "none"})`
  );
}
