# Manual Test Plan — Multi-Reviewer Review Flow (Iter 3)

How to verify the review-flow improvements by hand. Run these when you want
proof the bot behaves correctly before pointing reviewers at the prod bot.

Each case lists: **what it proves** (which iteration piece), **setup**, **steps**,
**expected result**, and a checkbox to tick when you've confirmed it.

---

## Prerequisites

- **Two+ Telegram accounts** you control: one as the *contributor*, at least one
  (ideally two) as *reviewers/admins*. The contributor is excluded from their own
  review pool, so you need at least one *other* admin to act as a reviewer.
- **A test Google Sheet** (a copy of prod — never test against prod). Note its id.
- **`.env`** pointing at the test sheet (`GOOGLE_SHEETS_ID`) with a valid
  `BOT_TOKEN`, `ANTHROPIC_API_KEY`, and the service-account credentials.
- **Only one bot instance running at a time.** Telegram long-polling drops
  updates if two processes poll the same token. Stop `bun run dev` elsewhere first.
- **AuthorizedUsers tab** in the test sheet: each reviewer's Telegram id present
  with `role = admin`. The contributor can be a non-admin or a different admin.
- Start the bot with `bun run start` (or `bun run dev` for auto-reload).

> Tip: the fastest way to seed/inspect rows without the full Telegram dance is the
> aggregation harness (Part A). Use the live Telegram flow (Part C) for the cases
> that exercise the bot's wiring and messaging.

---

## Part A — Automated checks (run these first, no Telegram needed)

### A1. Typecheck is clean — *all pieces*
- **Steps:** `bun run typecheck`
- **Expected:** exits 0, no errors.
- [ ] Pass

### A2. Aggregation engine across all buckets — *iter-1 + iter-2a harness*
- **Steps:** `bun scripts/test-aggregation.ts --sheet-id <TEST_SHEET_ID>`
- **Expected:** every scenario prints **PASS** (all-approve, all-reject, single
  counter pass-through, mixed multi mean-of-rates, empty input → null,
  idempotency signature match, reviewer revote dedup, null counter rate, equal
  rates, outlier). Rows are cleaned up afterward (omit `--keep`).
- **Note:** scenario 13 (sheet-write failure) is skipped here — covered live in C5.
- [ ] Pass

---

## Part B — Sheet-setup script (BL-001 pt1) — *iter-3a*

`scripts/ensure-reviewfeedback-tab.ts` is idempotent and additive. Verify all four
branches. Use a *throwaway* sheet for the destructive-looking cases, or undo
between runs.

### B1. Tab missing → created with headers
- **Setup:** a sheet with **no** `ReviewFeedback` tab.
- **Steps:** `bun scripts/ensure-reviewfeedback-tab.ts --sheet-id <ID>`
- **Expected:** tab created; row 1 = `agreementId, reviewerId, reviewerName,
  decision, suggestedRate, qualitativeFeedback, submittedAt`; exit 0.
- [ ] Pass

### B2. Tab exists, headers correct → no-op
- **Setup:** run B1 first (or use a sheet that already has the tab).
- **Steps:** run the script again.
- **Expected:** reports "already correct"; no changes; **exit 0**.
- [ ] Pass

### B3. Tab exists, row 1 empty → headers written
- **Setup:** a `ReviewFeedback` tab with an empty first row.
- **Steps:** run the script.
- **Expected:** headers written into row 1; no data loss; exit 0.
- [ ] Pass

### B4. Tab exists, row 1 wrong → refuses
- **Setup:** a `ReviewFeedback` tab whose row 1 has different/garbled headers.
- **Steps:** run the script.
- **Expected:** reports a mismatch, **does NOT overwrite**, **exit 1**.
- [ ] Pass

---

## Part C — Live review flow over Telegram (*iter-3b + iter-3d + iter-3g*, shipped)

These exercise the wired bot. For each, a contributor first reaches a finalized
proposal so it can be submitted for review (run the discovery → matching →
negotiation flow, or seed an Agreement row in `pending`/ready state). When the
contributor taps **Submit for review**, every admin except the contributor gets a
DM with Approve / Counter / Reject buttons.

> **Quorum model (D-011):** a review closes as soon as a **majority** of the
> notified reviewers respond — quorum = `floor(pool/2)+1` (so **2 of 3**; with a
> pool of 2, both). Non-responders are **not counted**. If the 48h deadline
> passes without quorum, the review **escalates** (admins are DM'd, status →
> `escalated`) — it is *not* auto-approved. With exactly two reviewers, quorum is
> both, so the two-reviewer cases below still fire on the last response.

