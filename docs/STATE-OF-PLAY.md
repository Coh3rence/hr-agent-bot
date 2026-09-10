# State of Play — 2026-09-10

**Project:** HR AI Agent for Collabberry
**Purpose:** what is built, what is live, what remains. Written after the 2026-09-07..09 QA run
against production. Every "built" claim below was verified against the source on 2026-09-10, not
recalled.

Companion documents: `KNOWN-ISSUES-AND-DECISIONS.md` (the numbered issue log, client-facing),
`DELIVERY-STATUS.md` (milestone summary), `QA-VERIFICATION.md` (the acceptance checklist).

---

## 1. Headline

**The product works.** The full loop completed successfully in production on 2026-09-09: discovery →
matching → negotiation → multi-reviewer review → aggregation → candidate acceptance → Collabberry
signup → agreement created. This included the invite-token → signup → agreement-creation leg, which
had never previously been proven end to end.

**None of the fixes from this QA run are live.** The running Railway build is from
`2026-09-07T17:53:55Z`. Eight commits sit on `main` locally, unpushed. Production therefore still
behaves exactly as it did while the defects were being observed.

That gap — diagnosis and repair done, nothing deployed — is the single most important fact about the
current state.

---

## 2. Production evidence from the QA run

Google Sheet `1qM9_Ppm…`, read 2026-09-10.

**Contributor** `c_1788807562702` — GUSTAVO (`@sepu85`, telegram `302836662`), status `hired`,
wallet `0x290a26a086d4ee4437c80aa1d669576cb7512061`,
Collabberry user `e2a00877-9249-4fcc-a037-2943ba60d534`.

**Four agreement rows, all `opp_003` / Community Manager:**

| Id | Rate | What happened | Status |
|---|---|---|---|
| `a_1788808260898` | $50 | Simon approved 09-07 20:38Z; Aleksa countered $40 09-08 07:54Z; counter-offer sent | `under_review` — **stale** |
| `a_1788858346291` | $40 | abandoned before submission | `draft` — **stale** |
| `a_1788858438270` | $40 | both approved (09-08 14:21Z, 09-09 09:45Z); candidate tapped Modify instead of Accept | `under_review` — **stale** |
| `a_1788962327012` | $40 | both approved (09-09 14:10Z, 14:16Z); candidate accepted | `approved` ✅ |

Final agreement in Collabberry: `231b0916-c607-4fba-9a24-68d593dcfc3c`.

Note rows 3 and 4 are **character-identical proposals** — same rate, commitment, duration and
likelihood. The reviewer DMs for them were indistinguishable except by position in the chat.

---

## 3. Built and verified, awaiting deploy

Verified present in source on 2026-09-10.

| Issue | Fix | Where |
|---|---|---|
| §11 — reviewer counter rate only parsed from a leading number | `parseCounterFeedback` handles amounts anywhere in the sentence | `conversations/review.ts:131` |
| §14 — renegotiating orphaned the previous proposal | terminal `superseded` status | `models/types.ts:60`, set at `review.ts:37` and `resolution.ts:185` |
| §14 — stale reviewer buttons stayed answerable | `ensureOpenForReview` guard on approve / counter / reject, re-checked when collecting written feedback | `review.ts:93`, called at `:45 :59 :74 :175` |
| round cap never bit | round derived from sheet history, not session memory | `sheets.ts:20` (pure `nextRoundFromHistory`), `sheets.ts:323`, used at `negotiation.ts:126` |
| round cap enforcement | refuses a third attempt, offers accept-or-walk-away | `resolution.ts:161` |
| §10 — conversation state lost on every restart | grammy sessions persisted via `FileAdapter`, with a TTL sweep | `bot.ts:67`, `config.ts:36`, `services/sessionStore.ts` |

`session.negotiationRound` has been fully removed — no references remain.

**Test suite: 60 passing, 0 failing, across 5 files.** Typecheck clean.

---

## 4. Remains to be built

### 4.1 A unanimously rejected candidate can hire themselves — §16, most severe

`presentToCandidate` builds its Accept / Modify / Walk away keyboard unconditionally and never
branches on the review outcome. `handleResolution`'s `accept` branch does not check it either.
**Confirmed by search on 2026-09-10: there is no outcome branching anywhere in `presentation.ts`,
`resolution.ts` or `quorum.ts`.**

So on an all-reject aggregation the candidate is shown Accept. Tapping it takes the normal approval
path — the suggested rate is null, so the rate falls back to the contributor's own asking figure,
the status becomes `approved`, an invite is issued, and on signup the bot writes the agreement into
Collabberry and marks them `hired`. No reviewer is notified. Nothing downstream blocks it.

Not yet observed live — found by tracing what a rejection would do *before* asking a reviewer to
test one.

**Complication:** the aggregation outcome is never persisted. `updateAgreementAggregation` writes
only the rate (M), the summary (N) and the commitment (Q). The verdict must therefore be
re-derived from `ReviewFeedback` rows.

