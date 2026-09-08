# Collabberry HR Agent — QA Verification Document

**Environment:** Production<br>
**Date of this run:** ______________<br>
**Tester:** ______________<br>
**Client witness:** ______________

## 1. Systems under test

Health verified 2026-09-07 09:23 UTC via `railway run --service bot bun scripts/health-check.ts` — all six checks PASS.

| Component | URL / Handle | Status |
|---|---|---|
| Telegram bot | [@Coh3erence_hr_bot](https://t.me/Coh3erence_hr_bot) (id `8811416846`) | PASS — process running, polling Telegram |
| Frontend | https://collabberry-frontend.vercel.app | PASS — 200 |
| Member signup route | https://collabberry-frontend.vercel.app/member-sign-up | PASS — 200 |
| Backend API | https://backend-production-53b74.up.railway.app | PASS — `POST /api/users/auth/nonce` → 200 |
| Org roster endpoint | `GET /api/orgs/{orgId}` | PASS — returns org "Aleksa" |
| Data store | Google Sheet `1qM9_Ppm…` | PASS — read OK |
| Language model (Claude) | `api.anthropic.com` | PASS — 200 |

**Target organisation:** "Aleksa", id `63e3ac6c-3e63-4eec-9ac0-de607adf7d05`
**Chain:** Arbitrum One (42161) — TeamPoints contract `0x635af529462Fe31cb92C639237207eD7cbAF084e`

> Note: the backend root URL returns 404 by design — there is no root route. Health is confirmed via the API endpoints above, not the bare domain.

**Participants for this run**

| Telegram id | Plays | Notes |
|---|---|---|
| `535329585` (Aleksa) | Candidate + org admin | Runs the section B admin commands before applying; the code excludes a contributor from their own reviewer pool, so he cannot review his own proposal |
| `1971913512` (Simon, @qbfrank) | Reviewer | First half of quorum |
| `302836662` (Gustavo, @sepu85) | Reviewer (client) | Second half of quorum |

Reviewer pool is therefore `1971913512` and `302836662`, quorum 2 of 2.

> **Before you start — both reviewers must have opened the bot.** Telegram will not deliver a message to anyone who has never started a chat with the bot, and the failure is silent rather than an error. If either reviewer has not pressed Start at https://t.me/Coh3erence_hr_bot, section E will stall until the 48-hour escalation rather than completing. Confirm both are reachable before beginning.
>
> If one reviewer cannot participate live, run `bun scripts/remove-admin.ts --id <their id>` to reduce the pool to one reviewer (quorum 1) so the session completes deterministically, and restore the row afterwards. Note this makes E4 and E5 not observable — see the note under section E.

## 2. How to use this document

Each test has a **fixed expected result** agreed in advance. Walk them in order — later tests depend on state created by earlier ones. Record the outcome in the Result column as PASS / FAIL / N-A and put anything surprising in Notes. A FAIL is not necessarily a defect; note it and continue so the session isn't blocked.

## 3. Configured business rules (verified in code, 2026-08-21)

These are the rules the tests below assert against. All are environment-overridable without a code change.

| Rule | Configured value | Source |
|---|---|---|
| Reviewer response window | 48 hours | `REVIEWER_TIMEOUT_HOURS` |
| Max negotiation rounds | 2 — enforced | `MAX_NEGOTIATION_ROUNDS` |
| Cooldown after rejection | 3 days | `COOLDOWN_DAYS` |
| Reviewer quorum | Majority — `floor(n/2)+1` | `services/quorum.ts` |
| Hourly → monthly conversion | × 160 h/month (40h × 4wk) | `FTE_HOURS_PER_MONTH` |
| Fiat portion of comp | 0 — remainder in TeamPoints | `DEFAULT_FIAT_REQUESTED` |
| Contributor statuses | `active`, `hired`, `rejected`, `cooldown` | `models/types.ts` |

## 4. Test cases

### A — Access control

| ID | Test | Steps | Expected result | Result | Notes |
|---|---|---|---|---|---|
| A1 | Bot responds | Send `/start` to @Coh3erence_hr_bot | Bot replies; conversation begins | | |
| A2 | Unauthorised user is gated | `/start` from an account not in AuthorizedUsers | Access is refused, no opportunity data leaks | | |
| A3 | Admin authorisation | Admin runs `/authorize` for a new Telegram id | User is added and can now proceed | | |

### B — Admin opportunity management

Confirms the admin never edits the spreadsheet directly — all changes go through the bot.

| ID | Test | Steps | Expected result | Result | Notes |
|---|---|---|---|---|---|
| B1 | List opportunities | `/list_opportunities` | Current roles returned with budget and status | | |
| B2 | Create opportunity | `/add_opportunity`, follow prompts | New role appears in B1 and in the sheet | | |
| B3 | Edit opportunity | `/edit_opportunity` | Change persists and is reflected in B1 | | |
| B4 | Pause opportunity | `/pause_opportunity` | Role stops being offered to new contributors | | |

### C — Contributor discovery and matching

| ID | Test | Steps | Expected result | Result | Notes |
|---|---|---|---|---|---|
| C1 | Natural-language intake | Describe skills conversationally, not as a form | Bot extracts skills, rate range, availability, timezone without rigid prompts | | |
| C2 | Structured capture | Check the Contributors sheet row | Skills, commitment %, rate min/max, timezone, location all populated correctly | | |
| C3 | Role match | Continue to matching | Bot proposes a relevant role with a match score | | |
| C4 | Poor-fit handling | Offer skills unrelated to any open role | Bot declines gracefully rather than forcing a bad match | | |

### D — Negotiation

| ID | Test | Steps | Expected result | Result | Notes |
|---|---|---|---|---|---|
| D1 | Counter-offer | Propose a rate above budget | Bot negotiates; settlement likelihood reflects distance from budget | | |
| D2 | Round cap | Tap "Modify Terms" after a second review | Revision limit reached; only Accept / Walk away are offered — no third round | | |
| D3 | Submission | Accept terms | Agreement row created with status submitted; reviewers notified | | |

### E — Review and quorum

| ID | Test | Steps | Expected result | Result | Notes |
|---|---|---|---|---|---|
| E1 | Reviewer notification | Check reviewer account | Reviewer receives the proposal with approve / counter options | | |
| E2 | Approve path | Reviewer approves | Decision recorded in ReviewFeedback | | |
| E3 | Counter path | Reviewer counters with a different rate | Suggested rate parsed and stored | | |
| E4 | Majority quorum | With a pool of n reviewers | Review closes at `floor(n/2)+1` responses, not unanimity | | |
| E5 | Late responder | Reviewer responds after quorum | Late response ignored, outcome unchanged | | |
| E6 | 48h escalation | Leave a review unanswered past the window | Sweep escalates the agreement (runs every 15 min) | | |

> **On E4 and E5.** With a two-reviewer pool, `floor(2/2)+1 = 2`, so majority and unanimity coincide and there is no third reviewer left to respond late — neither case is observable in a live run at this pool size. Both are instead evidenced deterministically by the unit tests in `src/services/quorum.test.ts`, which assert the threshold across pool sizes 1–5 (a pool of 3 closing at 2, and of 5 at 3), that a late responder does not change an already-satisfied outcome, and that out-of-pool and repeat votes are not double-counted. Run with `bun test`.

### F — Resolution

| ID | Test | Steps | Expected result | Result | Notes |
|---|---|---|---|---|---|
| F1 | Aggregation | Multiple reviewers give differing rates | Feedback aggregated into a single coherent counter-offer | | |
| F2 | Reconciliation | Reviewer counter changes the rate | Final agreement terms match the reviewer's counter, not the original ask | | |
| F3 | Candidate accepts | Accept the resolved offer | Agreement status → approved | | |
| F4 | Candidate rejects | Decline the offer | Contributor enters 3-day cooldown | | |

### G — Collabberry integration (the critical path)

| ID | Test | Steps | Expected result | Result | Notes |
|---|---|---|---|---|---|
| G1 | Invite issued | On acceptance | Bot sends a signup link to `/member-sign-up?invitationToken=…` | | |
| G2 | Signup completes | Open link, connect a **fresh** wallet, sign up | Account created in Collabberry | | |
| G3 | Confirmation tap | Return to Telegram, tap "I've signed up" | Bot links the wallet and creates the on-chain agreement | | |
| G4 | Sheet updated | Check Contributors row | status `hired`, walletAddress and collabberryUserId populated | | |
| G5 | Agreement recorded | Check Agreements row | `betaAppAgreementId` populated | | |
| G6 | Renders in app | Open frontend Team view as org admin | Contributor and agreement visible with correct rate and commitment | | |
| G7 | Rate conversion | Compare hourly ask to agreement marketRate | marketRate = hourly × 160 | | |
| G8 | Single-use invite | Attempt to reuse a consumed invite token | Second redemption refused cleanly | | |

## 5. Known limitations — disclose before testing

These are understood behaviours, not defects discovered during the session. Raising them up front avoids them being logged as surprises.

1. **The "I've signed up" tap is manual.** Nothing polls for signup completion. The contributor must return to Telegram and tap the button after finishing in the browser. Tapping *before* signup completes silently does nothing — the contributor stays in `active`. This is the most common point of confusion in a live demo.
2. **Each full end-to-end run needs a fresh wallet.** The backend rejects a second agreement for a wallet that already has one. Re-running G with a previously used wallet will fail by design.
3. **TeamPoints balance shows 0 after hiring.** Minting is a separate manual admin action on-chain and is outside the bot's scope.
4. **The bot has no per-message logging.** State is verified by reading the Google Sheet and backend, not by reading logs.
5. **A bot restart loses the conversation in progress.** Conversation state is held in memory, so a redeploy or crash makes the bot forget what it has already collected and ask for it again. Anything already written to the sheet is safe. Do not redeploy during a session.
6. **Data store is a Google Sheet.** Intentional for the MVP so the client can inspect state directly.

## 6. Pre-go-live items — not blockers for this session

Configuration that is deliberately relaxed for testing and must be tightened before real contributors are onboarded.

| Item | State for this session | Required before go-live |
|---|---|---|
| `NODE_ENV` | `production` | Already done |
| `ALLOW_SELF_REVIEW` | `false` — self-approval is structurally impossible | Already done |
| Reviewer pool | Two admins (quorum of 2), both reachable | Wider pool as the team grows |
| Test data | Cleared 2026-09-07 — sheet holds no prior records | Already done |

> The self-review escape hatch that previously allowed the whole loop to be driven from one Telegram account has been switched off for this session. Every decision below is made by a distinct participant: the candidate cannot approve their own agreement.

## 7. Outcome

**Tests passed:** ____ / 32
**Failures / follow-ups:**

| ID | Issue | Severity | Owner | Action |
|---|---|---|---|---|
| | | | | |

**Client sign-off:** ______________  **Date:** ______________
