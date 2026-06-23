import type { ReviewerFeedback } from "../models/types";

/**
 * Quorum logic for the review flow (D-011, supersedes D-006/D-007).
 *
 * The client's model is a majority quorum, not unanimity: a review closes as
 * soon as a *majority* of the notified reviewers have responded ("2 of 3").
 * Reviewers who never respond are simply not counted — their silence is neither
 * an approval nor a rejection, it just doesn't weigh in. If the 48h deadline
 * passes and quorum was still never reached, the review escalates (handled by
 * the timeout sweep) rather than auto-approving.
 *
 * These helpers are intentionally pure (no sheet/Claude access) so they are
 * trivially testable and reusable by both the on-tap check and the timeout sweep.
 */

/** Distinct reviewer ids that have submitted any feedback (dedup across re-votes). */
export function respondedReviewerIds(feedbacks: ReviewerFeedback[]): Set<string> {
  return new Set(feedbacks.map((f) => f.reviewerId).filter((id) => id));
}

/** Notified reviewers who have not yet submitted any feedback. */
export function outstandingReviewers(
  recipientIds: string[],
  feedbacks: ReviewerFeedback[]
): string[] {
  const responded = respondedReviewerIds(feedbacks);
  return recipientIds.filter((id) => !responded.has(id));
}

/** Count of notified reviewers who have responded (responders outside the pool don't count). */
export function respondedWithinPool(
  recipientIds: string[],
  feedbacks: ReviewerFeedback[]
): number {
  const responded = respondedReviewerIds(feedbacks);
  return recipientIds.filter((id) => responded.has(id)).length;
}

/**
 * Majority quorum threshold for a pool of `poolSize` reviewers: `floor(n/2)+1`.
 * n=3 → 2 ("2 of 3"); n=2 → 2; n=1 → 1.
 */
export function quorumThreshold(poolSize: number): number {
  return Math.floor(poolSize / 2) + 1;
}

/**
 * True when a majority of notified reviewers have responded (D-011).
 *
 * Empty recipient list returns false: with no reviewers there is no quorum to
 * reach — the caller handles the no-reviewer case explicitly (it must not
 * silently auto-approve). Responders not in `recipientIds` (e.g. the pool
 * changed mid-window) are ignored; only responders *within* the pool count
 * toward quorum.
 */
export function isReviewComplete(
  recipientIds: string[],
  feedbacks: ReviewerFeedback[]
): boolean {
  if (recipientIds.length === 0) return false;
  return respondedWithinPool(recipientIds, feedbacks) >= quorumThreshold(recipientIds.length);
}

/**
 * The review pool for a proposal: every admin except the contributor (a
 * contributor never reviews their own proposal). Pure so both the on-tap path
 * and the timeout sweep derive the same pool.
 *
 * `allowSelfReview` is a dev-only escape hatch (see `selfReviewAllowed`) that
 * keeps the contributor in the pool so the whole loop can be exercised from a
 * single Telegram account. It defaults to false, so production behavior — a
 * contributor can never review their own proposal — is unchanged.
 */
export function reviewRecipients(
  adminIds: string[],
  contributorTelegramId: string,
  allowSelfReview = false
): string[] {
  if (allowSelfReview) return [...adminIds];
  return adminIds.filter((id) => id !== contributorTelegramId);
}
