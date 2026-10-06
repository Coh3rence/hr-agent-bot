import { describe, expect, test } from "bun:test";
import {
  ensureOpenForReview,
  ensureSubmittable,
  notifyAdminsOfWriteFailure,
  parseCounterFeedback,
  supersedePendingRevision,
} from "./review";
import type { BotContext } from "../bot";
import { ClaudeService } from "../services/claude";
import type { Agreement, Contributor, ReviewerFeedback } from "../models/types";

function reviewerCtx(status: Agreement["status"] | null) {
  const replies: string[] = [];
  const ctx = {
    sheets: {
      getAgreement: async () => (status === null ? null : ({ id: "a_1", status } as Agreement)),
    },
    editMessageReplyMarkup: async () => {},
    reply: async (text: string) => {
      replies.push(text);
    },
  } as unknown as BotContext;
  return { ctx, replies };
}

describe("ensureOpenForReview", () => {
  test("an open proposal accepts the reviewer's tap", async () => {
    const { ctx, replies } = reviewerCtx("under_review");
    expect(await ensureOpenForReview(ctx, "a_1")).toBe(true);
    expect(replies).toEqual([]);
  });

  // The live QA failure: the contributor revised a $50 ask down to $40, but the
  // reviewer's original keyboard still worked, so their approval of the withdrawn
  // $50 was recorded and read as sign-off on the live proposal.
  test("a superseded proposal refuses the tap and says why", async () => {
    const { ctx, replies } = reviewerCtx("superseded");
    expect(await ensureOpenForReview(ctx, "a_1")).toBe(false);
    expect(replies[0]).toContain("no longer open for review");
  });

  test("an already-decided proposal refuses the tap", async () => {
    const { ctx } = reviewerCtx("approved");
    expect(await ensureOpenForReview(ctx, "a_1")).toBe(false);
  });

  test("a draft is not reviewable — Submit has not been tapped yet", async () => {
    const { ctx } = reviewerCtx("draft");
    expect(await ensureOpenForReview(ctx, "a_1")).toBe(false);
  });

  test("a missing agreement refuses rather than throwing", async () => {
    const { ctx, replies } = reviewerCtx(null);
    expect(await ensureOpenForReview(ctx, "a_1")).toBe(false);
    expect(replies[0]).toContain("couldn't find");
  });
});

// §24: the contributor-side mirror of ensureOpenForReview. The Submit button
// outlives the draft, so a late tap must not re-file it and re-ping reviewers.
describe("ensureSubmittable", () => {
  test("a draft accepts the submit tap", async () => {
    const { ctx, replies } = reviewerCtx("draft");
    expect(await ensureSubmittable(ctx, "a_1")).toBe(true);
    expect(replies).toEqual([]);
  });

  test("a second tap on an already-submitted proposal is refused and says so", async () => {
    const { ctx, replies } = reviewerCtx("under_review");
    expect(await ensureSubmittable(ctx, "a_1")).toBe(false);
    expect(replies[0]).toContain("already with the core team");
  });

  test("a superseded draft is refused — its replacement is the live one", async () => {
    const { ctx, replies } = reviewerCtx("superseded");
    expect(await ensureSubmittable(ctx, "a_1")).toBe(false);
    expect(replies[0]).toContain("no longer active");
  });

  test("a decided agreement is refused", async () => {
    const { ctx, replies } = reviewerCtx("approved");
    expect(await ensureSubmittable(ctx, "a_1")).toBe(false);
    expect(replies[0]).toContain("no longer active");
  });

  test("a missing agreement refuses rather than throwing", async () => {
    const { ctx, replies } = reviewerCtx(null);
    expect(await ensureSubmittable(ctx, "a_1")).toBe(false);
    expect(replies[0]).toContain("couldn't find");
  });
});

function supersedeCtx(opts: {
  pendingId: string | null;
  rows: Record<string, Partial<Agreement>>;
  failWrite?: boolean;
}) {
  const writes: string[] = [];
  const ctx = {
    session: { pendingSupersedeId: opts.pendingId },
    sheets: {
      getAgreement: async (id: string) =>
        opts.rows[id] ? ({ id, ...opts.rows[id] } as Agreement) : null,
      updateAgreementStatus: async (id: string, status: string) => {
        if (opts.failWrite) throw new Error("Sheets is down");
        writes.push(`${id}:${status}`);
      },
    },
  } as unknown as BotContext;
  return { ctx, writes };
}

