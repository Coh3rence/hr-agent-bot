import { describe, expect, test } from "bun:test";
import type { ReviewerFeedback } from "../models/types";
import {
  dedupLatestPerReviewer,
  isReviewComplete,
  outstandingReviewers,
  quorumThreshold,
  respondedReviewerIds,
  respondedWithinPool,
  reviewRecipients,
  unanimouslyRejected,
} from "./quorum";

function feedback(reviewerId: string, decision: ReviewerFeedback["decision"] = "approve"): ReviewerFeedback {
  return {
    reviewerId,
    reviewerName: `reviewer-${reviewerId}`,
    decision,
    suggestedRate: null,
    suggestedCommitment: null,
    qualitativeFeedback: "",
    submittedAt: "2026-09-07T00:00:00.000Z",
  };
}

describe("quorumThreshold (QA E4 — majority, not unanimity)", () => {
  test("pool of 1 needs 1", () => {
    expect(quorumThreshold(1)).toBe(1);
  });

  test("pool of 2 needs 2 — majority and unanimity coincide here", () => {
    expect(quorumThreshold(2)).toBe(2);
  });

  test("pool of 3 needs 2, not 3", () => {
    expect(quorumThreshold(3)).toBe(2);
  });

  test("pool of 4 needs 3", () => {
    expect(quorumThreshold(4)).toBe(3);
  });

  test("pool of 5 needs 3, not 5", () => {
    expect(quorumThreshold(5)).toBe(3);
  });
});

describe("isReviewComplete", () => {
  test("QA Q-1: pool of 3, two respond — closes at 2", () => {
    expect(isReviewComplete(["a", "b", "c"], [feedback("a"), feedback("b")])).toBe(true);
  });

  test("QA Q-5: pool of 3, only one responds — no quorum, escalates rather than approving", () => {
    expect(isReviewComplete(["a", "b", "c"], [feedback("a")])).toBe(false);
  });

  test("QA Q-2: pool of 2, both respond", () => {
    expect(isReviewComplete(["a", "b"], [feedback("a"), feedback("b")])).toBe(true);
  });

  test("QA Q-3: pool of 1 closes on the first response", () => {
    expect(isReviewComplete(["a"], [feedback("a")])).toBe(true);
  });

  test("empty pool never reaches quorum — must not silently auto-approve", () => {
    expect(isReviewComplete([], [feedback("a"), feedback("b")])).toBe(false);
  });

  test("QA Q-4: a responder outside the pool does not count toward quorum", () => {
    expect(isReviewComplete(["a", "b", "c"], [feedback("a"), feedback("zz")])).toBe(false);
  });

  test("QA R-17: the same reviewer voting twice counts once", () => {
    const twice = [feedback("a", "counter"), feedback("a", "approve")];
    expect(isReviewComplete(["a", "b", "c"], twice)).toBe(false);
    expect(respondedWithinPool(["a", "b", "c"], twice)).toBe(1);
  });
});

describe("respondedReviewerIds / respondedWithinPool / outstandingReviewers", () => {
  test("deduplicates repeat votes from one reviewer", () => {
    const ids = respondedReviewerIds([feedback("a"), feedback("a"), feedback("b")]);
    expect([...ids].sort()).toEqual(["a", "b"]);
  });

  test("ignores feedback rows with a blank reviewerId", () => {
    expect([...respondedReviewerIds([feedback(""), feedback("a")])]).toEqual(["a"]);
  });

  test("QA E5: once quorum is met the remaining reviewer is the only one outstanding", () => {
    const pool = ["a", "b", "c"];
    const responses = [feedback("a"), feedback("b")];
    expect(isReviewComplete(pool, responses)).toBe(true);
    expect(outstandingReviewers(pool, responses)).toEqual(["c"]);

    // c responds late; quorum was already satisfied and the count does not regress.
    const late = [...responses, feedback("c")];
    expect(isReviewComplete(pool, late)).toBe(true);
    expect(outstandingReviewers(pool, late)).toEqual([]);
  });
});

