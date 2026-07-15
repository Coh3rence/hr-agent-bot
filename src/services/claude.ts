import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import type { Env } from "../config";
import type {
  Contributor,
  Opportunity,
  MatchResult,
  ReviewerFeedback,
  CounterOffer,
} from "../models/types";

export class ClaudeService {
  private client: Anthropic;

  constructor(config: Env) {
    this.client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  }

  async chat(
    systemPrompt: string,
    messages: { role: "user" | "assistant"; content: string }[]
  ): Promise<string> {
    const response = await this.client.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    });

    const textBlock = response.content.find((b) => b.type === "text");
    return textBlock?.text ?? "";
  }

  async extractStructured<T>(
    systemPrompt: string,
    userMessage: string,
    toolName: string,
    toolSchema: Record<string, unknown>
  ): Promise<T | null> {
    const response = await this.client.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      tools: [
        {
          name: toolName,
          description: `Extract structured data from the conversation`,
          input_schema: toolSchema as Anthropic.Tool["input_schema"],
        },
      ],
      tool_choice: { type: "tool", name: toolName },
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (toolUse && toolUse.type === "tool_use") {
      return toolUse.input as T;
    }
    return null;
  }

  async matchOpportunities(
    contributor: Contributor,
    opportunities: Opportunity[]
  ): Promise<MatchResult[]> {
    const oppSummaries = opportunities.map((o) => ({
      id: o.id,
      title: o.title,
      description: o.description,
      skillsRequired: o.skillsRequired,
      commitmentRange: `${o.commitmentPercent.min}-${o.commitmentPercent.max}%`,
      hourlyRateRange: `$${o.hourlyRate.min}-${o.hourlyRate.max}/hr`,
      responsibilities: o.responsibilities,
    }));

    const matchToolSchema = {
      type: "object" as const,
      properties: {
        matches: {
          type: "array",
          items: {
            type: "object",
            properties: {
              opportunityId: { type: "string" },
              overallScore: { type: "number", description: "0-100 overall match score" },
              skillScore: { type: "number", description: "0-100 how well skills align" },
              rateScore: { type: "number", description: "0-100 rate compatibility" },
              commitmentScore: { type: "number", description: "0-100 commitment fit" },
              matchingSkills: {
                type: "array",
                items: { type: "string" },
                description: "Which of the contributor's skills are relevant to this role",
              },
              missingSkills: {
                type: "array",
                items: { type: "string" },
                description: "Required skills the contributor lacks",
              },
              explanation: {
                type: "string",
                description: "2-3 sentence explanation of the match quality",
              },
            },
            required: [
              "opportunityId", "overallScore", "skillScore", "rateScore",
              "commitmentScore", "matchingSkills", "missingSkills", "explanation",
            ],
          },
        },
      },
      required: ["matches"],
    };

    const systemPrompt = `You are an expert HR matching engine for a DAO (Collabberry). Your job is to evaluate how well a contributor fits each open opportunity.

Scoring guidelines:
- **Skill score (0-100):** Evaluate semantic relevance, not just exact keyword matches. "Full stack engineering" is highly relevant to frontend/backend roles. "Software architecture" transfers across domains. Adjacent skills matter (e.g., Solidity knowledge is relevant to Web3 frontend roles).
- **Rate score (0-100):** 100 if the contributor's rate falls within the budget range. Deduct proportionally based on distance from the range. Being slightly below budget is fine (they're cheaper).
- **Commitment score (0-100):** 100 if commitment falls within or above the required range. Being available MORE than required is a positive (they can fill the role fully), not a penalty. Only penalize if commitment is BELOW the minimum.
- **Overall score:** Weighted combination reflecting genuine fit. Skills matter most (50%), then commitment (30%), then rate (20%).

Be generous but honest. A "Full stack engineer" with Solidity is a strong match for both frontend and smart contract roles.`;

    const userMessage = `Evaluate this contributor against each opportunity:

CONTRIBUTOR:
- Name: ${contributor.name}
- Skills: ${contributor.skills.join(", ")}
- Desired rate: $${contributor.desiredRate.min}${contributor.desiredRate.max !== contributor.desiredRate.min ? `-${contributor.desiredRate.max}` : ""}/hr
- Commitment: ${contributor.commitmentPercent}%
- Location: ${contributor.location}
- Timezone: ${contributor.timezone}

OPPORTUNITIES:
${JSON.stringify(oppSummaries, null, 2)}

Return matches sorted by overallScore descending.`;

    interface AIMatch {
      opportunityId: string;
      overallScore: number;
      skillScore: number;
      rateScore: number;
      commitmentScore: number;
      matchingSkills: string[];
      missingSkills: string[];
      explanation: string;
    }

    const result = await this.extractStructured<{ matches: AIMatch[] }>(
      systemPrompt,
      userMessage,
      "evaluate_matches",
      matchToolSchema
    );

    if (!result?.matches) return [];

    return result.matches
      .map((m) => {
        const opp = opportunities.find((o) => o.id === m.opportunityId);
        if (!opp) return null;
        return {
          opportunity: opp,
          score: m.overallScore,
          breakdown: {
            skillOverlap: m.skillScore,
            rateAlignment: m.rateScore,
            commitmentFit: m.commitmentScore,
          },
          matchingSkills: m.matchingSkills,
          missingSkills: m.missingSkills,
          explanation: m.explanation,
        } as MatchResult & { matchingSkills: string[]; missingSkills: string[] };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .sort((a, b) => b.score - a.score);
  }

  async aggregateFeedback(
    feedbacks: ReviewerFeedback[],
    originalRate?: number,
    originalCommitment?: number
  ): Promise<CounterOffer | null> {
    const unique = dedupLatestPerReviewer(feedbacks);
    if (unique.length === 0) return null;

    const sig = aggregationSig(unique);
    const decisions = unique.map((f) => f.decision);
    const allApprove = decisions.every((d) => d === "approve");
    const allReject = decisions.every((d) => d === "reject");

    // D-002: all-approve fast-path, no Claude call.
    if (allApprove) {
      return {
        suggestedRate: originalRate ?? null,
        suggestedCommitment: originalCommitment ?? null,
        qualitativeSummary: "All reviewers approved.",
        outcome: "all_approve",
        reviewerCount: unique.length,
        aggregationSig: sig,
      };
    }

    // D-005: all-reject fast-path, deterministic reason list, no Claude call.
    if (allReject) {
      const reasons = unique
        .map((f) => f.qualitativeFeedback?.trim())
        .filter((r): r is string => !!r);
      return {
        suggestedRate: null,
        suggestedCommitment: null,
        qualitativeSummary: reasons.length
          ? `Reviewers declined. Reasons: ${reasons.join("; ")}.`
          : "Reviewers declined without giving reasons.",
        outcome: "all_reject",
        reviewerCount: unique.length,
        aggregationSig: sig,
      };
    }

    // Single reviewer (must be a single counter at this point): pass-through, no Claude call.
    if (unique.length === 1) {
      const sole = unique[0]!;
      return {
        suggestedRate: sole.suggestedRate,
        suggestedCommitment: sole.suggestedCommitment,
        qualitativeSummary:
          sole.qualitativeFeedback?.trim() || "(no feedback provided)",
        outcome: "mixed",
        reviewerCount: 1,
        aggregationSig: sig,
      };
    }

    // Mixed multi: D-001 mean of counter rates/commitments, Claude synthesis of qualitative.
    const meanRate = meanOfCounters(unique, "suggestedRate");
    const meanCommitment = meanOfCounters(unique, "suggestedCommitment");

    const feedbackText = unique
      .map((f) => {
        let stance: string;
        if (f.decision === "approve") {
          stance = "approved";
        } else if (f.decision === "counter") {
          const terms: string[] = [];
          if (f.suggestedRate !== null) terms.push(`$${f.suggestedRate}/hr`);
          if (f.suggestedCommitment !== null) terms.push(`${f.suggestedCommitment}% commitment`);
          stance = `countered${terms.length ? ` at ${terms.join(", ")}` : ""}`;
        } else {
          stance = "rejected";
        }
        return `Reviewer (${stance}): ${f.qualitativeFeedback?.trim() || "(no comment)"}`;
      })
      .join("\n");

    const summary = await this.chat(
      `You are an HR assistant synthesizing multiple reviewer opinions into a single concise counter-offer message for a contributor. Reflect the range of stances honestly, stay professional and constructive, and do not reveal individual reviewer identities. Respond in one paragraph.`,
      [{ role: "user", content: `Synthesize:\n\n${feedbackText}` }]
    );

    return {
      suggestedRate: meanRate,
      suggestedCommitment: meanCommitment,
      qualitativeSummary: summary,
      outcome: "mixed",
      reviewerCount: unique.length,
      aggregationSig: sig,
    };
  }
}

function dedupLatestPerReviewer(feedbacks: ReviewerFeedback[]): ReviewerFeedback[] {
  const latest = new Map<string, ReviewerFeedback>();
  for (const f of feedbacks) {
    const existing = latest.get(f.reviewerId);
    if (!existing || f.submittedAt > existing.submittedAt) {
      latest.set(f.reviewerId, f);
    }
  }
  return [...latest.values()];
}

/** Mean (rounded) of the given numeric field across counters that supplied it, else null. */
function meanOfCounters(
  feedbacks: ReviewerFeedback[],
  field: "suggestedRate" | "suggestedCommitment"
): number | null {
  const values = feedbacks
    .filter((f) => f.decision === "counter" && f[field] !== null)
    .map((f) => f[field] as number);
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

function aggregationSig(feedbacks: ReviewerFeedback[]): string {
  const canonical = feedbacks
    .map(
      (f) =>
        `${f.reviewerId}|${f.decision}|${f.suggestedRate ?? ""}|${f.suggestedCommitment ?? ""}|${f.qualitativeFeedback}|${f.submittedAt}`
    )
    .sort()
    .join("\n");
  return createHash("sha1").update(canonical).digest("hex").slice(0, 12);
}
