# Known Issues & Design Decisions

## Verified: Data Storage (Not Bugs)

### 1. Commitment % — stored at two levels
- **Contributor profile** (Contributors tab, col F): general availability (e.g., 30%)
- **Agreement** (Agreements tab, col G): negotiated commitment for specific role (e.g., 35%)
- These are intentionally separate — profile vs. per-agreement terms
- **To verify**: when commitment changes during negotiation, ensure the Agreement row is updated (not just session state)

### 2. Hourly rate — stored per opportunity
- **General roles**: stored in Opportunities row (e.g., $50/hr range)
- **Specialized roles**: separate Opportunities row with different rate (e.g., $60/hr for smart contract dev)
- Each opportunity has its own `hourlyRate.min` / `hourlyRate.max` columns (G-H)
- **Not a bug** — role-specific rates are separate opportunity rows by design

---

## Design Decisions

### 3. Optimistic Voting / Decision Making (Review Phase)
- **If no admin says no within 48 hours, the proposal automatically passes**
- Silence = approval (optimistic by default)
- Reduces bottlenecks — admins only need to act on proposals they disagree with

### 4. Rejection Requires Explanation
- When an admin rejects a proposal, they **must** specify what would need to change for it to pass
- Required feedback categories:
  - More commitment (higher %)
  - Lower rates
  - Different role fit
  - Other (free-text explanation)
- This gives the contributor actionable guidance for their next round

### 5. Match Parameters
- Matching happens by: **semantic skill match**, **skill overlap**, and **hourly rate alignment**
- Semantic matching is implemented via Claude tool use — e.g., "frontend dev" matches "React" even though the strings differ

### 6. Missing Parameter: Equity Points
- Currently missing from the model: **equity vs. fiat split**
- Organizations may offer part of compensation as equity points
- Need to capture: what the org can provide in fiat vs. what will be equity
- This affects rate negotiation — a lower fiat rate may be acceptable if equity is offered
- TODO: Add equity fields to Opportunity and Agreement models

**Client framing (Gustavo, 2026-09-08 QA session) — this scopes the work usefully:**
- The natural shape is: the applicant asks in **$**, and the reviewers' counter-offer can trade
  cash for TeamPoints — *"we don't have that much money, but we can give you these extra
  TeamPoints."* The split is the negotiable lever, not just the rate.
- **What a TeamPoint is worth is explicitly out of scope for the bot.** Its value (sweat equity,
  future retribution, utility in whatever the team produces) is settled person-to-person. The bot
  carries two numbers through the flow; it does not model or argue token valuation.
- That framing keeps this small. The downstream model **already supports it**:
  `betaApp.ts:135-136` sends `marketRate` (total monthly value) alongside `fiatRequested` (the cash
  portion), and the bot currently hardcodes `fiatRequested` to `DEFAULT_FIAT_REQUESTED` (0 = all
  TeamPoints). The gap is entirely in the *negotiation and review* surface — nothing in the bridge
  or the backend needs changing.
- Concretely: let a reviewer's counter carry a cash portion as well as a rate, show the contributor
  both numbers in the offer, and pass the agreed split through instead of the hardcoded default.

**Sharper than "a missing parameter" — the default is applied silently (verified live 2026-09-09).**
Neither `DEFAULT_FIAT_REQUESTED` nor `FTE_HOURS_PER_MONTH` is set in Railway, so the defaults stand.
When contributor `c_1788807562702` accepts, the bot will POST `marketRate: 6400` ($40/hr x 160h),
`fiatRequested: 0`, `commitment: 50` — i.e. **$6,400/month of value, none of it in cash.**

Now compare what the humans said. The contributor asked in dollars, the reviewer's counter was
*"It's above our budget for this role, can we reduce it to $40?"* — a sentence about **money** — and
the offer he is looking at reads "$40/hr". The record that comes out the other end says zero money.
Nobody in that conversation agreed to a split, because nobody was asked; the default quietly chose
one. This is a documented decision (D-015), not a bug, but a decision only works if the people it
binds know it is being made, and this run shows they don't. The live agreement is the most useful
possible prompt for the client conversation — it is Gustavo's own terms demonstrating his point.

**Open question for the client, worth answering before any of this is built:** `marketRate` is a
full-time-equivalent figure (hourly x 160) sent *alongside* `commitment: 50`. That is correct only
if Collabberry reads `marketRate` as an FTE benchmark and pro-rates it by commitment. If it reads it
as actual monthly compensation, the figure is double what it should be. Not asserted either way —
but it is the kind of mismatch that quietly pays someone 2x.

---

## Open Issues (Production Blockers & Hardening)

### 7. Invite-token consumption robustness (backend fork) — RESOLVED (2026-07-23)
- **Original ordering bug (FIXED, committed `85b17ce`):** the single-use invite token was consumed
  (`usageCount++`, `isActive=false`) *before* the email-uniqueness check, so a duplicate-email
  signup burned the token with no user created and the retry dead-ended with a misleading
  "Invalid or expired invitation token." Email + wallet checks now run **before** consume.
