# QA revert ledger

Every change made to **production** (Railway service `bot`, Google Sheet
`1qM9_Ppm7nmY0EL9eHmQEn-qHZm0q8ESIzlGz70XEvt0`) during the 2026-09-11 → 2026-09-12 QA work,
with how to undo it. Two classes: **KEEP** (a real fix or an intended
remediation) and **REVERT** (test scaffolding that must not survive handover).

---

## REVERT — before any client-witnessed run

> **Status 2026-10-05: R1–R5 are all closed.** Production config is back to its
> pre-QA state and the client's sheet holds only real rows. R4 was closed by decision
> D-c (2026-10-05): the scratch scripts are **kept as deliberate QA tooling**, not deleted.
> One residual, not blocking a client run: the unredeemed beta-app invite noted under R5,
> which no script in this repo can remove.

### R1. `ANTHROPIC_MODEL` is overridden to Haiku — **DONE 2026-09-22**
- **Set to:** `claude-haiku-4-5-20251001` on the Railway `bot` service.
- **Was:** unset — the code default is `claude-sonnet-4-5-20250929` (`src/config.ts`).
- **Why:** cut LLM spend during QA.
- **Revert:** `railway variables --service bot --set ANTHROPIC_MODEL=claude-sonnet-4-5-20250929`
  (or remove the variable to fall back to the default), then redeploy.
- **Why it matters:** reviewer aggregation is the feature the client calls the
  product's differentiator. Do not demo it on Haiku.
- **DONE 2026-09-22:** reverted by `railway variables delete ANTHROPIC_MODEL --service bot`,
  i.e. restored to genuinely unset rather than pinned, so the live model is whatever
  `src/config.ts` ships. The deployed model is therefore auditable from the repo instead of
  from invisible platform config. Verified two ways, neither of them "a deploy happened":
  the variable is absent from `railway variables --kv`, and `_modelcheck_tmp.ts` run under
  `railway run --service bot` prints `configured model: claude-sonnet-4-5-20250929` and gets
  a live reply back.

### R2. Seeded QA contributor row — **DONE 2026-09-22**
- **Added:** `Contributors` row `c_qa_1789223297207`, telegramId `535329585`,
  name `Aleksa (QA)`, status `active`.
- **Revert:** delete the row. Nothing else references it once R3 is gone.
- **Note:** `535329585` had no contributor row before this; deleting restores
  that. Do not touch `c_1788807562702` (Gustavo, `hired`, real).
- **DONE 2026-09-22:** deleted via `_qacontribclean_tmp.ts`, which carries the same id guard
  as `_qa6clean_tmp.ts` (refuses anything not `c_qa*`) plus one extra check — it refuses while
  any agreement still references the contributor, so the R3 rows cannot be orphaned by doing
  these in the wrong order. Row as deleted, for the record:
  `c_qa_1789223297207 | 535329585 | aleksaprosperitylabs | Aleksa (QA) | React, TypeScript,
  TailwindCSS, wagmi | 60 | 75 | 75 | CET | Serbia | active | | 0 | 2026-09-12T14:28:17.207Z |
  (no wallet) | (no collabberryUserId) | inviteToken 87903afd-ee4c-4157-9d48-e7928709c159`.
- `Contributors` is now a single row — `c_1788807562702` (Gustavo, `hired`), untouched.

### R3. Seeded QA agreement + simulated reviewer rows
- **Added:** `Agreements` row `a_qa6_1789223297207` (opp_002, $75/hr, 60%,
  6 months, `under_review`), plus its aggregation columns M/N and
  `candidateNotifiedAt`.
- **Added:** two `ReviewFeedback` rows for `a_qa6_1789223297207`, attributed to
  reviewer ids `302836662` and `1971913512` with reviewer names prefixed
  `QA-SIM reviewer …` so they are identifiable as synthetic.
