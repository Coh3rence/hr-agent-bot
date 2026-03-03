import type { BotContext } from "../bot";
import { calculateSettlementLikelihood } from "../services/matching";
import type { Agreement } from "../models/types";
import { InlineKeyboard } from "grammy";

const NEGOTIATION_SYSTEM_PROMPT = `You are an HR assistant helping structure an agreement between a contributor and Collabberry. Extract negotiation parameters from the conversation:
- hourly rate proposed
- commitment percentage
- duration in months
- any special conditions

Be helpful but neutral. You sit between both parties without providing full transparency to either side. Guide the contributor to propose reasonable terms.`;

const TERMS_TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    hourlyRate: { type: "number" },
    commitmentPercent: { type: "number" },
    durationMonths: { type: "number" },
    isComplete: { type: "boolean" },
  },
  required: ["isComplete"],
};

interface ExtractedTerms {
  hourlyRate?: number;
  commitmentPercent?: number;
  durationMonths?: number;
  isComplete: boolean;
}

export async function handleNegotiation(ctx: BotContext): Promise<void> {
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return;

  const oppId = ctx.session.selectedOpportunityId;
  if (!oppId) return;

  // First message after selecting opportunity
  if (!ctx.session.currentAgreementId && !ctx.message?.text) {
    const opportunities = await ctx.sheets.getOpenOpportunities();
    const opp = opportunities.find((o) => o.id === oppId);
    if (!opp) return;

    await ctx.reply(
      `You've selected **${opp.title}**.\n\nNow let's discuss the terms. Please propose:\n\n1. Your hourly rate (budget range is not disclosed)\n2. Your commitment % (e.g., 50% = ~20hrs/week)\n3. Preferred duration (in months)\n\nYou can share these all at once or we can discuss each one.`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  const text = ctx.message?.text;
  if (!text) return;

  ctx.session.messageHistory.push({ role: "user", content: text });

  const conversationText = ctx.session.messageHistory
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const extracted = await ctx.claude.extractStructured<ExtractedTerms>(
    NEGOTIATION_SYSTEM_PROMPT,
    conversationText,
    "extract_terms",
    TERMS_TOOL_SCHEMA
  );

  if (extracted?.isComplete && extracted.hourlyRate) {
    const opportunities = await ctx.sheets.getOpenOpportunities();
    const opp = opportunities.find((o) => o.id === oppId);
    if (!opp) return;

    const contributor = await ctx.sheets.getContributor(telegramId);
    if (!contributor) return;

    // Calculate settlement likelihood
    const skillScore =
      contributor.skills.filter((s) =>
        opp.skillsRequired.some(
          (r) =>
            r.toLowerCase().includes(s.toLowerCase()) ||
            s.toLowerCase().includes(r.toLowerCase())
        )
      ).length / (opp.skillsRequired.length || 1);

    const likelihood = calculateSettlementLikelihood(
      extracted.hourlyRate,
      opp.hourlyRate.min,
      opp.hourlyRate.max,
      skillScore
    );

    // Create draft agreement
    const agreement: Agreement = {
      id: `a_${Date.now()}`,
      opportunityId: oppId,
      contributorId: contributor.id,
      roleName: opp.title,
      responsibilities: opp.responsibilities,
      hourlyRate: extracted.hourlyRate,
      commitmentPercent: extracted.commitmentPercent || contributor.commitmentPercent,
      durationMonths: extracted.durationMonths || 3,
      settlementLikelihood: likelihood,
      status: "draft",
      reviewerFeedback: [],
      aggregatedCounterOffer: null,
      negotiationRound: 1,
      submittedAt: new Date().toISOString(),
      reviewedAt: null,
    };

    await ctx.sheets.addAgreement(agreement);
    ctx.session.currentAgreementId = agreement.id;

    const likelihoodLabel =
      likelihood >= 75 ? "High" : likelihood >= 50 ? "Medium" : "Low";

    const keyboard = new InlineKeyboard()
      .text("Submit for Review", `review:submit:${agreement.id}`)
      .row()
      .text("Modify Terms", `review:modify:${agreement.id}`);

    await ctx.reply(
      `Here's your proposed agreement:\n\n` +
        `**Role:** ${opp.title}\n` +
        `**Rate:** $${extracted.hourlyRate}/hr\n` +
        `**Commitment:** ${agreement.commitmentPercent}%\n` +
        `**Duration:** ${agreement.durationMonths} months\n` +
        `**Settlement Likelihood:** ${likelihood}% (${likelihoodLabel})\n\n` +
        `Would you like to submit this for review by the core team, or modify the terms?`,
      { parse_mode: "Markdown", reply_markup: keyboard }
    );
  } else {
    const response = await ctx.claude.chat(NEGOTIATION_SYSTEM_PROMPT, ctx.session.messageHistory);
    ctx.session.messageHistory.push({ role: "assistant", content: response });
    await ctx.reply(response);
  }
}
