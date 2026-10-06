import type { BotContext } from "../bot";
import { InlineKeyboard } from "grammy";
import { stripBoldMarkers } from "../services/presentation";

export async function handleGate(ctx: BotContext): Promise<void> {
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return;

  // Check authorization
  const isAuthorized = await ctx.sheets.isAuthorized(telegramId);
  if (!isAuthorized) {
    await ctx.reply(
      "Welcome! You're not authorized yet. An admin has been notified and can grant you access shortly."
    );

    // Notify all admins with authorize buttons
    const adminIds = await ctx.sheets.getAdminIds();
    const name = ctx.from?.first_name || "Unknown";
    const handle = ctx.from?.username ? `@${ctx.from.username}` : "no username";

    const keyboard = new InlineKeyboard()
      .text("Authorize as Contributor", `auth:contributor:${telegramId}`)
      .row()
      .text("Authorize as Admin", `auth:admin:${telegramId}`)
      .row()
      .text("Ignore", `auth:ignore:${telegramId}`);

    for (const adminId of adminIds) {
      try {
        // §26: no parse_mode — the requester controls their own name and
        // username, and an underscore in either (common in handles) would make
        // Telegram reject the DM, so the admin never sees the access request.
        await ctx.api.sendMessage(
          adminId,
          `New access request:\n\n` +
            `Name: ${name}\n` +
            `Username: ${handle}\n` +
            `ID: ${telegramId}\n\n` +
            `Authorize this user?`,
          { reply_markup: keyboard }
        );
      } catch {
        // Admin may not have started a DM with the bot yet
      }
    }
    return;
  }

  // Check if contributor is on cooldown
  const existing = await ctx.sheets.getContributor(telegramId);
  if (existing?.status === "cooldown" && existing.cooldownUntil) {
    const cooldownEnd = new Date(existing.cooldownUntil);
    if (cooldownEnd > new Date()) {
      const daysLeft = Math.ceil(
        (cooldownEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );
      await ctx.reply(
        `You're currently in a cooldown period. You can re-apply in ${daysLeft} day(s). This gives both parties time to reflect before the next round.`
      );
      return;
    }
  }

  // Returning contributor — skip discovery, go straight to matching
  if (existing && existing.skills.length > 0) {
    ctx.session.contributorId = existing.id;
    ctx.session.messageHistory = [];

    const rateStr = existing.desiredRate.min === existing.desiredRate.max
      ? `$${existing.desiredRate.min}/hr`
      : `$${existing.desiredRate.min}-${existing.desiredRate.max}/hr`;

    await ctx.reply(
      `Welcome back, ${existing.name}!\n\n` +
        `Your profile:\n` +
        `Skills: ${existing.skills.join(", ")}\n` +
        `Rate: ${rateStr}\n` +
        `Commitment: ${existing.commitmentPercent}%\n\n` +
        `Finding the best opportunities for you...`
    );

    // Run AI matching
    const opportunities = await ctx.sheets.getOpenOpportunities();
    if (opportunities.length === 0) {
      await ctx.reply("No open opportunities right now. We'll notify you when something opens up.");
      ctx.session.phase = "idle";
      return;
    }

    const matches = await ctx.claude.matchOpportunities(existing, opportunities);

    if (matches.length === 0) {
      await ctx.reply("No strong matches found right now. We'll keep your profile on file.");
      ctx.session.phase = "idle";
      return;
    }

    const topMatches = matches.slice(0, 3);
    // §26: no parse_mode — titles and skills are free text, and the explanation is
    // model prose; one unbalanced entity would make Telegram reject the whole list.
    let message = `Here are your top matches:\n\n`;
    const keyboard = new InlineKeyboard();

    for (const match of topMatches) {
      const m = match as typeof match & { matchingSkills?: string[]; missingSkills?: string[] };
      const badge = match.score >= 75 ? "🟢" : match.score >= 50 ? "🟡" : "🔴";

      message += `${badge} ${match.opportunity.title} — ${match.score}% match\n`;

      if (m.matchingSkills?.length) {
        message += `Relevant skills: ${m.matchingSkills.join(", ")}\n`;
      }
      if (m.missingSkills?.length) {
        message += `Could improve: ${m.missingSkills.join(", ")}\n`;
      }

      message += `${stripBoldMarkers(match.explanation)}\n\n`;

      keyboard
        .text(
          `${match.opportunity.title} (${match.score}%)`,
          `select_opp:${match.opportunity.id}`
        )
        .row();
    }

    message += "Select an opportunity to start negotiating terms:";
    ctx.session.phase = "matching";

    await ctx.reply(message, { reply_markup: keyboard });
    return;
  }

  // New contributor — start discovery
  ctx.session.phase = "discovery";

  await ctx.reply(
    `Welcome to Collabberry! I'm the HR agent here to help match you with the right opportunity.\n\n` +
      `Let's start by getting to know you. Could you tell me:\n\n` +
      `1. Your name\n` +
      `2. Your key skills (e.g., Solidity, React, Community Management)\n` +
      `3. Your desired hourly rate range\n` +
      `4. Your availability as commitment % (100% = 40hrs/week)\n` +
      `5. Your timezone`
  );
}
