import type { SheetsService } from "./sheets";
import type { ClaudeService } from "./claude";
import { aggregateForAgreement } from "./aggregation";
import { reviewRecipients, respondedWithinPool, quorumThreshold } from "./quorum";
import { presentToCandidate, type Notifier } from "./presentation";
import { selfReviewAllowed } from "../config";

/**
 * Review timeout sweep (D-011, the "48h cutoff" branch of the quorum model).
 *
 * A review completes one of two ways: a majority of notified reviewers respond
 * (handled on-tap in review.ts), or the 48h window elapses. This sweep handles
 * the second case. It re-reads the Agreements tab — the sheet is the source of
 * truth, so the deadline survives restarts and the sweep is safe to run on
 * startup to catch up on anything that expired while the process was down.
 *
 * Quorum, not silence=approval (D-011, supersedes D-006/D-007): non-responders
 * are simply not counted. When the deadline passes we check whether quorum was
 * reached among the responders. If it was, we aggregate the feedback that
 * arrived. If it was NOT — including the all-silent case — the review escalates:
 * every admin is DM'd and the agreement is moved to `escalated`. We never
 * auto-approve a proposal no one actually approved.
 *
 * Idempotent: an agreement is processed only while still `under_review` AND not
 * yet aggregated (column N empty). The first writer — this sweep or the on-tap
 * trigger — populates M/N or moves the status off `under_review`; everyone else
 * skips. Late firing therefore produces the same result, so downtime costs
 * bounded latency, never a lost/wrong decision.
 */

export const REVIEW_WINDOW_MS = 48 * 60 * 60 * 1000;
export const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

export async function sweepExpiredReviews(
  sheets: SheetsService,
  claude: ClaudeService,
  notifier: Notifier,
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
    if (s.status !== "under_review") continue;

    // Already aggregated but still under_review → restart-safe notify catch-up:
    // if the bot died between aggregating and DMing the candidate, deliver it now.
    if (s.aggregated) {
      if (!s.notified) {
        try {
          await presentToCandidate(s.id, sheets, notifier);
        } catch (err) {
          console.error(`sweepExpiredReviews: failed to notify candidate for ${s.id}:`, err);
        }
      }
      continue;
    }

    const submittedMs = Date.parse(s.submittedAt);
    if (Number.isNaN(submittedMs)) {
      console.warn(
        `sweepExpiredReviews: agreement ${s.id} under_review with unparseable submittedAt "${s.submittedAt}"; skipping`
      );
      continue;
    }
    if (now - submittedMs < REVIEW_WINDOW_MS) continue;

    try {
      await completeExpiredReview(s.id, sheets, claude, notifier);
    } catch (err) {
      console.error(`sweepExpiredReviews: failed to complete ${s.id}:`, err);
    }
  }
}

async function completeExpiredReview(
  agreementId: string,
  sheets: SheetsService,
  claude: ClaudeService,
  notifier: Notifier
): Promise<void> {
  const agreement = await sheets.getAgreement(agreementId);
  if (!agreement || agreement.status !== "under_review") return;

  const contributor = await sheets.getContributorById(agreement.contributorId);
  if (!contributor) {
    console.error(`sweepExpiredReviews: ${agreementId} has no contributor; skipping`);
    return;
  }

  const adminIds = await sheets.getAdminIds();
  const recipients = reviewRecipients(adminIds, contributor.telegramId, selfReviewAllowed());
  const feedbacks = await sheets.getReviewFeedbacks(agreementId);
  const responded = respondedWithinPool(recipients, feedbacks);

  const quorumReached =
    recipients.length > 0 && responded >= quorumThreshold(recipients.length);

  if (quorumReached) {
    const result = await aggregateForAgreement(agreementId, sheets, claude);
    console.log(
      `sweepExpiredReviews: ${agreementId} aggregated on timeout (outcome=${result?.outcome ?? "none"})`
    );
    if (result) await presentToCandidate(agreementId, sheets, notifier);
    return;
  }

  await escalateReview(agreementId, recipients.length, responded, sheets, notifier);
}

async function escalateReview(
  agreementId: string,
  poolSize: number,
  responded: number,
  sheets: SheetsService,
  notifier: Notifier
): Promise<void> {
  const adminIds = await sheets.getAdminIds();
  const message =
    `Review escalation: agreement ${agreementId} reached its 48h deadline without quorum ` +
    `(${responded}/${poolSize} reviewers responded, ${quorumThreshold(poolSize)} needed). ` +
    `It needs a manual decision — no counter-offer was generated.`;

  // DM admins first so the escalation is delivered even if the status write fails.
  for (const adminId of adminIds) {
    try {
      await notifier.sendMessage(Number(adminId), message);
    } catch (err) {
      console.error(`sweepExpiredReviews: could not DM admin ${adminId} for ${agreementId}:`, err);
    }
  }

  await sheets.updateAgreementStatus(agreementId, "escalated");
  console.log(
    `sweepExpiredReviews: ${agreementId} escalated (no quorum: ${responded}/${poolSize})`
  );
}