- **Why the real reviewer ids:** `isReviewComplete` only counts responses from
  ids inside the pool, so a fake id would not reach quorum and the scenario
  would not run. **No message was sent to either person** — the harness skips
  the `review:submit:` tap, which is the only code path that DMs reviewers.
- **Revert:** delete the agreement row and both feedback rows —
  `bun _qa6clean_tmp.ts <agreementId>` does exactly this.
- **DONE for `a_qa6_1789223297207`** (deleted 2026-09-12). Deleted rather than
  superseded because at that moment the candidate-side Accept button had no
  status guard, so superseding would have left a live button; a missing row
  makes the handler fail closed. That guard now exists (§19 of KNOWN-ISSUES),
  but deletion remains the cleaner cleanup since it removes the test data too.
  Any later re-run creates a fresh `a_qa6_*` id that must be cleaned the same way.
- **STILL TO CLEAN (2026-09-12):** `a_qa6_1789226741319` (split approve/reject —
  §19 verification) and `a_qa6_1789226816573` (counter at $60 — §11 regression).
  Both left in place so the candidate-side buttons can be tapped by hand; run
  `bun _qa6clean_tmp.ts <id>` on each when done.
- **DONE 2026-09-22 — both cleaned.** `a_qa6_1789226741319` (1 agreement + 2 feedback rows) and
  `a_qa6_1789226816573` (1 agreement + 2 feedback rows), 6 rows total. `a_qa6_1789226741319`
  was the more important of the two to remove: it was still `under_review` and its stored
  aggregation held the literal `[relevant area]` copy — the exact text §20's guard now refuses,
  sitting in the client-visible record.
- **Verified after:** `Agreements` back to its 4 real rows (`a_1788808260898`,
  `a_1788858346291`, `a_1788858438270` superseded; `a_1788962327012` approved with beta app id
  `231b0916-…`), `ReviewFeedback` back to its 6 real rows, and a grep for `qa6|c_qa_|QA-SIM`
  across all three tabs returns 0.
- **Reminder:** `_qa6clean_tmp.ts` must be run through `railway run --service bot`,
  or it will look for the rows in the dev sheet and find nothing. See the trap in R4.

### R5. Side effects of the 2026-09-14 Accept tap
Accepting `a_qa6_1789226816573` by hand (to verify §11 reconciliation) wrote three
things beyond the agreement row:
- **Agreement terms rewritten:** `hourlyRate` `75` → `60`, status `under_review` →
  `approved`. This is the *correct* behaviour under test, not a defect.
- **Contributor `c_qa_1789223297207` now holds `collabberryInviteToken`**
  `87903afd-ee4c-4157-9d48-e7928709c159`. Was empty.
- **A real, unredeemed invite exists in the Collabberry beta app** for that token —
  created by `ctx.beta.createInviteLink()`, which calls the live backend.
- **Revert:** deleting the contributor and agreement rows (R2/R3) clears the sheet
  side. The beta-app invite is *not* removed by that and will linger unredeemed.
  It was never signed up against, so no member or on-chain agreement was created —
  the "I've signed up" tap was deliberately not performed.
- **SHEET SIDE DONE 2026-09-22** with R2/R3. **The beta-app invite is the one residual of the
  whole QA effort:** token `87903afd-ee4c-4157-9d48-e7928709c159` still exists unredeemed in the
  Collabberry backend, and nothing in this repo deletes it — it was created by a live
  `createInviteLink()` call. It is inert (no member, no on-chain agreement, and the sheet row
  that carried it is gone, so the bot can no longer surface it to anyone). Flag it to whoever
  owns the beta app if unredeemed invites are ever audited.
- **Why it was allowed to happen:** proving the candidate is hired at the reviewers'
  rate rather than their own ask requires a genuine tap; no dry run exercises
  `updateAgreementTerms`. Accepted cost, recorded rather than avoided.

