import type { BotContext } from "../bot";
import type { Opportunity } from "../models/types";

const ADD_OPP_SYSTEM_PROMPT = `You are an HR assistant helping an admin create a new job opportunity. Extract these fields from the conversation:
- title (role name)
- description (brief overview)
- skillsRequired (array of skills)
- commitmentPercent min and max
- hourlyRate min and max (budget range)
- responsibilities (detailed description)

Ask for any missing required fields naturally. Required: title, skills, commitment range, rate range.`;

const OPP_TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    skillsRequired: { type: "array", items: { type: "string" } },
    commitmentPercentMin: { type: "number" },
    commitmentPercentMax: { type: "number" },
    hourlyRateMin: { type: "number" },
    hourlyRateMax: { type: "number" },
    responsibilities: { type: "string" },
    isComplete: { type: "boolean" },
  },
  required: ["isComplete"],
};

interface ExtractedOpportunity {
  title?: string;
  description?: string;
  skillsRequired?: string[];
  commitmentPercentMin?: number;
  commitmentPercentMax?: number;
  hourlyRateMin?: number;
  hourlyRateMax?: number;
  responsibilities?: string;
  isComplete: boolean;
}

export async function handleAddOpportunity(ctx: BotContext): Promise<void> {
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return;

  const isAdmin = await ctx.sheets.isAdmin(telegramId);
  if (!isAdmin) {
    await ctx.reply("You don't have admin permissions to manage opportunities.");
    return;
  }

  // Check if there's text after the command
  const text = ctx.message?.text?.replace("/add_opportunity", "").trim();

  if (!text) {
    await ctx.reply(
      "Let's create a new opportunity. You can provide all details at once or I'll ask step by step.\n\n" +
        "Please provide:\n" +
        "- Role title\n" +
        "- Description\n" +
        "- Required skills\n" +
        "- Commitment range (e.g., 20-50%)\n" +
        "- Budget range ($/hr)\n" +
        "- Responsibilities\n\n" +
        'Example: "Governance Developer - Need someone with Solidity and governance experience, 30-50% commitment, $60-80/hr, responsible for writing and auditing governance contracts"'
    );
    // Set phase to collect opportunity data in next message
    ctx.session.phase = "idle"; // Admin flow handled separately
    return;
  }

  // Try to extract opportunity from the command text
  const extracted = await ctx.claude.extractStructured<ExtractedOpportunity>(
    ADD_OPP_SYSTEM_PROMPT,
    text,
    "extract_opportunity",
    OPP_TOOL_SCHEMA
  );

  if (extracted?.isComplete && extracted.title && extracted.skillsRequired?.length) {
    const opp: Opportunity = {
      id: `opp_${Date.now()}`,
      title: extracted.title,
      description: extracted.description || "",
      skillsRequired: extracted.skillsRequired,
      commitmentPercent: {
        min: extracted.commitmentPercentMin || 0,
        max: extracted.commitmentPercentMax || 100,
      },
      hourlyRate: {
        min: extracted.hourlyRateMin || 0,
        max: extracted.hourlyRateMax || 0,
      },
      responsibilities: extracted.responsibilities || "",
      status: "open",
      createdBy: telegramId,
      createdAt: new Date().toISOString(),
    };

    await ctx.sheets.addOpportunity(opp);

    await ctx.reply(
      `Opportunity created!\n\n` +
        `**${opp.title}**\n` +
        `Skills: ${opp.skillsRequired.join(", ")}\n` +
        `Commitment: ${opp.commitmentPercent.min}-${opp.commitmentPercent.max}%\n` +
        `Budget: $${opp.hourlyRate.min}-${opp.hourlyRate.max}/hr\n` +
        `Status: Open\n` +
        `ID: ${opp.id}`,
      { parse_mode: "Markdown" }
    );
  } else {
    await ctx.reply(
      "I couldn't extract all required fields. Please provide at least: title, skills, commitment range, and budget range."
    );
  }
}