- **Atomicity (FIXED, committed `f522639`, pushed to `Coh3rence/backend`):** consume + user-create
  now run in ONE `AppDataSource.transaction` with an atomic conditional UPDATE
  (`SET usageCount = usageCount + 1, isActive = CASE WHEN usageCount >= usageLimit THEN false ELSE
  isActive END WHERE token = ? AND isActive = true AND usageCount < usageLimit`, then assert
  `affected === 1`). This closes all three residuals at once:
  - **Double-spend:** two concurrent redemptions of a `usageLimit:1` token can no longer both win —
    exactly one affects a row; the loser gets a clean 400.
  - **Token-burn-on-failure:** a failed `save(user)` (e.g. a racing unique address/email hit) rolls
    back the increment inside the transaction, so the link stays usable.
  - **Uncaught 500:** a duplicate-entry violation that slips past the pre-checks is mapped to a
    clean **400** (`isDuplicateEntryError`) instead of surfacing as a 500.
- **MySQL gotcha baked into the fix:** MySQL evaluates SET assignments left-to-right and later
  expressions see the *already-updated* column, so the deactivation guard is `usageCount >= usageLimit`
  (NOT `usageCount + 1 >= …`). Using `+ 1` deactivated a multi-use token one redemption early and
  locked out its last user — caught during retest.
- **Verified end-to-end 2026-07-23:** fresh-contributor loop through the real bot + browser signup;
  token minted → consumed exactly once (`isActive=0, usageCount=1`) → user + agreement created.
  Also validated at the SQL level (single-use blocks the 2nd redemption; multi-use stays active
  until the true limit).
- **Contributing cause (test hygiene) — FIXED:** `scripts/reset-test-data.ts` gained `--with-backend`
  to clear the Sheet AND the backend org's users/agreements/invitations in one shot, so stale users
  no longer squat on the unique email/wallet. Follow-up: `--with-backend` currently requires
  `NODE_ENV=development` (for the right sheet) and `SERVICE_ADMIN_WALLET` in the env — the plain
  one-shot invocation still needs that wiring.

### 8. Finalization depends on a manual "I've signed up" tap — HARDENING
- After the contributor accepts, the bot issues an invite and waits for the contributor to tap
  "I've signed up." Nothing auto-detects the completed signup; if they tap too early (before
  signup) it silently no-ops, and if they never tap, the agreement is never created.
- Observed live 2026-07-22: signup completed and the member appeared in the roster, but the
  agreement stayed uncreated until the button was tapped.
- **Fix idea:** after issuing the invite, poll `resolveByToken` for a window and finalize
  automatically once the signup is detected, keeping the button as a manual fallback.

### 9. No per-message bot logging — HARDENING
- The bot emits no per-message/per-callback logs, so debugging depends on inspecting the backend
  DB and Google Sheet. This made end-to-end diagnosis blind during testing.
- **Fix idea:** add structured logging around phase transitions and Beta App calls
  (submit, review decision, resolve, createAgreement) for production support/observability.

### 10. Conversation state is in-memory only — lost on every restart — DEPLOYED (2026-09-11)
- `src/bot.ts` installs grammy's `session()` with no storage adapter, so all conversation state
  (phase, message history, in-flight agreement/review ids) lives in process memory.
- Any restart — deploy, crash, or the Telegram 409 `getUpdates` conflict / Railway restart cycle —
  wipes every in-flight conversation. Discovery then re-asks for details it had already collected,
  and a reviewer mid-`reviewer_feedback` loses the pending decision.
- Observed live 2026-09-07 during the client QA session: a tester asked "why does it ask for the
  same info 10x" after the bot restarted several times behind a 409.
- **Operational workaround:** never `railway up` mid-session; confirm the log tail has no recent 409
  before a witnessed run.
**FIXED IN CODE 2026-09-08.** `session()` is backed by `@grammyjs/storage-file`
writing to `SESSION_DIR`, plus a message-history cap (`SESSION_HISTORY_LIMIT`) and a 7-day expiry
sweep on the existing scheduler. See §12 for why file-backed rather than Redis, and the deploy note
below.

> **Deploy prerequisite — the fix is inert without it.** `SESSION_DIR` defaults to `.sessions`,
> which on Railway is container-local and discarded on every restart, i.e. exactly the bug this
> fixes. The deploy MUST attach a volume at `/data` and set `SESSION_DIR=/data/sessions`. The
> resolved path is logged on boot so a misconfiguration is visible rather than silent.

**DEPLOYED 2026-09-11.** Prerequisite satisfied in the same change: Railway volume `bot-volume`
created on the `bot` service at mount path `/data`, and `SESSION_DIR=/data/sessions` set. Build
`839978aa` (2026-09-11T12:28:30Z) booted clean and logged `Sessions persisted to /data/sessions`
— the boot line above confirming the volume took, rather than the silent `.sessions` fallback.

**PROVEN LIVE 2026-09-14.** Candidate `535329585` was mid-discovery — the bot had greeted them by
name, echoed their stored profile and posted "Finding the best opportunities for you…" — when the
`bot` service was deliberately restarted (`railway redeploy`, build `2026-09-14T14:28:21Z`,
replacing `09:08:50Z`). The contributor then continued in the same thread and selected the
Frontend Developer role; the bot carried on without re-asking anything or demanding `/start`.

