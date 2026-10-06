import type { BotContext } from "../bot";
import { InlineKeyboard } from "grammy";
import type { ReviewerFeedback } from "../models/types";
import { isReviewComplete, reviewRecipients } from "../services/quorum";
import type { PriorTerms } from "../services/sheets";
import { selfReviewAllowed } from "../config";
import { presentToCandidate } from "../services/presentation";
import { aggregateForAgreement } from "../services/aggregation";

export async function handleReview(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data || ctx.message?.text || "";
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return;

  if (ctx.session.phase === "reviewer_feedback" && ctx.message?.text && !data.startsWith("review:")) {
    await collectReviewerFeedback(ctx, ctx.message.text);
    return;
  }

  if (data.startsWith("review:submit:")) {
    const agreementId = data.replace("review:submit:", "");
    if (!(await ensureSubmittable(ctx, agreementId))) return;
    await ctx.sheets.updateAgreementStatus(agreementId, "under_review");
    // Retire the Submit/Modify keyboard — its buttons outlive the draft otherwise.
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    // §23: the revision is now committed — retire the reviewed row it replaces.
    await supersedePendingRevision(ctx, agreementId);
    ctx.session.phase = "review";

    await ctx.reply(
      "Your proposal has been submitted to the core team for review. They have 48 hours to respond. I'll notify you as soon as there's a decision."
    );

    await notifyReviewers(ctx, agreementId);
  } else if (data.startsWith("review:modify:")) {
    const agreementId = data.replace("review:modify:", "");
    // Retire the draft rather than leaving it beside its replacement: its own
    // "Submit for Review" button stays live in the chat forever, and tapping it
    // later would push terms the contributor has since abandoned to reviewers.
    // Non-fatal: a stale draft left behind is worse than nothing, but stranding
    // the contributor outside negotiation over a Sheets hiccup is worse still.
    await ctx.sheets
      .updateAgreementStatus(agreementId, "superseded")
      .catch((err) => console.error(`review:modify: could not supersede ${agreementId}:`, err));
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    ctx.session.currentAgreementId = null;
    ctx.session.phase = "negotiation";
    await ctx.reply("No problem. What would you like to change? You can update your rate, commitment %, or duration.");
  } else if (data.startsWith("review:approve:")) {
    const agreementId = data.replace("review:approve:", "");
    if (!(await ensureOpenForReview(ctx, agreementId))) return;
    const ok = await recordReviewerDecision(ctx, agreementId, "approve", null, null, "");
    if (ok) {
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      await ctx.reply("Approval recorded. Thanks.");
      await maybeCompleteReview(ctx, agreementId);
    } else {
      // Keep the buttons in place so the reviewer can simply tap again.
      await ctx.reply(
        "Sorry — I couldn't record your approval just now. Please tap the button again in a moment. An admin has been notified."
      );
    }
  } else if (data.startsWith("review:counter:")) {
    const agreementId = data.replace("review:counter:", "");
    if (!(await ensureOpenForReview(ctx, agreementId))) return;
    ctx.session.pendingReviewAgreementId = agreementId;
    ctx.session.pendingReviewDecision = "counter";
    ctx.session.phase = "reviewer_feedback";
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    await ctx.reply(
      "Please send your counter-offer in a single message. You can suggest a new " +
        "rate, a new commitment %, or both — plus your feedback:\n\n" +
        "• Rate — start with the number (e.g. `60`), or write it with a dollar sign anywhere (e.g. `$60`)\n" +
        "• Commitment — write it as a percentage (e.g. `50%`)\n\n" +
        "Example: `60, commitment should be 50% - experience is thin for senior level`",
      { parse_mode: "Markdown" }
    );
  } else if (data.startsWith("review:reject:")) {
    const agreementId = data.replace("review:reject:", "");
    if (!(await ensureOpenForReview(ctx, agreementId))) return;
    ctx.session.pendingReviewAgreementId = agreementId;
    ctx.session.pendingReviewDecision = "reject";
    ctx.session.phase = "reviewer_feedback";
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    await ctx.reply(
      "Please send your reason for rejection in one message. " +
        "Include what would need to change for this to pass (e.g. lower rate, higher commitment, different role fit)."
    );
  }
}

