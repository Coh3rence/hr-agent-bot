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

## Part C — Live review flow over Telegram (*iter-3b + iter-3d*, shipped)

These exercise the wired bot. For each, a contributor first reaches a finalized
proposal so it can be submitted for review (run the discovery → matching →
negotiation flow, or seed an Agreement row in `pending`/ready state). When the
contributor taps **Submit for review**, every admin except the contributor gets a
DM with Approve / Counter / Reject buttons.

### C1. Two reviewers, all approve → aggregation fires on the LAST response — *iter-3d + D-006*
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

### C6. Contributor excluded from their own review pool — *getReviewRecipients*
- **Setup:** make the contributor also an admin in AuthorizedUsers.
- **Steps:** contributor submits a proposal for review.
- **Expected:** the contributor does **not** receive a reviewer DM for their own
  proposal; quorum is measured against the *other* admins only.
- [ ] Pass

---

## Part D — Not yet shipped (verify when these land)

### D1. 48h timeout → silence = approval — *iter-3e (planned)*
- For testing, shorten the deadline/interval (or seed an Agreement with a
  `submittedAt` already older than 48h).
- **Expected:** outstanding (silent) reviewers are treated as approvals once the
  deadline passes; the review aggregates with the responders' decisions +
  implicit approvals. Idempotent with the C1 "everyone answered" trigger — no
  double aggregation if both fire.
- [ ] Pass (when iter-3e lands)

### D2. Process restart / downtime across a deadline — *iter-3e startup sweep (planned)*
- **Steps:** submit a proposal, stop the bot, let the 48h deadline pass while it's
  down, restart the bot.
- **Expected:** the startup sweep re-reads the Agreements tab, sees the expired
  review, and completes it. Downtime causes only bounded latency — never a lost or
  wrong decision (because the deadline is stored on the sheet and silence =
  approval makes a late firing produce the same outcome).
- [ ] Pass (when iter-3e lands)

### D3. Aggregated counter-offer presented to the contributor — *iter-3f (planned)*
- **Expected:** after aggregation, the contributor is DM'd the counter-offer with
  Accept / Modify / Walk-away. Callback carries the agreement id; the session is
  rebuilt from the sheet if the contributor has no active session. Accept →
  finalized; Modify → re-enters negotiation; Walk-away → cooldown.
- [ ] Pass (when iter-3f lands)

---

## Quick reference — expected aggregation outcomes

| Reviewer decisions | outcome | suggested rate | summary |
|---|---|---|---|
| all approve | `all_approve` | original rate | "All reviewers approved." |
| all reject | `all_reject` | (empty) | "Reviewers declined. Reasons: …" |
| single counter | `mixed` | that reviewer's rate | their feedback |
| mixed / multi counter | `mixed` | mean of counter rates (rounded) | Claude one-paragraph synthesis |

Completion (D-006): aggregate when **every notified reviewer has responded**, or
(once iter-3e lands) when the 48h deadline passes. An empty reviewer pool never
auto-approves — it's surfaced, not silently completed.