This is the half the 2026-09-11 deploy note called out as still unproven: state is genuinely
re-read on the far side of a restart, not merely written to the right path. The restart was done
for an unrelated reason (checking the configured model), which is why it happened mid-flow —
worth keeping as the cheapest way to exercise this, since the scenario is awkward to stage
deliberately.

### 11. Reviewer counter rate is only parsed from a LEADING number — DEPLOYED (2026-09-11)
- `parseCounterFeedback` (`src/conversations/review.ts`) matches the rate with `/^\s*\$?(\d+...)/`,
  so it is captured only when the reviewer's message *begins* with the number. The prompt does ask
  the reviewer to "start with the number", but reviewers write naturally.
- **Observed live 2026-09-08 during the client QA session** on agreement `a_1788808260898`:
  the reviewer sent "It's above our budget for this role, can we reduce it to $40?".
  `suggestedRate` was stored as empty, and the confirmation degraded to the rate-less
  "Counter-offer recorded." rather than "Counter-offer recorded at $40/hr."
- **Downstream consequence (the damaging part):** aggregation had no numeric counter to average,
  so Agreements column M was left blank while Claude's synthesized prose in column N *does* quote
  "$40". The contributor is shown an offer that reads $40. On accept,
  `reconciledRate = offer.suggestedRate ?? agreement.hourlyRate` (`resolution.ts`) falls back to the
  **original $50 ask**, so the agreement is created at a rate the contributor never agreed to.
  Prose and stored terms silently disagree.
- **Fix (in `src/conversations/review.ts`, covered by `review.test.ts`):**
  1. `parseCounterFeedback` now falls back to the LAST currency-anchored amount anywhere in the
     message. A leading *bare* number still wins outright (the documented convention), but a
     leading *amount* no longer does — "$50/hr is over budget, land at $40" resolves to 40, since
     the first amount is usually the rate being argued against.
  2. `collectReviewerFeedback` refuses a counter carrying neither a rate nor a commitment. It asks
     the reviewer to restate with a number and keeps the pending decision so they can simply
     resend, rather than recording an unusable counter.
  3. The counter prompt now tells reviewers a dollar sign works anywhere in the sentence.
- **Live remediation:** the affected agreement's column M was corrected to `40` by hand so the run
  could continue; the reviewer's original blank-rate row is deliberately left in ReviewFeedback as
  evidence.

### 12. Session storage is file-backed and single-instance — DESIGN DECISION
- Fixing DEF-10 requires a durable session store. Redis is the textbook choice, but it means a new
  service, new credentials and new operational surface for a bot that runs at `numReplicas=1`.
- **Decision: use grammy's `FileAdapter` on a mounted Railway volume, accepting single-instance as
  a deliberate constraint rather than an oversight.** The bot has run at one replica since launch
  and nothing in the roadmap requires more.
- **The constraint, stated plainly:** a file-backed store is only safe while exactly one instance
  runs. Two replicas would write the same files concurrently and corrupt sessions. Scaling the
  `bot` service past one replica is therefore **not** a configuration change — it requires swapping
  the adapter first.
- **The swap, when it is needed:** `@grammyjs/storage-redis` exposes the same interface, so it is a
  one-line change to the `storage` option plus a Redis service. No session code changes. Triggers
  are (a) needing more than one replica, or (b) sustained message volume where per-message file
  I/O measurably lags.
- Recorded here so the tradeoff is a documented choice with a known exit, not a landmine for
  whoever next opens the Railway dashboard and scales the service.

### 13. Capacity ceiling is the Google Sheet, not the bot — CAPACITY NOTE
- **Estimated from code inspection, not from a load test.** Treat the figures as an order of
  magnitude and measure before committing to them with a client.
- Each inbound message costs **2–4 Sheets API calls**. `handleGate` alone reads `isAuthorized`,
  then `getAdminIds` for an unauthorised user, then `getContributor`, then `getOpenOpportunities`;
  `handleDiscovery` adds a contributor read plus a write, and re-reads the open roles on completion.
- Google's published quota is **60 reads and 60 writes per minute per user**, and the bot
  authenticates as a single service account — so the per-user quota is the whole bot's budget. The
  300/minute per-project ceiling is never the binding one.
- That gives roughly **15–30 messages per minute in total**, or **10–15 people in active
  conversation simultaneously**. Registered-but-idle users cost nothing, so roster size is
  effectively unbounded; only concurrent chatter counts.
- **The failure mode is abrupt, not graceful.** Over quota, Sheets returns 429 and the calls throw.
  There is no retry, backoff or queue, so the bot fails mid-conversation rather than slowing down.
- **Cheapest headroom is caching, not new infrastructure.** `isAuthorized` and `getAdminIds` run on
  nearly every message and change maybe weekly. A short in-memory TTL cache (~60s) on those two
  would cut sheet traffic by more than half and roughly double the ceiling. Do this before
  considering a database.
