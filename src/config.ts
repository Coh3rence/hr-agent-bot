import { z } from "zod";

const envSchema = z.object({
  BOT_TOKEN: z.string().min(1, "Telegram bot token is required"),
  ANTHROPIC_API_KEY: z.string().min(1, "Anthropic API key is required"),
  GOOGLE_SHEETS_ID: z.string().min(1, "Google Sheets ID is required"),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().email("Valid service account email required"),
  GOOGLE_PRIVATE_KEY: z.string().min(1, "Google service account private key is required"),
  BETA_APP_API_URL: z.string().url().default("https://beta.collabberry.xyz/api"),
  BETA_APP_JWT: z.string().optional(),
  REVIEWER_TIMEOUT_HOURS: z.coerce.number().default(48),
  MAX_NEGOTIATION_ROUNDS: z.coerce.number().default(2),
  COOLDOWN_DAYS: z.coerce.number().default(3),
});

export type Env = z.infer<typeof envSchema>;

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
