import { z } from "zod";

const envSchema = z.object({
  BOT_TOKEN: z.string().min(1, "Telegram bot token is required"),
  ANTHROPIC_API_KEY: z.string().min(1, "Anthropic API key is required"),
  GOOGLE_SHEETS_ID: z.string().min(1, "Google Sheets ID is required"),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().email("Valid service account email required"),
  GOOGLE_PRIVATE_KEY: z.string().min(1, "Google service account private key is required"),
  BETA_APP_API_URL: z.string().url().default("https://beta.collabberry.xyz/api"),
  BETA_APP_JWT: z.string().optional(),
  // Shared service-key for unattended bot auth (sent as X-Service-Key). The fork
  // impersonates a designated org admin on a match, so the bot needs no wallet key
  // and no weekly JWT rotation. Preferred over BETA_APP_JWT when set.
  BETA_APP_SERVICE_KEY: z.string().optional(),
  // Org the bot creates agreements in. Needed to read the contributor roster
  // (GET /orgs/:id) when resolving a freshly-signed-up contributor to their userId.
  BETA_APP_ORG_ID: z.string().optional(),
  // Where the unique org-invite link points. The bot appends ?<param>=<token>.
  BETA_APP_INVITE_URL: z.string().url().default("https://beta.collabberry.xyz/join"),
  // Query-param name carrying the invite token. Prod default is `invitation`; the
  // local/staging Collabberry frontend reads `invitationToken`. Env-overridable so
  // dev/staging can deep-link into a local frontend without a code change (and while
  // the correct production value is still being confirmed).
  BETA_APP_INVITE_PARAM: z.string().default("invitation"),
  // FTE basis for hourly->monthly marketRate conversion (40h x 4wk). Client-confirmed
  // 2026-06-30; env-overridable so the basis can change without a code edit.
  FTE_HOURS_PER_MONTH: z.coerce.number().default(160),
  // Fiat slice of monthly comp; remainder paid in TeamPoints. Default 0 = all TeamPoints.
  DEFAULT_FIAT_REQUESTED: z.coerce.number().default(0),
  REVIEWER_TIMEOUT_HOURS: z.coerce.number().default(48),
  MAX_NEGOTIATION_ROUNDS: z.coerce.number().default(2),
  COOLDOWN_DAYS: z.coerce.number().default(3),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Dev-only escape hatch: lets a contributor review their own proposal so the
 * full review loop can be exercised from a single Telegram account. Requires
 * BOTH NODE_ENV=development AND ALLOW_SELF_REVIEW=true, so it can never activate
 * in production even if the flag is set by accident.
 */
export function selfReviewAllowed(): boolean {
  return process.env.NODE_ENV === "development" && process.env.ALLOW_SELF_REVIEW === "true";
}

export function loadConfig(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Missing or invalid environment variables:");
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}