/**
 * A reviewer's inline keyboard lives in their chat forever, but the proposal it
 * points at does not. Once the contributor has revised it — or it has been
 * decided — a tap must be refused: recording it files an opinion about terms
 * nobody is offering any more, which is how an approval of a withdrawn $50 ask
 * ends up looking like sign-off on a live $40 one.
 */
export async function ensureOpenForReview(ctx: BotContext, agreementId: string): Promise<boolean> {
  const agreement = await ctx.sheets.getAgreement(agreementId);
  if (agreement?.status === "under_review") return true;

  if (!agreement) console.error(`ensureOpenForReview: agreement ${agreementId} not found`);

  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
  await ctx.reply(
    agreement
      ? "This proposal is no longer open for review — the contributor revised it, or it's already been decided. " +
          "If the revised version needs your input, it'll arrive as a new message."
      : "I couldn't find that proposal — it may have been removed."
  );
  return false;
}

/**
 * Same hazard as ensureOpenForReview, from the contributor's side: the
 * Submit/Modify keyboard outlives the draft it was attached to. A second tap on
 * Submit — or a tap on a keyboard whose draft was since superseded or decided —
 * must not re-file the agreement as under_review and re-ping every reviewer.
 */
export async function ensureSubmittable(ctx: BotContext, agreementId: string): Promise<boolean> {
  const agreement = await ctx.sheets.getAgreement(agreementId);
  if (agreement?.status === "draft") return true;

  if (!agreement) console.error(`ensureSubmittable: agreement ${agreementId} not found`);

  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
  if (!agreement) {
    await ctx.reply("I couldn't find that draft — it may have been removed. Send me a message to pick up where you left off.");
  } else if (agreement.status === "under_review") {
    await ctx.reply("This proposal is already with the core team — no need to submit it again. I'll notify you as soon as there's a decision.");
  } else {
    await ctx.reply("This draft is no longer active — it was revised or already decided. If you'd like to propose new terms, just send me a message.");
  }
  return false;
}

/**
 * §23 retire-on-commit (D-d): a post-review Modify leaves the reviewed row
 * standing and parks its id in the session; submitting the revision is the
 * commit that retires it. Fetch-and-check rather than a blind write — the old
 * row may have been settled during the window (accepted, walked away,
 * escalated), and a draft submitted for a DIFFERENT role must not retire a
 * standing offer it does not revise.
 */
export async function supersedePendingRevision(ctx: BotContext, submittedId: string): Promise<void> {
  const oldId = ctx.session.pendingSupersedeId;
  ctx.session.pendingSupersedeId = null;
  if (!oldId || oldId === submittedId) return;

  try {
    const [oldRow, submitted] = await Promise.all([
      ctx.sheets.getAgreement(oldId),
      ctx.sheets.getAgreement(submittedId),
    ]);
    if (oldRow?.status !== "under_review") return;
    if (submitted && submitted.opportunityId !== oldRow.opportunityId) return;
    await ctx.sheets.updateAgreementStatus(oldId, "superseded", submittedId);
  } catch (err) {
    // Loud: a failed supersede leaves the old row's reviewer keyboards
    // answerable (ensureOpenForReview still passes) beside the live revision.
    console.error(
      `supersedePendingRevision: could not supersede ${oldId} after ${submittedId} was submitted:`,
      err
    );
  }
}

export interface ParsedCounter {
  suggestedRate: number | null;
  suggestedCommitment: number | null;
  qualitative: string;
}

/**
 * Parse a reviewer's free-text counter-offer into structured levers + prose.
 * Pure (no I/O) so it can be unit-tested without the Telegram flow.
 *   - Rate, in precedence order: a LEADING bare number (the prompt asks the
 *     reviewer to "start with the number"), otherwise the LAST currency-anchored
 *     amount anywhere in the message. Reviewers write prose despite the prompt,
 *     and a leading amount is often the rate being argued against rather than the
 *     target ("$50/hr is over budget, land at $40"), so the last one wins there.
 *     A number followed by a digit or % is not a rate, so "we need a commitment
 *     of 50%" is never misread as $50/hr. A leading number followed by a duration
 *     unit is a quantity of something else — "6 months at $70" means $70, not $6.
 *     The abbreviations hr/hrs are deliberately NOT duration units, since they
 *     denote the rate itself ("60 hr").
 *   - Commitment = a number adjacent to % anywhere in the message, on either
 *     side ("50%" or "%40"), e.g. "bump commitment to 50%". Leading bare number
 *     (rate) and number-with-% (commitment) don't collide, so we scan the
 *     original text for the percent.
 *   - Everything left over rides through as qualitative feedback.
 */