// §23 retire-on-commit: submitting a revision is the moment the reviewed row it
// replaces gets retired. Fetch-and-check, never a blind write.
describe("supersedePendingRevision", () => {
  test("a committed revision supersedes the reviewed row it revises", async () => {
    const h = supersedeCtx({
      pendingId: "a_old",
      rows: {
        a_old: { status: "under_review", opportunityId: "opp_1" },
        a_new: { status: "under_review", opportunityId: "opp_1" },
      },
    });
    await supersedePendingRevision(h.ctx, "a_new");
    expect(h.writes).toEqual(["a_old:superseded"]);
    expect(h.ctx.session.pendingSupersedeId).toBeNull();
  });

  test("no revision window open → nothing happens", async () => {
    const h = supersedeCtx({ pendingId: null, rows: {} });
    await supersedePendingRevision(h.ctx, "a_new");
    expect(h.writes).toEqual([]);
  });

  test("an old row settled during the window is left alone", async () => {
    const h = supersedeCtx({
      pendingId: "a_old",
      rows: {
        a_old: { status: "approved", opportunityId: "opp_1" },
        a_new: { status: "under_review", opportunityId: "opp_1" },
      },
    });
    await supersedePendingRevision(h.ctx, "a_new");
    expect(h.writes).toEqual([]);
    expect(h.ctx.session.pendingSupersedeId).toBeNull();
  });

  test("a draft for a DIFFERENT role does not retire a standing offer it never revised", async () => {
    const h = supersedeCtx({
      pendingId: "a_old",
      rows: {
        a_old: { status: "under_review", opportunityId: "opp_1" },
        a_new: { status: "under_review", opportunityId: "opp_2" },
      },
    });
    await supersedePendingRevision(h.ctx, "a_new");
    expect(h.writes).toEqual([]);
  });

  test("a parked id equal to the submitted id is ignored", async () => {
    const h = supersedeCtx({
      pendingId: "a_new",
      rows: { a_new: { status: "under_review", opportunityId: "opp_1" } },
    });
    await supersedePendingRevision(h.ctx, "a_new");
    expect(h.writes).toEqual([]);
  });

  test("a failed supersede write logs rather than breaking the submit flow", async () => {
    const h = supersedeCtx({
      pendingId: "a_old",
      rows: {
        a_old: { status: "under_review", opportunityId: "opp_1" },
        a_new: { status: "under_review", opportunityId: "opp_1" },
      },
      failWrite: true,
    });
    await supersedePendingRevision(h.ctx, "a_new");
    expect(h.ctx.session.pendingSupersedeId).toBeNull();
  });
});

function writeFailureCtx(opts: {
  adminIds: string[];
  candidateTelegramId?: string;
  lookupThrows?: boolean;
}) {
  const dms: (number | string)[] = [];
  const ctx = {
    sheets: {
      getAdminIds: async () => opts.adminIds,
      getAgreement: async () => {
        if (opts.lookupThrows) throw new Error("Sheets is down");
        return { id: "a_1", contributorId: "c_1" } as Agreement;
      },
      getContributorById: async () =>
        opts.candidateTelegramId
          ? ({ id: "c_1", telegramId: opts.candidateTelegramId } as Contributor)
          : null,
    },
    api: {
      sendMessage: async (chatId: number) => {
        dms.push(chatId);
      },
    },
  } as unknown as BotContext;
  return { ctx, dms };
}

// §15: the alert names another reviewer and their decision, and in this
// deployment a contributor is often an admin too.
describe("notifyAdminsOfWriteFailure", () => {
  test("the candidate does not receive an alert about their own review", async () => {
    const h = writeFailureCtx({ adminIds: ["100", "200", "300"], candidateTelegramId: "300" });
    await notifyAdminsOfWriteFailure(h.ctx, "a_1", "Reviewer One", "approve", new Error("boom"));
    expect(h.dms).toEqual([100, 200]);
  });

  test("a non-admin candidate leaves the alert list intact", async () => {
    const h = writeFailureCtx({ adminIds: ["100", "200"], candidateTelegramId: "999" });
    await notifyAdminsOfWriteFailure(h.ctx, "a_1", "Reviewer One", "approve", new Error("boom"));
    expect(h.dms).toEqual([100, 200]);
  });

  // We are already on a Sheets failure path. Losing the alert entirely is worse
  // than the narrower leak, so an unresolvable candidate falls back to all admins.
  test("an alert still goes out when the candidate cannot be resolved", async () => {
    const h = writeFailureCtx({ adminIds: ["100", "200"], lookupThrows: true });
    await notifyAdminsOfWriteFailure(h.ctx, "a_1", "Reviewer One", "approve", new Error("boom"));
    expect(h.dms).toEqual([100, 200]);
  });
});

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

  // §22. A leading bare number is normally the rate, but not when it counts
  // months or hours — "6 months at $70" booked $6/hr, and the candidate was shown
  // a counter-offer no reviewer had proposed.
  test("§22: a leading duration does not become the rate", () => {
    const r = parseCounterFeedback("6 months at $70 would work better for us");
    expect(r.suggestedRate).toBe(70);
  });

  test("§22: a leading weekly-hours figure does not become the rate", () => {
    const r = parseCounterFeedback("40 hours a week at $70");
    expect(r.suggestedRate).toBe(70);
  });

  test("§22: a duration-only counter records nothing, so the reviewer is re-asked", () => {
    const r = parseCounterFeedback("we'd want 6 months rather than 3");
    expect(r.suggestedRate).toBeNull();
    expect(r.suggestedCommitment).toBeNull();
  });

  // hr/hrs denote the rate itself, so they must stay outside the duration list.
  test("§22: an hr-suffixed rate is still a rate", () => {
    expect(parseCounterFeedback("60 hr - above band").suggestedRate).toBe(60);
    expect(parseCounterFeedback("60/hr - above band").suggestedRate).toBe(60);
    expect(parseCounterFeedback("60 an hour is our ceiling").suggestedRate).toBe(60);
  });

  test("§22: duration, commitment and rate in one message each land correctly", () => {
    const r = parseCounterFeedback("6 months, 80% commitment, $70/hr");
    expect(r.suggestedRate).toBe(70);
    expect(r.suggestedCommitment).toBe(80);
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