- **When the Sheet has to go:** sustained bursts — fifty applicants in an afternoon — exceed what
  caching can absorb. That is a store migration, materially larger than the session-persistence
  change in `FIX-PLAN-DEF10-SESSION-PERSISTENCE.md`, and out of MVP scope. The Sheet is deliberate
  for the MVP so the client can inspect state directly (QA document §5).

### 14. Renegotiating orphans the previous agreement — DEPLOYED (2026-09-11)
- `review:modify:` (`src/conversations/review.ts:29`) only sets `phase = "negotiation"` and replies.
  It never touches the agreement the contributor is walking away from, and `negotiation.ts:123`
  then inserts a **new** row. Nothing marks the old one superseded.
- **Observed live 2026-09-08** on contributor `c_1788807562702`: three Agreements rows for one
  application — `a_1788808260898` still `under_review` after being superseded, an abandoned `draft`
  `a_1788858346291`, and the live `a_1788858438270`.
- **Consequences, in order of severity:**
  1. The superseded row keeps its 48h deadline, so the timeout sweep will **escalate a dead
     proposal** and DM every admin about it. This is the user-visible one.
  2. Reviewers still hold live buttons on the old proposal and can record decisions against it.
  3. Abandoned `draft` rows accumulate — one per renegotiation pass — and never get cleaned up.
- **Not a data-integrity issue.** The live agreement is correct and the contributor's terms are
  right; the damage is noise and reviewer confusion, not a wrong hire or a wrong rate.

**Recurred live 2026-09-09, and consequence (2) is worse than first assessed.** After both
reviewers approved `a_1788858438270`, the contributor tapped **Modify Terms** on the offer — by his
own account simply because the button was there — renegotiated, and resubmitted as
`a_1788962327012` with **identical** terms ($40/hr, 50%, 6 months, likelihood 86). That leaves two
`under_review` rows whose reviewer DMs are *character-for-character the same*. On 2026-09-08 the
stale message was at least distinguishable by price ($50 vs $40); here nothing distinguishes them
but position in the chat.

The failure mode is a **silent no-op that looks like success**: a tap on the older message writes a
ReviewFeedback row against the dead agreement, `maybeCompleteReview` then bails because that row is
already aggregated, and the live proposal receives nothing. The reviewer believes they approved.
Quorum is never reached and the proposal escalates at its 48h deadline with no one aware anything
was missed. Mitigated on the day only by telling both reviewers to go by message position.

This also re-demonstrates the round-cap bypass: `a_1788962327012` is a second review cycle recorded
as `negotiationRound = 1`, so nothing would have stopped a third or fourth loop, each one spawning
another indistinguishable pair of buttons.
- **Related — DEF-1's round cap can be bypassed (verified 2026-09-08, not just suspected).**
  The cap itself is correct: `resolution.ts:161` reads the round off the *persisted row* rather
  than the session, refuses a third round, and `resolution.ts:181` carries `round + 1` onto the
  replacement. But that is the only path that maintains the counter. Two routes reset it to 1:
  - `bot.ts:137` — re-selecting an opportunity (`select_opp:`) hard-sets
    `ctx.session.negotiationRound = 1`. A contributor who navigates back to their matches and picks
    the role again gets a fresh round budget.
  - Session loss (DEF-10) — the `initial()` factory returns `negotiationRound: 1`, so any restart
    mid-negotiation silently restores a full budget. Fixed by the persistence change, but only for
    restarts, not for the `select_opp:` route.
  - `review.ts:29` (`review:modify:`, the pre-submission edit) leaves the counter untouched, which
    is correct — that edit happens before a round is consumed.
  Evidence: `a_1788858438270` is genuinely a second-round proposal and is recorded as round 1.
**FIXED (2026-09-08), DEPLOYED 2026-09-11.** Four changes:

1. **New terminal status `superseded`** (`models/types.ts`). Both renegotiation paths now retire the
   row they replace: `review:modify:` (pre-submission draft) and `resolution.ts` `action === "modify"`
   (post-review). The timeout sweep already skips anything not `under_review`, so consequence (1) —
   escalating a dead proposal — goes away with no change to `timeout.ts`. The status write is
   deliberately non-fatal: a stale row left behind beats stranding the contributor outside
   negotiation over a Sheets hiccup.
2. **Reviewer buttons are checked against live status** (`ensureOpenForReview`, `review.ts`). A tap on
   a keyboard for a proposal that is no longer `under_review` is refused with an explanation instead
   of recorded, closing consequence (2). Re-checked again in `collectReviewerFeedback`, since a
   reviewer can tap Counter while the proposal is open and only type their reply after it is revised.
3. **The round counter moved out of the session and into the sheet.** `SessionData.negotiationRound`
   is deleted — it was written in four places and read in one. `nextNegotiationRound()` derives the
   round from the contributor's prior agreements for that opportunity, counting only rows whose
   review actually closed and returned a result (column N populated) — including a unanimous
   approval the contributor then renegotiated, since reviewers spent a cycle either way. Abandoned
   drafts and no-quorum escalations do not burn a round. Both bypass routes are closed: `select_opp:`
   no longer resets anything, and a restart has nothing to lose. Abandoned drafts and no-quorum
   escalations correctly do not burn a round.
