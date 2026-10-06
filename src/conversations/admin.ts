import type { BotContext } from "../bot";
import type { Opportunity } from "../models/types";
import type { OpportunityUpdate } from "../services/sheets";

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
    status: { type: "string", enum: ["open", "paused", "filled"] },
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
  status?: string;
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
    // §25: there is no step-by-step mode — a follow-up message routes through the
    // contributor gate. Everything must come in one message with the command.
    await ctx.reply(
      "To create an opportunity, send ONE message starting with /add_opportunity followed by all details:\n" +
        "- Role title\n" +
        "- Description\n" +
        "- Required skills\n" +
        "- Commitment range (e.g., 20-50%)\n" +
        "- Budget range ($/hr)\n" +
        "- Responsibilities\n\n" +
        'Example: "/add_opportunity Governance Developer - Need someone with Solidity and governance experience, 30-50% commitment, $60-80/hr, responsible for writing and auditing governance contracts"'
    );
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
    };

    await ctx.sheets.addOpportunity(opp);

    // §26: no parse_mode — the id's underscore is an unclosed Markdown entity and
    // Telegram rejects the whole message, eating the receipt for a successful write.
    await ctx.reply(
      `Opportunity created!\n\n` +
        `${opp.title}\n` +
        `Skills: ${opp.skillsRequired.join(", ")}\n` +
        `Commitment: ${opp.commitmentPercent.min}-${opp.commitmentPercent.max}%\n` +
        `Budget: $${opp.hourlyRate.min}-${opp.hourlyRate.max}/hr\n` +
        `Status: Open\n` +
        `ID: ${opp.id}`
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

  // §26: no parse_mode — titles and skills are free text, and one stray
  // underscore or asterisk would make Telegram reject the whole list.
  let message = "Current Opportunities:\n\n";
  for (const opp of opportunities) {
    const statusEmoji =
      opp.status === "open" ? "🟢" : opp.status === "paused" ? "🟡" : "🔴";
    message += `${statusEmoji} ${opp.title} (${opp.status})\n`;
    message += `Skills: ${opp.skillsRequired.join(", ")}\n`;
    message += `Commitment: ${opp.commitmentPercent.min}-${opp.commitmentPercent.max}% | Rate: $${opp.hourlyRate.min}-${opp.hourlyRate.max}/hr\n`;
    message += `ID: ${opp.id}\n\n`;
  }

  await ctx.reply(message);
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

  if (!extracted) {
    await ctx.reply("I couldn't understand those changes. Nothing was modified.");
    return;
  }

  const updates: OpportunityUpdate = {};
  if (extracted.title) updates.title = extracted.title;
  if (extracted.description) updates.description = extracted.description;
  if (extracted.skillsRequired) updates.skillsRequired = extracted.skillsRequired;

  const hourlyRate: OpportunityUpdate["hourlyRate"] = {};
  if (extracted.hourlyRateMin !== undefined) hourlyRate.min = extracted.hourlyRateMin;
  if (extracted.hourlyRateMax !== undefined) hourlyRate.max = extracted.hourlyRateMax;
  if (Object.keys(hourlyRate).length > 0) updates.hourlyRate = hourlyRate;

  const commitmentPercent: OpportunityUpdate["commitmentPercent"] = {};
  if (extracted.commitmentPercentMin !== undefined)
    commitmentPercent.min = extracted.commitmentPercentMin;
  if (extracted.commitmentPercentMax !== undefined)
    commitmentPercent.max = extracted.commitmentPercentMax;
  if (Object.keys(commitmentPercent).length > 0) updates.commitmentPercent = commitmentPercent;

  if (extracted.responsibilities) updates.responsibilities = extracted.responsibilities;
  if (extracted.status === "open" || extracted.status === "paused" || extracted.status === "filled") {
    updates.status = extracted.status;
  }

  if (Object.keys(updates).length === 0) {
    await ctx.reply("I couldn't find any changes to apply in that request. Nothing was modified.");
    return;
  }

  let success: boolean;
  try {
    success = await ctx.sheets.updateOpportunity(oppId, updates);
  } catch (err) {
    console.error("updateOpportunity failed:", err);
    await ctx.reply(`Saving the change to ${oppId} failed — nothing was modified.`);
    return;
  }
  if (success) {
    await ctx.reply(`Opportunity ${oppId} updated successfully.`);
  } else {
    await ctx.reply(`Opportunity ${oppId} not found.`);
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

  let success: boolean;
  try {
    success = await ctx.sheets.updateOpportunity(oppId, { status: "paused" });
  } catch (err) {
    console.error("updateOpportunity failed:", err);
    await ctx.reply(`Pausing ${oppId} failed — nothing was modified.`);
    return;
  }
  if (success) {
    await ctx.reply(`Opportunity ${oppId} has been paused. Use /edit_opportunity ${oppId} status open to reopen it.`);
  } else {
    await ctx.reply(`Opportunity ${oppId} not found.`);
  }
}

export async function handleAuthorize(ctx: BotContext): Promise<void> {
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return;

  const isAdmin = await ctx.sheets.isAdmin(telegramId);
  if (!isAdmin) {
    await ctx.reply("You don't have admin permissions.");
    return;
  }

  const args = ctx.message?.text?.replace("/authorize", "").trim().split(/\s+/);
  if (!args || args.length < 1 || !args[0]) {
    await ctx.reply(
      "Usage: /authorize <telegram_id> [admin|contributor]\n\n" +
        "Example: /authorize 123456789 contributor\n" +
        "Default role: contributor"
    );
    return;
  }

  const targetId = args[0];
  const role = (args[1] === "admin" ? "admin" : "contributor") as "admin" | "contributor";

  const alreadyAuthorized = await ctx.sheets.isAuthorized(targetId);
  if (alreadyAuthorized) {
    await ctx.reply(`User ${targetId} is already authorized.`);
    return;
  }

  await ctx.sheets.addAuthorizedUser(targetId, role);
  await ctx.reply(`User ${targetId} authorized as ${role}.`);

  // Try to notify them
  try {
    await ctx.api.sendMessage(targetId, "You've been authorized! Send /start to begin.");
  } catch {
    // User may need to message the bot first
  }
}
