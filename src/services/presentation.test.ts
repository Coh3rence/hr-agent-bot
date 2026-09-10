import { describe, expect, test } from "bun:test";
import { InlineKeyboard } from "grammy";
import type { Agreement, Contributor, ReviewerFeedback } from "../models/types";
import { presentToCandidate, type Notifier } from "./presentation";
import type { SheetsService } from "./sheets";

function feedback(reviewerId: string, decision: ReviewerFeedback["decision"]): ReviewerFeedback {
  return {
    reviewerId,
    reviewerName: `reviewer-${reviewerId}`,
    decision,
    suggestedRate: null,
    suggestedCommitment: null,
    qualitativeFeedback: "",
    submittedAt: "2026-09-09T00:00:00.000Z",
  };
}

interface Sent {
  chatId: number | string;
  text: string;
  keyboard: InlineKeyboard | undefined;
}

function harness(feedbacks: ReviewerFeedback[], offerRate: number | null = 45) {
  const sent: Sent[] = [];
  const statusWrites: string[] = [];
  const contributorWrites: Partial<Contributor>[] = [];
  let notified = false;

  const contributor = {
    id: "c_1",
    telegramId: "555",
    name: "Candidate",
    status: "active",
    cooldownUntil: null,
    previousAttempts: 0,
  } as Contributor;

  const sheets = {
    isCandidateNotified: async () => notified,
    markCandidateNotified: async () => {
      notified = true;
    },
    getCandidateOffer: async () => ({
      suggestedRate: offerRate,
      suggestedCommitment: null,
      qualitativeSummary: "The reviewers weighed in.",
    }),
    getAgreement: async () =>
      ({ id: "a_1", contributorId: "c_1", roleName: "Engineer", status: "under_review" }) as Agreement,
    getContributorById: async () => contributor,
    getReviewFeedbacks: async () => feedbacks,
    updateAgreementStatus: async (_id: string, status: string) => {
      statusWrites.push(status);
    },
    updateContributor: async (_id: string, patch: Partial<Contributor>) => {
      contributorWrites.push(patch);
    },
  } as unknown as SheetsService;

  const notifier: Notifier = {
    sendMessage: async (chatId, text, other) => {
      sent.push({ chatId, text, keyboard: other?.reply_markup });
    },
  };

  return { sheets, notifier, sent, statusWrites, contributorWrites };
}

// §16: a unanimously rejected candidate was shown an Accept button, and tapping
// it hired them at their own asking rate. There is no offer on the table, so the
// DM carries no buttons and the attempt closes the same way walking away does.
describe("presentToCandidate — unanimous rejection", () => {
  test("no buttons are offered, so there is nothing to accept", async () => {
    const h = harness([feedback("R1", "reject"), feedback("R2", "reject")]);
    expect(await presentToCandidate("a_1", h.sheets, h.notifier)).toBe(true);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.keyboard).toBeUndefined();
    expect(h.sent[0]!.text).not.toContain("How would you like to proceed?");
  });

  test("the attempt is closed and the candidate cooled down", async () => {
    const h = harness([feedback("R1", "reject")]);
    await presentToCandidate("a_1", h.sheets, h.notifier);
    expect(h.statusWrites).toEqual(["rejected"]);
    expect(h.contributorWrites[0]!.status).toBe("cooldown");
    expect(h.contributorWrites[0]!.previousAttempts).toBe(1);
    expect(h.contributorWrites[0]!.cooldownUntil).toBeTruthy();
  });

  test("the rate is never quoted back — accepting it was the original defect", async () => {
    const h = harness([feedback("R1", "reject")]);
    await presentToCandidate("a_1", h.sheets, h.notifier);
    expect(h.sent[0]!.text).not.toContain("/hr");
  });

  test("invited back after the reflection period", async () => {
    const h = harness([feedback("R1", "reject")]);
    await presentToCandidate("a_1", h.sheets, h.notifier);
    expect(h.sent[0]!.text).toContain("apply again");
  });
});

describe("presentToCandidate — an offer still on the table", () => {
  test("a mixed outcome keeps the three-button keyboard", async () => {
    const h = harness([feedback("R1", "reject"), feedback("R2", "approve")]);
    expect(await presentToCandidate("a_1", h.sheets, h.notifier)).toBe(true);
    const rows = h.sent[0]!.keyboard!.inline_keyboard;
    expect(rows.flat().map((b) => b.text)).toEqual(["Accept", "Modify Terms", "Walk away"]);
    expect(h.statusWrites).toEqual([]);
  });

  test("a counter is not a rejection — negotiation continues", async () => {
    const h = harness([feedback("R1", "reject"), feedback("R2", "counter")]);
    await presentToCandidate("a_1", h.sheets, h.notifier);
    expect(h.sent[0]!.keyboard).toBeDefined();
  });

  test("all approvals present the offer normally", async () => {
    const h = harness([feedback("R1", "approve"), feedback("R2", "approve")]);
    await presentToCandidate("a_1", h.sheets, h.notifier);
    expect(h.sent[0]!.text).toContain("Proposed rate: $45/hr");
    expect(h.sent[0]!.keyboard).toBeDefined();
  });

  // Silence is not a verdict (D-011): a review that simply has not closed must
  // not be read as a refusal.
  test("no feedback at all is not treated as a rejection", async () => {
    const h = harness([]);
    await presentToCandidate("a_1", h.sheets, h.notifier);
    expect(h.sent[0]!.keyboard).toBeDefined();
    expect(h.statusWrites).toEqual([]);
  });

  test("the candidate is DM'd exactly once across both triggers", async () => {
    const h = harness([feedback("R1", "approve")]);
    expect(await presentToCandidate("a_1", h.sheets, h.notifier)).toBe(true);
    expect(await presentToCandidate("a_1", h.sheets, h.notifier)).toBe(false);
    expect(h.sent).toHaveLength(1);
  });
});
