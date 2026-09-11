# State of Play — 2026-09-11

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

**All fixes from this QA run went live on 2026-09-11.** Build `839978aa`
(`2026-09-11T12:28:30Z`) replaced the `2026-09-07T17:53:55Z` build that was running while the
defects were observed. The session volume was attached in the same change, so §10 is active rather
than inert. The deploy/repair gap that dominated this document is closed.

**A blocker appeared and was cleared the same day.** The production Anthropic key was out of
credit, which — because `claude.ts` has no error handling — made the bot reply with nothing at all
rather than an error (`KNOWN-ISSUES` §17). Credits were purchased at 13:19Z and all six health
checks now pass. The silent-failure fragility itself is still unfixed; it is simply not triggered.

**Production is deliberately running Haiku 4.5 for the QA scenarios** (`KNOWN-ISSUES` §18) and must
be returned to Sonnet before any client-witnessed run.

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

## 3. Built, verified and deployed

Verified present in source on 2026-09-10; shipped to production 2026-09-11 in build `839978aa`.

| Issue | Fix | Where |
|---|---|---|
| §11 — reviewer counter rate only parsed from a leading number | `parseCounterFeedback` handles amounts anywhere in the sentence | `conversations/review.ts:131` |
| §14 — renegotiating orphaned the previous proposal | terminal `superseded` status | `models/types.ts:60`, set at `review.ts:37` and `resolution.ts:185` |
| §14 — stale reviewer buttons stayed answerable | `ensureOpenForReview` guard on approve / counter / reject, re-checked when collecting written feedback | `review.ts:93`, called at `:45 :59 :74 :175` |
| round cap never bit | round derived from sheet history, not session memory | `sheets.ts:20` (pure `nextRoundFromHistory`), `sheets.ts:323`, used at `negotiation.ts:126` |
| round cap enforcement | refuses a third attempt, offers accept-or-walk-away | `resolution.ts:161` |
| §10 — conversation state lost on every restart | grammy sessions persisted via `FileAdapter`, with a TTL sweep | `bot.ts:67`, `config.ts:36`, `services/sessionStore.ts` |
| §16 — a unanimously rejected candidate could hire themselves | verdict re-derived from feedback rows; no-button decline DM; server-side guard on `accept` | `services/quorum.ts`, `services/decline.ts`, `presentation.ts:60`, `resolution.ts:45` and `:251` |
| §15 — admin-only alerts reached a candidate who is also an admin | both broadcasts route through `reviewRecipients` | `timeout.ts:137`, `review.ts:300` |

`session.negotiationRound` has been fully removed — no references remain.

**Test suite: 96 passing, 0 failing, across 8 files.** Typecheck clean.

---

## 4. Remains to be built

§16 and §15 were listed here earlier today and were **built on 2026-09-10** — they have moved up to
§3. Two notes worth keeping, because both shaped the implementation:

- The aggregation outcome is never persisted (`updateAgreementAggregation` writes only rate, summary
  and commitment), so the verdict is re-derived from the `ReviewFeedback` rows. The helper that does
  it must agree with `aggregateFeedback` exactly — including its *lack* of a pool filter — or the
  bot would build a counter-offer while refusing permission to accept it.
- The §16 fix was smaller than first estimated: an all-reject outcome reuses the existing walk-away
  closure rather than growing new copy. See §6.1.

### 4.1 Prior-attempt history is stored but never surfaced — new, 2026-09-10

The client asked that a returning contributor be flagged with context from the previous round:
*"this has been attempted before"*, the reasons it did not work, and the opinions from that round.

`previousAttempts` is initialised in `discovery.ts:95`, carried forward on re-application at
`discovery.ts:106`, incremented on walk-away at `resolution.ts:214`, and read/written in
`sheets.ts`. **It appears nowhere else.** It is never shown to reviewers, never used in matching,
never surfaced in conversation.

This is an unimplemented requirement rather than a defect. It does not block the deploy.

---

## 5. Not code, but blocking

### 5.1 Railway disk — DONE 2026-09-11

The session fix was committed but **inert without storage**: a volume at `/data` on the bot service
plus `SESSION_DIR=/data/sessions`. Both were absent when checked on 2026-09-11 — the only volume in
the project was `mysql-volume` on MySQL.