### R4. Local scratch scripts — **CLOSED 2026-10-05, resolution: KEEP (decision D-c)**
- Reclassified from residue to **deliberate QA tooling**. They are gitignored so they never
  reach the client repo, and they stay in active use (`_statecheck_tmp.ts` and
  `_reachcheck_tmp.ts` were both used the week of 2026-09-29). Nothing to revert; the
  "delete at handover" instruction below is superseded by this decision.
- `_addadmin_tmp.ts`, `_authlist_tmp.ts`, `_fixrate_tmp.ts`, `_gate_tmp.ts`,
  `_guardwire_tmp.ts`, `_keycheck_tmp.ts`, `_modelcheck_tmp.ts`, `_proddump_tmp.ts`,
  `_previewagg_tmp.ts`, `_qa6_tmp.ts`, `_qa6clean_tmp.ts`, `_qacontribclean_tmp.ts`,
  `_reachcheck_tmp.ts`, `_statecheck_tmp.ts`, `_supersede_tmp.ts`.
- `_previewagg_tmp.ts` is the counterpart to `_reachcheck_tmp.ts` for the aggregation: it calls
  `aggregateFeedback` directly with real recorded feedback, so it answers "what copy would the
  candidate get" **without writing a row, sending a DM or changing a status**. It is how the
  2026-09-24 mixed verdict was validated while a reviewer was still outstanding.
- `_reachcheck_tmp.ts` is worth reading before deleting: it calls Telegram `getChat` per
  reviewer id, which answers "has this person opened the chat with the bot" **without sending
  them anything**. That question otherwise fails silently — an unreachable reviewer stalls
  quorum with no error. Do not reach for `getUpdates` instead; it terminates the live
  long-poll and crashes the running bot.
- Gitignored (`.gitignore` `_*_tmp.ts`), so they never reached the client repo.
- **Revert:** `rm _*_tmp.ts` before handover.
- **Trap — these scripts read whatever env they are given.** Local `.env` points at a
  *different* spreadsheet than Railway. Run them plain (`bun _statecheck_tmp.ts`) and
  you are inspecting the dev sheet; the production sheet is only reached via
  `railway run --service bot bun _statecheck_tmp.ts`. Every QA row listed in R2/R3 was
  written through `railway run`. Reading the dev sheet by mistake shows an almost-empty
  database and invites the conclusion that production has been wiped.

### R6. The QA tester holds an `admin` row — **OPEN, 2026-10-14**

- **Set to:** `AuthorizedUsers` row 5 = `8983159792, admin` (Nikola, the QA tester).
- **Was:** `8983159792, contributor`, present **three times** (DEF-5 — repeated
  taps of the inline Authorize button appended a row each time). The two
  duplicates were deleted in the same operation, so DEF-5 is closed for this id.
- **Why:** the closeout needs a reviewer who only ever taps **Approve** — Counter
  requires typing a rate and Reject a reason, so an approve-only reviewer is the
  one genuinely button-only seat. With Aleksa as the candidate the pool becomes
  Gustavo + Simon + Nikola = 3, quorum 2, the same arithmetic that passed E4.
- **Why it must be reverted:** `admin` is not only the reviewer pool, it is also
  the admin-command gate (`isAdmin` → `/add_opportunity`, `/edit_opportunity`,
  `/pause_opportunity`). An outside tester must not keep write access to the
  client's live opportunity rows after the campaign.
- **Revert:** set row 5 column B back to `contributor` (one row, not three), or
  delete the row outright if the tester should lose access entirely.
- **Trap worth knowing:** `reviewRecipients` (quorum.ts:132) does **not** dedupe
  and `respondedWithinPool` counts by filtering the pool list, so a *duplicate*
  admin row would inflate the pool and double-count that reviewer's response.
  Promote by editing one row — never by tapping "Authorize as Admin" again.

### R7. Stale round-2 draft retired on the Aleksa + `opp_002` pair — **CLOSED 2026-10-14, resolution: KEEP**

- **Set to:** `Agreements!J7` (`a_1790584489474`) `draft` → `superseded`, via
  `_supersede_tmp.ts` run with `NODE_ENV=production`. `supersededBy` (column R)
  deliberately left empty — the successor did not exist yet.
