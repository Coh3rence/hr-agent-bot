# HR Agent Bot — Full QA Test Plan

**Audience:** QA / engineering team
**Scope:** every phase of the bot, including edge cases, negative paths and recovery behaviour
**Last updated:** 2026-08-23

Related documents:

- `QA-VERIFICATION.md` — the short client-facing acceptance checklist (32 cases, happy path). Use that one *with* the client; use this one *before* the client sees it.
- `docs/MANUAL-TEST-PLAN.md` — the older iteration-3 deep dive on the review flow. Superseded by Part 4 here, but its aggregation-harness steps are still valid and are referenced in Part 2.
- `docs/DELIVERY-STATUS.md` — current deployment state and open blockers.

---

## Part 0 — Legend and conventions

| Marker | Meaning |
|---|---|
| **[HAPPY]** | Core path — must pass before any release |
| **[EDGE]** | Unusual but reachable through normal use |
| **[NEG]** | Negative path — invalid input, wrong order, unauthorised |
| **[FAULT]** | Requires fault injection (revoke a key, delete a row mid-flow, stop a service) |
| **[DEFECT]** | Known defect — documented expected behaviour differs from actual. See Part 8 |

Record results as PASS / FAIL / BLOCKED / N-A. A FAIL needs a defect ID before the run is considered closed.

---

## Part 1 — Prerequisites

1. **Two or more Telegram accounts.** A contributor is excluded from their own reviewer pool, so genuine multi-reviewer testing needs at least one *other* admin. Three accounts (1 contributor + 2 reviewers) exercises majority quorum properly.
2. **A dedicated test Google Sheet** — a copy of the production structure. Never run this plan against the production sheet. Note its ID.
3. **A test bot token.** Only one process may poll a token at a time; two pollers silently drop updates.
4. **A valid `ANTHROPIC_API_KEY`.** Without it every Claude-dependent phase fails (see D-FAULT-1).
5. **`AuthorizedUsers` tab** seeded with each reviewer's Telegram id and `role = admin`.
6. **A fresh wallet per full end-to-end run.** The backend rejects a second agreement for a wallet that already has one.
7. **Backend + frontend reachable** — for Part 7 only.

> Do not run `scripts/setup-sheets.ts` against a sheet with real data. It unconditionally writes sample rows.

---

## Part 2 — Automated checks (run first, no Telegram needed)

| ID | Test | Command | Expected | Result |
|---|---|---|---|---|
| AU-1 | Typecheck | `bun run typecheck` | Exits 0, no errors | |
| AU-2 | Unit tests | `bun test` | All pass (covers counter-feedback parsing) | |
| AU-3 | Aggregation engine | `bun scripts/test-aggregation.ts --sheet-id <TEST_ID>` | Every scenario PASS; rows cleaned up | |
| AU-4 | Health check | `bun scripts/health-check.ts` | All services PASS incl. Anthropic key | |
| AU-5 | ReviewFeedback tab missing → created | `bun scripts/ensure-reviewfeedback-tab.ts --sheet-id <ID>` | Tab created with 7 headers, exit 0 | |
| AU-6 | Tab exists, headers correct | Re-run AU-5 | "already correct", no change, exit 0 | |
| AU-7 | Tab exists, row 1 empty | Clear row 1, re-run | Headers written, no data loss, exit 0 | |
| AU-8 | Tab exists, row 1 wrong | Garble row 1, re-run | Refuses, does NOT overwrite, exit 1 | |

---

## Part 3 — Gate and authorisation

