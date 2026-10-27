# HR AI Agent — Delivery Status

**Project:** HR AI Agent MVP for Collabberry
**Client:** [Coh3rence](https://github.com/Coh3rence/) / [Collabberry](https://github.com/collabberry/)
**Developer:** Prosperity Labs
**Status as of:** 2026-10-27

---

## Summary

All three milestones are **complete** and the full QA campaign is **closed at 32 / 32** against the live production environment, with the follow-up audit cases (FU-1 … FU-7) also run. Every bot bug surfaced during the campaign has been fixed and deployed to Railway; the latest build, **2026-10-23T10:18:39Z**, carries the final fix (§34, silent-spinner on reviewer callbacks). The deployed source is identical to `main` on GitHub — verified by hash-comparing `src/bot.ts` between the local tree and the Railway container.

Production is healthy and reachable; the authorized reviewer pool is reset to its final three accounts; the self-review bypass is structurally off (`NODE_ENV=production` + `ALLOW_SELF_REVIEW=false`); the invite link and param that drive signup are explicitly set on Railway.

**The project is ready for client sign-off.** The vendor admin row was removed on 2026-10-27 as the handoff cleanup; one housekeeping question — whether to keep or wipe the QA-campaign data on the production sheet — remains for the client to decide, actionable at any time after sign-off (see §6).

---

## Live environment

| Component | Location | Health (re-check with the script below) |
|---|---|---|
| Telegram bot | [@Coh3erence_hr_bot](https://t.me/Coh3erence_hr_bot) — id `8811416846`, Railway service `bot` | PASS |
| Backend API | `backend-production-53b74.up.railway.app` — Railway | PASS |
| Database (backend) | MySQL 9.4 — Railway | PASS |
| Frontend | `collabberry-frontend.vercel.app` — Vercel | PASS |
| Bot data store | Google Sheet `1qM9_Ppm…` | PASS |
| Language model | Claude Sonnet via `api.anthropic.com` | PASS |

Re-check at any time with `railway run --service bot bun scripts/health-check.ts` (read-only, non-destructive).

**Target org:** "Aleksa", `63e3ac6c-3e63-4eec-9ac0-de607adf7d05` on Arbitrum One (42161). TeamPoints contract `0x635af529462Fe31cb92C639237207eD7cbAF084e`.

**Authorized reviewers (final):**

| Telegram id | Role | Plays |
|---|---|---|
| `302836662` | admin | Gustavo (client) |
| `1971913512` | admin | Simon (client-side reviewer) |

Quorum for a proposal is `floor(n/2)+1` of the pool minus the candidate — so two admins with the candidate excluded gives quorum 2 of 2. The Prosperity Labs admin row was removed on 2026-10-27 as the handoff cleanup; the vendor is no longer in the live reviewer pool or on the admin-command surface (ledger K13; reversible via `scripts/add-admin.ts` if post-handoff support ever requires it).

**Prod-safety configuration (verified live):**

| Setting | Value | Why it matters |
|---|---|---|
| `NODE_ENV` | `production` | Flips `selfReviewAllowed()` off |
| `ALLOW_SELF_REVIEW` | `false` | The second gate on the self-review bypass |
| `GOOGLE_SHEETS_ID` | `1qM9_Ppm…` (prod sheet) | Dev sheet is a different id and no longer referenced |
| `BOT_TOKEN` | `@Coh3erence_hr_bot` (id `8811416846`) | Dedicated prod bot, no token collision |
| `BETA_APP_INVITE_URL` | `https://collabberry-frontend.vercel.app/member-sign-up` | Explicitly set; matches the deployed frontend route |
| `BETA_APP_INVITE_PARAM` | `invitationToken` | Explicitly set; matches the frontend's query key |
| `BETA_APP_ORG_ID` | `63e3ac6c…` | Points at the live Collabberry org on Arbitrum |

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

### Milestone 3 — Integration, Polish & Handoff: COMPLETE

| Deliverable | Status |
|---|---|
| On-chain bridge to Beta App API (agreement created on Arbitrum) | Done |
| Cooldown and flagging (3-day cooldown after rejection) | Done |
| Edge-case hardening (restart recovery, malformed input, counter parsing) | Done |
| End-to-end testing | **Done — 32 / 32 live, campaign closed 2026-10-16; follow-up audit closed 2026-10-23** |
| Documentation | Done — see §4 |
| Deployment | Done — Railway + Vercel |
| Client handoff session | Pending sign-off |

---

## QA campaign result — 32 / 32

Every case was executed against the production environment and recorded with its own timestamp and sheet / on-chain evidence in `QA-VERIFICATION.md`. The campaign ran from early September through 2026-10-16, with the follow-up audit (FU-1 … FU-7) resolving 2026-10-16 → 2026-10-23.

Highlights of what the campaign proved live, not in a unit test:

- **End-to-end agreement creation on Arbitrum** — discovery → match → negotiation → review → aggregation → acceptance → invite link → wallet signup on the deployed frontend → on-chain agreement id written back. Last re-proven on current code 2026-10-17 with a fresh wallet (`0xA07a0ee3…`, agreement `a_1792257419170`, `betaAppAgreementId f6a5f2d6-…`).
- **Genuine multi-party review** — the first real `Reject` in the project's history (Nikola on `a_1792160941359`, 2026-10-16) completed quorum 2 of 3, and §19's split-verdict suppression was observed live: the aggregator produced no rate, and the candidate's DM offered Modify / Walk-away but **no Accept button**.
- **48h escalation (E6)** — a throwaway proposal left untouched for 48h flipped to `escalated` and admins were notified, inside the predicted window.
- **Retire-on-commit (§23)** — a round-2 revision drafted after Modify did not retire the standing offer until it was submitted; on submit, the original flipped to `superseded` and `supersededBy` was set.
- **Cooldown gate** — `/start` from a candidate on cooldown was refused verbatim with the 3-day message, not routed back into matching.

### Bugs fixed and deployed during the campaign

| # | Issue | Fixed in | Deployed |
|---|---|---|---|
| §19 | Split approve / reject let the candidate accept at their own ask | — | 2026-09-14 |
| §20 | Aggregated reviewer copy sent to candidate unvalidated | — | 2026-09-22 |
| §21 | Selecting an opportunity did nothing if an earlier agreement id lingered | — | 2026-09-23 |
| §22 | A leading duration was parsed as the hourly rate | — | 2026-09-24 |
| §23 | Modify destroyed the standing offer before new terms existed | `6ed1c34` | 2026-10-08 |
| §24 | `review:submit:` had no status guard — a stale Submit could resurrect a dead draft | `465a0a3` | 2026-10-08 |
| §25 | `/add_opportunity` step-by-step mode fell into the contributor gate | — | 2026-10-06 |
| §26 | Legacy-Markdown underscore broke the confirmation DM | — | 2026-10-08 (full audit) |
| §27 | Every opportunity edit was rejected by Google (12 values into an 11-column range) | — | 2026-10-06 |
| §31 | No match-score floor — the graceful decline was unreachable | — | 2026-10-08 |
| §32 | Counter-offer DM misattributed the reviewer's rate as the candidate's | `baa5290` | 2026-10-14 |
| §33 | Reviewer's "previous ask" quoted an abandoned draft | `cbd37fa` | 2026-10-14 |
| §34 | `answerCallbackQuery` ran after the handler for `review:` / `resolution:` — silent spinner on throw | `06c6aa2` | **2026-10-23** |

All thirteen are live on the Railway `bot` service build `2026-10-23T10:18:39Z`. Every production change is also recorded with an explicit REVERT or KEEP disposition in `docs/QA-REVERT-LEDGER.md`.

### Follow-up audit — FU-1 … FU-7

Written as an honest list on 2026-10-16, this was an audit of what the 32 happened not to touch. Six of seven are closed:

- **FU-1** — accept → invite → signup → on-chain chain re-proven on current code (2026-10-17).
- **FU-2** — first real Reject pressed; §19 observed live.
- **FU-3** — §23 retire-on-commit observed in both halves (draft safe, commit retires).
- **FU-4** — cooldown gate refused `/start` with the 3-day message.
- **FU-5** — §34 deployed and verified live by hash compare on 2026-10-23.
- **FU-6** — the QA tester's admin row removed; `AuthorizedUsers` was reset to the three final admins, then the Prosperity Labs row was removed on 2026-10-27 as the handoff cleanup (ledger K13), leaving the two client admins (Gustavo, Simon).
- **FU-7** (open, scoped) — see §5.

---

## 4. Documentation delivered

| Document | Purpose |
|---|---|
| `docs/DELIVERY-STATUS.md` | This document — the one-page sign-off summary |
| `QA-VERIFICATION.md` (+ `.html`, `.pdf`) | Per-case QA evidence, 32 / 32 result, follow-up audit, client sign-off line |
| `docs/KNOWN-ISSUES-AND-DECISIONS.md` | 34 issues logged with status and evidence; design decisions explained |
| `docs/QA-REVERT-LEDGER.md` | Every production change with its REVERT / KEEP disposition |
| `docs/ARCHITECTURE.md` | System overview |
| `docs/CONVERSATION-FLOWS.md` | Phase-by-phase walkthrough |
| `docs/BETA-APP-BRIDGE.md` | How the bot calls into the Collabberry Beta App to create the on-chain agreement |
| `docs/DEPLOYMENT-RAILWAY.md` | Operations runbook: what is where, how to deploy, how to re-check |
| `docs/MANUAL-TEST-PLAN.md` | The agreed test plan the campaign ran against |

---

## 5. Known limitations and remaining items

Deliberate, accepted limitations of the MVP (full detail in `docs/KNOWN-ISSUES-AND-DECISIONS.md`):

1. **"I've signed up" is a manual tap.** Nothing polls for signup completion. Tapping before the browser flow finishes silently does nothing. This is the most common point of confusion in a live demo.
2. **Each end-to-end run needs a fresh wallet.** The backend rejects a second agreement for a wallet that already has one.
3. **TeamPoints balance shows 0 after hiring.** Minting is a separate admin signature, outside the bot's scope.
4. **No per-message bot logging.** State is diagnosed by reading the sheet and backend.
5. **Google Sheets as the bot data store.** Intentional for MVP so the client can inspect state directly.

**One open follow-up (FU-7), outside the bot's scope:**

- **FU-7(a)** The one live retry on 2026-10-17 originally hypothesised a config fallthrough in the invite link; this is now disproved — `BETA_APP_INVITE_URL` and `BETA_APP_INVITE_PARAM` are explicitly set on Railway (see §Live environment). The retry's root cause was not captured during the run; no further occurrence has been observed.
- **FU-7(b)** MetaMask warned *"this site shows signs of phishing or wallet-draining activity"* on the Vercel subdomain. Most likely a false positive on the hosting pattern, but a real contributor would see the same warning. **Owner: client / frontend team.** Serve signup from a custom domain or file a false-positive removal against MetaMask's `eth-phishing-detect` list.

---

## 6. Housekeeping decisions

1. **Developer admin row — RESOLVED 2026-10-27.** `535329585` (Aleksa, Prosperity Labs) was removed from `AuthorizedUsers` as the handoff cleanup. The live reviewer pool is now the two client admins (Gustavo, Simon) only. Recorded as ledger entry K13; reversible via `scripts/add-admin.ts` if post-handoff support ever requires it.

2. **QA-campaign data on the production sheet — OPEN.** Three contributor rows, twelve agreement rows and sixteen review-feedback rows exist on the prod sheet — these are the actual 32 / 32 campaign records (including the on-chain agreement proofs cited above). Options: leave in place as live-run evidence; archive to a backup tab; or zero out so the client starts against an empty roster. A reset script exists (`scripts/reset-test-data.ts`) and preserves a dated backup. **Deferred to the client's preference, actionable at any time after sign-off.**

---

## 7. Tech stack

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

## 8. Next steps

1. **Client review of this document plus `QA-VERIFICATION.pdf`.**
2. **Client countersigns `QA-VERIFICATION.md` §7** (the sign-off line) and `docs/DELIVERY-STATUS.md` is treated as the delivery statement.
3. **Payment initiation per the engagement terms.**
4. **Client's call on the QA-campaign data** (§6 item 2) — leave as live-run evidence, archive, or wipe. Actionable at any time; not a sign-off blocker.
5. **Post-handoff:** operations runbook is `docs/DEPLOYMENT-RAILWAY.md`; incident paths are logged with sheet-read scripts and `railway logs --service bot`.