### C1. Two reviewers, all approve → aggregation fires on the LAST response — *iter-3d + D-011*
- **Setup:** two admin reviewers (R1, R2) for one proposal.
- **Steps:** R1 taps **Approve** → then R2 taps **Approve**.
- **Expected:**
  - After R1: R1 sees "Approval recorded." No aggregation yet (R2 outstanding).
  - After R2 (the last responder): aggregation runs. Sheet columns M/N for that
    agreement get written — outcome **all_approve**, suggested rate = the
    original proposed rate, summary "All reviewers approved."
- **How to confirm:** open the test sheet, find the Agreement row, check the
  aggregated-counter columns are now populated.
- [ ] Pass

### C2. Mixed (approve + counter) → Claude-synthesized counter — *iter-3d + D-001*
- **Setup:** two reviewers.
- **Steps:** R1 **Approve**; R2 **Counter** → sends e.g. `55 - experience is thin`.
- **Expected:** on R2's response (pool complete), aggregation runs. Outcome
  **mixed**; suggested rate = mean of the counter rates (here just 55, rounded);
  summary is a single professional paragraph synthesized by Claude that does not
  name individual reviewers.
- [ ] Pass

### C3. All reject → deterministic reason list, no Claude — *iter-3d + D-005*
- **Setup:** two reviewers.
- **Steps:** both tap **Reject** and give reasons.
- **Expected:** outcome **all_reject**; suggested rate empty; summary =
  "Reviewers declined. Reasons: ...;" joining the reasons given.
- [ ] Pass

### C4. Re-tap / re-vote idempotency — *iter-3d status guard + dedup*
- **Setup:** the C1 proposal *after* it has aggregated (status no longer
  `under_review`), or a single reviewer who taps twice.
- **Steps:** have a reviewer tap **Approve** again after completion; or have R1
  vote, change their mind, and vote again before R2 responds.
- **Expected:**
  - Re-tap after completion → `maybeCompleteReview` sees status ≠ `under_review`
    and does nothing; no second aggregation, no duplicate sheet write.
  - Re-vote before completion → only the latest vote per reviewer counts
    (dedup-by-reviewer); quorum still needs the *other* reviewer.
- [ ] Pass

### C5. ReviewFeedback write failure is surfaced, not dropped — *iter-3b + BL-001 pt2*
- **Setup:** force a write failure — e.g. temporarily rename/delete the
  `ReviewFeedback` tab on the test sheet so `addReviewFeedback` throws.
- **Steps:** a reviewer taps **Approve** (or Counter/Reject).
- **Expected:**
  - The reviewer sees a "couldn't record your decision, please retry / an admin
    has been notified" message — **not** a false "Approval recorded."
  - The inline keyboard / pending state stays so they can retry.
  - Every admin receives a DM naming the agreement id + the error, mentioning the
    ensure script.
- **Cleanup:** restore the tab (or run `ensure-reviewfeedback-tab.ts`), retry the
  tap, confirm it now records.
- [ ] Pass

### C6. Contributor excluded from their own review pool — *reviewRecipients*
- **Setup:** make the contributor also an admin in AuthorizedUsers.
- **Steps:** contributor submits a proposal for review.
- **Expected:** the contributor does **not** receive a reviewer DM for their own
  proposal; quorum is measured against the *other* admins only.
- [ ] Pass

### C7. Three reviewers, majority closes early (2 of 3) — *iter-3g + D-011*
- **Setup:** three admin reviewers (R1, R2, R3) for one proposal (pool of 3,
  quorum = 2).
- **Steps:** R1 **Approve** → R2 **Approve** (R3 never taps).
- **Expected:**
  - After R1: "Approval recorded." No aggregation (1 of 3, quorum not yet met).
  - After R2 (quorum reached at 2 of 3): aggregation runs **immediately** — the
    bot does **not** wait for R3. M/N written; R3's silence is simply not counted.
- **Then (late responder):** R3 taps **Reject** *after* aggregation.
- **Expected:** `maybeCompleteReview` sees the review already aggregated and does
  nothing — no re-open, no second aggregation, no overwrite of M/N.
- [ ] Pass

---

## Part D — Timeout sweep (*iter-3e + iter-3g*, shipped) + not-yet-shipped (3f)

