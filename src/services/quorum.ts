import type { ReviewerFeedback } from "../models/types";

/**
 * Quorum logic for the review flow (D-006).
 *
 * A review is "complete" — i.e. ready to aggregate — when every notified
 * reviewer has submitted at least one decision. The 48h timeout (D-007) is the
 * other way a review completes; it is handled by the caller, which treats the
 * `outstandingReviewers` as implicit approvals once the deadline passes.
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

/**
 * True when every notified reviewer has responded.
 *
 * Empty recipient list returns false: with no reviewers there is nothing to be
 * "complete" — the caller handles the no-reviewer case explicitly (it must not
 * silently auto-approve). Extra responders not in `recipientIds` (e.g. the pool
 * changed mid-window) are ignored; only `recipients ⊆ responders` is required.
 */
export function isReviewComplete(
  recipientIds: string[],
  feedbacks: ReviewerFeedback[]
): boolean {
  if (recipientIds.length === 0) return false;
  return outstandingReviewers(recipientIds, feedbacks).length === 0;
}