- **Was:** `draft`, round 2, $60/hr at 60% for 3 months, never submitted for review.
- **Why:** Cycle 1 re-proposes round 2 on this pair, and a dead draft left in
  `draft` is indistinguishable from a live one to anyone reading the sheet.
- **Resolution KEEP:** the row is genuinely dead and `superseded` is what the
  deployed code writes when a draft is retired (§23). Reverting would only
  restore a lie. Round numbering is untouched either way — `nextRoundFromHistory`
  counts reviewed rows, and this one never was (`next round: 2` before and after).
- **It did not do what it was meant to.** The stated reason was to stop the
  round-2 reviewer DM quoting the dead row's terms, and it does not:
  `priorTermsFromRows` ignores column J and still picked the draft. That is
  **§33**, fixed in code the same day, not fixed by this write.
- **Guards used:** the script refuses any id but `a_1790584489474`, any
  spreadsheet but the production one, and asserts the row's contributor,
  opportunity, round and `draft` status before writing.

### R8. The C4 no-match profile replaced on the QA candidate's row — **OPEN, 2026-10-14**

- **Set to:** `Contributors!E3` (`c_1790157082079`, Aleksa) = `React, TypeScript,
  TailwindCSS, Web3, community management, DAO governance, content writing`.
- **Was:** `veterinary surgery, equine dentistry` — the deliberate poor-fit profile
  written for C4.
- **Why:** C4 has passed twice over (FAIL pre-floor, PASS post-floor), so the
  profile has done its job. With §31 live it now *blocks* the remaining tests: the
  vet profile scores every open role below 50, so the candidate gets the graceful
  decline and can never reach negotiation. Cycle 1 (D2 + Modify) needs `opp_002`
  and Cycle 2 (§19 + F4) needs `opp_003`.
- **Chosen by probe, not by guesswork** (`_matchprobe.ts`, live Sonnet + the real
  open opportunities): vet → nothing above the floor; frontend-only → `opp_002` 95
  but `opp_003` below; the combined profile → `opp_002` **95**, `opp_003` **88**,
  with `opp_001` still below the floor. One write covers both cycles and leaves no
  wrong button to tap.
- **Only column E changed.** `id`, `telegramId`, rate (50–50), commitment (50%) and
  status (`active`) are untouched — verified after the write.
- **Deliberately not done through the bot:** re-onboarding would have regenerated
  the contributor id (§30, still OPEN) and orphaned `a_1790186286202`, the reviewed
  round 1 that the D2 round-cap test counts.
- **Revert:** set `Contributors!E3` back to `veterinary surgery, equine dentistry`
  if C4 ever needs re-running; otherwise this is only QA test data on a QA row and
  can be left or the row retired with R2.

### R9. The QA candidate is in cooldown, and the Cycle 1 agreement is `rejected` — **OPEN, 2026-10-16**

- **Set to:** `Contributors` `c_1790157082079` (Aleksa) status `cooldown`,
  `cooldownUntil 2026-10-19T12:33:11.776Z`; `Agreements` `a_1792023040163`
  status `under_review` → `rejected`.
- **Was:** contributor `active` with no cooldown; the agreement `under_review`
  holding a closed 2-of-3 verdict (Simon approve, Nikola counter 65) and an
  `aggregatedRate` of 65.
- **Written by the bot, not by hand** — the candidate tapped **Walk away** on the
  capped counter-offer. This is F4, the last unrun case in the verification
  document, and the first time any contributor has held status `cooldown`.
- **Why it matters for 3 days:** the cooldown gate refuses a new application from
  this row until 2026-10-19T12:33Z. Any further live run on *this* candidate is
  blocked until then — including a re-run of D2 or §19, both of which need to
  reach negotiation. Nothing in the deliverable needs it, but a session that
  starts on 2026-10-17 and finds the bot declining Aleksa should look here first
  rather than suspecting the gate.