> Easiest way to trigger the sweep without waiting 48h: in the test sheet, edit
> the target Agreement's **submittedAt** (column L) to a timestamp >48h in the
> past, leave its **status** (column J) = `under_review`, and make sure the
> aggregation cells (columns M/N) are **empty**. Then restart the bot (startup
> sweep fires immediately) or wait for the next 15-min tick.
>
> **D-011 change:** the sweep no longer treats silence as approval. At the
> deadline it checks whether **quorum** was reached among the reviewers who
> *did* respond. Quorum reached → aggregate. Quorum **not** reached (including
> all-silent) → **escalate**: every admin is DM'd and the agreement moves to
> `escalated`. To confirm an escalation: watch for the admin DM and check the
> Agreement's **status** (column J) flips to `escalated` while M/N stay empty.

### D1. Deadline with quorum reached → aggregate on timeout — *iter-3g + D-011*
- **Setup:** three reviewers (pool of 3, quorum = 2); R1 **Approve**, R2
  **Counter**, R3 silent. Backdate `submittedAt` >48h; M/N empty; status
  `under_review`.
- **Steps:** restart the bot (or wait for a tick).
- **Expected:** 2 of 3 responded = quorum met, so the sweep aggregates the two
  decisions that arrived (R3's silence not counted). M/N get written. Console
  logs `aggregated on timeout`. No escalation DM.
- [ ] Pass

### D2. Deadline without quorum → escalate (no default approval) — *iter-3g + D-011*
- **Setup:** three reviewers; only R1 responded (1 of 3, quorum not met). Or:
  an `under_review` agreement with **no** ReviewFeedback rows (all silent).
  Backdate `submittedAt` >48h; M/N empty.
- **Steps:** restart the bot (or wait for a tick).
- **Expected:** the sweep **escalates** — every admin receives a DM naming the
  agreement id and the responded/needed counts; the Agreement's status flips to
  `escalated`; M/N stay **empty**. Claude is **not** called. Console logs
  `escalated (no quorum: X/Y)`. No auto-approval.
- [ ] Pass

### D3. Idempotency — sweep does not double-fire / conflict with on-tap — *iter-3e + iter-3g*
- **Steps:** after D1 has written M/N, leave the agreement `under_review` and
  trigger the sweep again (restart / next tick). Separately: an agreement the
  on-tap path already aggregated (Part C) — confirm the sweep leaves it alone.
  Separately: an agreement already `escalated` (D2) — confirm the sweep skips it
  (status ≠ `under_review`), so admins are not re-DM'd.
- **Expected:** the second sweep sees column N populated (`aggregated = true`) or
  the status off `under_review` and skips — no second write, no duplicate Claude
  call, no duplicate escalation DM. Whoever acted first wins.
- [ ] Pass

### D4. Downtime across a deadline → bounded latency, correct outcome — *iter-3e startup sweep*
- **Steps:** submit a proposal, stop the bot, backdate `submittedAt` >48h while
  it's down (simulating the deadline passing during downtime), restart the bot.
- **Expected:** the startup sweep re-reads the Agreements tab, sees the expired
  review, and resolves it on boot — aggregate if quorum was reached, otherwise
  escalate. Downtime causes only bounded latency — never a lost or wrong decision
  (deadline is stored on the sheet, so a late firing produces the same outcome a
  timely one would have).
- [ ] Pass

### D5. Bad submittedAt is not auto-resolved — *iter-3e guard*
- **Setup:** an `under_review` agreement with an empty/garbled `submittedAt`.
- **Steps:** trigger the sweep.
- **Expected:** the sweep logs a warning and **skips** it — no aggregation and no
  escalation on an undeterminable deadline.
- [ ] Pass

### D6. Aggregated counter-offer presented to the contributor
- **Setup:** drive a proposal through to aggregation (D1 quorum path or a timeout
  with quorum). Confirm column N (summary) and M (rate) are populated.
- **Expected:** the contributor is DM'd the counter-offer with Accept / Modify /
  Walk-away. The buttons carry the agreement id (`resolution:<action>:<id>`), so
  the flow works even after a restart or a long delay (cold session): tapping a
  button rehydrates the session from the sheet.
  - **Accept** → status `approved`, congratulations message, session reset.
  - **Modify** → re-enters negotiation seeded with the prior terms; the next
    message proposes new terms and creates a fresh draft.
  - **Walk-away** → status `rejected`, contributor put on a 3-day cooldown,
    `previousAttempts` incremented.
- **Notify-once:** the DM fires exactly once even if both the on-tap close and the
  sweep run (column O guard). Re-running the sweep does not re-DM.
- [ ] Pass

### D7. Cold-session resolution (restart safety)
- **Setup:** after D6's DM is delivered, restart the bot process (clears in-memory
  sessions) **before** the contributor taps a button. Then tap Accept.
