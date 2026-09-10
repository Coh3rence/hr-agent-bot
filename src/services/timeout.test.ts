import { describe, expect, test } from "bun:test";
import type { Agreement, Contributor, ReviewerFeedback } from "../models/types";
import type { ClaudeService } from "./claude";
import type { Notifier } from "./presentation";
import type { SheetsService } from "./sheets";
import { REVIEW_WINDOW_MS, sweepExpiredReviews } from "./timeout";

const SUBMITTED = "2026-09-01T00:00:00.000Z";
const EXPIRED = Date.parse(SUBMITTED) + REVIEW_WINDOW_MS + 1;

function feedback(reviewerId: string): ReviewerFeedback {
  return {
    reviewerId,
    reviewerName: `reviewer-${reviewerId}`,
    decision: "approve",
    suggestedRate: null,
    suggestedCommitment: null,
    qualitativeFeedback: "",
    submittedAt: SUBMITTED,
  };
}

function harness(opts: {
  adminIds: string[];
  candidateTelegramId: string;
  feedbacks: ReviewerFeedback[];
}) {
  const dms: { chatId: number | string; text: string }[] = [];
  const statusWrites: string[] = [];

  const sheets = {
    listAgreementReviewState: async () => [
      { id: "a_1", status: "under_review", submittedAt: SUBMITTED, aggregated: false, notified: false },
    ],
    getAgreement: async () =>
      ({ id: "a_1", contributorId: "c_1", status: "under_review" }) as Agreement,
    getContributorById: async () =>
      ({ id: "c_1", telegramId: opts.candidateTelegramId }) as Contributor,
    getAdminIds: async () => opts.adminIds,
    getReviewFeedbacks: async () => opts.feedbacks,
    updateAgreementStatus: async (_id: string, status: string) => {
      statusWrites.push(status);
    },
  } as unknown as SheetsService;

  const notifier: Notifier = {
    sendMessage: async (chatId, text) => {
      dms.push({ chatId, text });
    },
  };

  const claude = {} as ClaudeService;
  return { sheets, notifier, claude, dms, statusWrites };
}

// §15: every participant in this deployment is an admin, so an unfiltered
// broadcast told a candidate how many reviewers had weighed in on their own
// application. The escalation is *about* them, so they are exactly the wrong
// recipient.
describe("escalation routing when the candidate is also an admin", () => {
  test("the candidate is not DM'd their own escalation", async () => {
    const h = harness({ adminIds: ["100", "200", "300"], candidateTelegramId: "300", feedbacks: [] });
    await sweepExpiredReviews(h.sheets, h.claude, h.notifier, EXPIRED);
    expect(h.dms.map((d) => d.chatId)).toEqual([100, 200]);
  });

  test("the other reviewers still get the alert", async () => {
    const h = harness({ adminIds: ["100", "200", "300"], candidateTelegramId: "300", feedbacks: [] });
    await sweepExpiredReviews(h.sheets, h.claude, h.notifier, EXPIRED);
    expect(h.dms[0]!.text).toContain("without quorum");
    expect(h.dms[0]!.text).toContain("a_1");
  });

  test("a non-admin candidate leaves the reviewer list intact", async () => {
    const h = harness({ adminIds: ["100", "200"], candidateTelegramId: "999", feedbacks: [] });
    await sweepExpiredReviews(h.sheets, h.claude, h.notifier, EXPIRED);
    expect(h.dms.map((d) => d.chatId)).toEqual([100, 200]);
  });

  test("the agreement is moved to escalated, never auto-approved", async () => {
    const h = harness({ adminIds: ["100", "200", "300"], candidateTelegramId: "300", feedbacks: [] });
    await sweepExpiredReviews(h.sheets, h.claude, h.notifier, EXPIRED);
    expect(h.statusWrites).toEqual(["escalated"]);
  });

  // The pool is admins minus the candidate, so the reported counts must be against
  // that pool — not the raw admin list, which would misstate what was needed.
  test("the counts quoted are against the pool the candidate was excluded from", async () => {
    const h = harness({
      adminIds: ["100", "200", "300"],
      candidateTelegramId: "300",
      feedbacks: [feedback("100")],
    });
    await sweepExpiredReviews(h.sheets, h.claude, h.notifier, EXPIRED);
    expect(h.dms[0]!.text).toContain("1/2 reviewers responded, 2 needed");
  });

  test("a review still inside its window is left alone", async () => {
    const h = harness({ adminIds: ["100", "200"], candidateTelegramId: "999", feedbacks: [] });
    await sweepExpiredReviews(h.sheets, h.claude, h.notifier, Date.parse(SUBMITTED) + 1000);
    expect(h.dms).toEqual([]);
    expect(h.statusWrites).toEqual([]);
  });
});