- **Revert:** clear `status` back to `active` and empty `cooldownUntil` on
  `c_1790157082079`. The agreement's `rejected` status should **not** be reverted
  — it is the true outcome of a real tap and the evidence F4 rests on.
- **Resolution deferred:** keep until the campaign is signed off. If the client
  wants a clean slate at handover, this row is QA test data and R2 retires it
  wholesale, which supersedes this entry.
- **Cooldown half REVERTED 2026-10-16** (`_clearcool_tmp.ts`, `--apply`, K:L of
  row 3 only): `cooldown` → `active`, `cooldownUntil` emptied. Verified after the
  write — id, telegram id, handle and skills unchanged.
  **Both halves of the evidence were banked first**, which is the only reason
  this was safe to do: F4 recorded the stored value and its timestamps, and FU-4
  recorded the gate actually refusing a `/start` with the verbatim 3-day message.
  Cleared so the same account could serve as the candidate in the closing session
  the same day instead of idling until 2026-10-19T12:33Z.
  The agreement's `rejected` status was **not** touched — it remains the true
  outcome of a real tap.

---

## KEEP — intended changes, do not undo

### K1. Railway volume + `SESSION_DIR`
- `bot-volume` mounted at `/data`; `SESSION_DIR=/data/sessions`.
- This is what makes the committed session-persistence fix actually work.
  Removing it silently reverts sessions to an ephemeral container path.
- Tell: the boot line `Sessions persisted to /data/sessions`.

### K2. Three stale proposals closed
- `a_1788808260898`, `a_1788858346291`, `a_1788858438270` moved from
  `under_review` to `superseded` on 2026-09-11.
- **Why:** reviewer inline keyboards stay tappable until the status leaves
  `under_review`, so a tap today would have filed a verdict on a settled
  proposal from the 2026-09-09 run.
- `a_1788962327012` (`approved`, beta app id `231b0916-…`) is the real
  outcome of that run and was deliberately left untouched.

### K4. §19 fix deployed 2026-09-14
- Commits `0feade5`, `4847862`, `8f3dde7` pushed to `main`, then `railway up --ci
  --service bot`. Build `2026-09-14T09:08:50Z` (previous: `2026-09-11T13:28:33Z`).
- **Note for anyone auditing what is live:** `railway up` uploads the *working
  tree*, not a git ref. The deployed build is whatever was on disk at that moment,
  which is why the older §14-family fix (dated 2026-09-08) also went live here.
  Always confirm against the build timestamp, never against `git log`.

### K3. Code + docs shipped in `98a4cde`
- `ANTHROPIC_MODEL` made env-overridable (`src/config.ts`), model lifted out of
  the two hardcoded call sites (`src/services/claude.ts`), status docs updated.
- The *code* stays. Only the production *value* is temporary — see R1.

### K5. §20 summary guard deployed 2026-09-22
- Commits `be4e20a` (guard + wiring + 14 tests), `ac8e8fc` (harness model id),
  `1dddfbf` (docs), then `railway up --service bot --ci`.
- Build **`2026-09-22T06:48:13Z`** (previous: `2026-09-14T14:28:21Z`). Boot log clean:
  `Sessions persisted to /data/sessions` → `Starting HR Agent Bot...`, no trailing 409.
- Same caveat as K4: `railway up` uploads the working tree, not a git ref. The tree was
  clean at upload, so this build does correspond to `main` — but confirm by timestamp.

### K6. §21 dead-end fix deployed 2026-09-23
- Commits `eeea637` (fix + 4 regression tests), `5a4cdc0` (docs), then `railway up --service bot --ci`.
- Build **`2026-09-23T13:30:35Z`** (previous: `2026-09-22T06:48:13Z`). Boot log clean.
- Working tree was clean at upload, so this build corresponds to `main` — but per K4, confirm by
  timestamp, not by `git log`.