Resolved before the deploy, so production restarted once rather than twice: volume `bot-volume`
created on the `bot` service at `/data`, `SESSION_DIR=/data/sessions` set. The boot log of build
`839978aa` reads `Sessions persisted to /data/sessions`, which is the line that distinguishes a
working volume from the silent `.sessions` fallback.

Still unproven: that a conversation survives a restart (scenario 4 below). The boot line proves the
path, not the round trip.

### 5.2 The three stale rows — CLOSED 2026-09-11

Deploying does not clean up history. `ensureOpenForReview` refuses a tap only when the proposal is
no longer `under_review` — and `a_1788808260898` and `a_1788858438270` still were. Their reviewer
buttons in Aleksa's and Simon's chats stayed answerable after the deploy; a tap would have quietly
recorded a verdict on a settled proposal.

Checked 2026-09-10: they were otherwise inert. The timeout sweep skips them because both are already
aggregated and the candidate was already notified (`timeout.ts:53`), so no escalation or
re-notification was pending. The live buttons were the only exposure.

**Done 2026-09-11.** All three (`a_1788808260898`, `a_1788858346291`, `a_1788858438270`) written to
`superseded` via `SheetsService.updateAgreementStatus`, i.e. the same path the bot writes through.
Re-read afterwards to confirm. The real agreement `a_1788962327012` was explicitly excluded and
remains `approved` with `betaAppAgreementId 231b0916-…`.

Outstanding, needs a human: tap one of the old buttons and confirm the refusal reads *"This proposal
is no longer open for review…"*. That is the half the sheet write cannot prove.

### 5.3 Pushing does not deploy — the two are unrelated here

The Railway bot service has **no GitHub repo or branch attached**; its latest deployment carries no
commit metadata. It was deployed by uploading source from a developer machine, so a `git push`
changes nothing in production. Deploying is a separate, deliberate CLI action against the
`collabberry-hr-agent` project, `production` environment, `bot` service.

Recorded because the failure mode is silent and plausible: push, see green, assume the fix is live.
Verify a deploy by its build timestamp, never by the state of `origin/main`.

### 5.4 Two live tests need a second reviewer

The round-limit, unanimous-rejection and stale-button scenarios all need two reviewers responding,
so they cannot be run solo — reviewer time has to be booked, not improvised. The quorum arithmetic
also shifts with pool size, so confirm the pool before interpreting a result.

**Pool as it actually stands, read 2026-09-11.** `AuthorizedUsers` holds three rows and **all three
are `admin`**: `535329585` (Aleksa), `302836662` (the client), `1971913512` (unidentified — worth
confirming who this is before a client-witnessed run). The contributor-role rows referenced in
earlier notes (`383220557`, `298220926`) are gone.

Since there is no separate reviewer role — `getAdminIds` serves both the review pool and the
admin-command gate — the pool is those three minus whoever is the candidate:

| Candidate | Pool | Quorum (`floor(n/2)+1`) | Consequence |
|---|---|---|---|
| A 4th, non-admin account | 3 | 2 | **Majority, as designed.** One silent reviewer cannot stall it. |
| Any of the three admins | 2 | 2 | Unanimity by accident — "majority not unanimity" becomes unrunnable and one silent reviewer stalls until the 48h escalation. |

**So the candidate must be a fourth Telegram account, authorised as Contributor — not Admin.** A new
account is not a contributor by default: it hits the gate, every admin is DM'd, and the *Authorize
as Contributor* button is the correct one. Tapping *Authorize as Admin* puts the candidate in the
review pool and collapses the arithmetic to the second row above.

Using a fresh account also removes the need to reset Gustavo's record — he is `hired`
(`c_1788807562702`) and can simply be left alone.

One more trap, previously observed: **anyone new must press Start at the bot before they can
receive anything.** Telegram silently drops bot→user messages to a user who has never opened the
chat, so an un-started reviewer stalls quorum invisibly rather than erroring.

### 5.5 The Anthropic key was out of credit — CLEARED 2026-09-11T13:19Z

Found by `scripts/health-check.ts` at 2026-09-11T12:30Z, minutes after the deploy: the production
key returned `400 — Your credit balance is too low`. Confirmed to be the production key and not a
local one by comparing fingerprints under `railway run` (`eb2f7cd5…`) against local (`afc43b46…`).

Because `claude.ts` has no error handling, the rejection reached `bot.ts:148` and was only logged —
the user was sent **nothing**. Full detail in `KNOWN-ISSUES-AND-DECISIONS.md` §17.

