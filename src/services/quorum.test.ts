import { describe, expect, test } from "bun:test";
import type { ReviewerFeedback } from "../models/types";
import {
  isReviewComplete,
  outstandingReviewers,
  quorumThreshold,
  respondedReviewerIds,
  respondedWithinPool,
  reviewRecipients,
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
