# Closing — session handoff for the QA closeout

Written 2026-10-05. **Deadline: full delivery by 2026-10-10.**

This is the pick-up point for the next session. The authority on *what* remains
and *why* is `docs/QA-COMPLETION-PLAN.md` (2026-10-02) — read it first. This doc
adds only what that one cannot know: the state verified on 2026-10-05, the agreed
day-by-day schedule, and the pending human decisions.

---

## 1. State as of 2026-10-05 evening — **Phase A is DONE**

- **16 of 32 cases proven live**, all now recorded with evidence in
  `QA-VERIFICATION.md` (backfilled 2026-10-05; the other 16 marked *Not yet run*
  with what's scheduled).
- **Phase A complete:** round-cap test committed (`298c9f6`); §23 (retire-on-tap)
  and §24 (submit guard) written into `KNOWN-ISSUES-AND-DECISIONS.md`; ledger K7
  corrected; ledger R4 closed as KEEP.
- **Nothing deployed since the §22 build**, `2026-09-24T18:37:16Z`.
- Phases B, C, D, E: not started. The 4th account will be **a friend of Aleksa's**,
  onboarding imminent.

## 2. Decisions — resolved 2026-10-05 except Gustavo's

| # | Decision | Owner | Status |
|---|---|---|---|
| D-a | Park the `opp_002` draft `a_1790584489474` | Aleksa | **DECIDED: parked** — safe indefinitely, sweep only touches `under_review` |
| D-b | Authorize the QA-VERIFICATION.md backfill | Aleksa | **DECIDED: yes** — backfill done 2026-10-05 |
| D-c | Keep the `_*_tmp.ts` scratch scripts | Aleksa | **DECIDED: keep** — ledger R4 closed as deliberate QA tooling |
| D-d | §23 retire-on-commit design change | **Gustavo** | Proposal written (KNOWN-ISSUES §23) — message not yet sent. **Gates the last Phase E item** |
| D-e | Test identities in the live Collabberry org | **Gustavo** | Not yet asked — bundle with the D-d message |

## 3. The compressed schedule (re-agreed 2026-10-05: target close Oct 7)

The 48h escalation test is the floor — nothing closes in under two days.

| Day | Date | Work |
|---|---|---|
| 1 | Oct 5 | ~~Phase A~~ DONE · message Gustavo+Simon (ignore-E6 warning, D-d, D-e, tomorrow's availability) · Phase B solo cases (→25/32) · **start E6** · Phase C: friend's account onboards as Contributor (A2/A3) |
| 2 | Oct 6 | D-1 on `opp_001` morning (F2, E4, E5) · D-2 + D-3 afternoon, same pair (D2 cap, §19, F4 walk-away) · write Phase E code locally, no deploy |
| 3 | Oct 7 | E6 48h elapses → verify `escalated` + admin notify → **32/32** · deploy Phase E (nothing in review by then), verify by **build timestamp** · §23 fix only if D-d answered, else record as open · final ledger + QA-VERIFICATION updates · deliver |

Slack days Oct 8–10 exist if reviewers are slow; the plan above is the fast path.

**Critical-path logic:** E6 costs 48 elapsed hours → must start Day 1. Phase D is
three *sequential* runs each needing one reviewer tap (only 1 of Gustavo/Simon
per round, thanks to the pool-of-3 from the 4th account). The main risk is both
reviewers going dark 2+ days — nothing on our side fixes that.

## 4. Gotchas the next session must not rediscover

- **E6 heads-up first.** The throwaway proposal DMs Gustavo and Simon, who must
  *not* tap for 48h. Tell them to ignore it *before* submitting, or the test is
  spoiled on first contact.
- **The 4th account must be authorized as Contributor, not Admin** — Admin would
  join the reviewer pool and break the quorum arithmetic the whole of Phase D
  rests on (`QA-COMPLETION-PLAN.md` §3).
- **Prod is only reachable via `railway run --service bot bun _<script>_tmp.ts`** —
  local `.env` points at a different sheet. Never `getUpdates` in a scratch
  script (kills the live long-poll; use `getChat`).
- **`railway up` uploads the working tree, not a git ref.** Verify any deploy by
  build timestamp, never `git log`. Deploy only when no review is in flight.
- Use the B2-created role for B3/B4 and the E6 throwaway so `opp_001`–`opp_003`
  stay clean as Phase D fixtures.
- Every production change gets a ledger entry in `docs/QA-REVERT-LEDGER.md`
  (REVERT vs KEEP); log new findings into `KNOWN-ISSUES-AND-DECISIONS.md` as
  discovered, with live evidence.

## 5. First actions on pick-up

1. Read `docs/QA-COMPLETION-PLAN.md`.
2. Check which tasks above already happened (git log, QA-VERIFICATION Result
   columns, KNOWN-ISSUES §23, ledger K7, AuthorizedUsers row count for the 4th
   account, any agreement with status `escalated`).
3. Resume at the first unfinished row of the Day schedule in §3, adjusted for
   the actual date — E6's 48h window and the Phase D reviewer dependency are the
   two clocks that cannot compress.