| ID | Type | Scenario | Expected | Result |
|---|---|---|---|---|
| G-1 | HAPPY | Unauthorised user sends `/start` | "Not authorised yet" reply; every admin DM'd with Approve/Ignore buttons | |
| G-2 | NEG | Unauthorised user sends arbitrary text | Same gate response as G-1 | |
| G-3 | HAPPY | Admin taps "Authorize as Contributor" | User added with role contributor; message edited to confirm; user DM'd | |
| G-4 | HAPPY | Admin taps "Authorize as Admin" | Same, role admin | |
| G-5 | HAPPY | Admin taps "Ignore" | Message edited to "ignored"; no sheet write; no DM | |
| G-6 | EDGE | Admin double-taps an authorise button | **Expected: no duplicate row.** See DEF-5 | |
| G-7 | EDGE | Authorised user, no profile yet | Phase → discovery; onboarding message | |
| G-8 | HAPPY | Returning contributor with a complete profile | Welcome-back message; goes straight to matching, skipping discovery | |
| G-9 | EDGE | Returning contributor whose rate min equals max | Displays `$X/hr`, not `$X-X/hr` | |
| G-10 | EDGE | Returning contributor, no open opportunities | "No open opportunities right now"; phase → idle | |
| G-11 | EDGE | Returning contributor, no strong matches | "No strong matches found"; phase → idle | |
| G-12 | NEG | Contributor on cooldown with a future expiry | Cooldown message with days remaining; flow stops | |
| G-13 | EDGE | Contributor whose cooldown has expired | Cooldown skipped; proceeds to matching | |
| G-14 | EDGE | Contributor status `cooldown` but no expiry date | Treated as not on cooldown, proceeds. Confirm this is acceptable | |
| G-15 | EDGE | Previously `hired` contributor sends `/start` | **No guard exists** — re-enters the full flow. See DEF-6 | |
| G-16 | FAULT | Admin has never opened a DM with the bot | Send fails silently; other admins still notified; user still gets a reply | |
| G-17 | FAULT | `AuthorizedUsers` has zero admins | User denied; no DMs attempted; no crash. Nobody is told a request happened | |

---

## Part 4 — Discovery and matching

| ID | Type | Scenario | Expected | Result |
|---|---|---|---|---|
| D-1 | HAPPY | Describe skills conversationally over several messages | Claude asks follow-ups until complete, then saves the profile | |
| D-2 | HAPPY | Profile saved | Contributors row has skills, commitment %, rate min/max, timezone, location | |
| D-3 | HAPPY | Matching runs | Up to 3 opportunities with scores, shown as inline buttons; phase → matching | |
| D-4 | EDGE | Give a name but no skills | Profile NOT saved; conversation continues | |
| D-5 | EDGE | Give skills but no name | Profile NOT saved; conversation continues | |
| D-6 | EDGE | Never state a commitment % | Defaults to 50 | |
| D-7 | EDGE | State a rate of 0, or no rate | Stored as 0 — no validation. Confirm acceptable. See DEF-7 | |
| D-8 | EDGE | Send 20+ messages before completing the profile | All history sent to Claude; no truncation. Watch for latency or token errors | |
| D-9 | NEG | Send a photo or sticker during discovery | Ignored, no reply, no crash | |
| D-10 | EDGE | Re-run discovery as an existing contributor | Existing row updated in place; id and previousAttempts preserved | |
| D-11 | EDGE | Offer skills matching nothing on offer | Graceful "no strong matches"; no forced bad match | |
| D-12 | NEG | Type text while the match keyboard is showing | Routed back into discovery; no crash | |
| D-13 | EDGE | Opportunity paused between being shown and tapped | **Silent no-op — user gets no feedback.** See DEF-3 | |
| D-14 | FAULT | Invalid Anthropic key during discovery | Bot fails to reply. Confirm the failure is visible, not silent | |

---

## Part 5 — Negotiation

