import type { BotContext } from "../bot";
import type { Agreement, Contributor } from "../models/types";
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

    const contributor = await ctx.sheets.getContributorById(agreement.contributorId);
    if (!contributor) {
      console.error(`handleResolution: contributor ${agreement.contributorId} not found`);
      await ctx.reply(
        "Your agreement has been approved! We hit a snag finalizing it — the admin has been notified and will follow up."
      );
      resetSession(ctx);
      return;
    }

    // Already linked to a Collabberry user → create the agreement straight away.
    if (contributor.collabberryUserId) {
      await createBetaAgreement(ctx, agreement, contributor);
      resetSession(ctx);
      return;
    }

    // Not linked yet → issue a unique invite link and wait for self-registration (D-014).
    // Wallet ownership is proven by the contributor's Collabberry sign-up signature;
    // we never ask them to type a wallet in chat.
    try {
      const invite = await ctx.beta.createInviteLink();
      // Persist the token as the join key (D-018): after sign-up we resolve the
      // contributor by the token they redeemed, not by a self-reported handle.
      await ctx.sheets.updateContributor(contributor.id, {
        collabberryInviteToken: invite.token,
      });
      await ctx.reply(
        "Congratulations — your agreement is approved! One quick step to finalize.\n\n" +
          `1. Open your personal Collabberry invite: ${invite.url}\n` +
          "2. Sign up by connecting and signing with your wallet — this proves ownership and is where your TeamPoints are paid.\n\n" +
          "This link is unique to you, so I'll link your account automatically. When you're done, tap the button below.",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "I've signed up", callback_data: `resolution:linked:${agreementId}` }],
            ],
          },
        }
      );
      ctx.session.phase = "awaiting_collabberry_signup";
      ctx.session.currentAgreementId = agreementId;
    } catch (err) {
      console.error("handleResolution accept: invite link failed", err);
      await ctx.reply(
        "Your agreement is approved! We couldn't generate your Collabberry invite just now — the admin has been notified and will follow up."
      );
      resetSession(ctx);
    }
  } else if (action === "linked") {
    // Contributor reports they've finished Collabberry sign-up. Resolve them on
    // the org roster by the invite token they redeemed, capture the verified
    // wallet + userId, then create the agreement (D-018).
    const contributor = await ctx.sheets.getContributorById(agreement.contributorId);
    if (!contributor) return;

    try {
      const match = await ctx.beta.resolveByToken(contributor.collabberryInviteToken);
      if (!match || !match.walletAddress) {
        await ctx.reply(
          "I couldn't find your Collabberry sign-up yet. Make sure you finished signing up " +
            'through the invite link I sent, then tap "I\'ve signed up" again.',
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: "I've signed up", callback_data: `resolution:linked:${agreementId}` }],
              ],
            },
          }
        );
        return;
      }

      await ctx.sheets.updateContributor(contributor.id, {
        walletAddress: match.walletAddress,
        collabberryUserId: match.id,
      });

      await createBetaAgreement(ctx, agreement, {
        ...contributor,
        walletAddress: match.walletAddress,
        collabberryUserId: match.id,
      });
      resetSession(ctx);
    } catch (err) {
      console.error("handleResolution linked: resolve/create failed", err);
      await ctx.reply(
        "Something went wrong linking your Collabberry account. The admin has been notified and will follow up."
      );
    }
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

    resetSession(ctx);
  } else if (ctx.session.phase === "awaiting_collabberry_signup") {
    // Contributor typed a message instead of tapping the button. Re-prompt.
    await ctx.reply(
      "Once you've finished signing up on Collabberry, tap the button below to finish.",
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "I've signed up", callback_data: `resolution:linked:${agreementId}` }],
          ],
        },
      }
    );
  }
}

/**
 * Create the agreement record in the Collabberry Beta App and mark the
 * contributor hired. Idempotent: skips if the agreement already has a Beta App id,
 * so a re-tap never double-creates (the backend also rejects re-submits with a
 * 400, making this belt-and-suspenders). On-chain signing/minting is a separate
 * manual admin action.
 */
async function createBetaAgreement(
  ctx: BotContext,
  agreement: Agreement,
  contributor: Contributor
): Promise<void> {
  if (agreement.betaAppAgreementId) {
    await ctx.reply("You're all set — your agreement already exists in Collabberry. Welcome to the team!");
    return;
  }
  if (!contributor.collabberryUserId) {
    console.error(`createBetaAgreement: contributor ${contributor.id} has no collabberryUserId`);
    await ctx.reply(
      "Your agreement is approved, but we couldn't link your Collabberry account. The admin has been notified and will finalize it."
    );
    return;
  }

  try {
    const { betaAgreementId } = await ctx.beta.createAgreement({
      userId: contributor.collabberryUserId,
      roleName: agreement.roleName,
      responsibilities: agreement.responsibilities,
      hourlyRate: agreement.hourlyRate,
      commitmentPercent: agreement.commitmentPercent,
    });

    if (betaAgreementId) {
      await ctx.sheets.updateAgreementBetaId(agreement.id, betaAgreementId);
    }
    await ctx.sheets.updateContributor(contributor.id, { status: "hired" });

    await ctx.reply(
      "Done! Your agreement has been created in Collabberry. An admin will sign it on-chain and your TeamPoints will follow. Welcome to the team!"
    );
  } catch (err) {
    console.error(`createBetaAgreement: failed for agreement ${agreement.id}:`, err);
    await ctx.reply(
      "Your Collabberry account is linked, but I hit an error creating the agreement. The admin has been notified and will finalize it."
    );
  }
}

function resetSession(ctx: BotContext): void {
  ctx.session.phase = "idle";
  ctx.session.currentAgreementId = null;
  ctx.session.selectedOpportunityId = null;
  ctx.session.messageHistory = [];
  ctx.session.negotiationContext = null;
}
