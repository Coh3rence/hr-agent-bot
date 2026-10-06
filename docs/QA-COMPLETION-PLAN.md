# QA Completion Plan — consolidated closeout

Written 2026-10-02. **This is the single document to work from.** It supersedes the
scattered picture across `QA-VERIFICATION.md`, `QA-TEST-PLAN.md`,
`KNOWN-ISSUES-AND-DECISIONS.md` and `QA-REVERT-LEDGER.md`, all of which remain
accurate as references but none of which state where the campaign stands or what
to do next.

**Status: 16 of the 32 cases in `QA-VERIFICATION.md` are proven live.** The other
16 are listed in §4–§7 below, each under the thing that unblocks it. Full
case-by-case evidence is in Appendix A; the open defects are in Appendix B.

---

## 1. Two corrections that reframe the campaign

**Section G — the Collabberry integration, labelled "the critical path" — was
already completed on 2026-09-09.** Agreement `a_1788962327012` is `approved` with
`betaAppAgreementId = 231b0916-c607-4fba-9a24-68d593dcfc3c`, and contributor
`c_1788807562702` (Gustavo, acting as the test candidate) is `hired` with a wallet
and a `collabberryUserId`. G1–G5 are proven. The campaign was being planned around
re-proving a section that was already done, because every Result column in
`QA-VERIFICATION.md` is blank and a finished section looked unstarted.

**The remaining work was scheduled behind the least controllable resource.** The
planned next run needed Gustavo *and* Simon to tap within 48h, on `opp_002`, where
the contributor is already at round 2 of 2 — so a missed window had no retry.
§3 removes that constraint.

---

## 2. Decisions needed before Phase D

> **Resolved 2026-10-05** (see `docs/CLOSING.md` §2): D-a **park**, D-b **yes** (backfill
> done), D-c **keep** (ledger R4 closed), D-d **approved by Gustavo** (retire-on-commit
> ships in Phase E; write-up is KNOWN-ISSUES §23). Only D-e (test-identity cleanup
> ownership) remains open — not blocking.

| # | Decision | Owner | Recommendation |
|---|---|---|---|
| D-a | Submit or park the standing `opp_002` draft `a_1790584489474` ($60/hr, round 2)? | Aleksa | **Park.** Aleksa is the contributor on that row, so its pool is only Gustavo + Simon — quorum 2 of 2, the exact dependency that stalled the campaign, with no retry left at the round cap. Everything it could prove is covered better from Phase D at a pool of 3. Safe parked indefinitely: the timeout sweep only touches `under_review` rows |
| D-b | Authorise the backfilled `QA-VERIFICATION.md`? | Aleksa | It is the client-facing acceptance record. Phase A drafts it; read the evidence before it becomes the version Gustavo sees |
| D-c | Delete or keep the 15 `_*_tmp.ts` scratch scripts? | Aleksa | Still listed as outstanding in `QA-REVERT-LEDGER.md` R4. They are gitignored and genuinely useful (`_statecheck_tmp.ts` and `_reachcheck_tmp.ts` were both used this week). Recommend keeping, and closing R4 by recording them as deliberate QA tooling rather than residue |
| D-d | **§23 — change the Modify flow to retire-on-commit?** | **Gustavo** | A design change to a flow he specified, not a bug fix, and it trades directly against the hazard retire-on-tap was introduced to close (`resolution.ts:205-207`). Needs his call. Phase A writes the proposal with the real round history attached |
| D-e | Test identities in the live Collabberry org | **Gustavo** | The 09-09 run left him in the Team view as a `hired` Community Manager at $40/hr, and Phase D adds another test identity. Agree a heads-up and who cleans up, rather than a surprise |

---

## 3. The change that unblocks everything else

Add a **4th Telegram account as a contributor** (not an admin).

The review pool is every admin *except* the contributor (`reviewRecipients`,
`quorum.ts`). With a non-admin candidate the pool becomes all three admins, so
quorum is `floor(3/2)+1 = 2` — **Aleksa casts one of the two required votes
himself, and only one of Gustavo or Simon is needed.** Three consequences:

1. The reviewer dependency halves, from two people to one.
2. E4 and E5 become observable live for the first time. At a pool of 2,
   `floor(2/2)+1 = 2` makes majority and unanimity identical and leaves no third
   reviewer to respond late, so neither case was testable at all.