| ID | Type | Scenario | Expected | Result |
|---|---|---|---|---|
| N-1 | HAPPY | Select an opportunity | Intro message: "You've selected X, propose your terms" | |
| N-2 | HAPPY | Propose complete terms | Agreement row created as draft; summary shown with Submit / Modify buttons | |
| N-3 | HAPPY | Propose a rate above budget | Bot negotiates; settlement likelihood reflects the gap | |
| N-4 | EDGE | Propose terms with no numeric rate | Not treated as complete; conversation continues | |
| N-5 | EDGE | Omit commitment % | Falls back to the contributor's profile value | |
| N-6 | EDGE | Omit duration | Defaults to 3 months | |
| N-7 | EDGE | Settlement likelihood when budget min equals max | No divide-by-zero; a sane number is produced | |
| N-8 | EDGE | Settlement likelihood is never above 95% | Capped at 95 | |
| N-9 | EDGE | Ask far above budget | Likelihood floors around 50, never negative | |
| N-10 | DEFECT | Negotiate repeatedly past two rounds | **Documented as capped at 2. No cap exists — rounds are unlimited.** See DEF-1 | |
| N-11 | EDGE | Send more terms after a draft already exists | A second agreement row may be created, orphaning the first. See DEF-4 | |
| N-12 | HAPPY | Tap "Modify Terms" from the draft | Phase → negotiation; "What would you like to change?" | |
| N-13 | FAULT | Contributor row deleted mid-negotiation | Handler returns silently; user is stuck with no message. See DEF-3 | |

---

## Part 6 — Review, quorum and aggregation

### 6.1 Submission and notification

| ID | Type | Scenario | Expected | Result |
|---|---|---|---|---|
| R-1 | HAPPY | Tap "Submit for review" | Status → under_review; contributor confirmed; all admins except the contributor DM'd | |
| R-2 | HAPPY | Reviewer receives the DM | Proposal details plus Approve / Counter / Reject buttons | |
| R-3 | EDGE | Contributor is also the only admin, self-review off | Pool is empty; nobody can vote; only the 48h sweep will act (escalation) | |
| R-4 | EDGE | Self-review enabled (dev only) | Contributor stays in their own pool | |
| R-5 | FAULT | One reviewer has blocked the bot | Error logged; other reviewers still receive DMs | |

### 6.2 Reviewer decisions

| ID | Type | Scenario | Expected | Result |
|---|---|---|---|---|
| R-6 | HAPPY | Reviewer approves | "Approval recorded"; feedback row written | |
| R-7 | HAPPY | Reviewer counters with `60 - experience is thin` | Rate 60 parsed; remainder stored as qualitative | |
| R-8 | HAPPY | Reviewer rejects with a reason | Decision and reason recorded | |
| R-9 | EDGE | Counter `we need 50% commitment` | Commitment 50 parsed; rate null | |
| R-10 | EDGE | Counter `60, 50% - too junior` | Rate 60, commitment 50, qualitative "too junior" | |
| R-11 | EDGE | Counter `%40` (percent before the number) | Commitment 40 parsed | |
| R-12 | EDGE | Counter `62.5 - solid` | Decimal rate 62.5 parsed | |
| R-13 | EDGE | Counter `60` with no comment | Rate 60; qualitative placeholder inserted | |
| R-14 | EDGE | Counter `50%` only | Read as commitment, NOT as a rate of 50 | |
| R-15 | NEG | Counter with no numbers at all | Rate and commitment null; whole text kept as qualitative | |
| R-16 | NEG | Counter with empty or whitespace text | Placeholder qualitative recorded | |
| R-17 | EDGE | Same reviewer votes twice | Only the latest vote counts; quorum counts them once | |
| R-18 | EDGE | Reviewer changes their mind (counter, then reject) | Later decision wins | |
| R-19 | NEG | Reviewer votes after quorum already closed | Ignored; no second aggregation; outcome unchanged | |
| R-20 | NEG | Reviewer votes after escalation | Ignored | |
| R-21 | FAULT | Sheet write fails on approve | Reviewer told to tap again; buttons kept; admins DM'd about the failure | |
| R-22 | EDGE | Bot restarts between tapping Counter and sending the text | Session lost; phase resets; reviewer gets no explanation. See DEF-3 | |