**Shape of the fix:**
1. Pure helper in `services/quorum.ts` — dedupe re-votes so a reviewer's latest decision wins,
   ignore responders outside the pool, report whether every in-pool responder rejected.
2. Branch the keyboard in `services/presentation.ts`.
3. Guard the `accept` branch in `conversations/resolution.ts` server-side. Callback data is
   replayable, so hiding a button is not the same as disabling it.
4. Route the round-cap branch (`resolution.ts:161`, which also offers "Accept offer") through the
   same guard, or it becomes a back door.

**Scope is smaller than first estimated** — see §6.1. An all-reject outcome can reuse the existing
walk-away behaviour rather than growing new copy.

### 4.2 Admin-only messages reach a candidate who is also an admin — §15

Two broadcast paths DM everyone `getAdminIds()` returns without applying the `reviewRecipients`
filter that already excludes a contributor from reviewing their own proposal:

- `escalateReview` — `services/timeout.ts:123`
- `notifyAdminsOfWriteFailure` — `conversations/review.ts:295`

(For contrast, `timeout.ts:96` and `review.ts:319`/`:377` *do* filter correctly — the bug is
specific to these two broadcasts.)

Gustavo is admin `302836662`, so he would receive reviewer response counts and other reviewers'
names and decisions about his own application. Not yet harmful — no escalation has fired — but the
role model permits a real contributor to be an admin.

Fix: thread the agreement's contributor telegram id into both and filter it out.

### 4.3 Prior-attempt history is stored but never surfaced — new, 2026-09-10

The client asked that a returning contributor be flagged with context from the previous round:
*"this has been attempted before"*, the reasons it did not work, and the opinions from that round.

`previousAttempts` is initialised in `discovery.ts:95`, carried forward on re-application at
`discovery.ts:106`, incremented on walk-away at `resolution.ts:214`, and read/written in
`sheets.ts`. **It appears nowhere else.** It is never shown to reviewers, never used in matching,
never surfaced in conversation.

This is an unimplemented requirement rather than a defect. It does not block the deploy.

---

## 5. Not code, but blocking

### 5.1 Railway disk

The session fix is committed but **inert without storage**. Requires a volume mounted at `/data` on
the bot service and `SESSION_DIR=/data/sessions`. Deploying without it changes nothing about
conversations being wiped on restart.

### 5.2 The three stale rows must be closed by hand

Deploying does not clean up history. `ensureOpenForReview` refuses a tap only when the proposal is
no longer `under_review` — and `a_1788808260898` and `a_1788858438270` still are. **Their reviewer
buttons in Aleksa's and Simon's chats remain answerable after the deploy.** A tap today would
quietly record a verdict on a settled proposal.

Checked 2026-09-10: they are otherwise inert. The timeout sweep skips them because both are already
aggregated and the candidate was already notified (`timeout.ts:53`), so no escalation or
re-notification is pending. The live buttons are the only exposure.

Action: mark all three `superseded` in the sheet, then confirm by tapping an old button.

---

## 6. Decisions resolved from the client's own words

Source: discovery call transcript and `VIDEO-ANSWERS-ANALYSIS.md` in the sibling
`collabberry-agents-onboarding-support/docs/`.

### 6.1 A unanimous rejection ends the attempt — RESOLVED

> *"If no agreement was met, okay, thank you for your attention. We will move forward."*
> *"We want a cool-down period before we apply again... two or three days of cool down."*

Intent per the answer digest: thank them, allow re-entry into matching if roles remain open, after a
2–3 day cooldown whose purpose is *"time for both parties to reflect and gather more info for the
next negotiation cycle."*

**Caveat, recorded honestly:** he was answering *"what if the contributor rejects the final
offer?"* — the mirror case. He never explicitly addressed all reviewers rejecting. But he framed the
rule as *"if no agreement was met"*, which covers both directions, and `DECISIONS.md` D-005 already
notes he was silent on how a rejection should be presented back.

**Decision:** no Accept and no Modify on an all-reject outcome. Modify keeps the same negotiation
alive, which is what he described as ending. The existing walk-away path already implements his
rule exactly — `resolution.ts:203` marks the proposal rejected, sets a 3-day cooldown, increments
the attempt count, and replies *"Thank you for your time... you're welcome to re-apply after a
3-day reflection period."* The all-reject path should route into it.

### 6.2 A split verdict is not a veto — RESOLVED

> Counter-offers are *"the whole idea about the negotiation."*
> The AI aggregates all opinions into a single output — qualitative synthesised, rates averaged.
> He called this *"intersubjective aggregation"* and named it a key differentiator.

Combined with the majority-quorum model, a single dissent is designed to be folded into the
counter-offer. Blocking on one rejection would contradict the feature he was most invested in.

**Decision:** leave mixed outcomes as they are — counter-offer, candidate may accept.

### 6.3 Two items reclassified by the same read

- **The manual "I've signed up" tap (§8) is sanctioned, not a shortfall.** *"I'll link to Beta App
  for a signature, yes"* and *"for this prototype, manually is okay."* Downgrade from hardening gap
  to accepted design.
