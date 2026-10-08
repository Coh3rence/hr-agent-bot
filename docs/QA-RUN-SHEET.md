# QA Run Sheet — final 12 cases (written 2026-10-07)

The execution companion to `QA-COMPLETION-PLAN.md`. Code work is finished — the
Phase E batch is committed locally at `a930d8b` (165 tests pass) and waits only
on the deploy window. Everything below is live QA. Tick boxes here as you go;
mark the Result column in `QA-VERIFICATION.md` after each case.

**Deadline: 2026-10-10.** Critical path: the friend's availability Oct 8–9.

---

## Session 1 — today, Oct 7 (Aleksa solo, ~15 min)

### G6 — Team view renders the hire — PASS 2026-10-07

1. [x] Open https://collabberry-frontend.vercel.app, sign in as org admin
       (wallet signature).
2. [x] Open the **Team** view.
3. [x] **PASS:** Gustavo (display name "Guena Cosa") shows as Community Manager,
       50% commitment, agreement icons present.

### G7 — marketRate conversion (same screen) — PASS 2026-10-07

4. [x] Open Gustavo's agreement detail.
5. [x] **PASS:** Market Rate column reads **$6,400** (= 40 × 160
       `FTE_HOURS_PER_MONTH`). App-side only — the sheet cannot prove this.

### G8 — consumed invite link refuses reuse — PASS 2026-10-07 (with caveat)

6. [x] Reuse attempted with a fresh wallet against the consumed 09-09 token.
7. [x] DB verified: token unchanged (`isActive=0, usageCount=1/1`), attempt
       refused org membership (`organization_id=NULL`).
8. [x] **Caveat:** refusal is server-side only — the frontend serves the full
       signup form before validating the token and leaves an orphaned Users row.
       Orphan `92a9a5cc` + the unused live invite `87903afd…` go on the D-e
       cleanup list. Logged as KNOWN-ISSUES §28 (upstream observation).

### C4 — graceful decline (LAST solo case) — FAIL 2026-10-08 (§31)

9. [x] Ran 2026-10-08. Two detours, both documented: free text in `review` phase
       is swallowed by design (§29 — needed `/start` → matching first), and the
       re-onboarding regenerated the contributor id, orphaning the E6 agreement
       (§30 — sheet repaired, ledger K9).
10. [x] **FAIL:** all three open roles were offered as tappable matches at 11–15%
        score. No match-score floor exists; the decline branch is unreachable
        (§31). Fix decision pending — a surgical filter could ride the Phase E
        deploy and C4 re-runs with one `/start`.

### Housekeeping

11. [x] G6, G7, G8, C4 marked in `QA-VERIFICATION.md`.
12. [ ] **Ping the friend** and lock a slot: Oct 8 after ~15:00 UTC, or Oct 9.

---

## Session 2 — Oct 8, 14:06–14:21 UTC (E6 + deploy)

### E6 — 48h escalation (the 32nd case; never run in history) — PASS 2026-10-08

1. [x] Untouched before the window (§30 orphaning repaired in time, ledger K9).
2. [x] **PASS:** escalated at 14:15:52Z (log: `no quorum: 0/2`), sheet row
       `escalated`, no counter-offer. Candidate correctly excluded from the DM
       pool; both reviewer DMs dispatched without errors. Gustavo/Simon asked to
       confirm receipt (non-blocking).
3. [x] Marked in `QA-VERIFICATION.md`.

### Phase E deploy (Claude drives, immediately after E6)

Deploy restarts the bot — only in a quiet window, never over an active review.

4. [ ] Confirm **no** agreement is `under_review`.
5. [ ] `railway up --service bot --ci` (uploads the working tree, not a git ref).
6. [ ] Verify by **build timestamp** — never by `git log`.
7. [ ] One-time header write: `supersededBy` into `Agreements!R1` on the prod
       sheet.
8. [ ] Ledger entry in `QA-REVERT-LEDGER.md` (REVERT vs KEEP split).

Ships: §24 submit guard `465a0a3`, §23 retire-on-commit `6ed1c34`, lineage
column `df642e3`, reviewer DM revision context `e6dbd54`, §26 parse_mode audit
`03a1ed7`, §31 match-score floor `ea5da9c` (added 2026-10-08 after C4 failed).
Deploying **before** Phase D is deliberate — D-2 exercises the new Modify
behavior.

9. [x] Post-deploy C4 re-run — **PASS** 2026-10-08: "No strong matches found
       right now. We'll keep your profile on file.", no buttons. First time the
       decline branch has ever fired in production. Recorded in
       `QA-VERIFICATION.md` next to the original FAIL.

---

## Session 3 — Oct 8 (post-deploy) or Oct 9 (Aleksa + friend + one reviewer)

### Phase C — onboard the 4th account (~5 min)

1. [ ] Friend sends `/start` to the bot.
2. [ ] **A2 PASS if:** access refused and **no opportunity data leaks**.
3. [ ] All three admins receive the access request with Authorize / Ignore
       buttons.
4. [ ] Tap **Authorize as Contributor** — **never Admin**: an admin account
       joins the reviewer pool and breaks the quorum arithmetic Phase D needs.
5. [ ] **A3 PASS if:** the friend can now proceed.

### D-1 — F2, E4, E5 on `opp_001` (Smart Contract Developer, $55–85/hr, 30–60%)

If a run spoils, retry on `opp_003` for a fresh round budget.

6. [ ] Friend onboards conversationally, selects `opp_001`, proposes **above
       budget** (e.g. $95/hr), submits for review.
7. [ ] One reviewer (Gustavo *or* Simon) **counters lower**; Aleksa **approves**.
8. [ ] **E4 PASS if:** the review closes at 2 of 3 — not unanimity.
9. [ ] Friend taps **Accept** on the counter.
10. [ ] **F2 PASS if:** the final row carries the **counter's** rate, not the
        $95 ask. *The most commercially important untested case in the campaign.*
11. [ ] The third reviewer taps afterwards.
12. [ ] **E5 PASS if:** the outcome is unchanged by the late tap.

### D-2 — D2 round cap + §19 (second round, same pair)

13. [ ] Round 2: reviewers counter again; friend taps **Modify**, revises,
        resubmits.
14. [ ] **D2 PASS if:** at the cap the bot refuses a third round, offering only
        Accept / Walk away. (Unit-tested 2026-10-01; never observed live.)
15. [ ] **§19 PASS if:** in a round with one approve + one reject, the friend
        **cannot** accept at their own asking rate — Modify / Walk away only.

### D-3 — F4 walk-away cooldown

16. [ ] Friend taps **Walk away** on a closed review.
17. [ ] **F4 PASS if:** the friend's Contributors row goes to status `cooldown`
        for 3 days, and a fresh `/start` is refused with the cooldown message.
        (No contributor has ever had status `cooldown`.)

---

## Done = 32/32

Afterwards: fill the remaining Result columns in `QA-VERIFICATION.md`, close the
ledger, and raise decision **D-e** with Gustavo (who cleans up the test
identities in the live org) — non-blocking but should not be a surprise.