4. `review:modify:` also clears `currentAgreementId` and strips the old keyboard, so a stale
   "Submit for Review" button can't push withdrawn terms to reviewers.

Consequence (3) — accumulating `draft` rows — is *not* fixed. The rows are still written; they are
now marked `superseded` rather than left as live `draft`s, which removes the hazard but not the
clutter. Purging them is deferred: harmless at current volume, see §13.

Tests: `nextRoundFromHistory` (round consumption rule, incl. per-role isolation and that the cap
still bites) and `ensureOpenForReview` (open / superseded / decided / draft / missing).

---

### 15. Admin broadcasts are not filtered against the candidate — DEPLOYED (2026-09-11)

`reviewRecipients` correctly excludes a contributor from reviewing their own proposal, but the two
admin *broadcast* paths do not apply that filter — both DM everyone `getAdminIds()` returns:

- `escalateReview` (`services/timeout.ts`) — on a 48h no-quorum expiry, sends *"agreement `<id>`
  reached its 48h deadline without quorum (1/2 reviewers responded, 2 needed). It needs a manual
  decision."*
- `notifyAdminsOfWriteFailure` (`conversations/review.ts`) — on a failed feedback write, sends the
  agreement id, the reviewer's name, and their decision.

**Why it bites here.** In this deployment every participant is `role=admin` (see §Review pool), so
a contributor who is also an admin receives internal review-process messaging about their own
application — reviewer response counts, another reviewer's name and decision. Live risk right now:
contributor `c_1788807562702` is admin `302836662`, so if `a_1788962327012` escalates on
2026-09-11 13:58 UTC he is told his own proposal failed to reach quorum.

**Not currently causing harm** — no escalation has fired — and it is partly an artefact of the QA
setup, where the reviewer pool and the candidate overlap. It becomes a genuine confidentiality
problem the moment a real contributor is also an admin, which the role model permits.

**Fixed 2026-09-10.** Both broadcasts now resolve the agreement's contributor and route through
`reviewRecipients` with the same self-review escape hatch the review pool uses, so a solo dev run
still receives its own alerts. `escalateReview` takes the candidate's telegram id as a parameter and
loops over the filtered list; the escalation counts quoted in the message were already computed
against that pool, so they now agree with who was actually asked.

`notifyAdminsOfWriteFailure` resolves the candidate **best-effort**: it runs on an already-failing
Sheets path, so if the contributor lookup also fails it logs and falls back to the unfiltered admin
list. Losing the alert entirely is worse than the narrower leak.

Covered by `services/timeout.test.ts` (candidate excluded; other reviewers still alerted; non-admin
candidate leaves the list intact; status moves to `escalated`, never auto-approved; counts quoted
against the filtered pool) and the `notifyAdminsOfWriteFailure` block in
`conversations/review.test.ts` (including the fallback when the lookup throws).

---

### 16. A unanimously rejected candidate can hire themselves — DEPLOYED (2026-09-11)

`presentToCandidate` (`services/presentation.ts`) builds its keyboard **unconditionally** — Accept /
Modify Terms / Walk away — and never branches on `CounterOffer.outcome`. `handleResolution`'s
`accept` branch does not check the outcome either. So on an `all_reject` aggregation the candidate
is shown:

> The reviewers did not propose a rate.
> Reviewers declined. Reasons: …
> How would you like to proceed?   `[Accept] [Modify Terms] [Walk away]`

Tapping **Accept** takes the normal approval path: `getCandidateOffer` returns non-null (the decline
text populates column N), `suggestedRate` is null so `reconciledRate` falls back to the
contributor's own asking rate, status is set to `approved`, an invite link is issued, and on signup
the bot POSTs the agreement to Collabberry and marks the contributor `hired`.

**A candidate every reviewer rejected can hire themselves at their original asking rate by tapping
a button.** No reviewer is notified, nothing blocks it downstream — the on-chain signature is the
only remaining human gate, and it comes after the record exists.

**Severity note.** This is a different class from §11/§14, which produced noise and confusion but
never a wrong outcome. This one writes a materially wrong result into the production system, and it
requires no unusual behaviour from the candidate — "Accept" is the obvious button to press.

**Not yet observed live.** No proposal has been unanimously rejected; every review so far has been
all-approve or mixed. Found 2026-09-09 by tracing what a reject would do before asking a reviewer
to test one, rather than from an incident.

**Fixed 2026-09-10**, in two layers, because hiding a button is not disabling it.

*The verdict has to be recomputed.* `updateAgreementAggregation` persists only the rate, summary and
commitment — the `outcome` field is never written to the sheet, so there is nothing to branch on
after a restart. The verdict is therefore derived from the ReviewFeedback rows by a new
`unanimouslyRejected` in `services/quorum.ts`. It must agree with `aggregateFeedback` *exactly*: if
the guard and the aggregation disagreed, the bot would build a counter-offer while refusing the
candidate permission to accept it. So `dedupLatestPerReviewer` was moved out of `claude.ts` into
`quorum.ts` and both now share it, and — deliberately, matching aggregation — neither filters
against the review pool. A reviewer who votes twice is counted once, by their latest word.