- **Escalation on a stalled review is his design.** *"If [quorum] didn't get reached, it will
  escalate, yes."* What he never specified is who picks it up afterwards.

---

## 7. Open with the client

### 7.1 The TeamPoints / cash split — §6

Searched the full transcript and the pre-call question list on 2026-09-10. **The compensation
structure was never asked and never answered.** The call contains one adjacent line — *"the hard
constraints will be in terms of budgets, cash flow"* — and the agreement schema drafted before the
call has `hourly_rate` and no equity or points field at all.

The only guidance is Gustavo speaking during the QA session (2026-09-08): the applicant asks in
dollars, and reviewers counter by trading cash for TeamPoints — *"we don't have that much money,
but we can give you these extra TeamPoints."* What a TeamPoint is worth is explicitly out of scope
for the bot.

Live consequence: neither `DEFAULT_FIAT_REQUESTED` nor `FTE_HOURS_PER_MONTH` is set in Railway, so
defaults applied. Agreement `231b0916-…` records **$6,400/month with zero cash** — even though the
contributor asked in dollars and the reviewer's counter was *"It's above our budget for this role,
can we reduce it to $40?"*, a sentence about money. Nobody agreed to a split because nobody was
asked.

This is new scope rather than a dropped requirement, which makes it a better conversation to have.

### 7.2 Is `marketRate` an FTE benchmark or actual pay? — riskier

The bot sends `marketRate` = hourly × 160 alongside `commitment: 50`. Correct only if Collabberry
reads it as a full-time-equivalent benchmark and pro-rates by commitment. If it reads it as actual
monthly compensation, the figure is **double**. Unconfirmed either way. Worth settling before
on-chain signing.

---

## 8. How each issue gets proven

Two layers, because they catch different failures. Unit tests prove the logic; only a live run
proves the wiring.

| Issue | Unit | Live | Status |
|---|---|---|---|
| §11 counter rate mid-sentence | ✅ | — | covered |
| §14 dead proposals answerable | ✅ 5 tests | ❌ | unit only |
| round counter stuck at 1 | ✅ 8 tests | ❌ | unit only |
| §10 state lost on restart | ✅ | ❌ | unit only |
| §16 rejected can self-hire | ❌ | ❌ | **neither** |
| §15 alerts leak to candidate | ❌ | ❌ | **neither** |
| §6 TeamPoints split | — | ❌ | blocked on client |

**Unit tests to add.** For §16: all reject → blocked; mixed → allowed; all approve → allowed; no
responses → allowed; reject-then-approve re-vote → allowed (latest wins); out-of-pool responder
ignored; all-reject keyboard omits Accept; normal keyboard unchanged; replayed accept on a rejected
agreement refused. For §15: escalation recipients exclude the candidate when the candidate is also
an admin; same for the write-failure alert.

**Live scenarios, after deploy.** All need a candidate who is not in the review pool — Gustavo is
now `hired`, so either reset his record (`scripts/reset-test-data.ts`) or use a third Telegram
account. Pool size changes with that choice, which changes the quorum arithmetic; confirm before
running.

1. **Round limit** — propose, counter, modify, counter, then attempt a third modify. Expect the
   limit message with only accept-or-walk-away. Confirm an abandoned draft does not burn a round,
   and that rounds are counted per role.
2. **Unanimous rejection** — both reviewers reject. Expect no Accept button, a replayed Accept
   refused, no Collabberry agreement written, contributor not `hired`, cooldown applied.
3. **Stale reviewer button** — after a Modify, tap the previous proposal's approve button. Expect a
   clear refusal, not a silently recorded verdict.
4. **Restart survival** — redeploy mid-conversation, continue the thread. Failure here means the
   volume or `SESSION_DIR` is wrong; the code fix alone cannot produce this behaviour.
5. **Escalation routing** — testable in ~1h instead of 48 by lowering `REVIEWER_TIMEOUT_HOURS` for
   a single run. Expect the escalation DM to reach reviewers, the candidate to receive nothing, and
   the proposal to move to `escalated`. Restore the timeout afterwards.

Scenarios 1–3 are the failures actually observed this week.

---

## 9. Ordered next steps

1. Build §16 (routing all-reject into the existing walk-away behaviour) with unit tests.
2. Build §15 (filter the candidate out of both admin broadcasts) with unit tests.
3. Add the Railway volume and set `SESSION_DIR`.
4. Push the eight commits and deploy. Confirm the new build is live.
5. Mark the three stale rows `superseded`; verify an old button is now refused.
6. Prepare a test candidate outside the review pool.
7. Run live scenarios 1–5.
8. Fill the 32 functional results in `QA-VERIFICATION.md` and regenerate the HTML and PDF.
9. Update `KNOWN-ISSUES-AND-DECISIONS.md` status labels with live evidence as each lands.
10. Raise §7.1 and §7.2 with the client; agreement `231b0916-…` is the concrete example.
11. Clear the untracked scratch files before handover.

Items 1–2 are unblocked: both design decisions are answered in §6.
