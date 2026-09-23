import { describe, expect, test } from "bun:test";
import type { BotContext } from "../bot";
import type { Opportunity, SessionData } from "../models/types";
import { handleNegotiation } from "./negotiation";

const FRONTEND = { id: "opp_002", title: "Frontend Developer" } as Opportunity;

function selectionCtx(session: Partial<SessionData>) {
  const replies: string[] = [];
  const ctx = {
    from: { id: 535329585 },
    // No `message` — this is how a select_opp: callback query arrives.
    session: {
      phase: "negotiation",
      contributorId: "c_1",
      selectedOpportunityId: "opp_002",
      currentAgreementId: null,
      messageHistory: [],
      negotiationContext: null,
      ...session,
    },
    sheets: { getOpenOpportunities: async () => [FRONTEND] },
    reply: async (text: string) => {
      replies.push(text);
    },
  } as unknown as BotContext;
  return { ctx, replies };
}

describe("handleNegotiation entered from the opportunity keyboard", () => {
  test("introduces the selected role", async () => {
    const h = selectionCtx({});
    await handleNegotiation(h.ctx);
    expect(h.replies[0]).toContain("Frontend Developer");
  });

  // The tap used to produce no reply, no error and no log line when the session
  // still carried an agreement id from an earlier loop — the contributor was left
  // with a bot that had simply gone quiet.
  test("still introduces the role when a previous agreement id lingers", async () => {
    const h = selectionCtx({ currentAgreementId: "a_qa6_1789226816573" });
    await handleNegotiation(h.ctx);
    expect(h.replies[0]).toContain("Frontend Developer");
  });

  test("says so rather than going quiet when the role has closed", async () => {
    const h = selectionCtx({ selectedOpportunityId: "opp_gone" });
    await handleNegotiation(h.ctx);
    expect(h.replies[0]).toContain("no longer open");
  });

  test("recovers when the session lost the selection entirely", async () => {
    const h = selectionCtx({ selectedOpportunityId: null });
    await handleNegotiation(h.ctx);
    expect(h.replies[0]).toContain("/start");
  });
});
