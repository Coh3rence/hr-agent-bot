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
  round?: number;
  pendingSupersedeId?: string | null;
  currentAgreementId?: string | null;
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
      currentAgreementId: opts.currentAgreementId ?? null,
      messageHistory: [],
      negotiationContext: null,
      pendingSupersedeId: opts.pendingSupersedeId ?? null,
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
          negotiationRound: opts.round ?? 1,
          status: opts.status,
        }) as Agreement,
      getReviewFeedbacks: async () => [],
      getCandidateOffer: async () => null,
      getContributorById: async () => opts.contributor ?? null,
      updateAgreementStatus: async (id: string, status: string) => {
        statusWrites.push(`${id}:${status}`);
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
    expect(h.statusWrites).toEqual(["a_1:approved"]);
  });

  // `linked` runs after `accept` has already moved the row to `approved`. Guarding
  // it would strand a candidate who has finished Collabberry sign-up.
  test("the Collabberry sign-up follow-up is exempt from the guard", async () => {
    const h = resolutionCtx({ action: "linked", status: "approved" });
    await handleResolution(h.ctx);
    expect(h.replies[0]).toContain("couldn't find your profile");
  });
});

// DEF-1 / §14: the round is read off the persisted row so a cold session can't
// buy a fresh budget. `nextRoundFromHistory` covers how the number is derived;
// these cover the cap acting on it.
describe("handleResolution — the negotiation round cap", () => {
  test("Modify at the final round is refused, and the row is left standing", async () => {
    const h = resolutionCtx({ action: "modify", status: "under_review", round: 2 });
    await handleResolution(h.ctx);
    expect(h.replies[0]).toContain("limit of 2 negotiation rounds");
    // §23: refusing without superseding is what keeps the offer acceptable. A
    // retired row would strand the candidate with nothing left to accept.
    expect(h.statusWrites).toEqual([]);
    expect(h.ctx.session.phase).toBe("resolution");
  });

  test("a round past the cap is refused too, not just the boundary", async () => {
    const h = resolutionCtx({ action: "modify", status: "under_review", round: 3 });
    await handleResolution(h.ctx);
    expect(h.replies[0]).toContain("limit of 2 negotiation rounds");
    expect(h.statusWrites).toEqual([]);
  });

  test("Modify below the cap re-enters negotiation without retiring the row (§23)", async () => {
    const h = resolutionCtx({ action: "modify", status: "under_review", round: 1 });
    await handleResolution(h.ctx);
    // Retire-on-commit: exploring a revision must not destroy the standing
    // offer. The row is parked for supersede at submit time instead.
    expect(h.statusWrites).toEqual([]);
    expect(h.ctx.session.phase).toBe("negotiation");
    expect(h.ctx.session.currentAgreementId).toBeNull();
    expect(h.ctx.session.pendingSupersedeId).toBe("a_1");
  });
});

// §23 retire-on-commit (D-d): between the Modify tap and the revision's submit,
// the reviewed row and an exploratory draft coexist. Settling the reviewed row
// (Accept or Walk away) makes the draft the dead branch — it must be retired, or
// its Submit button later files terms the candidate decided against (and §24's
// guard would let it through: its status is still `draft`).
describe("handleResolution — settling the standing offer retires the exploratory draft", () => {
  test("Accept during a revision window retires the parked draft", async () => {
    const h = resolutionCtx({
      action: "accept",
      status: "under_review",
      pendingSupersedeId: "a_1",
      currentAgreementId: "a_2",
    });
    await handleResolution(h.ctx);
    expect(h.statusWrites).toEqual(["a_2:superseded", "a_1:approved"]);
    expect(h.ctx.session.pendingSupersedeId).toBeNull();
  });

  test("Walk away during a revision window retires the parked draft too", async () => {
    const h = resolutionCtx({
      action: "walkaway",
      status: "under_review",
      pendingSupersedeId: "a_1",
      currentAgreementId: "a_2",
    });
    await handleResolution(h.ctx);
    expect(h.statusWrites).toEqual(["a_2:superseded", "a_1:rejected"]);
    expect(h.ctx.session.pendingSupersedeId).toBeNull();
  });

  test("Accept with no draft yet just clears the parked id", async () => {
    const h = resolutionCtx({
      action: "accept",
      status: "under_review",
      pendingSupersedeId: "a_1",
    });
    await handleResolution(h.ctx);
    expect(h.statusWrites).toEqual(["a_1:approved"]);
    expect(h.ctx.session.pendingSupersedeId).toBeNull();
  });

  test("Accept of an unrelated proposal leaves another window's draft alone", async () => {
    const h = resolutionCtx({
      action: "accept",
      status: "under_review",
      pendingSupersedeId: "a_other",
      currentAgreementId: "a_2",
    });
    await handleResolution(h.ctx);
    expect(h.statusWrites).toEqual(["a_1:approved"]);
  });
});
