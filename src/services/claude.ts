import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../config";

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