- **Expected:** resolution still succeeds — the agreement id from the callback is
  used to reload the agreement and rebuild the session; no "no active session"
  dead-end.
- [ ] Pass

---

## Beta App linkage — invite-token join key (D-018)

Proves the contributor↔Collabberry link uses the **single-use invite token**, not
the Telegram handle. Needs the fork running (`docker compose up -d --build`), the
Collabberry frontend on `:5173`, and `.env`/`.env.development` pointed at the fork
(`BETA_APP_API_URL`, `BETA_APP_SERVICE_KEY`, `BETA_APP_ORG_ID`).

> Fork gotcha: `agreements.user_id` is UNIQUE — **use a fresh wallet each run**, or
> clear the prior user's agreement, else `createAgreement` returns 400.

### L1. Token minted single-use and persisted on accept
- **Setup:** a contributor with an empty `collabberryUserId` reaches the Accept tap.
- **Steps:** tap **Accept**.
- **Expected:** the bot DMs a personal invite link; the contributor's Contributors
  row **column Q (`collabberryInviteToken`)** is populated with the token that
  appears in the invite URL; session phase = `awaiting_collabberry_signup`. In the
  fork DB the `invitations` row for that token has `usageLimit = 1`.
- [ ] Pass

### L2. `resolveByToken` links the freshly-signed-up user
- **Setup:** after L1, open the invite link in the frontend, connect a **fresh
  wallet**, sign (SIWE), and complete sign-up.
- **Steps:** back in Telegram, tap **"I've signed up"**.
- **Expected:** the bot resolves the user by the **token** (not the handle), writes
  `walletAddress` + `collabberryUserId` to the Contributors row, creates the
  agreement in the fork (`marketRate = hourly×160`, correct commitment, `fiat 0`),
  writes `betaAppAgreementId`, marks the contributor `hired`, and DMs success.
- [ ] Pass

### L3. Retry when sign-up isn't finished yet
- **Setup:** after L1, tap **"I've signed up"** *before* completing sign-up.
- **Expected:** the bot replies it couldn't find the sign-up yet and re-offers the
  button; no partial writes, no crash. Completing sign-up then tapping again → L2.
- [ ] Pass

### L4. Handle is no longer load-bearing (regression of the old join key)
- **Setup:** run L2 but **leave the Telegram Handle field blank** (or type a wrong
  handle) during sign-up.
- **Expected:** linking still succeeds via the token — proves the handle no longer
  gates resolution.
- [ ] Pass

### L5. Already-linked contributor skips the invite path
- **Setup:** a contributor whose row already has `collabberryUserId` taps Accept.
- **Expected:** the bot creates the agreement immediately — no invite link, no token
  write. Idempotent: if `betaAppAgreementId` is already set, it reports "already
  exists" and does not double-create.
- [ ] Pass

### L6. Pre-existing contributors without a token are unaffected
- **Setup:** an old Contributors row with an empty column Q and no
  `collabberryUserId` taps Accept.
- **Expected:** the normal invite-mint path runs and writes a fresh token to Q;
  nothing errors on the previously-empty cell.
- [ ] Pass

---

## Quick reference — expected aggregation outcomes

| Reviewer decisions | outcome | suggested rate | summary |
|---|---|---|---|
| all approve | `all_approve` | original rate | "All reviewers approved." |
| all reject | `all_reject` | (empty) | "Reviewers declined. Reasons: …" |
| single counter | `mixed` | that reviewer's rate | their feedback |
| mixed / multi counter | `mixed` | mean of counter rates (rounded) | Claude one-paragraph synthesis |

Completion (D-011, supersedes D-006/D-007): aggregate as soon as a **majority of
notified reviewers respond** (quorum = `floor(pool/2)+1`, "2 of 3" — early close).
Non-responders are not counted. If the 48h deadline passes **with** quorum among
responders, aggregate; **without** quorum (including all-silent), **escalate** —
DM admins and set status `escalated`. A proposal no one approved is never
auto-approved.
