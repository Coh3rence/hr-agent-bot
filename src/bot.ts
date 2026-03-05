import { Bot, session, Context, type SessionFlavor } from "grammy";
import { loadConfig } from "./config";
import type { SessionData, ConversationPhase } from "./models/types";
import { handleGate } from "./conversations/gate";
import { handleDiscovery } from "./conversations/discovery";
import { handleNegotiation } from "./conversations/negotiation";
import { handleReview } from "./conversations/review";
import { handleResolution } from "./conversations/resolution";
import { SheetsService } from "./services/sheets";
import { ClaudeService } from "./services/claude";
import {
  handleAddOpportunity,
  handleListOpportunities,
  handleEditOpportunity,
  handlePauseOpportunity,
  handleAuthorize,
} from "./conversations/admin";

export type BotContext = Context &
  SessionFlavor<SessionData> & {
    sheets: SheetsService;
    claude: ClaudeService;
  };

const config = loadConfig();

const bot = new Bot<BotContext>(config.BOT_TOKEN);

// Initialize services
const sheets = new SheetsService(config);
const claude = new ClaudeService(config);

// Inject services into context
bot.use((ctx, next) => {
  ctx.sheets = sheets;
  ctx.claude = claude;
  return next();
});

// Session middleware
bot.use(
  session({
    initial: (): SessionData => ({
      phase: "idle",
      contributorId: null,
      selectedOpportunityId: null,
      currentAgreementId: null,
      messageHistory: [],
    }),
  })
);

// Admin commands (core contributors only)
bot.command("add_opportunity", handleAddOpportunity);
bot.command("list_opportunities", handleListOpportunities);
bot.command("edit_opportunity", handleEditOpportunity);
bot.command("pause_opportunity", handlePauseOpportunity);
bot.command("authorize", handleAuthorize);

// Contributor entry point
bot.command("start", handleGate);

// Route messages based on conversation phase
bot.on("message:text", async (ctx) => {
  const phase = ctx.session.phase;

  const handlers: Record<ConversationPhase, ((ctx: BotContext) => Promise<void>) | null> = {
    idle: handleGate,
    gate: handleGate,
    discovery: handleDiscovery,
    matching: handleDiscovery,
    negotiation: handleNegotiation,
    review: handleReview,
    resolution: handleResolution,
  };

  const handler = handlers[phase];
  if (handler) {
    await handler(ctx);
  }
});

// Callback query handler for inline keyboards
bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;

  if (data.startsWith("auth:")) {
    const parts = data.split(":");
    const action = parts[1]!;
    const targetId = parts[2]!;

    await ctx.answerCallbackQuery();

    if (action === "ignore") {
      await ctx.editMessageText("Access request ignored.");
      return;
    }

    const role = action as "admin" | "contributor";
    await ctx.sheets.addAuthorizedUser(targetId, role);
    await ctx.editMessageText(`User ${targetId} authorized as ${role}.`);

    // Notify the user they've been authorized
    try {
      await ctx.api.sendMessage(
        Number(targetId),
        `You've been authorized! Send /start to begin.`
      );
    } catch {
      // User may need to message bot first
    }
    return;
  } else if (data.startsWith("select_opp:")) {
    ctx.session.selectedOpportunityId = data.replace("select_opp:", "");
    ctx.session.phase = "negotiation";
    await ctx.answerCallbackQuery();
    await handleNegotiation(ctx);
  } else if (data.startsWith("review:")) {
    await handleReview(ctx);
    await ctx.answerCallbackQuery();
  } else if (data.startsWith("resolution:")) {
    await handleResolution(ctx);
    await ctx.answerCallbackQuery();
  }
});

// Error handler
bot.catch((err) => {
  console.error("Bot error:", err);
});

// Start
async function main() {
  await sheets.initialize();
  console.log("Google Sheets connected");
  console.log("Starting HR Agent Bot...");
  bot.start();
}

main();