*Layer 1, presentation.* `presentToCandidate` branches before building the keyboard. On a unanimous
rejection the DM carries **no buttons at all** and never quotes a rate. The client's rule for an
attempt that ends without agreement is the same one walking away follows — thank them, cool down,
invite them back — so the attempt is closed here rather than left open waiting for the candidate to
consent to their own rejection. Both endings now share `services/decline.ts` (`closeAsDeclined`:
status → `rejected`, contributor → `cooldown`, `previousAttempts` incremented). Ordering is
load-bearing: the close runs *after* `markCandidateNotified`, so a failed send retries the DM rather
than re-incrementing the attempt count.

*Layer 2, the handler.* `refuseIfDeclined` guards the `accept` branch of `handleResolution`, since
callback data is replayable — an Accept from an earlier round, or from a message sent before this
fix, stays tappable in the chat forever. It also covers the round-cap branch, which offers its own
Accept button.

Covered by `services/quorum.test.ts` (unanimity semantics, including re-votes and the deliberate
absence of a pool filter), `services/presentation.test.ts` (no keyboard, no rate quoted, attempt
closed and cooled down; mixed/counter/all-approve/no-feedback still get the three buttons) and
`conversations/resolution.test.ts` (a replayed Accept is refused; every non-unanimous verdict is
still accepted).

### 17. Production Anthropic key is out of credit — the bot answers nothing — PRODUCTION BLOCKER (2026-09-11)

- **Observed live 2026-09-11T12:30Z**, immediately after the deploy of build `839978aa`.
  `scripts/health-check.ts`, run as `railway run --service bot` so it reads the injected production
  environment, returned:
  `FAIL anthropic api key 400 — Your credit balance is too low to access the Anthropic API.`
  Every other check passed: backend `auth/nonce` 200, frontend root and `/member-sign-up` 200,
  backend org roster 200, Telegram identity `@Coh3erence_hr_bot` (8811416846).
- **This is the production key, not a local one.** Bun auto-loads `.env`, so the check could in
  principle have tested the developer key. Ruled out by fingerprint: SHA-256 prefix of the key seen
  under `railway run` is `eb2f7cd5da5e`, versus `afc43b46c136` locally. Railway's injected variable
  takes precedence, so the failing key is the one the deployed bot uses.
- **Why it is worse than an error message.** `src/services/claude.ts` contains no `try`/`catch`, so
  the SDK rejection propagates to the global handler at `src/bot.ts:148`, which only does
  `console.error`. Nothing is sent to the user. A contributor messaging the bot gets **silence**,
  not an apology — indistinguishable from the bot being down.
- **Blast radius: every LLM-backed step.** Discovery extraction, matching narration, negotiation
  handling and review aggregation all route through `claude.ts`. Non-LLM paths (sheet reads, button
  callbacks) still work, so the bot will look partly alive, which makes the failure harder to read
  from the outside.
- **Action required from the client/owner:** top up the Anthropic account or set a funded
  `ANTHROPIC_API_KEY` on the Railway `bot` service. No code change is needed to restore service.
- **Hardening worth doing regardless (not yet built):** wrap the Claude calls so an API failure
  sends the user a plain "I'm having trouble right now, please try again shortly" instead of
  nothing. A dead LLM should degrade loudly, not silently. Related to §9 (no per-message logging) —
  with neither, an outage is invisible from both sides.

**RESOLVED 2026-09-11T13:19Z.** Credits purchased; `health-check.ts` now returns
`PASS anthropic api key 200` with all six checks green. The silent-failure hardening above is
still unbuilt — the underlying fragility remains, it simply is not currently triggered.

### 18. The model is env-overridable; QA runs on Haiku — DESIGN DECISION (2026-09-11)

- Both Claude calls previously hardcoded `claude-sonnet-4-5-20250929`, so reducing spend for a test
  run meant editing source and redeploying. The model now comes from `ANTHROPIC_MODEL`
  (`src/config.ts`), read once in the `ClaudeService` constructor.
- **Default remains Sonnet, deliberately.** The two jobs carry different risk. `extractStructured`
  is forced tool-use against a fixed schema and tolerates a smaller model. `aggregateFeedback` is
  judgement work — synthesising several reviewers into one counter-offer is what the client called
  *"intersubjective aggregation"* and named as the product's differentiator. A quiet quality drop
  there would be a drop in the thing being sold.
- **Production is currently set to `claude-haiku-4-5-20251001`** to keep the cost of the live QA
  scenarios down. Verified live the same day: production resolves the model and returns a reply, so
  the id is valid — worth checking explicitly, because an invalid model id would fail through the
  same silent path as §17 and look identical to the bot being dead.

> **Restore before any client-witnessed run.** Unset `ANTHROPIC_MODEL` on the Railway `bot` service
> (or set it back to `claude-sonnet-4-5-20250929`) and redeploy. Judge output quality only on
> Sonnet; Haiku is for exercising the plumbing, not for assessing the aggregation copy.

### 19. A split approve/reject verdict lets the candidate accept at their own ask — FIXED (2026-09-12), DEPLOYED 2026-09-14