- **No sheet or config change**, so there is nothing to undo on the production data side.
- One piece of live state is worth knowing: the persisted session for `535329585` still carried
  `currentAgreementId: a_qa6_1789226816573` — a row deleted under R3 — *after* the restart, since
  the volume is the point of K1. That is not a leak to clean; the fix clears it on the next
  opportunity selection. It is recorded because it is the evidence §21 was real.

### K7. §22 parser fix deployed 2026-09-24
- Commits `64b3b7d` (fix + 5 tests), `6e8197a` (docs), then `railway up --service bot --ci`.
- Build **`2026-09-24T18:37:16Z`** (previous: `2026-09-23T13:30:35Z`). Boot log clean.
- **Deployed mid-review on purpose.** `a_1790186286202` was already `under_review`. Gustavo
  had in fact already countered at `2026-09-24T09:12:53Z` — nine hours *before* the
  `18:37:16Z` build — so his $60 counter was parsed by the **pre-fix** parser (it parsed
  correctly: a leading bare `60` is the intended case). Simon had not yet responded; the fix
  had to be live before *his* freely-worded reply arrived, which is the whole reason it was
  found. Verified the proposal survived the restart still `under_review` — the sheet is the
  source of truth and the reviewers' inline keyboards stay tappable across a redeploy.
  *(Corrected 2026-10-05: this entry originally claimed neither reviewer had responded at
  deploy time.)*
- **No sheet or config change**, so nothing to undo on the data side.

### K8. §27 edit/pause fix deployed 2026-10-06 (+§25, §26 ride-alongs)
- Commit `224ff69` (fix + 5 tests), then `railway up --service bot --ci`.
- Build **`2026-10-06T12:30:21Z`** (previous: `2026-09-24T18:37:16Z`). Boot log clean —
  Sheets connected, sweep scheduled, sessions volume mounted.
- **Deployed with nothing in review** — verified by state dump immediately before: no
  agreement `under_review` (4 superseded, 1 approved, 1 parked draft `a_1790584489474`).
- What shipped: §27 (Opportunities writes aligned to the real 11-column schema, phantom
  `createdAt` removed from the model, partial edits deep-merge instead of zeroing bounds,
  edits can change `status` so pause has an inverse, failed writes reply instead of dying
  silently); §25 (bare `/add_opportunity` states the one-message requirement, no longer
  promises the nonexistent step-by-step mode); §26 (create confirmation is plain text so the
  id's underscore can't make Telegram drop the receipt).
- **No sheet or config change.** Undo = redeploy the previous image (or `git revert 224ff69`
  + `railway up`); nothing to clean on the data side. The surgical scope was deliberate:
  §23/§24/lineage/reviewer-DM wait for the final Phase E batch so the behavior Phase D
  exercises is not changed mid-campaign.

