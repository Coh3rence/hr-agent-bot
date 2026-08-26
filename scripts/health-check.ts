/**
 * Non-destructive production health check. Safe to run any time.
 *
 * Deliberately does NOT call Telegram getUpdates: that would terminate the running
 * bot's long-poll with a 409 and crash it. Bot liveness is confirmed via getMe plus
 * `railway logs --service bot` (a healthy tail ends with "Starting HR Agent Bot..."
 * and no trailing 409).
 *
 *   railway run --service bot bun scripts/health-check.ts
 */
const BACKEND = "https://backend-production-53b74.up.railway.app";
const FRONTEND = "https://collabberry-frontend.vercel.app";

async function check(label: string, fn: () => Promise<Response>): Promise<void> {
  const t0 = Date.now();
  try {
    const r = await fn();
    const ms = Date.now() - t0;
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${label.padEnd(26)} ${r.status} (${ms}ms)`);
  } catch (e: any) {
    console.log(`FAIL  ${label.padEnd(26)} ${e.message}`);
  }
}

await check("backend auth/nonce", () =>
  fetch(`${BACKEND}/api/users/auth/nonce`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress: "0x0000000000000000000000000000000000000001" }),
  }),
);

await check("frontend root", () => fetch(FRONTEND));
await check("frontend member-sign-up", () => fetch(`${FRONTEND}/member-sign-up`));

const key = process.env.BETA_APP_SERVICE_KEY || process.env.SERVICE_API_KEY;
const org = process.env.BETA_APP_ORG_ID;
if (key && org) {
  await check("backend org roster", () =>
    fetch(`${BACKEND}/api/orgs/${org}`, { headers: { "X-Service-Key": key } }),
  );
}

const token = process.env.BOT_TOKEN;
if (token) {
  const me: any = await (await fetch(`https://api.telegram.org/bot${token}/getMe`)).json();
  console.log(`${me.ok ? "PASS" : "FAIL"}  ${"telegram bot identity".padEnd(26)} @${me.result?.username} (${me.result?.id})`);
}

const anthropicKey = process.env.ANTHROPIC_API_KEY;
if (anthropicKey) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4,
      messages: [{ role: "user", content: "hi" }],
    }),
  });
  const detail = r.ok ? "" : ` — ${((await r.json()) as any)?.error?.message ?? ""}`;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${"anthropic api key".padEnd(26)} ${r.status}${detail}`);
} else {
  console.log(`FAIL  ${"anthropic api key".padEnd(26)} not set`);
}

console.log(`\nchecked ${new Date().toISOString()}`);