const DURATION_UNIT = /^\s*(?:months?|mos?|weeks?|wks?|days?|years?|yrs?|hours?)\b/i;

export function parseCounterFeedback(text: string): ParsedCounter {
  let suggestedRate: number | null = null;
  let suggestedCommitment: number | null = null;
  let qualitative = text.trim();

  const leadingMatch = text.match(/^\s*\$?(\d+(?:\.\d+)?)(?![\d%])/);
  const startsWithAmount = /^\s*\$/.test(text);
  const dollarAmounts = [...text.matchAll(/\$\s*(\d+(?:\.\d+)?)(?![\d%])/g)];
  const lastAmount = dollarAmounts.at(-1);
  const leadsWithDuration =
    !!leadingMatch &&
    DURATION_UNIT.test(text.slice(leadingMatch[0].length));

  if (leadingMatch && !startsWithAmount && !leadsWithDuration) {
    suggestedRate = Number(leadingMatch[1]);
    qualitative = text.slice(leadingMatch[0].length).replace(/^[\s\-:,.]+/, "").trim();
  } else if (lastAmount) {
    suggestedRate = Number(lastAmount[1]);
    // Only strip the amount out of the prose when it led the message and was the
    // only one; mid-sentence amounts are part of a sentence that stops making
    // sense with a hole in it.
    if (startsWithAmount && dollarAmounts.length === 1) {
      qualitative = text.slice(leadingMatch![0].length).replace(/^[\s\-:,.]+/, "").trim();
    }
  }

  // Accept the percent on either side of the number: "50%", "50 %", "%40", "% 40".
  const commitmentMatch = text.match(/(\d+(?:\.\d+)?)\s*%|%\s*(\d+(?:\.\d+)?)/);
  if (commitmentMatch) {
    suggestedCommitment = Number(commitmentMatch[1] ?? commitmentMatch[2]);
  }

  if (!qualitative) qualitative = "(no qualitative feedback provided)";

  return { suggestedRate, suggestedCommitment, qualitative };
}

async function collectReviewerFeedback(ctx: BotContext, text: string): Promise<void> {
  const agreementId = ctx.session.pendingReviewAgreementId;
  const decision = ctx.session.pendingReviewDecision;
  if (!agreementId || !decision) {
    ctx.session.phase = "idle";
    return;
  }

  // Re-check: the reviewer may have tapped Counter while the proposal was open
  // and only got round to typing after the contributor revised it.
  if (!(await ensureOpenForReview(ctx, agreementId))) {
    ctx.session.pendingReviewAgreementId = null;
    ctx.session.pendingReviewDecision = null;
    ctx.session.phase = "idle";
    return;
  }

  let suggestedRate: number | null = null;
  let suggestedCommitment: number | null = null;
  let qualitative = text.trim();

  if (decision === "counter") {
    const parsed = parseCounterFeedback(text);
    suggestedRate = parsed.suggestedRate;
    suggestedCommitment = parsed.suggestedCommitment;
    qualitative = parsed.qualitative;

    // A counter with no number is unusable: aggregation has nothing to average,
    // so the contributor is shown prose quoting a rate the agreement never
    // stores, and accepting silently reinstates the original ask. Ask again
    // instead of recording it.
    if (suggestedRate === null && suggestedCommitment === null) {
      await ctx.reply(
        "I couldn't find a number in that. Please resend with the rate written as a " +
          "number — either at the start (`40`) or with a dollar sign anywhere (`$40`) — " +
          "and keep your reasoning in the same message.\n\n" +
          "To change commitment instead, write it as a percentage (`50%`).",
        { parse_mode: "Markdown" }
      );
      return;
    }
  }

  const ok = await recordReviewerDecision(
    ctx,
    agreementId,
    decision,
    suggestedRate,
    suggestedCommitment,
    qualitative
  );

  if (!ok) {
    // Keep the pending decision + phase so the reviewer can resend the same
    // message to retry, rather than losing their feedback to a silent drop.
    await ctx.reply(
      "Sorry — I couldn't record that just now. Please send it again in a moment. An admin has been notified."
    );
    return;
  }

  ctx.session.pendingReviewAgreementId = null;
  ctx.session.pendingReviewDecision = null;
  ctx.session.phase = "idle";

  let summary: string;
  if (decision === "counter") {
    const parts: string[] = [];
    if (suggestedRate !== null) parts.push(`$${suggestedRate}/hr`);
    if (suggestedCommitment !== null) parts.push(`${suggestedCommitment}% commitment`);
    summary = parts.length
      ? `Counter-offer recorded at ${parts.join(", ")}. Thanks.`
      : `Counter-offer recorded. Thanks.`;
  } else {
    summary = `Rejection recorded. Thanks.`;
  }
  await ctx.reply(summary);

  await maybeCompleteReview(ctx, agreementId);
}