### 6.3 Quorum

| ID | Type | Scenario | Expected | Result |
|---|---|---|---|---|
| Q-1 | HAPPY | Pool of 3, two respond | Quorum met at 2 (`floor(3/2)+1`); aggregation fires on the 2nd | |
| Q-2 | HAPPY | Pool of 2, both respond | Quorum is 2; fires on the last | |
| Q-3 | EDGE | Pool of 1 | Quorum is 1; fires immediately | |
| Q-4 | EDGE | An admin added *after* submission votes | Out-of-pool vote does not count toward quorum | |
| Q-5 | EDGE | Pool of 3, only one responds, deadline passes | No quorum → escalation, NOT approval | |

### 6.4 Aggregation outcomes

| ID | Type | Scenario | Expected | Result |
|---|---|---|---|---|
| AG-1 | HAPPY | All approve | Outcome all_approve; summary "All reviewers approved."; original rate kept; no Claude call | |
| AG-2 | HAPPY | All reject | Reasons concatenated deterministically; no Claude call | |
| AG-3 | EDGE | All reject, nobody gives a reason | "Reviewers declined without giving reasons." | |
| AG-4 | HAPPY | Mixed approve + counter | Claude synthesises one professional paragraph; no reviewer named individually | |
| AG-5 | HAPPY | Multiple counters with different rates | Suggested rate is the mean of the counters only; approvers' rates excluded | |
| AG-6 | EDGE | Counters where some give no rate | Mean computed only over those that did | |
| AG-7 | EDGE | Single counter in the pool | Passed through unchanged; no Claude call | |
| AG-8 | EDGE | Quorum met but zero usable feedback | Returns null; candidate is not notified | |

---

## Part 7 — Resolution and Collabberry integration

### 7.1 Candidate decision

| ID | Type | Scenario | Expected | Result |
|---|---|---|---|---|
| RS-1 | HAPPY | Candidate is presented the outcome | DM with the counter offer and Accept / Modify / Walk away | |
| RS-2 | EDGE | Candidate notified exactly once | A second aggregation pass must not re-DM | |
| RS-3 | EDGE | Outcome has no proposed rate | "The reviewers did not propose a rate." | |
| RS-4 | EDGE | Outcome has no commitment | Commitment line omitted entirely | |
| RS-5 | HAPPY | Accept after a reviewer counter | **Final terms reconcile to the counter**, not the original ask | |
| RS-6 | EDGE | Accept after all-approve (no counter) | Original terms kept unchanged | |
| RS-7 | EDGE | Accept where only the rate was countered | Rate updated; commitment untouched | |
| RS-8 | EDGE | Accept where only commitment was countered | Commitment updated; rate untouched | |
| RS-9 | HAPPY | Tap "Modify Terms" | Returns to negotiation with reviewer context injected; history cleared | |
| RS-10 | EDGE | Modify when no reviewer notes exist | Context section omitted; negotiation still works | |
| RS-11 | HAPPY | Tap "Walk away" | Agreement rejected; contributor → cooldown 3 days; previousAttempts incremented | |
| RS-12 | NEG | Re-apply during cooldown | Blocked with days remaining (ties back to G-12) | |
| RS-13 | NEG | Tap a stale button from an old agreement | Silent no-op, no feedback. See DEF-3 | |

### 7.2 Signup and on-chain bridge

