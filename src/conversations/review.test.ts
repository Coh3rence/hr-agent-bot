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
