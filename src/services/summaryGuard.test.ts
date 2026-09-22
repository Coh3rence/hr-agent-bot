import { describe, expect, test } from "bun:test";
import type { ReviewerFeedback } from "../models/types";
import { deterministicSummary, findSummaryViolation } from "./summaryGuard";

function feedback(
  decision: ReviewerFeedback["decision"],
  qualitativeFeedback = "",
  suggestedRate: number | null = null
): ReviewerFeedback {
  return {
    reviewerId: "r1",
    reviewerName: "reviewer",
    decision,
    suggestedRate,
    suggestedCommitment: null,
    qualitativeFeedback,
    submittedAt: "2026-09-12T00:00:00.000Z",
  };
}

describe("findSummaryViolation — placeholders (§20, the [relevant area] run)", () => {
  test("rejects the exact copy that nearly reached a candidate", () => {
    const summary =
      "We'd encourage you to consider gaining additional targeted experience in [relevant area] and welcome you to reapply.";
    expect(findSummaryViolation(summary, [])).toBe(
      "unfilled placeholder [relevant area]"
    );
  });

  test("rejects curly-brace placeholders too", () => {
    expect(findSummaryViolation("Thanks {name}, we'll be in touch.", [])).toBe(
      "unfilled placeholder {name}"
    );
  });

  test("clean prose with no brackets passes", () => {
    expect(
      findSummaryViolation("The reviewers were positive about your portfolio.", [])
    ).toBeNull();
  });
});

describe("findSummaryViolation — invented figures (§20, the $60 run)", () => {
  test("rejects a rate no reviewer proposed", () => {
    const summary =
      "Our current band for this position is $60, which represents fair compensation. We'd like to move forward at this rate.";
    expect(findSummaryViolation(summary, [75])).toBe(
      "unsupported figure $60 (no reviewer proposed it)"
    );
  });

  test("allows a figure that is actually on the table", () => {
    const summary = "We'd like to propose an adjusted rate of $60/hour rather than the $75 you requested.";
    expect(findSummaryViolation(summary, [60, 75])).toBeNull();
  });

  test("catches a bare per-hour figure written without a dollar sign", () => {
    expect(findSummaryViolation("Could we land at 55/hr instead?", [60, 75])).toBe(
      "unsupported figure $55 (no reviewer proposed it)"
    );
  });

  test("parses thousands separators rather than reading $6,400 as 6", () => {
    expect(findSummaryViolation("The monthly equivalent is $6,400.", [6400])).toBeNull();
    expect(findSummaryViolation("The monthly equivalent is $6,400.", [6])).toBe(
      "unsupported figure $6400 (no reviewer proposed it)"
    );
  });

  test("reports the first unsupported figure when several appear", () => {
    expect(findSummaryViolation("Between $40 and $90.", [40])).toBe(
      "unsupported figure $90 (no reviewer proposed it)"
    );
  });
});

describe("findSummaryViolation — empty generations", () => {
  test("an empty summary is a violation, not valid copy", () => {
    expect(findSummaryViolation("", [60])).toBe("empty summary");
  });

  test("whitespace only is a violation", () => {
    expect(findSummaryViolation("   \n  ", [60])).toBe("empty summary");
  });
});

describe("deterministicSummary — the fallback cannot invent a figure", () => {
  test("uses the reviewers' own words", () => {
    const result = deterministicSummary([
      feedback("counter", "Strong portfolio, but $75 is over the band — could we land at $60?", 60),
      feedback("reject", "Not convinced the experience matches this role at this price."),
    ]);

    expect(result).toBe(
      "The reviewers did not reach a single view. Their comments: " +
        "Strong portfolio, but $75 is over the band — could we land at $60?; " +
        "Not convinced the experience matches this role at this price."
    );
  });

  test("skips reviewers who left no comment", () => {
    const result = deterministicSummary([
      feedback("approve"),
      feedback("reject", "Too expensive for the scope."),
    ]);

    expect(result).toBe(
      "The reviewers did not reach a single view. Their comments: Too expensive for the scope."
    );
  });

  test("still says something when nobody wrote anything", () => {
    expect(deterministicSummary([feedback("approve"), feedback("reject")])).toBe(
      "The reviewers did not reach a single view and left no written comments."
    );
  });

  test("its own output passes the guard", () => {
    const fallback = deterministicSummary([
      feedback("counter", "Above our band, can we reduce it to $60?", 60),
    ]);
    expect(findSummaryViolation(fallback, [60])).toBeNull();
  });
});