describe("reviewRecipients", () => {
  test("a contributor is excluded from reviewing their own proposal", () => {
    expect(reviewRecipients(["admin1", "admin2", "candidate"], "candidate")).toEqual([
      "admin1",
      "admin2",
    ]);
  });

  test("non-admin contributor leaves the pool intact", () => {
    expect(reviewRecipients(["admin1", "admin2"], "someone-else")).toEqual(["admin1", "admin2"]);
  });

  test("self-review escape hatch keeps the contributor in the pool", () => {
    expect(reviewRecipients(["admin1", "candidate"], "candidate", true)).toEqual([
      "admin1",
      "candidate",
    ]);
  });

  test("sole admin applying to their own role yields an empty pool, not a self-approval", () => {
    expect(reviewRecipients(["candidate"], "candidate")).toEqual([]);
    expect(isReviewComplete(reviewRecipients(["candidate"], "candidate"), [feedback("candidate")])).toBe(
      false
    );
  });
});

function vote(
  reviewerId: string,
  decision: ReviewerFeedback["decision"],
  submittedAt: string
): ReviewerFeedback {
  return { ...feedback(reviewerId, decision), submittedAt };
}

describe("dedupLatestPerReviewer", () => {
  test("a reviewer who votes twice is counted once, by their latest word", () => {
    const rows = dedupLatestPerReviewer([
      vote("R1", "reject", "2026-09-09T10:00:00.000Z"),
      vote("R1", "approve", "2026-09-09T11:00:00.000Z"),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.decision).toBe("approve");
  });

  test("out-of-order arrival still keeps the newest", () => {
    const rows = dedupLatestPerReviewer([
      vote("R1", "approve", "2026-09-09T11:00:00.000Z"),
      vote("R1", "reject", "2026-09-09T10:00:00.000Z"),
    ]);
    expect(rows[0]!.decision).toBe("approve");
  });
});

// §16: a declined candidate was shown an Accept button. The aggregation carries
// no suggested rate on this path, so accepting fell back to the contributor's own
// asking rate and hired them at it. The outcome is never persisted — only the
// rate, summary and commitment are — so the verdict is recomputed from the
// feedback rows, and must agree with aggregateFeedback exactly.
describe("unanimouslyRejected", () => {
  test("every reviewer rejected", () => {
    expect(unanimouslyRejected([feedback("R1", "reject"), feedback("R2", "reject")])).toBe(true);
  });

  test("a lone reviewer rejecting still counts", () => {
    expect(unanimouslyRejected([feedback("R1", "reject")])).toBe(true);
  });

  test("one approval among rejections is not unanimous — that is a mixed outcome", () => {
    expect(unanimouslyRejected([feedback("R1", "reject"), feedback("R2", "approve")])).toBe(false);
  });

  test("a counter is not a rejection — it is an offer to keep negotiating", () => {
    expect(unanimouslyRejected([feedback("R1", "reject"), feedback("R2", "counter")])).toBe(false);
  });

  test("all approvals are obviously not a rejection", () => {
    expect(unanimouslyRejected([feedback("R1", "approve"), feedback("R2", "approve")])).toBe(false);
  });

  // Silence is not a verdict (D-011). Nobody has declined anything yet, so there
  // is nothing to refuse — and refusing here would strand a candidate whose
  // review simply has not closed.
  test("no responses is not a rejection", () => {
    expect(unanimouslyRejected([])).toBe(false);
  });

  test("a reviewer who rejected then changed their mind is not counted as rejecting", () => {
    expect(
      unanimouslyRejected([
        vote("R1", "reject", "2026-09-09T10:00:00.000Z"),
        vote("R1", "approve", "2026-09-09T11:00:00.000Z"),
      ])
    ).toBe(false);
  });

  test("a reviewer who approved then rejected is counted as rejecting", () => {
    expect(
      unanimouslyRejected([
        vote("R1", "approve", "2026-09-09T10:00:00.000Z"),
        vote("R1", "reject", "2026-09-09T11:00:00.000Z"),
      ])
    ).toBe(true);
  });

  // Deliberately NOT pool-filtered, matching aggregateFeedback. If an out-of-pool
  // approval were dropped here, aggregation would build a counter-offer while the
  // guard refused the candidate permission to accept it.
  test("a responder outside the pool still counts, as it does in aggregation", () => {
    expect(unanimouslyRejected([feedback("R1", "reject"), feedback("stranger", "approve")])).toBe(
      false
    );
  });
});