Same family as §16, but reached from the opposite direction. §16 closed the case where *every*
reviewer declined. This is the case where they **disagree** — and it was the more likely of the
two to happen in practice.

> **Correction, same day.** This was first written up as "a reviewer counters without naming a
> number". **That premise is wrong** — `collectReviewerFeedback` already refuses a numberless
> counter and asks the reviewer to resend (`src/conversations/review.ts:196`), so a `counter` row
> always carries a rate or a commitment. The state was reached here only because the QA harness
> wrote the row directly and bypassed that guard.
>
> The defect is nonetheless real, by a different and more ordinary route: **one reviewer approves,
> another rejects, and nobody counters.** `meanOfCounters` averages only rows with
> `decision === "counter"`, so with no counters it returns `null` for both rate and commitment,
> while the verdict is `mixed` rather than `all_reject`. That is the plainest possible split
> decision — and the "dispute between the admins" flow the client asked about.

**The reachable trigger:** a split approve/reject with no counter-offer. From there:

1. `aggregateForAgreement` returns a `CounterOffer` with `suggestedRate: null`.
2. `presentToCandidate` renders *"The reviewers did not propose a rate."* — and still offers
   the **Accept** button (`src/services/presentation.ts:77-97`).
3. `handleResolution` accept reconciles with
   `offer.suggestedRate ?? agreement.hourlyRate` (`src/conversations/resolution.ts:54`).

The fallback is the candidate's **own original ask**. So "Accept" on a proposal the reviewers
pushed back on approves it at the full asking rate, and bridges that to Collabberry. The
candidate is not doing anything wrong — it is the only affirmative button on screen.

**Live evidence, 2026-09-12.** Seeded `a_qa6_1789223297207` at $75/hr against `opp_002`
(band $45–70). Aggregation returned:

```json
{ "suggestedRate": null, "suggestedCommitment": null, "outcome": "mixed", "reviewerCount": 2 }
```

The candidate DM read *"The reviewers did not propose a rate"* and carried an **Accept** button.
Tapping it would have recorded $75 — $5 above the top of the advertised band — and bridged that
to Collabberry.

**The gap: Accept is offered when there is nothing to accept.** When a `mixed` outcome carries
neither a rate nor a commitment, the honest options are *Modify Terms* and *Walk away* — the same
reasoning §16 applied to a unanimous rejection. An Accept button whose only possible meaning is
"approve my own asking rate" should not be rendered.

Noted while confirming: the accept path had **no `under_review` status guard**.
`refuseIfDeclined` blocks only the unanimous-rejection case, so a stale Accept button on a
`superseded` agreement was still actionable — the reviewer side got this guard in §14
(`ensureOpenForReview`), the candidate side did not.

**FIX (2026-09-12).** Both the button and the guard, since either alone leaves a hole — hiding a
keyboard does not disable it, and guarding without hiding shows the candidate a button that only
ever errors.

- `presentToCandidate` no longer renders **Accept** when the offer carries neither a rate nor a
  commitment *and* the reviewers did not unanimously approve. The candidate is told plainly that
  no revised offer is on the table and is offered *Modify Terms* / *Walk away*
  (`src/services/presentation.ts`).
- `unanimouslyApproved` added beside `unanimouslyRejected` (`src/services/quorum.ts`) to separate
  the two reasons a rate can be absent. **This carve-out is the load-bearing part:** on an
  all-approve, a missing rate means nobody wanted a change, so the candidate's own terms *are*
  what was approved and Accept must still appear. Suppressing on `rate == null` alone would have
  blocked legitimate hires.
- `handleResolution` now refuses `accept` / `modify` / `walkaway` unless the row is still
  `under_review` (`src/conversations/resolution.ts`). `linked` is exempt by design: it runs after
  `accept` has already moved the row to `approved` and is the continuation of that decision.

Covered by 9 new tests (`presentation.test.ts`, `resolution.test.ts`), including the all-approve
carve-out and the `linked` exemption. Suite: 105 pass.

**Verified in production 2026-09-14**, on build `2026-09-14T09:08:50Z`, against candidate
`535329585`:

- *Accept suppressed on a split verdict.* The DM for `a_qa6_1789226741319` carries the new
  "there's no revised offer for you to accept yet" wording and no Accept button. That sentence is
  emitted only by the new branch, so its presence is itself proof the suppression fired.
- *Reconciliation.* Accepting `a_qa6_1789226816573` moved `hourlyRate` `75` → **`60`** and the
  status to `approved` — the candidate was hired at the reviewers' counter, not their own ask.
- *Stale button refused.* Tapping Accept a second time on that same (now `approved`) message was
  refused with the guard's wording, and wrote nothing: the `collabberryInviteToken` stayed
  `87903afd-…`, which a second successful accept would have replaced with a freshly minted token.
  That unchanged token is the evidence, not the reply text.
- *Deleted rows fail closed.* Tapping Accept on the deleted first run (`a_qa6_1789223297207`)
  produced "I couldn't find that agreement", logging `handleResolution: agreement … not found`.
  This is what makes deletion a safe cleanup strategy for seeded QA rows (ledger R3).

