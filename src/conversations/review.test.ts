import { describe, expect, test } from "bun:test";
import { parseCounterFeedback } from "./review";
import { ClaudeService } from "../services/claude";
import type { ReviewerFeedback } from "../models/types";

describe("parseCounterFeedback", () => {
  test("leading bare number is the rate", () => {
    const r = parseCounterFeedback("60 - depth is thin");
    expect(r.suggestedRate).toBe(60);
    expect(r.suggestedCommitment).toBeNull();
    expect(r.qualitative).toBe("depth is thin");
  });

  test("number followed by % is commitment, not rate (the old $50/hr bug)", () => {
    const r = parseCounterFeedback("we need a commitment of 50%");
    expect(r.suggestedRate).toBeNull();
    expect(r.suggestedCommitment).toBe(50);
    expect(r.qualitative).toBe("we need a commitment of 50%");
  });

  test("rate and commitment together", () => {
    const r = parseCounterFeedback("60, commitment should be 50% - depth is thin");
    expect(r.suggestedRate).toBe(60);
    expect(r.suggestedCommitment).toBe(50);
  });

  test("bare rate only yields placeholder qualitative", () => {
    const r = parseCounterFeedback("60");
    expect(r.suggestedRate).toBe(60);
    expect(r.qualitative).toBe("(no qualitative feedback provided)");
  });

  test("leading percentage is commitment, rate stays null", () => {
    const r = parseCounterFeedback("50% commitment please");
    expect(r.suggestedRate).toBeNull();
    expect(r.suggestedCommitment).toBe(50);
  });

  test("percent before the number is still commitment (%40)", () => {
    const r = parseCounterFeedback("commitment should be %40");
    expect(r.suggestedRate).toBeNull();
    expect(r.suggestedCommitment).toBe(40);
  });

  test("percent before the number with a space (% 40)", () => {
    const r = parseCounterFeedback("commitment should be % 40");
    expect(r.suggestedCommitment).toBe(40);
  });

  test("rate + percent-before-number commitment", () => {
    const r = parseCounterFeedback("60, commitment %40 - fine otherwise");
    expect(r.suggestedRate).toBe(60);
    expect(r.suggestedCommitment).toBe(40);
  });

  // DEF-11: a reviewer wrote prose ending in "$40?" during the 2026-09-08 QA run.
  // The rate was dropped, so the contributor was shown $40 while the agreement
  // still held the original $50 ask.
  test("DEF-11: dollar amount mid-sentence is the rate", () => {
    const r = parseCounterFeedback("It's above our budget for this role, can we reduce it to $40?");
    expect(r.suggestedRate).toBe(40);
    expect(r.suggestedCommitment).toBeNull();
    expect(r.qualitative).toBe("It's above our budget for this role, can we reduce it to $40?");
  });

  test("DEF-11: when the current rate is quoted first, the last dollar amount wins", () => {
    const r = parseCounterFeedback("$50/hr is over budget, let's land at $40");
    expect(r.suggestedRate).toBe(40);
  });

  test("DEF-11: a leading number still beats a later dollar amount", () => {
    const r = parseCounterFeedback("38 - their last ask was $50 which we can't fund");
    expect(r.suggestedRate).toBe(38);
    expect(r.qualitative).toBe("their last ask was $50 which we can't fund");
  });

  test("DEF-11: a lone leading amount is the rate and drops out of the prose", () => {
    const r = parseCounterFeedback("$60 - too expensive otherwise");
    expect(r.suggestedRate).toBe(60);
    expect(r.qualitative).toBe("too expensive otherwise");
  });

  test("DEF-11: a dollar amount does not hijack a percentage", () => {
    const r = parseCounterFeedback("keep the rate, but commitment must be 50%");
    expect(r.suggestedRate).toBeNull();
    expect(r.suggestedCommitment).toBe(50);
  });

  test("DEF-11: prose with no number at all yields nothing to record", () => {
    const r = parseCounterFeedback("this feels too expensive for the role");
    expect(r.suggestedRate).toBeNull();
    expect(r.suggestedCommitment).toBeNull();
  });
});

// ClaudeService's constructor makes no network call, and these aggregation
// fast-paths never call the API, so they run fully offline.
const claude = new ClaudeService({ ANTHROPIC_API_KEY: "test-key" } as never);

function fb(partial: Partial<ReviewerFeedback>): ReviewerFeedback {
  return {
    reviewerId: "R1",
    reviewerName: "R1",
    decision: "counter",
    suggestedRate: null,
    suggestedCommitment: null,
    qualitativeFeedback: "",
    submittedAt: "2026-07-15T00:00:00.000Z",
    ...partial,
  };
}

describe("aggregateFeedback commitment (offline fast-paths)", () => {
  test("single counter passes commitment through", async () => {
    const r = await claude.aggregateFeedback(
      [fb({ suggestedRate: 70, suggestedCommitment: 60, qualitativeFeedback: "lower rate" })],
      80,
      40
    );
    expect(r?.suggestedRate).toBe(70);
    expect(r?.suggestedCommitment).toBe(60);
  });

  test("all approve keeps the original commitment", async () => {
    const r = await claude.aggregateFeedback(
      [fb({ reviewerId: "R1", decision: "approve" }), fb({ reviewerId: "R2", decision: "approve" })],
      80,
      40
    );
    expect(r?.outcome).toBe("all_approve");
    expect(r?.suggestedCommitment).toBe(40);
  });

  test("all reject yields null commitment", async () => {
    const r = await claude.aggregateFeedback(
      [
        fb({ reviewerId: "R1", decision: "reject", qualitativeFeedback: "no" }),
        fb({ reviewerId: "R2", decision: "reject", qualitativeFeedback: "nope" }),
      ],
      80,
      40
    );
    expect(r?.outcome).toBe("all_reject");
    expect(r?.suggestedCommitment).toBeNull();
  });
});