export async function handleListOpportunities(ctx: BotContext): Promise<void> {
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return;

  const isAdmin = await ctx.sheets.isAdmin(telegramId);
  if (!isAdmin) {
    await ctx.reply("You don't have admin permissions to manage opportunities.");
    return;
  }

  const opportunities = await ctx.sheets.getOpportunities();

  if (opportunities.length === 0) {
    await ctx.reply("No opportunities found. Use /add_opportunity to create one.");
    return;
  }

  let message = "**Current Opportunities:**\n\n";
  for (const opp of opportunities) {
    const statusEmoji =
      opp.status === "open" ? "🟢" : opp.status === "paused" ? "🟡" : "🔴";
    message += `${statusEmoji} **${opp.title}** (${opp.status})\n`;
    message += `Skills: ${opp.skillsRequired.join(", ")}\n`;
    message += `Commitment: ${opp.commitmentPercent.min}-${opp.commitmentPercent.max}% | Rate: $${opp.hourlyRate.min}-${opp.hourlyRate.max}/hr\n`;
    message += `ID: \`${opp.id}\`\n\n`;
  }

  await ctx.reply(message, { parse_mode: "Markdown" });
}

export async function handleEditOpportunity(ctx: BotContext): Promise<void> {
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return;

  const isAdmin = await ctx.sheets.isAdmin(telegramId);
  if (!isAdmin) {
    await ctx.reply("You don't have admin permissions to manage opportunities.");
    return;
  }

  const text = ctx.message?.text?.replace("/edit_opportunity", "").trim();
  if (!text) {
    await ctx.reply(
      "Usage: /edit_opportunity <id> <changes>\n\n" +
        'Example: /edit_opportunity opp_123 rate $70-90/hr, add skill "TypeScript"'
    );
    return;
  }

  // Extract opportunity ID and changes
  const parts = text.split(" ");
  const oppId = parts[0];
  const changes = parts.slice(1).join(" ");

  if (!oppId || !changes) {
    await ctx.reply("Please provide both the opportunity ID and the changes.");
    return;
  }

  const extracted = await ctx.claude.extractStructured<ExtractedOpportunity>(
    "Extract the updated fields from this edit request. Only include fields that are being changed.",
    changes,
    "extract_opportunity",
    OPP_TOOL_SCHEMA
  );

  if (extracted) {
    const updates: Partial<Opportunity> = {};
    if (extracted.title) updates.title = extracted.title;
    if (extracted.description) updates.description = extracted.description;
    if (extracted.skillsRequired) updates.skillsRequired = extracted.skillsRequired;
    if (extracted.hourlyRateMin || extracted.hourlyRateMax) {
      updates.hourlyRate = {
        min: extracted.hourlyRateMin || 0,
        max: extracted.hourlyRateMax || 0,
      };
    }
    if (extracted.commitmentPercentMin || extracted.commitmentPercentMax) {
      updates.commitmentPercent = {
        min: extracted.commitmentPercentMin || 0,
        max: extracted.commitmentPercentMax || 100,
      };
    }
    if (extracted.responsibilities) updates.responsibilities = extracted.responsibilities;

    const success = await ctx.sheets.updateOpportunity(oppId, updates);
    if (success) {
      await ctx.reply(`Opportunity ${oppId} updated successfully.`);
    } else {
      await ctx.reply(`Opportunity ${oppId} not found.`);
    }
  }
}

export async function handlePauseOpportunity(ctx: BotContext): Promise<void> {
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return;

  const isAdmin = await ctx.sheets.isAdmin(telegramId);
  if (!isAdmin) {
    await ctx.reply("You don't have admin permissions to manage opportunities.");
    return;
  }

  const oppId = ctx.message?.text?.replace("/pause_opportunity", "").trim();
  if (!oppId) {
    await ctx.reply("Usage: /pause_opportunity <id>");
    return;
  }

  const success = await ctx.sheets.updateOpportunity(oppId, { status: "paused" });
  if (success) {
    await ctx.reply(`Opportunity ${oppId} has been paused. Use /edit_opportunity ${oppId} status open to reopen it.`);
  } else {
    await ctx.reply(`Opportunity ${oppId} not found.`);
  }
}
