# QA revert ledger

Every change made to **production** (Railway service `bot`, Google Sheet
`1qM9_Ppm7nmY0EL9eHmQEn-qHZm0q8ESIzlGz70XEvt0`) during the 2026-09-11 → 2026-09-12 QA work,
with how to undo it. Two classes: **KEEP** (a real fix or an intended
remediation) and **REVERT** (test scaffolding that must not survive handover).

---

## REVERT — before any client-witnessed run

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

### R2. Seeded QA contributor row
- **Added:** `Contributors` row `c_qa_1789223297207`, telegramId `535329585`,
  name `Aleksa (QA)`, status `active`.
- **Revert:** delete the row. Nothing else references it once R3 is gone.
- **Note:** `535329585` had no contributor row before this; deleting restores
  that. Do not touch `c_1788807562702` (Gustavo, `hired`, real).

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
- **Why it was allowed to happen:** proving the candidate is hired at the reviewers'
  rate rather than their own ask requires a genuine tap; no dry run exercises
  `updateAgreementTerms`. Accepted cost, recorded rather than avoided.

### R4. Local scratch scripts
- `_addadmin_tmp.ts`, `_authlist_tmp.ts`, `_fixrate_tmp.ts`, `_gate_tmp.ts`,
  `_guardwire_tmp.ts`, `_keycheck_tmp.ts`, `_modelcheck_tmp.ts`, `_proddump_tmp.ts`,
  `_qa6_tmp.ts`, `_qa6clean_tmp.ts`, `_statecheck_tmp.ts`, `_supersede_tmp.ts`.
- Gitignored (`.gitignore` `_*_tmp.ts`), so they never reached the client repo.
- **Revert:** `rm _*_tmp.ts` before handover.
- **Trap — these scripts read whatever env they are given.** Local `.env` points at a
  *different* spreadsheet than Railway. Run them plain (`bun _statecheck_tmp.ts`) and
  you are inspecting the dev sheet; the production sheet is only reached via
  `railway run --service bot bun _statecheck_tmp.ts`. Every QA row listed in R2/R3 was
  written through `railway run`. Reading the dev sheet by mistake shows an almost-empty
  database and invites the conclusion that production has been wiped.

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

---

## Authorized users — unchanged

`AuthorizedUsers` still holds exactly the three real rows it held before this
work: `535329585` (Aleksa), `302836662` (Gustavo, the client), `1971913512`
(Simon). Temporarily swapping the client out of the review pool was considered
and **not done** — the harness made it unnecessary.
