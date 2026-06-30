/**
 * Integration test for the M3 Beta App bridge against a running backend fork.
 * Exercises the real BetaAppService methods (the same code the bot calls):
 * invite-link mint, roster read, telegramHandle resolution, hourly->monthly
 * conversion, and agreement creation. Requires the fork up + bot .env pointed
 * at it (BETA_APP_API_URL, BETA_APP_SERVICE_KEY, BETA_APP_ORG_ID).
 *
 * Usage: bun scripts/test-bridge.ts --handle <telegramHandle>
 */
import { loadConfig } from "../src/config";
import { BetaAppService } from "../src/services/betaApp";

const hIdx = process.argv.indexOf("--handle");
const handle = hIdx >= 0 ? process.argv[hIdx + 1]! : "testnewbie";

const config = loadConfig();
const beta = new BetaAppService(config);

let failures = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

console.log(`API: ${config.BETA_APP_API_URL}  org: ${config.BETA_APP_ORG_ID}\n`);

// 1. invite link (service-key auth on /orgs/invitation)
const invite = await beta.createInviteLink();
check("createInviteLink", !!invite.token && invite.url.includes("invitation="), invite.url);

// 2. roster read + telegramHandle resolution
const resolved = await beta.resolveByHandle(handle);
check("resolveByHandle", !!resolved, resolved ? `${resolved.username} -> ${resolved.id}` : `no match for @${handle}`);

// 3. hourly -> monthly (D-013: 50/hr * 160 = 8000)
const monthly = beta.hourlyToMonthly(50);
check("hourlyToMonthly(50)", monthly === 8000, `${monthly} (expect 8000)`);

// 4. createAgreement against the resolved user
if (resolved) {
  const res = await beta.createAgreement({
    userId: resolved.id,
    roleName: "Bridge Test Role",
    responsibilities: "End-to-end bridge verification",
    hourlyRate: 50,
    commitmentPercent: 40,
  });
  check("createAgreement", !!res.betaAgreementId, `betaAgreementId=${res.betaAgreementId}`);
} else {
  check("createAgreement", false, "skipped — resolveByHandle returned null");
}

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
