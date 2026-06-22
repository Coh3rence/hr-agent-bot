import type { BotContext } from "../bot";
import { buildModifyContext } from "../services/modify-context";

/**
 * Candidate-facing resolution of a reviewed proposal (D-010).
 *
 * Invoked from the inline keyboard built in presentToCandidate, whose callbacks
 * carry the agreement id (`resolution:<action>:<id>`). We parse that id rather
 * than relying on session state, then rehydrate the session from the sheet — the
 * candidate may tap these buttons hours later on a cold session (process restart,
 * or they simply walked away and came back), so we can't assume currentAgreementId
 * still holds. The id from the button is the source of truth; session is only a
 * fallback for older messages that predate id-carrying callbacks.
 */
export async function handleResolution(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data || ctx.message?.text || "";
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return;

  const parts = data.split(":");
  const action = parts[1] ?? "";
  const agreementId = parts[2] || ctx.session.currentAgreementId;
  if (!agreementId) return;

  const agreement = await ctx.sheets.getAgreement(agreementId);
  if (!agreement) {
    console.error(`handleResolution: agreement ${agreementId} not found`);
    return;
  }

  // Rehydrate so the branch logic (and any re-entered negotiation) works even if
  // this is a cold session that has lost the in-memory negotiation context.
  ctx.session.currentAgreementId = agreementId;
  ctx.session.contributorId = agreement.contributorId;
  ctx.session.selectedOpportunityId = agreement.opportunityId;

  if (action === "accept") {
    await ctx.sheets.updateAgreementStatus(agreementId, "approved");

    await ctx.reply(
      "Congratulations! Your agreement has been approved. The admin will now create your agreement in the Collabberry Beta App, and you'll receive a notification to finalize it.\n\nWelcome to the team!"
    );

    // TODO: Call Beta App API to create agreement
    // POST /orgs/agreement { userId, roleName, responsibilities, marketRate, fiatRequested, commitment }

    ctx.session.phase = "idle";
    ctx.session.currentAgreementId = null;
    ctx.session.selectedOpportunityId = null;
    ctx.session.messageHistory = [];
    ctx.session.negotiationContext = null;
  } else if (action === "modify") {
    // Re-enter negotiation. Clear currentAgreementId so a fresh draft is created
    // when the new terms complete. The prior offer + counter + reviewer reasons
    // ride in negotiationContext (D-012) as system-prompt background, keeping
    // messageHistory a clean user-first transcript.
    ctx.session.currentAgreementId = null;
    ctx.session.phase = "negotiation";
    ctx.session.messageHistory = [];
    ctx.session.negotiationContext = await buildModifyContext(agreementId, ctx.sheets);

    await ctx.reply(
      "No problem — let's revise your terms. What would you like to change? " +
        "You can update your rate, commitment %, or duration."
    );
  } else if (action === "walkaway") {
    await ctx.sheets.updateAgreementStatus(agreementId, "rejected");

    const contributor = await ctx.sheets.getContributorById(agreement.contributorId);
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
    ctx.session.negotiationContext = null;
  }
}