3. Rounds are scoped per **(contributor, opportunity)** and count only reviews
   that closed (`nextRoundFromHistory`, `sheets.ts:20`), so a fresh pair restores
   a full budget of 2 — **runs become retryable** instead of one-shot.

Note that production self-review is not an option: `selfReviewAllowed` requires
`NODE_ENV=development` **and** `ALLOW_SELF_REVIEW=true` (`config.ts:58`), so it
cannot activate in prod. A separate account is the only route to a pool of 3.

---

## 4. Phase A — documentation (Claude, no live dependency)

- [x] **Round-cap unit test.** Done 2026-10-01 — 3 tests asserting Modify is
      refused at `negotiationRound >= MAX_NEGOTIATION_ROUNDS`, mutation-verified
      (2 fail with the cap disabled). Suite 131 pass, typecheck clean.
- [x] **Backfill all 32 Result columns** in `QA-VERIFICATION.md` from Appendix A.
      Done 2026-10-05 (D-b approved).
- [x] **Write §23** (retire-on-tap) in `KNOWN-ISSUES-AND-DECISIONS.md`, grounded
      in the 09-23 → 09-28 round history, as the proposal for decision D-d.
      Done 2026-10-05.
- [x] **Log the submit-guard defect** (Appendix B, issue 4) — now
      `KNOWN-ISSUES-AND-DECISIONS.md` §24. Done 2026-10-05.
- [x] **Correct ledger item K7** in `QA-REVERT-LEDGER.md`. Done 2026-10-05, with
      the correction noted inline.

Nothing in this phase touches the running bot.

---

## 5. Phase B — the solo cases (Aleksa, ~20 min, needs nobody)

Nine cases, no contributor account and no reviewer required. Takes the campaign
from **16/32 to 25/32**.

### Admin commands — B1 to B4

Run as an admin in Telegram. All three opportunities carry an identical
`createdAt` of `2026-03-05T01:13:24.778Z`, so they were seeded into the sheet
rather than created through the bot, and all three are still `open` — **B2 and B4
have certainly never run.** This section substantiates the client-facing claim at
`QA-VERIFICATION.md:71` that "the admin never edits the spreadsheet directly", so
the seeded timestamps are mild evidence against the doc's own premise.

- [ ] **B1** `/list_opportunities` → roles returned with budget and status
- [ ] **B2** `/add_opportunity` → new role appears in B1 *and* in the sheet
- [ ] **B3** `/edit_opportunity` → change persists and shows in B1
- [ ] **B4** `/pause_opportunity` → role stops being offered to new contributors

Use the role created in B2 as the subject of B3 and B4, so nothing touches
`opp_001`–`opp_003` and Phase D's fixtures stay clean.

### Graceful decline — C4

- [ ] **C4** From a contributor conversation, offer skills unrelated to any open
      role (e.g. "veterinary surgery, equine dentistry"). The bot must decline
      gracefully rather than force a bad match

### Beta app inspection — G6, G7, G8

- [ ] **G6** Open the frontend Team view at https://collabberry-frontend.vercel.app
      as org admin → Gustavo renders with the agreement at $40/hr, 50%
- [ ] **G7** In the same view, the agreement `marketRate` must be **6400**
      (= 40 × 160, `FTE_HOURS_PER_MONTH`). Not verifiable from the sheet —
      `marketRate` is stored app-side only, which is why this pairs with G6
- [ ] **G8** Re-open the consumed invite link with token
      `06ceee59-545e-452e-a836-5669f9115bf4` → second redemption must be refused
      cleanly. Reuse the original link the bot sent if you still have it, rather
      than hand-assembling the URL

### Escalation — E6

- [ ] **E6** Submit any proposal and answer nothing for 48h. The sweep runs every
      15 min and must move the row to `escalated` and notify admins

Start E6 **early** — it costs elapsed time rather than attention, and can run
alongside everything else. No agreement has ever reached status `escalated`, so
this has definitively never run. Use the B2 role with a throwaway proposal so it
does not consume a round on a Phase D fixture.

---

## 6. Phase C — onboard the 4th account (Aleksa, ~5 min)

- [ ] New Telegram account sends `/start`
- [ ] **A2** Access is refused and no opportunity data leaks
- [ ] All three admins receive the access request with Authorize / Ignore buttons
- [ ] **A3** Tap **Authorize as Contributor** → the user can now proceed

