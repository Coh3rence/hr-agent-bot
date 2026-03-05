import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../config";
import type { Contributor, Opportunity, MatchResult } from "../models/types";

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
    feedbacks: { reviewer: string; decision: string; rate: number | null; feedback: string }[]
  ): Promise<{ suggestedRate: number; qualitativeSummary: string }> {
    const rates = feedbacks
      .map((f) => f.rate)
      .filter((r): r is number => r !== null);

    const avgRate = rates.length > 0
      ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length)
      : 0;

    const feedbackText = feedbacks
      .map((f) => `${f.reviewer} (${f.decision}): ${f.feedback}`)
      .join("\n");

    const summary = await this.chat(
      `You are an HR assistant synthesizing multiple reviewer opinions into a single coherent counter-offer message. Be concise, professional, and constructive. Do not reveal individual reviewer identities.`,
      [
        {
          role: "user",
          content: `Synthesize these reviewer feedbacks into one paragraph:\n\n${feedbackText}`,
        },
      ]
    );

    return { suggestedRate: avgRate, qualitativeSummary: summary };
  }
}