Reconstructing the above required diffing sheet cells and comparing invite tokens, because the
bot logged exactly one line across the whole session — see §9. The absence of per-message logging
is a live QA cost, not just a hardening nicety.

**Deliberately left open: a rejection carries no terms into the aggregate.** A reviewer who
rejects is asked for "what would need to change", and that prose is summarised for the candidate,
but no rate is ever parsed from it — `parseCounterFeedback` runs only on `counter`. So a reject
saying "fine at $50" cannot move the offer to $50; the candidate has to re-enter negotiation and
propose it themselves. That is now a friction cost rather than a correctness risk, and changing it
means deciding whether a rejection may set terms at all — a product question for the client, not a
patch.

### 20. Aggregated reviewer copy is sent to the candidate unvalidated — FIXED IN CODE, AWAITING DEPLOY (2026-09-15)

`aggregateForAgreement` takes whatever `claude.aggregateFeedback` returns as `qualitativeSummary`
and `presentToCandidate` puts it in the DM verbatim. Nothing between the model and the candidate
checks it. Two things surfaced in the 2026-09-12 runs:

**An unfilled placeholder reached candidate-facing copy.** The split-verdict run
(`a_qa6_1789226741319`) produced:

> "We'd encourage you to consider gaining additional targeted experience in **[relevant area]** and
> welcome you to reapply in the future…"

A literal `[relevant area]` would have been sent to a real person.

**The copy asserted a rate the offer did not carry — the most serious of the three.** The first
run (`a_qa6_1789223297207`, since deleted) had no aggregated rate at all, so the DM's own header
said *"The reviewers did not propose a rate."* The prose underneath it said:

> "Our current band for this position is **$60**, which represents fair compensation for the scope
> and level we've defined. We'd like to move forward at this rate."

There was no $60 anywhere in the feedback rows or in the structured offer — the model supplied it.
Because that run predates §19, the message also carried an **Accept** button, and accepting would
have reconciled to `offer.suggestedRate ?? agreement.hourlyRate` = the candidate's own **$75**.
So the candidate reads $60, taps Accept, and is hired at $75. §19 removes the button on this
verdict, which closes the money path; it does **not** stop the prose inventing a figure, and a
number invented on a *counter* verdict would still be shown next to a different real rate.

Evidence is the 2026-09-12 16:28 CEST DM to `535329585`, preserved in the QA transcript; the
sheet row was deleted per ledger R3, so the DM is the only remaining copy.

**The tone contradicted the buttons.** That same summary reads as a rejection — *"reapply in the
future"* — on a `mixed` verdict where the product's intent is to keep negotiating, and where the
message underneath now offers *Modify Terms*. The candidate is told to go away and invited to
continue in the same breath.

Both were produced on **Haiku** (§18), so this is not evidence about the model that ships, and the
counter-offer run on the same day (`a_qa6_1789226816573`) returned clean, on-message copy. The
structural point stands regardless of model: there is no floor under what reaches the candidate.
A cheap guard would be to reject a summary containing bracketed placeholders and fall back to the
deterministic phrasing the all-reject path already uses, rather than trusting every generation.

Re-check on Sonnet before deciding how much to build — and treat this as a reason to hold the
restore to Sonnet (§18, ledger R1) as a release gate rather than a nicety.

**FIXED IN CODE 2026-09-15.** `src/services/summaryGuard.ts`, applied in `claude.ts` at the one
place a model writes candidate-facing prose freehand — the mixed-verdict branch of
`aggregateFeedback`. The all-approve, all-reject and single-reviewer paths are deterministic
already, and a lone reviewer's own words are authoritative, so none of them are touched.

`findSummaryViolation` refuses a summary that:
- contains a square- or curly-bracketed placeholder;
- names a dollar figure — `$60` or a bare `60/hr` — that is not the aggregated rate, the
  candidate's own ask, or some reviewer's counter;
- is empty, which `chat()` returns whenever the response carries no text block.

On refusal the copy falls back to `deterministicSummary`: the reviewers' own comments, which
cannot invent a figure because no model generated them. The rejection is logged with its reason,
so the guard firing is visible in the deploy logs rather than silent (§9).

Because the guard sits inside `aggregateFeedback`, the sanitised text is what
`updateAgreementAggregation` persists — the stored record and the DM cannot disagree.

**Verified against the real production strings**, not only synthetic ones. The `[relevant area]`
copy from `a_qa6_1789226741319` is refused; the invented-`$60` copy from the deleted first run is
refused; the genuinely clean counter-offer from `a_qa6_1789226816573` passes untouched, which is
the false-positive case that matters. 14 new tests, suite 119 pass.

**The third symptom is handled at the prompt, not the guard.** The system prompt now forbids
figures absent from the feedback, forbids bracketed placeholders, and states that this is a
continuing negotiation so the model must not tell the contributor to reapply. Tone is not
deterministically checkable, so there is no floor under it the way there is under the other two —
if the copy again reads as a rejection on a `mixed` verdict, that is a prompt problem to iterate
on, and it is worth re-reading once production is back on Sonnet.
