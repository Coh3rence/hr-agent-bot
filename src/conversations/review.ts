import type { BotContext } from "../bot";
import { InlineKeyboard } from "grammy";

export async function handleReview(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data || ctx.message?.text || "";
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return;

  if (data.startsWith("review:submit:")) {
    const agreementId = data.replace("review:submit:", "");
    await ctx.sheets.updateAgreementStatus(agreementId, "under_review");
    ctx.session.phase = "review";

    await ctx.reply(
      "Your proposal has been submitted to the core team for review. They have 48 hours to respond. I'll notify you as soon as there's a decision."
    );

    // TODO: Send DMs to core contributor reviewers with proposal details
    // This will be implemented with the reviewer notification system
  } else if (data.startsWith("review:modify:")) {
    ctx.session.phase = "negotiation";
    await ctx.reply("No problem. What would you like to change? You can update your rate, commitment %, or duration.");
  } else if (data.startsWith("review:approve:")) {
    // Core contributor approving
    const agreementId = data.replace("review:approve:", "");
    // Store approval feedback
    // TODO: Implement reviewer feedback collection and quorum check
  } else if (data.startsWith("review:counter:")) {
    // Core contributor countering
    const agreementId = data.replace("review:counter:", "");
    await ctx.reply(
      "Please provide your counter-offer:\n\n1. Suggested rate ($/hr)\n2. Your feedback on the candidate"
    );
    // TODO: Collect and store counter-offer
  } else if (data.startsWith("review:reject:")) {
    // Core contributor rejecting
    const agreementId = data.replace("review:reject:", "");
    await ctx.reply("Please provide your reason for rejection:");
    // TODO: Collect rejection reason
  }
}
