import { describe, expect, test } from "bun:test";
import type { BotContext } from "../bot";
import type { ReviewerFeedback } from "../models/types";
import { refuseIfDeclined } from "./resolution";

function feedback(
  reviewerId: string,
  decision: ReviewerFeedback["decision"],
  submittedAt = "2026-09-09T00:00:00.000Z"
): ReviewerFeedback {
  return {
    reviewerId,
    reviewerName: `reviewer-${reviewerId}`,
    decision,
    suggestedRate: null,
    suggestedCommitment: null,
    qualitativeFeedback: "",
    submittedAt,
  };
}

function candidateCtx(feedbacks: ReviewerFeedback[]) {
  const replies: string[] = [];
  let markupCleared = false;
  const ctx = {
    sheets: { getReviewFeedbacks: async () => feedbacks },
    editMessageReplyMarkup: async () => {
      markupCleared = true;
    },
    reply: async (text: string) => {
      replies.push(text);
    },
  } as unknown as BotContext;
  return { ctx, replies, cleared: () => markupCleared };
}

// §16: hiding the Accept button does not disable it. Callback data is replayable,
// so a tap on an older message must be refused at the handler, not just omitted
// from the keyboard.
describe("refuseIfDeclined", () => {
  test("a replayed Accept on a declined proposal is refused", async () => {
    const h = candidateCtx([feedback("R1", "reject"), feedback("R2", "reject")]);
    expect(await refuseIfDeclined(h.ctx, "a_1")).toBe(true);
    expect(h.replies[0]).toContain("can't be accepted");
    expect(h.cleared()).toBe(true);
  });

  test("a mixed verdict still lets the candidate accept the counter-offer", async () => {
    const h = candidateCtx([feedback("R1", "reject"), feedback("R2", "approve")]);
    expect(await refuseIfDeclined(h.ctx, "a_1")).toBe(false);
    expect(h.replies).toEqual([]);
  });

  test("all approvals are accepted", async () => {
    const h = candidateCtx([feedback("R1", "approve"), feedback("R2", "approve")]);
    expect(await refuseIfDeclined(h.ctx, "a_1")).toBe(false);
  });

  test("a counter is an invitation to keep talking, not a refusal", async () => {
    const h = candidateCtx([feedback("R1", "reject"), feedback("R2", "counter")]);
    expect(await refuseIfDeclined(h.ctx, "a_1")).toBe(false);
  });

  test("no feedback at all does not block an accept", async () => {
    const h = candidateCtx([]);
    expect(await refuseIfDeclined(h.ctx, "a_1")).toBe(false);
  });

  test("a reviewer who rejected then changed their mind unblocks the accept", async () => {
    const h = candidateCtx([
      feedback("R1", "reject", "2026-09-09T10:00:00.000Z"),
      feedback("R1", "approve", "2026-09-09T11:00:00.000Z"),
    ]);
    expect(await refuseIfDeclined(h.ctx, "a_1")).toBe(false);
  });

  test("the refusal names the reflection period so the candidate knows what to do next", async () => {
    const h = candidateCtx([feedback("R1", "reject")]);
    await refuseIfDeclined(h.ctx, "a_1");
    expect(h.replies[0]).toContain("apply again");
  });
});