**Contributor, not Admin.** Admin would add the account to the reviewer pool and
subscribe it to admin broadcasts. The quorum arithmetic in §3 depends on it being
outside the admin list.

---

## 7. Phase D — the one-reviewer runs (Aleksa + one of Gustavo/Simon)

Run the 4th account against `opp_001` (Smart Contract Developer, $55–85/hr,
30–60% commitment), which has a clean round budget. If a run spoils, move to
`opp_003` for a fresh budget and retry.

### D-1 — F2, E4, E5

- [ ] Candidate asks **above** budget; one reviewer counters lower; Aleksa approves
- [ ] **E4** Review closes at 2 of 3 — not unanimity
- [ ] **F2** Candidate accepts the counter; the final row carries the **counter's**
      rate, not the ask
- [ ] **E5** The third reviewer taps afterwards; the outcome is unchanged

**F2 is the most important untested case in the campaign.** It is the one with
real commercial consequence — a reviewer's counter actually binding the hire rate
— and it has only ever run against a seeded harness row (2026-09-14), never live.

### D-2 — D2 and §19

- [ ] Second round on the same pair: counter again, candidate taps **Modify**
- [ ] **D2** The cap refuses, offering only Accept / Walk away. Unit-tested
      2026-10-01; never observed live
- [ ] **§19** A round with one approve and one reject — the candidate must not be
      able to accept at their own ask. Also harness-only today

### D-3 — F4

- [ ] **F4** Candidate walks away → 3-day cooldown on the Contributors row. No
      contributor has ever had status `cooldown`, so this has never run

---

## 8. Phase E — code changes (deploy only when no review is in flight)

Deploying restarts the bot, so these wait until Phase D is quiet. Railway's
`railway up --service bot --ci` uploads the **working tree**, not a git ref —
confirm any deploy by build timestamp, never by `git log`.

- [ ] **Markdown** (Appendix B, issue 2)
- [ ] **Reviewer DM revision context** (issue 3)
- [ ] **Submit status guard** (issue 4)
- [ ] **Agreements lineage column** (issue 5)
- [ ] **§23 retire-on-commit** — approved (D-d, 2026-10-05); land after the submit guard

---

## Appendix A — all 32 cases with evidence

### Proven live (16)

| Case | Evidence |
|---|---|
| A1 | Both contributors onboarded via `/start` (2026-09-07, 2026-09-23) |
| C1 | Skills extracted conversationally into both Contributors rows |
| C2 | Rows fully populated — skills, commitment %, rate min/max, timezone, location |
| C3 | `settlementLikelihood` populated on every agreement row |
| D1 | `opp_002` budget is $45–70: ask $75 → likelihood 74; ask $60 → 92 |
| D3 | `a_1790186286202` submitted 2026-09-23T17:58:06Z, both reviewers notified |
| E1 | Gustavo and Simon both received the proposal and acted on it |
| E2 | Simon approve recorded 2026-09-24T20:53:20Z |
| E3 | Gustavo counter recorded 2026-09-24T09:12:53Z, `suggestedRate = 60` parsed and stored |
| F1 | `aggregatedRate = 60` + coherent prose in column N, written 2026-09-24T20:53:29Z |
| F3 | `a_1788962327012` status `approved` |
| G1 | `collabberryInviteToken = 06ceee59-545e-452e-a836-5669f9115bf4` |
| G2 | `collabberryUserId = e2a00877-9249-4fcc-a037-2943ba60d534` |
| G3 | `walletAddress = 0x290a26a086d4ee4437c80aa1d669576cb7512061` + on-chain agreement created |
| G4 | `c_1788807562702` status `hired`, wallet and userId both populated |
| G5 | `betaAppAgreementId = 231b0916-c607-4fba-9a24-68d593dcfc3c` |

### Not run (16)

| Case | Blocked on | Phase |
|---|---|---|
| B1, B2, B3, B4 | nothing | B |
| C4 | nothing | B |
| G6, G7, G8 | nothing — beta app inspection | B |
| E6 | nothing — 48h elapsed time | B |
| A2, A3 | 4th account | C |
| F2 | 4th account + 1 reviewer | D-1 |
| E4, E5 | pool of 3 — not observable at all before then | D-1 |
| D2 | two closed rounds | D-2 |
| F4 | a closed review to walk away from | D-3 |

Two are definitively never-run rather than merely unrecorded: no agreement has
ever had status `escalated` (E6), and no contributor has ever had status
`cooldown` (F4).

### Regression, not a gap