async function recordReviewerDecision(
  ctx: BotContext,
  agreementId: string,
  decision: ReviewerFeedback["decision"],
  suggestedRate: number | null,
  suggestedCommitment: number | null,
  qualitativeFeedback: string
): Promise<boolean> {
  const reviewerId = ctx.from?.id?.toString() ?? "";
  const reviewerName =
    ctx.from?.first_name || ctx.from?.username || reviewerId;

  const feedback: ReviewerFeedback = {
    reviewerId,
    reviewerName,
    decision,
    suggestedRate,
    suggestedCommitment,
    qualitativeFeedback,
    submittedAt: new Date().toISOString(),
  };

  try {
    await ctx.sheets.addReviewFeedback(agreementId, feedback);
    return true;
  } catch (err) {
    console.error(`recordReviewerDecision: failed to write feedback for ${agreementId}:`, err);
    await notifyAdminsOfWriteFailure(ctx, agreementId, reviewerName, decision, err);
    return false;
  }
}

export async function notifyAdminsOfWriteFailure(
  ctx: BotContext,
  agreementId: string,
  reviewerName: string,
  decision: ReviewerFeedback["decision"],
  err: unknown
): Promise<void> {
  const message =
    `Could not record a reviewer decision.\n\n` +
    `Agreement: ${agreementId}\n` +
    `Reviewer: ${reviewerName}\n` +
    `Decision: ${decision}\n` +
    `Error: ${err instanceof Error ? err.message : String(err)}\n\n` +
    `The reviewer was asked to retry. If this keeps happening, the ReviewFeedback ` +
    `tab may be missing — run scripts/ensure-reviewfeedback-tab.ts.`;

  try {
    const adminIds = await ctx.sheets.getAdminIds();
    // Exclude the candidate: this names another reviewer and their decision, and
    // a contributor may themselves be an admin. Resolving them is best-effort —
    // we are already on a Sheets failure path, so if the lookup also fails we
    // keep the alert rather than lose it, and accept the narrower leak.
    let recipients = adminIds;
    try {
      const agreement = await ctx.sheets.getAgreement(agreementId);
      const contributor = agreement
        ? await ctx.sheets.getContributorById(agreement.contributorId)
        : null;
      if (contributor) {
        recipients = reviewRecipients(adminIds, contributor.telegramId, selfReviewAllowed());
      }
    } catch (e) {
      console.error("notifyAdminsOfWriteFailure: could not resolve the candidate to exclude:", e);
    }

    for (const adminId of recipients) {
      await ctx.api.sendMessage(Number(adminId), message).catch((e) => {
        console.error(`notifyAdminsOfWriteFailure: failed to DM admin ${adminId}:`, e);
      });
    }
  } catch (e) {
    console.error("notifyAdminsOfWriteFailure: could not load admin ids:", e);
  }
}

/**
 * The revision block of the reviewer DM (issue 3). Rendered from the agreement
 * row alone, two DMs for the same role came out character-for-character
 * identical (2026-09-09) — a reviewer had no way to tell a revision from a
 * duplicate, or to see what the candidate moved from. Pure so it's unit-testable.
 */
export function formatPriorTermsBlock(prior: PriorTerms | null): string {
  if (!prior) return "";
  let block =
    `Previous ask: $${prior.hourlyRate}/hr, ${prior.commitmentPercent}%, ` +
    `${prior.durationMonths} months\n`;
  const counters: string[] = [];
  if (prior.counteredRate !== null) counters.push(`rate $${prior.counteredRate}/hr`);
  if (prior.counteredCommitment !== null) counters.push(`commitment ${prior.counteredCommitment}%`);
  if (counters.length > 0) block += `Reviewers countered: ${counters.join(", ")}\n`;
  return block + "\n";
}