| ID | Type | Scenario | Expected | Result |
|---|---|---|---|---|
| BR-1 | HAPPY | Accept issues an invite | Invite token minted and persisted; signup URL DM'd; phase → awaiting signup | |
| BR-2 | HAPPY | Complete signup with a fresh wallet, then tap "I've signed up" | Wallet linked; agreement created on-chain; contributor → hired | |
| BR-3 | EDGE | Tap "I've signed up" *before* completing signup | "Couldn't find your sign-up yet"; button re-offered; state unchanged | |
| BR-4 | EDGE | Never tap the button | **Nothing happens, ever** — no polling exists. See DEF-2 | |
| BR-5 | EDGE | Send text instead of tapping the button | Re-prompted to tap | |
| BR-6 | NEG | Signup with a wallet that already has an agreement | Backend rejects; error surfaced to the contributor | |
| BR-7 | NEG | Reuse an already-consumed invite token | Refused cleanly, no 500 (regression test for the token fix) | |
| BR-8 | EDGE | Accept when already linked to Collabberry | Invite step skipped; agreement created directly | |
| BR-9 | EDGE | Tap Accept twice | Idempotency guard prevents a second on-chain agreement | |
| BR-10 | HAPPY | Verify rate conversion | marketRate = hourly × 160 | |
| BR-11 | HAPPY | Verify compensation split | fiatRequested 0; remainder in TeamPoints | |
| BR-12 | HAPPY | View in the frontend | Contributor and agreement render in the org Team view with correct terms | |
| BR-13 | EDGE | TeamPoints balance after hiring | Shows 0 — minting is a separate manual admin action | |
| BR-14 | FAULT | Beta App API returns an error on create | Error surfaced to contributor; contributor NOT marked hired | |
| BR-15 | FAULT | Sheet write fails after a successful on-chain create | Agreement exists upstream but not recorded locally; re-tap would duplicate. See DEF-8 | |

---

## Part 8 — Admin commands

| ID | Type | Scenario | Expected | Result |
|---|---|---|---|---|
| A-1 | NEG | Non-admin runs each of the five admin commands | All refused with "no admin permissions" | |
| A-2 | HAPPY | `/list_opportunities` | Roles listed with status emoji: green open, yellow paused, red filled | |
| A-3 | EDGE | `/list_opportunities` with none defined | "No opportunities found" | |
| A-4 | HAPPY | `/add_opportunity` with full details inline | Opportunity created; appears in the list | |
| A-5 | DEFECT | `/add_opportunity` with no text, then reply | **Multi-turn flow is broken** — the follow-up goes to the gate handler. See DEF-9 | |
| A-6 | EDGE | `/add_opportunity` with partial details | "Couldn't extract all required fields" | |
| A-7 | HAPPY | `/edit_opportunity <id> <change>` | Change persists and shows in the list | |
| A-8 | NEG | `/edit_opportunity` with no arguments | Usage hint | |
| A-9 | NEG | `/edit_opportunity <id>` with no change text | Usage hint | |
| A-10 | NEG | `/edit_opportunity` with an unknown id | "Not found" | |
| A-11 | EDGE | Edit that changes nothing extractable | Silent no-op success. Confirm acceptable | |
| A-12 | HAPPY | `/pause_opportunity <id>` | Paused; no longer offered to new contributors | |
| A-13 | NEG | `/pause_opportunity` unknown id | "Not found" | |
| A-14 | HAPPY | `/authorize <id> admin` | Added as admin; user DM'd | |
| A-15 | EDGE | `/authorize` an already-authorised user | "Already authorised"; no duplicate row | |
| A-16 | EDGE | `/authorize <id>` with no role | Defaults to contributor | |
| A-17 | FAULT | Notify DM fails on authorise | Admin still sees confirmation | |

---

## Part 9 — Resilience and recovery

