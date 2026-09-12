import { describe, expect, test } from "bun:test";
import type { BotContext } from "../bot";
import type { Agreement, Contributor, ReviewerFeedback } from "../models/types";
import { handleResolution, refuseIfDeclined } from "./resolution";

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

function resolutionCtx(opts: {
  action: string;
  status: Agreement["status"];
  contributor?: Contributor | null;
}) {
  const replies: string[] = [];
  const statusWrites: string[] = [];
  let markupCleared = false;

  const ctx = {
    callbackQuery: { data: `resolution:${opts.action}:a_1` },
    from: { id: 555 },
    config: { MAX_NEGOTIATION_ROUNDS: 2 },
    session: {
      phase: "resolution",
      contributorId: null,
      selectedOpportunityId: null,
      currentAgreementId: null,
      messageHistory: [],
      negotiationContext: null,
    },
    sheets: {
      getAgreement: async () =>
        ({
          id: "a_1",
          opportunityId: "opp_1",
          contributorId: "c_1",
          roleName: "Engineer",
          hourlyRate: 75,
          commitmentPercent: 60,
          negotiationRound: 1,
          status: opts.status,
        }) as Agreement,
      getReviewFeedbacks: async () => [],
      getCandidateOffer: async () => null,
      getContributorById: async () => opts.contributor ?? null,
      updateAgreementStatus: async (_id: string, status: string) => {
        statusWrites.push(status);
      },
      updateContributor: async () => {},
    },
    editMessageReplyMarkup: async () => {
      markupCleared = true;
    },
    reply: async (text: string) => {
      replies.push(text);
    },
  } as unknown as BotContext;

  return { ctx, replies, statusWrites, cleared: () => markupCleared };
}

// §19: the candidate-side mirror of ensureOpenForReview. Callback data is
// replayable, so a keyboard from a round the candidate has already left stays
// tappable forever — and an Accept filed against a retired row hired them on
// terms nobody had agreed to.
describe("handleResolution — the proposal must still be open", () => {
  test("a replayed Accept on a superseded proposal is refused", async () => {
    const h = resolutionCtx({ action: "accept", status: "superseded" });
    await handleResolution(h.ctx);
    expect(h.replies[0]).toContain("earlier version of this proposal");
    expect(h.statusWrites).toEqual([]);
    expect(h.cleared()).toBe(true);
  });

  test("a replayed Accept on an already-approved proposal does not re-approve it", async () => {
    const h = resolutionCtx({ action: "accept", status: "approved" });
    await handleResolution(h.ctx);
    expect(h.statusWrites).toEqual([]);
  });

  test("Modify is refused once the row is retired, so no second negotiation starts", async () => {
    const h = resolutionCtx({ action: "modify", status: "superseded" });
    await handleResolution(h.ctx);
    expect(h.replies[0]).toContain("settled or replaced");
    expect(h.ctx.session.phase).not.toBe("negotiation");
  });

  test("Walk away is refused on a closed proposal rather than cooling the candidate twice", async () => {
    const h = resolutionCtx({ action: "walkaway", status: "rejected" });
    await handleResolution(h.ctx);
    expect(h.statusWrites).toEqual([]);
  });

  test("an open proposal still passes the guard", async () => {
    const h = resolutionCtx({ action: "accept", status: "under_review" });
    await handleResolution(h.ctx);
    expect(h.statusWrites).toEqual(["approved"]);
  });

  // `linked` runs after `accept` has already moved the row to `approved`. Guarding
  // it would strand a candidate who has finished Collabberry sign-up.
  test("the Collabberry sign-up follow-up is exempt from the guard", async () => {
    const h = resolutionCtx({ action: "linked", status: "approved" });
    await handleResolution(h.ctx);
    expect(h.replies[0]).toContain("couldn't find your profile");
  });
});
