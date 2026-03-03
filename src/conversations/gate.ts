import type { BotContext } from "../bot";

export async function handleGate(ctx: BotContext): Promise<void> {
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return;

  // Check authorization - silently ignore unauthorized users
  const isAuthorized = await ctx.sheets.isAuthorized(telegramId);
  if (!isAuthorized) return;

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
