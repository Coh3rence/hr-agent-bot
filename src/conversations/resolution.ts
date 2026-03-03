import type { BotContext } from "../bot";

export async function handleResolution(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data || ctx.message?.text || "";
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return;

  if (data.startsWith("resolution:accept")) {
    // Contributor accepts final offer
    const agreementId = ctx.session.currentAgreementId;
    if (agreementId) {
      await ctx.sheets.updateAgreementStatus(agreementId, "approved");
    }

    await ctx.reply(
      "Congratulations! Your agreement has been approved. The admin will now create your agreement in the Collabberry Beta App, and you'll receive a notification to finalize it.\n\nWelcome to the team!"
    );

    // TODO: Call Beta App API to create agreement
    // POST /orgs/agreement { userId, roleName, responsibilities, marketRate, fiatRequested, commitment }

    ctx.session.phase = "idle";
    ctx.session.currentAgreementId = null;
    ctx.session.selectedOpportunityId = null;
    ctx.session.messageHistory = [];
  } else if (data.startsWith("resolution:decline")) {
    // Contributor declines
    const agreementId = ctx.session.currentAgreementId;
    if (agreementId) {
      await ctx.sheets.updateAgreementStatus(agreementId, "rejected");
    }

    const contributor = await ctx.sheets.getContributor(telegramId);
    if (contributor) {
      const cooldownUntil = new Date();
      cooldownUntil.setDate(cooldownUntil.getDate() + 3);

      await ctx.sheets.updateContributor(contributor.id, {
        status: "cooldown",
        cooldownUntil: cooldownUntil.toISOString(),
        previousAttempts: contributor.previousAttempts + 1,
      });
    }

    await ctx.reply(
      "Thank you for your time. We understand this wasn't the right fit. You're welcome to re-apply after a 3-day reflection period. We'll keep your profile on file."
    );

    ctx.session.phase = "idle";
    ctx.session.currentAgreementId = null;
    ctx.session.selectedOpportunityId = null;
    ctx.session.messageHistory = [];
  }
}