async function notifyReviewers(ctx: BotContext, agreementId: string): Promise<void> {
  const agreement = await ctx.sheets.getAgreement(agreementId);
  if (!agreement) {
    console.error(`notifyReviewers: agreement ${agreementId} not found`);
    return;
  }

  const contributor = await ctx.sheets.getContributorById(agreement.contributorId);
  if (!contributor) {
    console.error(`notifyReviewers: contributor ${agreement.contributorId} not found`);
    return;
  }

  const adminIds = await ctx.sheets.getAdminIds();
  const recipients = reviewRecipients(adminIds, contributor.telegramId, selfReviewAllowed());

  if (recipients.length === 0) {
    console.warn(`notifyReviewers: no reviewers available for agreement ${agreementId}`);
    return;
  }

  const round = agreement.negotiationRound;
  const maxRounds = ctx.config.MAX_NEGOTIATION_ROUNDS;
  let prior: PriorTerms | null = null;
  if (round > 1) {
    // Best-effort: a revision DM without the prior terms is still a revision DM.
    prior = await ctx.sheets
      .getPriorAgreementTerms(agreement.contributorId, agreement.opportunityId, agreementId)
      .catch((err) => {
        console.error(`notifyReviewers: could not load prior terms for ${agreementId}:`, err);
        return null;
      });
  }

  const title =
    round > 1
      ? `Revised proposal for review — round ${round} of ${maxRounds}`
      : `New proposal for review`;

  const handle = contributor.telegramHandle ? ` (@${contributor.telegramHandle})` : "";
  const message =
    `${title}\n\n` +
    formatPriorTermsBlock(prior) +
    `Contributor: ${contributor.name}${handle}\n` +
    `Skills: ${contributor.skills.join(", ")}\n\n` +
    `Role: ${agreement.roleName}\n` +
    `Rate: $${agreement.hourlyRate}/hr\n` +
    `Commitment: ${agreement.commitmentPercent}%\n` +
    `Duration: ${agreement.durationMonths} months\n` +
    `Settlement Likelihood: ${agreement.settlementLikelihood}%\n\n` +
    `Please review within 48 hours. A majority of reviewers closes it early; ` +
    `if quorum isn't reached by the deadline it escalates for a manual decision.`;

  const keyboard = new InlineKeyboard()
    .text("Approve", `review:approve:${agreementId}`)
    .row()
    .text("Counter", `review:counter:${agreementId}`)
    .row()
    .text("Reject", `review:reject:${agreementId}`);

  for (const reviewerId of recipients) {
    try {
      await ctx.api.sendMessage(Number(reviewerId), message, {
        reply_markup: keyboard,
      });
    } catch (err) {
      console.error(`notifyReviewers: failed to DM ${reviewerId}:`, err);
    }
  }
}

/**
 * After a reviewer decision lands, aggregate if a majority of notified reviewers
 * has now responded (D-011, the "quorum reached" branch). The 48h branch is
 * handled separately by the timeout sweep. Only acts while the agreement is
 * still `under_review` and not already aggregated — a late responder arriving
 * after quorum already closed the review is ignored, so it can't re-open or
 * double-aggregate. Presenting the result to the contributor is wired separately.
 */
async function maybeCompleteReview(ctx: BotContext, agreementId: string): Promise<void> {
  const agreement = await ctx.sheets.getAgreement(agreementId);
  if (!agreement || agreement.status !== "under_review") return;
  if (await ctx.sheets.isReviewAggregated(agreementId)) return;

  const contributor = await ctx.sheets.getContributorById(agreement.contributorId);
  if (!contributor) {
    console.error(`maybeCompleteReview: contributor ${agreement.contributorId} not found`);
    return;
  }

  const adminIds = await ctx.sheets.getAdminIds();
  const recipients = reviewRecipients(adminIds, contributor.telegramId, selfReviewAllowed());
  const feedbacks = await ctx.sheets.getReviewFeedbacks(agreementId);
  if (!isReviewComplete(recipients, feedbacks)) return;

  const result = await aggregateForAgreement(agreementId, ctx.sheets, ctx.claude);
  if (result) await presentToCandidate(agreementId, ctx.sheets, ctx.api);
}
