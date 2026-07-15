import type { BotContext } from "../bot";
import { InlineKeyboard } from "grammy";
import type { ReviewerFeedback } from "../models/types";
import { isReviewComplete, reviewRecipients } from "../services/quorum";
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
    await ctx.sheets.updateAgreementStatus(agreementId, "under_review");
    ctx.session.phase = "review";

    await ctx.reply(
      "Your proposal has been submitted to the core team for review. They have 48 hours to respond. I'll notify you as soon as there's a decision."
    );

    await notifyReviewers(ctx, agreementId);
  } else if (data.startsWith("review:modify:")) {
    ctx.session.phase = "negotiation";
    await ctx.reply("No problem. What would you like to change? You can update your rate, commitment %, or duration.");
  } else if (data.startsWith("review:approve:")) {
    const agreementId = data.replace("review:approve:", "");
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
    ctx.session.pendingReviewAgreementId = agreementId;
    ctx.session.pendingReviewDecision = "counter";
    ctx.session.phase = "reviewer_feedback";
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    await ctx.reply(
      "Please send your counter-offer in a single message. You can suggest a new " +
        "rate, a new commitment %, or both — plus your feedback:\n\n" +
        "• Rate — start with the number (e.g. `60`)\n" +
        "• Commitment — write it as a percentage (e.g. `50%`)\n\n" +
        "Example: `60, commitment should be 50% - experience is thin for senior level`",
      { parse_mode: "Markdown" }
    );
  } else if (data.startsWith("review:reject:")) {
    const agreementId = data.replace("review:reject:", "");
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

async function collectReviewerFeedback(ctx: BotContext, text: string): Promise<void> {
  const agreementId = ctx.session.pendingReviewAgreementId;
  const decision = ctx.session.pendingReviewDecision;
  if (!agreementId || !decision) {
    ctx.session.phase = "idle";
    return;
  }

  let suggestedRate: number | null = null;
  let suggestedCommitment: number | null = null;
  let qualitative = text.trim();

  if (decision === "counter") {
    // Rate = a LEADING bare number (the prompt asks the reviewer to "start with
    // the number"). A number followed by a digit or % is not a rate, so
    // "we need a commitment of 50%" is never misread as $50/hr.
    const rateMatch = text.match(/^\s*\$?(\d+(?:\.\d+)?)(?![\d%])/);
    if (rateMatch) {
      suggestedRate = Number(rateMatch[1]);
      qualitative = text.slice(rateMatch[0].length).replace(/^[\s\-:,.]+/, "").trim();
    }
    // Commitment = a number immediately followed by % anywhere in the message,
    // e.g. "bump commitment to 50%". Rate (leading bare number) and commitment
    // (number+%) don't collide, so scan the original text for the percentage.
    const commitmentMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
    if (commitmentMatch) {
      suggestedCommitment = Number(commitmentMatch[1]);
    }
    if (!qualitative) qualitative = "(no qualitative feedback provided)";
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

async function notifyAdminsOfWriteFailure(
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
    for (const adminId of adminIds) {
      await ctx.api.sendMessage(Number(adminId), message).catch((e) => {
        console.error(`notifyAdminsOfWriteFailure: failed to DM admin ${adminId}:`, e);
      });
    }
  } catch (e) {
    console.error("notifyAdminsOfWriteFailure: could not load admin ids:", e);
  }
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

  const handle = contributor.telegramHandle ? ` (@${contributor.telegramHandle})` : "";
  const message =
    `New proposal for review\n\n` +
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