| ID | Type | Scenario | Expected | Result |
|---|---|---|---|---|
| RC-1 | HAPPY | Timeout sweep runs at startup and every 15 minutes | Log line on boot; no duplicate processing | |
| RC-2 | HAPPY | 48h passes with quorum met but candidate never notified | Sweep catches up and delivers the DM | |
| RC-3 | HAPPY | 48h passes without quorum | Escalation DM to all admins; status → escalated; **not** auto-approved | |
| RC-4 | EDGE | Sweep runs after on-tap quorum already closed the review | Skipped; no duplicate DM | |
| RC-5 | EDGE | Agreement with an unparseable submission date | Warned and skipped; sweep continues | |
| RC-6 | EDGE | Bot restarts mid-conversation | Session state lost; user can recover with `/start` — confirm no corrupt state | |
| RC-7 | FAULT | Sheet unreachable during a sweep | Error logged; sweep aborts; bot stays alive | |
| RC-8 | FAULT | Two bot instances on one token | Updates dropped silently. Confirm only one runs in each environment | |
| RC-9 | NEG | Tap a button whose callback prefix is unknown | Telegram spinner never clears. See DEF-10 | |
| RC-10 | FAULT | Anthropic key invalid | Every Claude-dependent phase fails. Confirm failures are visible | |

---

## Part 10 — Known defects

Found by code inspection on 2026-08-23. Confirm each still reproduces, then either fix or accept and correct the documentation.

| ID | Severity | Defect | Evidence |
|---|---|---|---|
| DEF-1 | ~~High~~ **FIXED 2026-08-26 (`0e956fd`)** | `MAX_NEGOTIATION_ROUNDS` is now read and enforced on the Modify branch, with the round read from the persisted agreement row so it survives a cold session. First draft is round 1; one revision is allowed after review, then only Accept / Walk away are offered | `resolution.ts` modify branch, `negotiation.ts:113` |
| DEF-2 | **High** | No auto-detection of Collabberry signup. Finalisation depends entirely on a manual tap; if the contributor never taps, the agreement is never created | `resolution.ts:109` |
| DEF-3 | ~~Medium~~ **FIXED 2026-08-26 (`0e956fd`)** | Seven failure branches returned silently, leaving the user with no message. All now reply in plain language and log where the condition indicates a real fault | `negotiation.ts`, `resolution.ts` |
| DEF-4 | Medium | Re-entering negotiation while a draft exists can create a second agreement, orphaning the first | `negotiation.ts:40` |
| DEF-5 | Medium | Double-tapping an authorise button writes a duplicate `AuthorizedUsers` row (the `/authorize` command guards against this; the button does not) | `bot.ts:110` |
| DEF-6 | Medium | A contributor already `hired` can re-enter the full flow; there is no status guard | `gate.ts:47,61` |
| DEF-7 | Low | No lower bound on the desired rate; `$0/hr` is accepted | `discovery.ts:73` |
| DEF-8 | Medium | If the sheet write fails after a successful on-chain create, the agreement exists upstream but not locally, and a retry would duplicate it | `resolution.ts:233` |
| DEF-9 | Medium | `/add_opportunity` with no inline text sets phase to idle, so the follow-up message is handled by the gate — the multi-turn flow cannot complete | `admin.ts:55` |
| DEF-10 | Low | Unrecognised callback data never calls `answerCallbackQuery`, so the Telegram spinner hangs | `bot.ts:94` |
| DEF-11 | Low | `COOLDOWN_DAYS` and `REVIEWER_TIMEOUT_HOURS` are declared but never read; 3 days and 48h are hardcoded. Behaviour matches the documented defaults, so this is a configurability gap, not a behavioural bug | `resolution.ts:170`, `timeout.ts:31` |
| DEF-12 | Low | `getOpportunities` reads range `A2:K` but reads `createdAt` from index 11 (column L), which is outside the range — it is always empty | `sheets.ts:31,43` |

---

## Part 11 — Sign-off

**Environment:** ____________  **Build / commit:** ____________
**Tester:** ____________  **Date:** ____________

| Part | Total | Pass | Fail | Blocked |
|---|---|---|---|---|
| 2 — Automated | 8 | | | |
| 3 — Gate | 17 | | | |
| 4 — Discovery | 14 | | | |
| 5 — Negotiation | 13 | | | |
| 6 — Review | 35 | | | |
| 7 — Resolution | 28 | | | |
| 8 — Admin | 17 | | | |
| 9 — Resilience | 10 | | | |

**Release recommendation:** ____________