Re-running section G end to end on current code. The 09-09 run predates the §19
(09-14), §20 (09-22), §21 and §22 (09-24) deploys, but none of those touched the
accept → invite → wallet-link → on-chain path. Worth doing once; not worth
blocking on.

---

## Appendix B — open defects

| # | Issue | Location | Disposition |
|---|---|---|---|
| 1 | **§23 — retire-on-tap.** Tapping Modify supersedes the agreement *before* any new terms are stated, so merely exploring a revision destroys the standing offer irrecoverably. Witnessed live 2026-09-28 | `resolution.ts:208` | Write-up Phase A; fix gated on decision D-d |
| 2 | **Literal `**` reaches the user.** Model prose is sent with no `parse_mode`. Separately, `**bold**` never renders at any of the 11 existing `parse_mode` sites — Telegram legacy Markdown wants single `*`, so the asterisks are silently swallowed | `negotiation.ts:158`, `discovery.ts:189` | Phase E. **Naive `parse_mode: "Markdown"` is the wrong fix** — unbalanced `*` or `_` in model output raises a Telegram 400 `can't parse entities` and the entire message is dropped. **Proven live 2026-10-05 (§26):** every `/add_opportunity` confirmation dies this way — the `_` in `opp_<timestamp>` is an unclosed entity, from a static template |
| 3 | **Reviewer DM carries no revision context** — rendered from the agreement row alone: no round number, no prior terms, no indication it is a revision. Made two DMs character-for-character identical on 2026-09-09 | `notifyReviewers`, `review.ts:352` | Phase E. Amplifies issue 1 |
| 4 | **`review:submit:` has no status guard.** Every other callback path was hardened — `ensureOpenForReview` for reviewer taps (§14), the candidate-side check in `handleResolution` (§19) — but submit writes `under_review` unconditionally. A tap on a stale draft's Submit button resurrects a dead row and DMs reviewers withdrawn terms: the §14 hazard arriving through the one door left open. Found 2026-10-02, not reproduced live | `review.ts:19-21` | Phase E. Mitigated only by `review:modify:` stripping the keyboard of the draft it retires, so the exposure is drafts retired by other routes |
| 5 | **No lineage column** on Agreements — `superseded` records *that* a row died, not what replaced it, so the sheet cannot show that one proposal superseded another | Agreements tab | Phase E |
| 6 | **Section B premise unproven** — identical seeded `createdAt` values are mild evidence against the client-facing claim that all changes go through the bot | `QA-VERIFICATION.md:71` | Closed by Phase B |
| 7 | **Ledger K7 is factually wrong** — states neither reviewer had responded at the §22 deploy; Gustavo countered 9h before the build | `QA-REVERT-LEDGER.md` | Phase A |
| 8 | **All 32 Result columns blank** — the bookkeeping failure that made a finished section G look unstarted and misdirected the campaign | `QA-VERIFICATION.md` | Phase A, gated on D-b |
| 9 | **Every opportunity edit fails, and the retry would have corrupted data (§27).** Schema drift: the sheet has 11 columns, the code writes 12 → Google 400 on every `/edit_opportunity` and `/pause_opportunity`, uncaught, silent. Separately the partial-edit merge rebuilds ranges with `\|\| 0` defaults — "raise max to 80" carried `hourlyRateMin: 0`. **Proven live 2026-10-06; B3 FAILED, B4 blocked** | `sheets.ts:115-132`, `admin.ts:190-200` | **Must fix before B3/B4/§19-reopen can run** — the one defect that blocks live cases rather than merely annoying them. Fix both halves together in Phase E (pulled forward to 2026-10-06) |

---

## Appendix C — operational notes

- **Production is only reachable via `railway run --service bot bun _<script>_tmp.ts`.**
  The local `.env` points at a *different* sheet. A scratch script run without
  `railway run` reads and writes the wrong spreadsheet.
- **Never use `getUpdates`** in a scratch script — it terminates the live
  long-poll. `_reachcheck_tmp.ts` uses `getChat`, which has no side effect.
- Reviewer reachability confirmed 2026-10-02: Gustavo Segovia (@sepu85,
  `302836662`), Simon Q (@qbfrank, `1971913512`), Aleksa (@aleksaprosperitylabs,
  `535329585`) — all three reachable by the bot.
- Live build is the §22 deploy, `2026-09-24 20:37 +02:00`. Nothing deployed since.
