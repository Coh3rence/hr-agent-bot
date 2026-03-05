import type { BotContext } from "../bot";
import { InlineKeyboard } from "grammy";

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
        await ctx.api.sendMessage(
          adminId,
          `New access request:\n\n` +
            `Name: ${name}\n` +
            `Username: ${handle}\n` +
            `ID: \`${telegramId}\`\n\n` +
            `Authorize this user?`,
          { parse_mode: "Markdown", reply_markup: keyboard }
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

  ctx.session.phase = "discovery";

  const greeting = existing
    ? `Welcome back, ${existing.name}! I see you've been here before. Let's see what opportunities are available now.`
    : `Welcome to Collabberry! I'm the HR agent here to help match you with the right opportunity.\n\nLet's start by getting to know you. Could you tell me:\n\n1. Your name\n2. Your key skills (e.g., Solidity, React, Community Management)\n3. Your desired hourly rate range\n4. Your availability as commitment % (100% = 40hrs/week)\n5. Your timezone`;

  await ctx.reply(greeting);
}
