import type { BotContext } from "../bot";
import { InlineKeyboard } from "grammy";
import type { ReviewerFeedback } from "../models/types";

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
    await recordReviewerDecision(ctx, agreementId, "approve", null, "");
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    await ctx.reply("Approval recorded. Thanks.");
  } else if (data.startsWith("review:counter:")) {
    const agreementId = data.replace("review:counter:", "");
    ctx.session.pendingReviewAgreementId = agreementId;
    ctx.session.pendingReviewDecision = "counter";
    ctx.session.phase = "reviewer_feedback";
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    await ctx.reply(
      "Please send your counter-offer in a single message:\n\n" +
        "Start with the suggested rate (just the number), then your feedback.\n\n" +
        "Example: `60 - experience is thin for senior level, would consider at a lower tier`",
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
  let qualitative = text.trim();

  if (decision === "counter") {
    const match = text.match(/\$?(\d+(?:\.\d+)?)/);
    if (match) {
      suggestedRate = Number(match[1]);
      qualitative = text.replace(match[0], "").replace(/^[\s\-:,.]+/, "").trim();
    }
    if (!qualitative) qualitative = "(no qualitative feedback provided)";
  }

  await recordReviewerDecision(ctx, agreementId, decision, suggestedRate, qualitative);

  ctx.session.pendingReviewAgreementId = null;
  ctx.session.pendingReviewDecision = null;
  ctx.session.phase = "idle";

  const summary =
    decision === "counter"
      ? `Counter-offer recorded${suggestedRate !== null ? ` at $${suggestedRate}/hr` : ""}. Thanks.`
      : `Rejection recorded. Thanks.`;
  await ctx.reply(summary);
}

async function recordReviewerDecision(
  ctx: BotContext,
  agreementId: string,
  decision: ReviewerFeedback["decision"],
  suggestedRate: number | null,
  qualitativeFeedback: string
): Promise<void> {
  const reviewerId = ctx.from?.id?.toString() ?? "";
  const reviewerName =
    ctx.from?.first_name || ctx.from?.username || reviewerId;

  const feedback: ReviewerFeedback = {
    reviewerId,
    reviewerName,
    decision,
    suggestedRate,
    qualitativeFeedback,
    submittedAt: new Date().toISOString(),
  };

  try {
    await ctx.sheets.addReviewFeedback(agreementId, feedback);
  } catch (err) {
    console.error(`recordReviewerDecision: failed to write feedback for ${agreementId}:`, err);
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

  const reviewerIds = await ctx.sheets.getAdminIds();
  const recipients = reviewerIds.filter((id) => id !== contributor.telegramId);

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
    `Please review within 48 hours. Silence will be treated as approval.`;

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