Credits purchased; all six health checks now pass. **The fragility is not fixed** — any future API
failure (rate limit, invalid model id, expired key) will still present as silence. Worth an hour to
wrap the calls; it is the difference between a diagnosable outage and a mystery.

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
| §16 rejected can self-hire | ✅ 27 tests | ❌ | unit only |
| §15 alerts leak to candidate | ✅ 9 tests | ❌ | unit only |
| §6 TeamPoints split | — | ❌ | blocked on client |

**Unit coverage added 2026-09-10.** §16 across three files: unanimity semantics in
`services/quorum.test.ts` (all reject, lone reject, mixed, counter-is-not-rejection, no responses,
re-votes in both directions, and the deliberately unfiltered out-of-pool responder);
`services/presentation.test.ts` (all-reject DM carries no keyboard and quotes no rate, the attempt
is closed and the contributor cooled down, while mixed / counter / all-approve / no-feedback still
get the three buttons, and the candidate is DM'd exactly once across both triggers); and
`conversations/resolution.test.ts` (a replayed Accept on a declined proposal is refused, every
non-unanimous verdict still accepted). §15 in `services/timeout.test.ts` and the
`notifyAdminsOfWriteFailure` block of `conversations/review.test.ts`.

One case in that list was deliberately **not** implemented as planned: the §16 helper does not
ignore out-of-pool responders. `aggregateFeedback` does not filter by pool, so filtering in the
guard would let the two disagree.

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
6. **Reviewers disagreeing — the flow the client asked about.** One approves, one counters with the
   rate written mid-sentence ("It's above our budget, can we reduce it to $40?"), a third stays
   silent. Expect: quorum reached at 2 of 3 *without* the third, both opinions synthesised into one
   counter-offer, the counter rate captured as `40` in Agreements column M, and the prose in column
   N agreeing with it. On accept, the agreement must be created at **40**, not at the original ask.

Scenarios 1–3 are the failures actually observed this week. Scenario 6 is the one with the most
client attention and, until now, the least ability to be tested: it needs a **3-person pool** so
that a majority can close a review while one reviewer dissents or abstains. With the 2-person pool
that existed previously, quorum equalled unanimity and the case was logically unrunnable.

Scenario 6 is also the direct regression test for §11. That defect was found *inside* this exact
flow on `a_1788808260898` — the reviewer's "$40" was dropped, aggregation had no number to average,
and acceptance would have silently created the agreement at the original $50. Prose and stored
terms disagreeing is the worst-looking failure in the product, and it lives in the client's
favourite feature.

---

## 9. Ordered next steps

1. ~~Build §16 (routing all-reject into the existing walk-away behaviour) with unit tests.~~ Done 2026-09-10.
2. ~~Build §15 (filter the candidate out of both admin broadcasts) with unit tests.~~ Done 2026-09-10.
3. ~~Add the Railway volume and set `SESSION_DIR`.~~ Done 2026-09-11 — `bot-volume` at `/data`.
4. ~~Push the pending commits and deploy. Confirm the new build is live.~~ Done 2026-09-11 — build
   `839978aa`, clean boot, no 409.
5. ~~Fund the Anthropic key (§5.5).~~ Done 2026-09-11T13:19Z — all six health checks pass.
6. ~~Mark the three stale rows `superseded`.~~ Done 2026-09-11 (§5.2). Still to do: tap an old
   button and confirm the refusal.
7. Prepare a test candidate outside the review pool — a **fourth** Telegram account, authorised as
   Contributor. See the pool table in §5.4; using an existing admin collapses quorum to unanimity.
8. Run live scenarios 1–5.
9. Fill the 32 functional results in `QA-VERIFICATION.md` and regenerate the HTML and PDF.
10. ~~Update `KNOWN-ISSUES-AND-DECISIONS.md` status labels with live evidence as each lands.~~
    §10, §11, §14, §15 and §16 moved to DEPLOYED on 2026-09-11; §17 opened for the Anthropic key.
    Still to do for the live scenarios as they land.
11. Raise §7.1 and §7.2 with the client; agreement `231b0916-…` is the concrete example.
12. **Restore `ANTHROPIC_MODEL` to Sonnet before any client-witnessed run** (`KNOWN-ISSUES` §18).
13. Clear the untracked scratch files before handover.

The deploy and credit gates are both cleared — steps 6–9 are now runnable. Step 6 is the cheapest
and needs nobody else; step 8 is the one that needs reviewer time booked.
