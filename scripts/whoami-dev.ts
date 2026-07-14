/**
 * Dev diagnostic: prints the resolved (non-secret) sheet id + self-review flags
 * for the current NODE_ENV, so we can confirm which sheet dev:stage targets.
 * Run: NODE_ENV=development bun scripts/whoami-dev.ts
 */
import { loadConfig, selfReviewAllowed } from "../src/config";

const config = loadConfig();
console.log("NODE_ENV:", process.env.NODE_ENV);
console.log("GOOGLE_SHEETS_ID:", config.GOOGLE_SHEETS_ID);
console.log("selfReviewAllowed():", selfReviewAllowed());
console.log("BETA_APP_API_URL:", config.BETA_APP_API_URL);
console.log("BETA_APP_ORG_ID:", config.BETA_APP_ORG_ID);
