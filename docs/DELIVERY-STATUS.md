# HR AI Agent — Delivery Status

**Project:** HR AI Agent MVP for Collabberry
**Client:** [Coh3rence](https://github.com/Coh3rence/) / [Collabberry](https://github.com/collabberry/)
**Developer:** Prosperity Labs
**Status as of:** 2026-08-26

---

## Summary

All three milestones are **functionally complete** and the entire loop has been **proven end to end in production** — discovery through to an on-chain agreement in the live Collabberry org.

Production is **healthy — all six service checks pass** as of 2026-08-26 14:14 UTC. The Anthropic key outage that blocked conversation on 2026-08-22/23 is resolved.

Three configuration items remain before real contributors are onboarded:

1. The client's reviewer account (`302836662`) is authorised but **has never opened a DM with the bot**, so Telegram will not deliver reviewer notifications to them. Because quorum is now 2 of 2, every review will hang until the 48h escalation until they press Start at https://t.me/Coh3erence_hr_bot.
2. The bot runs with **development flags in production**, which leaves the self-review bypass active.
3. The production sheet still holds **test records** (`test_contributor_123`).

None of these are code defects. All three are deployment or configuration items.

---

## Live environment

| Component | Location | Health (2026-08-26 14:14 UTC) |
|---|---|---|
| Telegram bot | [@Coh3erence_hr_bot](https://t.me/Coh3erence_hr_bot) — id `8811416846`, Railway | PASS — running, polling |
| Backend API | `backend-production-53b74.up.railway.app` — Railway | PASS |
| Database (backend) | MySQL 9.4 — Railway | PASS |
| Frontend | `collabberry-frontend.vercel.app` — Vercel | PASS |
| Bot data store | Google Sheet `1qM9_Ppm…` | PASS |
| Language model | Claude Sonnet via `api.anthropic.com` | PASS |

**Reviewer pool:** `535329585` (Prosperity Labs, reachable) and `302836662` (client, **not yet reachable** — awaiting their first Start). Quorum is `floor(2/2)+1 = 2`, so both must respond for a review to close.

**Target org:** "Aleksa", `63e3ac6c-3e63-4eec-9ac0-de607adf7d05` on Arbitrum One (42161).
TeamPoints contract `0x635af529462Fe31cb92C639237207eD7cbAF084e`.

Re-check any time with `railway run --service bot bun scripts/health-check.ts` (non-destructive).

---

## Milestones

### Milestone 1 — Foundation: COMPLETE

Bot scaffolding (grammy + TypeScript + Bun), invite-only application gate, Google Sheets integration across four tabs, Claude integration via tool use, natural-language discovery, and admin commands (`/add_opportunity`, `/list_opportunities`, `/edit_opportunity`, `/pause_opportunity`, `/authorize`).

### Milestone 2 — Core Features: COMPLETE

| Deliverable | Status |
|---|---|
| Semantic skill matching (Claude tool use, not substring) | Done |
| Opportunity ranking and presentation | Done |
| Negotiation flow (rate, hours, commitment %) | Done |
| Settlement likelihood calculation | Done |
| Submit proposal for review | Done |
| Reviewer DM notifications with inline approve / counter / reject | Done |
| Multi-reviewer feedback collection and storage | Done |
| Majority quorum + 48h timeout with escalation | Done |
| Claude aggregates reviewer feedback into a counter-offer | Done |
| Resolution loop (accept / negotiate / walk away) | Done |
| Reviewer counter reconciled into final agreement terms | Done |

### Milestone 3 — Integration, Polish & Handoff: COMPLETE, pending sign-off

| Deliverable | Status |
|---|---|
| On-chain bridge to Beta App API (agreement created on Arbitrum) | Done |
| Cooldown and flagging (3-day cooldown after rejection) | Done |
| Edge-case hardening (restart recovery, malformed input, counter parsing) | Done |
| End-to-end testing | Done in production — see below |
| Documentation | Done — this doc, `QA-VERIFICATION.md`, `DEPLOYMENT-RAILWAY.md`, `KNOWN-ISSUES-AND-DECISIONS.md` |
| Deployment | Done — Railway + Vercel |
| Client handoff session | Outstanding |

---

## End-to-end verification

**Verified in production, 2026-07-31.** Full loop from a live Telegram conversation: discovery → match → negotiation → submission → review → aggregation → acceptance → invite link → wallet signup on the deployed frontend → backend user created → on-chain agreement created.

Evidence in the production sheet:

- Contributor `c_1785494049152` — status `hired`, wallet `0x164993ad…`, Collabberry user `05b60b5c…`
- Agreement `a_1785497474310` — Frontend Developer, $50/hr, 50% commitment, 3 months, status `approved`
- On-chain agreement id `2bf3fbd0-c1aa-4d6a-ba25-410760c79606`

**Important qualification:** the review step in that run was a **self-review** — the reviewer and the contributor were the same Telegram account (`535329585`), using the development bypass. The mechanics of quorum and aggregation are unit-tested and work, but **a genuine multi-party review with two or more distinct humans has never been run**. That is the main remaining validation gap.

---

## Blockers before real contributors

| # | Item | Current state | Required |
|---|---|---|---|
| 1 | **Anthropic API key** | 401, invalid | Set a valid `ANTHROPIC_API_KEY` on the Railway bot service and redeploy. Blocks all conversation. |
| 2 | **`NODE_ENV`** | `development` | `production` |
| 3 | **`ALLOW_SELF_REVIEW`** | `true` | `false` or removed. With #2 this is what keeps the self-review bypass live. |
| 4 | **Reviewer pool** | `535329585` (admin) plus a `test_contributor_123` placeholder | Authorise the real reviewers, remove the placeholder, then run one genuine multi-reviewer loop |
| 5 | **Test data** | Prod sheet holds the 2026-07-31 test contributor and agreement | `bun scripts/reset-test-data.ts` (no `NODE_ENV` prefix — that targets the dev sheet) |

Items 2 and 3 are a single `railway variables` call plus a redeploy. Item 1 needs a valid key from the client or from Prosperity Labs.

> Note: an earlier version of this document claimed self-review was "already prod-safe" because it requires both `NODE_ENV=development` and `ALLOW_SELF_REVIEW=true`. Both are currently set on the deployed bot, so the bypass **is active in production**. That claim was wrong and is corrected here.

---

## Known limitations (accepted for MVP)

1. **The "I've signed up" confirmation is manual.** Nothing polls for signup completion; the contributor must return to Telegram and tap the button. Tapping before signup completes silently does nothing. This is the most common source of confusion in a live demo.
2. **Each full run needs a fresh wallet.** The backend rejects a second agreement for a wallet that already has one.
3. **TeamPoints balance shows 0 after hiring.** Minting is a separate manual admin signature, outside bot scope.
4. **No per-message logging.** State is diagnosed by reading the sheet and backend, not logs.
5. **Google Sheets as the data store.** Deliberate for the MVP so the client can inspect state directly.

---

## Resolved

**Invite-token consumption (2026-07-23).** Consume and user-create now run in one transaction with an atomic conditional UPDATE, closing double-spend, token-burn-on-failure, and an uncaught 500 on a racing duplicate. Fixed in `85b17ce` and `f522639`, pushed to `Coh3rence/backend`, verified end-to-end and at SQL level.

**Production hosting decision.** Previously the critical-path unknown. Resolved: Railway for bot, backend and MySQL; Vercel for frontend.

**Anthropic API key outage (2026-08-26).** The deployed key returned 401 `authentication_error`, breaking every Claude-dependent phase. Replaced on Railway and verified; all six health checks now pass.

**Negotiation round cap, DEF-1 (2026-08-26).** `MAX_NEGOTIATION_ROUNDS` is now read and enforced. Fixed in `0e956fd`.

**Silent handler failures, DEF-3 (2026-08-26).** Seven paths returned with no reply, indistinguishable from a crashed bot. Each now sends a plain-language message. Fixed in `0e956fd`.

---

## Key design decisions

| Decision | Detail |
|---|---|
| Majority quorum | Review closes at `floor(n/2)+1` responses, not unanimity |
| 48h deadline behaviour | If quorum is met, aggregate and proceed. If not, **escalate to admins for a manual decision** — silence is not approval, and non-responses are simply not counted |
| Rejection requires explanation | Actionable feedback required (lower rate, more commitment, etc.) |
| Semantic matching | Claude evaluates skill fit, not keyword substring |
| Max 2 negotiation rounds | Enforced on the Modify branch, read from the persisted agreement row so it survives a restart. The first draft is round 1; one revision is allowed after review, then the candidate must accept or walk away |
| Commitment above max is positive | Extra availability is not penalised |
| Returning users skip discovery | Go straight to matching |
| Hourly to monthly | marketRate = hourly × 160 (40h × 4wk) |
| Compensation split | Fiat portion defaults to 0; remainder in TeamPoints |

---

## Tech stack

| Component | Technology |
|---|---|
| Bot framework | grammy (TypeScript) |
| LLM | Claude Sonnet via `@anthropic-ai/sdk` |
| Bot data store | Google Sheets (googleapis) |
| Backend | Node/TypeScript + MySQL (Collabberry fork) |
| Chain | Arbitrum One |
| Hosting | Railway (bot, backend, DB), Vercel (frontend) |
| Runtime | Bun |

---

## Next steps

1. Deploy a valid Anthropic API key and confirm with the health check.
2. Flip `NODE_ENV` to `production` and `ALLOW_SELF_REVIEW` to `false`.
3. Authorise the real reviewer accounts and reset the test data.
4. Run one genuine multi-reviewer loop with a fresh wallet, recording results in `QA-VERIFICATION.md`.
5. Hold the handoff session.