### K9. Contributor id restored on the prod sheet 2026-10-08 (data repair, no deploy) — KEEP
- **What changed:** `Contributors!A3` `c_1791455337784` → `c_1790157082079`;
  `Contributors!N3` (createdAt) `2026-10-08T10:28:57.784Z` → `2026-09-23T09:51:22.079Z`.
  Veterinary profile fields (C4's subject) deliberately left in place.
- **Why:** running C4 re-onboarded an existing contributor, which hit §30 — discovery
  passes a *complete* contributor object (fresh `c_${Date.now()}` id, fresh createdAt) to
  `updateContributor`, so the sheet row's identity was regenerated. That orphaned all three
  of Aleksa's Agreements rows, including `a_1791295559074` — and the timeout sweep
  **silently skips** agreements whose contributor can't be resolved (timeout.ts:91-94), so
  E6 would never have fired at today's 14:06Z window.
- **How:** one-shot script `_restore_contributor_id_tmp.ts` under `NODE_ENV=production`
  (2026-10-08 ~10:45Z), verified by state dump immediately after. Session file on the
  volume already carried the old id (discovery patches it back in memory post-write), so
  the repair re-aligns sheet, session and agreements.
- **Undo:** swap the two constants in the script and re-run (writes `c_1791455337784` /
  `2026-10-08T10:28:57.784Z` back). Classified **KEEP** — the repair *is* the revert of an
  accidental mutation; undoing it would re-orphan the agreements.

### K10. Phase E batch deployed 2026-10-08 — KEEP
*("final campaign deploy" when written; superseded by K11 after §32 was found live.)*

- Working tree at `d02bc1e`, then `railway up --service bot --ci`.
- Build **`2026-10-08T14:23:22Z`** (previous: `2026-10-06T12:30:21Z`), status SUCCESS.
  Boot log clean at 14:24:09Z — Sheets connected, sweep scheduled, sessions volume mounted.
- **Deployed with nothing in review** — state dump immediately before showed zero
  `under_review` rows (the E6 agreement had just escalated at 14:15:52Z; deploy began
  minutes later, inside the planned post-E6 quiet window).
- What shipped: §24 submit guard `465a0a3`, §23 retire-on-commit `6ed1c34`, lineage column
  `df642e3`, reviewer DM revision context `e6dbd54`, §26 parse_mode audit `03a1ed7`,
  §31 match-score floor `ea5da9c` (added same-day after C4 failed). 169 tests, typecheck
  clean at deploy time.
- **Sheet change (one-time, idempotent):** `Agreements!R1` = `supersededBy` via
  `_write_header_tmp.ts` (checks-before-writing; second run is a no-op). Undo = clear R1 —
  but **KEEP**: the deployed code writes column R on supersede.
- **Undo (code):** redeploy the previous image `sha256:dae1cd14…` (or `git revert` the six
  commits + `railway up`). Nothing else to clean on the data side.

### K11. §32 counter-offer attribution fix deployed 2026-10-14 — KEEP
- Working tree at `baa5290`, then `railway up --service bot --ci`.
- Build **`2026-10-14T12:13:48.728Z`** (previous: `2026-10-08T14:23:22Z`), status SUCCESS.
  Boot log clean — Sheets connected, sweep scheduled every 15 min, sessions volume
  mounted, no trailing 409.
- **Deployed with nothing in review** — F2 had just closed and accepted, so the
  only recent agreement was final. Same quiet-window discipline as K10.
- What shipped: §32 only (`baa5290`) — the contributor's own ask is now passed into
  the aggregation synthesis prompt. 169 tests, typecheck clean at deploy time.
- **No sheet change.** Prompt-side only; `aggregatedRate` was always correct.
- **Undo (code):** `git revert baa5290` + `railway up`. Reverting restores a DM that
  tells the candidate the team's counter is their own ask — only do this if the fix
  itself regresses something.

### K12. §33 prior-terms fix deployed 2026-10-14 — KEEP
- Working tree at `cbd37fa`, then `railway up --service bot --ci`.
- Build **`2026-10-14T13:28:21.877Z`** (previous: `2026-10-14T12:13:48.728Z`), SUCCESS.
  Boot log clean — Sheets connected, sweep scheduled, `/data/sessions` mounted.
- **Deployed with nothing in review** — state dump immediately before showed
  8 agreement rows and **0** `under_review`. Deliberately taken before Cycle 1
  opened a review, because the next quiet window would not have come until the
  campaign ended.
- What shipped: §33 only (`cbd37fa`). 174 tests, typecheck clean at deploy time.
- **No sheet change.** Read-path selection only.
- **Undo (code):** `git revert cbd37fa` + `railway up`.

---

## Authorized users — one added row, tracked as R6

The three real rows are untouched: `535329585` (Aleksa), `302836662` (Gustavo,
the client), `1971913512` (Simon). Temporarily swapping the client out of the
review pool was considered and **not done** — the harness made it unnecessary.

Added since: `8983159792` (Nikola, QA tester) — authorised as `contributor`
2026-10-09 for A2/A3, promoted to `admin` 2026-10-14 so he can serve as the
approve-only reviewer. Both steps are one row, and the undo is **R6**.
