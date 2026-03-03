import type { BotContext } from "../bot";
import { matchContributor } from "../services/matching";
import { InlineKeyboard } from "grammy";
import type { Contributor } from "../models/types";

const DISCOVERY_SYSTEM_PROMPT = `You are an HR assistant for Collabberry, a DAO compensation platform. You're collecting information about a new contributor through natural conversation. Extract the following fields when mentioned:
- name
- skills (as array)
- desired hourly rate (min and max)
- commitment percentage (100% = 40hrs/week)
- timezone
- location/country

Be friendly and conversational. If information is missing, ask for it naturally. When you have all required fields (name, skills, rate, commitment), confirm the profile with the user.`;

const PROFILE_TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    name: { type: "string" },
    skills: { type: "array", items: { type: "string" } },
    desiredRateMin: { type: "number" },
    desiredRateMax: { type: "number" },
    commitmentPercent: { type: "number" },
    timezone: { type: "string" },
    location: { type: "string" },
    isComplete: { type: "boolean" },
  },
  required: ["isComplete"],
};

interface ExtractedProfile {
  name?: string;
  skills?: string[];
  desiredRateMin?: number;
  desiredRateMax?: number;
  commitmentPercent?: number;
  timezone?: string;
  location?: string;
  isComplete: boolean;
}

export async function handleDiscovery(ctx: BotContext): Promise<void> {
  const text = ctx.message?.text;
  if (!text) return;

  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return;

  // Add to conversation history
  ctx.session.messageHistory.push({ role: "user", content: text });

  // Try to extract profile data
  const conversationText = ctx.session.messageHistory
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const extracted = await ctx.claude.extractStructured<ExtractedProfile>(
    DISCOVERY_SYSTEM_PROMPT,
    conversationText,
    "extract_profile",
    PROFILE_TOOL_SCHEMA
  );

  if (extracted?.isComplete && extracted.name && extracted.skills?.length) {
    // Save contributor profile
    const contributor: Contributor = {
      id: `c_${Date.now()}`,
      telegramId,
      telegramHandle: ctx.from?.username || "",
      name: extracted.name,
      skills: extracted.skills,
      commitmentPercent: extracted.commitmentPercent || 50,
      desiredRate: {
        min: extracted.desiredRateMin || 0,
        max: extracted.desiredRateMax || 0,
      },
      timezone: extracted.timezone || "",
      location: extracted.location || "",
      status: "active",
      cooldownUntil: null,
      previousAttempts: 0,
      createdAt: new Date().toISOString(),
    };

    const existing = await ctx.sheets.getContributor(telegramId);
    if (existing) {
      await ctx.sheets.updateContributor(existing.id, contributor);
      contributor.id = existing.id;
      contributor.previousAttempts = existing.previousAttempts;
    } else {
      await ctx.sheets.addContributor(contributor);
    }

    ctx.session.contributorId = contributor.id;

    // Run matching
    const opportunities = await ctx.sheets.getOpenOpportunities();
    if (opportunities.length === 0) {
      await ctx.reply(
        "Thanks for your profile! Unfortunately, there are no open opportunities right now. We'll notify you when something opens up."
      );
      ctx.session.phase = "idle";
      return;
    }

    const matches = matchContributor(contributor, opportunities);
    const topMatches = matches.slice(0, 3);

    // Build opportunity cards
    let message = `Great, ${contributor.name}! Here are your top matches:\n\n`;
    const keyboard = new InlineKeyboard();

    for (const match of topMatches) {
      const badge =
        match.score >= 80 ? "🟢" : match.score >= 60 ? "🟡" : "🔴";

      message += `${badge} **${match.opportunity.title}** — ${match.score}% match\n`;
      message += `Skills: ${match.breakdown.skillOverlap}% | Rate: ${match.breakdown.rateAlignment}% | Commitment: ${match.breakdown.commitmentFit}%\n`;
      message += `${match.opportunity.description}\n\n`;

      keyboard
        .text(
          `${match.opportunity.title} (${match.score}%)`,
          `select_opp:${match.opportunity.id}`
        )
        .row();
    }

    message += "Select an opportunity to start negotiating terms:";
    ctx.session.phase = "matching";

    await ctx.reply(message, { parse_mode: "Markdown", reply_markup: keyboard });
  } else {
    // Continue conversation to collect missing info
    const response = await ctx.claude.chat(DISCOVERY_SYSTEM_PROMPT, ctx.session.messageHistory);
    ctx.session.messageHistory.push({ role: "assistant", content: response });
    await ctx.reply(response);
  }
}
