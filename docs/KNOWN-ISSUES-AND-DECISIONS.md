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

### 20. Aggregated reviewer copy is sent to the candidate unvalidated — FIXED (2026-09-15), DEPLOYED 2026-09-22

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

**DEPLOYED 2026-09-22**, build `2026-09-22T06:48:13Z`, with `ANTHROPIC_MODEL` removed so the bot
is back on Sonnet (ledger R1). The §18 release gate was then run against the live production
configuration: both real 2026-09-12 inputs — the approve+reject at $75 that produced
`[relevant area]`, and the approve+counter at $60 — synthesised three times each.

- **6 of 6 clean.** No placeholder, no unsupported figure, no tone tell in any run.
- **The guard fired 0 times**, which is the result that mattered. A guard that replaced decent
  Sonnet copy with the blunt deterministic fallback would have been a downgrade disguised as a
  fix; it stays out of the way and only the unit tests (which feed it the actual bad strings)
  exercise the fallback.
- **The third symptom is gone on Sonnet.** The prompt change holds: every run of the
  approve+reject case invited the candidate to revise their terms rather than telling them to
  reapply in future. Worth spot-checking again after any prompt edit, since nothing enforces it.
- Case B cited `$75` and `$60` and nothing else — both supported figures (the candidate's own ask
  and the reviewer's counter), so the guard correctly let them through.

---

### 21. Selecting an opportunity does nothing if an earlier agreement id lingers — FIXED (2026-09-23)

**Symptom, hit live.** The candidate tapped *Frontend Developer* on the match keyboard and the
bot said nothing at all. No reply, no error message, no `Bot error:` line in the Railway log —
the conversation simply stopped. Retapping did nothing either.

**The tap was not lost.** The session on the production volume had moved:

```json
{ "phase": "negotiation", "selectedOpportunityId": "opp_002",
  "currentAgreementId": "a_qa6_1789226816573" }
```

`select_opp:` set the phase and the opportunity, then called `handleNegotiation`, which fell
through to a silent `return`. The entry branch was gated on **two** conditions:

```ts
if (!ctx.session.currentAgreementId && !ctx.message?.text) { /* introduce the role */ }
const text = ctx.message?.text;
if (!text) return;            // <- a callback query always lands here
```

A callback query carries no message text, so with `currentAgreementId` set the tap skipped the
introduction and hit `if (!text) return`. That line is unreachable by any legitimate path — its
only effect was to swallow this one.

**Not a QA artefact.** `a_qa6_1789226816573` happened to be a QA row deleted from the sheet on
2026-09-22, which is what made this surface now — §10's session persistence (correctly) kept the
id across restarts while the row itself went away. But the id does not need to be stale:
`select_opp:` never cleared it under any circumstance, so **any contributor who finishes one
agreement and later picks a second opportunity gets the same dead end**. It needed a returning
contributor to reach, which is why five QA rounds of first-time candidates missed it.

**Fix, two parts.**
1. `select_opp:` now clears `currentAgreementId` and `negotiationContext` — a new opportunity is
   a new draft. This is the same reset `resolution.ts:218` already performed before re-entering
   negotiation from *Modify*; the keyboard path had simply never been given it. Clearing
   `negotiationContext` also stops a *Modify* brief for one role leaking into the system prompt
   of a negotiation for a different one.
2. `handleNegotiation` now branches on message text alone, deleting the unreachable
   `if (!text) return`. Entering without text can only mean the keyboard, which always warrants
   the introduction.

Either part alone fixes the reported symptom; together they remove the silent path entirely.

**Regression test** (`negotiation.test.ts`, 4 tests) pins the case with a lingering agreement id.
Confirmed to fail against the previous condition and pass against the fix, so it is testing the
behaviour and not just passing. Suite 123 pass.

**Worth generalising:** a handler that returns without replying is invisible in production. There
is no log line, no error, and Telegram shows the user nothing — §9 (no per-message logging) is
what made this cost a live debugging session rather than a glance at the logs.

---

### 22. A leading duration is parsed as the hourly rate — FIXED (2026-09-24)

**Found by fuzzing the parser with realistic reviewer prose**, not by a failing run — while
deciding whether reviewers could be left to word their counters freely instead of being handed a
script to paste.

`parseCounterFeedback` takes a leading bare number as the rate, because §11's prompt asks the
reviewer to "start with the number". But a reviewer who opens with a duration gets that counted
as money:

```
"6 months at $70 would work better for us."   ->  rate = 6     (the $70 ignored)
"40 hours a week at $70."                     ->  rate = 40
```

**Why this one was worth stopping before a client-witnessed run.** The candidate would be shown,
and could accept, a counter-offer of **$6/hr** — a figure nobody proposed. §20's guard does not
help: it validates the model's summary against the *stored* suggested rates, and once `6` is
stored it is a supported figure, so copy citing "$6/hr" passes. **The guard catches invented
numbers, not correctly-stored wrong ones** — a useful limit to remember about it.

**Fix.** A leading number immediately followed by a duration unit
(`months|mos|weeks|wks|days|years|yrs|hours`) is not a rate; parsing falls through to the
currency-anchored branch, which finds the `$70`. `hr`/`hrs` are deliberately **excluded** from
that list — they denote the rate itself, so `60 hr` and `60/hr` must keep parsing as $60. A
duration-only counter (`"we'd want 6 months rather than 3"`) now records nothing and the reviewer
is re-asked, which is correct: **duration is not a counterable dimension at all** — there is no
parser for it and `updateAgreementTerms` only reconciles rate and commitment.

5 tests added, 3 of which were confirmed to fail against the previous parser. Suite 128 pass.

**Known and deliberately not fixed — a bare rate mid-sentence is dropped:**

```
"Rate should come down to 60 and commitment to 80%."  ->  rate = null, commitment = 80
```

The `60` is neither leading nor currency-anchored, so it is ignored and only the commitment
moves. A general "last bare number wins" rule was rejected because it misfires worse — it would
read `"we'd want 6 months rather than 3"` as a rate of $3. The bot's own Counter prompt already
tells reviewers to start with the number or use a dollar sign, so this stays a prompt-adherence
case. **It fails safe** (drops a figure) where §22 failed dangerous (invents one), which is why
the line was drawn here.

---

### 23. Tapping Modify destroys the standing offer before any new terms exist — FIXED IN CODE 2026-10-06 (commit `6ed1c34`), awaiting Phase E deploy

**Witnessed live 2026-09-28.** The post-review *Modify* handler supersedes the reviewed
agreement **at the moment of the tap**, before the candidate has stated a single new term
(`resolution.ts:208`). Merely *exploring* a revision is therefore destructive: there is no way
to look at "what would I change?" and then decide the standing counter-offer was fine after all.

**The round that proved it.** `a_1790186286202` (opp_002) was submitted
2026-09-23T17:58:06Z. Gustavo countered at $60 on 2026-09-24T09:12:53Z, Simon approved at
20:53:20Z, and the aggregated counter — $60/hr — was written and presented at 20:53:29Z. On
2026-09-28 the candidate tapped **Modify** on that offer. The agreement went `superseded`
immediately; the renegotiation produced draft `a_1790584489474` ($60/hr, round 2), which was
never submitted. Net effect: a counter-offer that was *acceptable by one tap* on 09-24 no
longer exists in any form, and the candidate's only remaining moves on that pair are
submit-at-round-2-of-2 or nothing. (Decision D-a, 2026-10-05: the draft stays parked — safe
indefinitely, the timeout sweep only touches `under_review` rows.)

**Why the code is this way — this is §14's fix, not an accident.** Left `under_review`, the
old row stayed in the sweep's view (a dead proposal would escalate and DM every admin) and
kept every reviewer's inline keyboard answerable (taps landing silently on withdrawn terms —
the 2026-09-09 incident). Retiring on tap closed both. The cost, unexamined at the time, is
that the retirement happens before the replacement exists, so an abandoned revision strands
the candidate with nothing.

**The cap already bounds the damage at the boundary.** At `negotiationRound >= MAX`, Modify
is refused *before* the supersede and the row is left standing (`resolution.ts:185-199`) —
unit-tested 2026-10-01 (`resolution.test.ts`, 3 tests, mutation-verified). The destruction
only occurs on a Modify *below* the cap.

**Proposed change (decision D-d — Gustavo's call, not ours to make).** Retire-on-**commit**:
keep the reviewed agreement alive until the revised terms are actually *submitted*, and
supersede it then. This is a design change to a flow Gustavo specified, and it trades directly
against the hazard §14 closed — between tap and commit, two live rows coexist and the old
reviewer keyboards answer again. Prerequisites if approved:

1. **§24 must land first.** The unguarded `review:submit:` is exactly the door through which
   a coexisting old row becomes dangerous.
2. The old row's reviewer keyboards stay refusable via `ensureOpenForReview` only *after* the
   supersede — during the tap-to-commit window they are live by design, so the window must
   either strip the old keyboards up front or accept late taps until commit.

Also amplified by the reviewer-DM gap (QA-COMPLETION-PLAN Appendix B, issue 3): revision DMs
carry no round number or prior terms, so the two proposals this flow produces are
near-indistinguishable to reviewers — the 09-09 failure shape again.

**Disposition:** proposal sent to Gustavo 2026-10-05 as decision D-d; **approved by Gustavo
the same day** ("I'm good for you to change it! Makes sense"). Retire-on-commit ships in the
QA-closeout Phase E deploy, together with and after §24, which is its prerequisite.

**Implemented 2026-10-06 (commit `6ed1c34`, after §24 in `465a0a3`).** Modify parks the
reviewed row's id in the session (`pendingSupersedeId`) and leaves it `under_review`; the
supersede happens in `review:submit:` via `supersedePendingRevision` — fetch-and-check, so an
old row settled during the window, or a draft submitted for a different role, is left alone.
The sweep cannot escalate the standing row in the meantime (it skips aggregated rows).
Settling the standing offer (Accept/Walk away) retires the exploratory draft in turn — §24's
guard alone would let it through, since its live status is still `draft`. Session loss
mid-window degrades conservatively: the standing offer simply stays standing. 10 new unit
tests (151 total). Awaiting Phase E deploy.

---

### 24. `review:submit:` has no status guard — a stale Submit button can resurrect a dead draft — FIXED IN CODE 2026-10-06 (commit `465a0a3`), awaiting Phase E deploy

**The one callback path left unhardened.** After §14, reviewer taps are checked against live
status (`ensureOpenForReview`); after §19, candidate resolution taps are too. But
`review:submit:` (`review.ts:19-21`) writes `under_review` **unconditionally** and DMs every
reviewer. A tap on the Submit button of a draft that has since died resurrects the row and
pushes withdrawn terms to reviewers — §14's hazard arriving through the one door left open.

**Found by code reading 2026-10-02, not reproduced live.** Current exposure is narrow but
real: `review:modify:` strips the keyboard of the draft it retires (`review.ts:39`), so the
risk is drafts abandoned by *other* routes — notably `select_opp:` (§21's fix clears
`currentAgreementId` for the new role but does not supersede or strip the abandoned draft,
whose Submit button stays live in the chat history).

**Fix queued (QA-closeout Phase E):** refuse submit unless the row's live status is `draft`,
mirroring `ensureOpenForReview`'s shape, with keyboard-strip on refusal. Also a prerequisite
for §23's retire-on-commit, which widens the window in which a stale Submit tap is possible.

**Implemented 2026-10-06 (commit `465a0a3`), exactly as queued:** `ensureSubmittable` passes
only a live `draft`; anything else strips the keyboard and explains (distinct copy for
already-submitted vs. revised/decided vs. missing). The successful submit now also retires its
own keyboard, closing the double-submit window. 5 unit tests. Awaiting Phase E deploy.

---

### 25. `/add_opportunity`'s step-by-step mode is a dead end — the follow-up message lands in the contributor gate — FIXED, DEPLOYED 2026-10-06 (build `2026-10-06T12:30:21Z`, K8)

**Witnessed live during QA case B2.** The bare command replies *"You can provide all details
at once or I'll ask step by step"*, then sets `phase = "idle"` with the comment "Admin flow
handled separately" (`admin.ts:68`) — **no such flow exists**. The admin's next message routes
through the idle → gate path like any contributor text. When the admin sent the role details
as the promised follow-up, the bot answered *"Welcome back, Aleksa!"* and produced a match
list — it read the job posting as a job application. No opportunity was created, and nothing
signalled failure.

**The failure masquerades as a feature,** which is worse than an error message: an admin who
is also a contributor gets a plausible-looking match screen; an admin who is not gets
discovery asking *them* to introduce themselves. Either way the admin lands in a candidate
flow with no hint the add was dropped.

**The only working path** is everything in one message:
`/add_opportunity <title> - <description, skills, commitment range, rate range, responsibilities>`.
The one-shot branch works correctly (Claude tool-use extraction, `admin.ts:73-111`).

**Disposition:** Phase E. Minimal honest fix: the bare-command reply states the one-message
requirement and stops promising a step-by-step mode. An admin collection phase would be the
full fix but adds a session phase for little gain at current admin volume — not planned.

### 26. Every `/add_opportunity` confirmation is dropped — the ID's underscore breaks legacy Markdown — FIXED AT THE PROVEN SITE, DEPLOYED 2026-10-06 (K8); FULL AUDIT FIXED IN CODE 2026-10-06, awaiting Phase E deploy

> **VERIFIED LIVE 2026-10-16.** `/add_opportunity` run once as a throwaway
> (`opp_1792158537582`, "QA Receipt Check", `$40-50/hr` at 10-20%, `createdBy
> 535329585`) — the first run of the command since the K8 deploy. The row landed
> **and the receipt arrived**, carrying the `opp_` id whose underscore used to
> take the whole message down. Admin confirmed receipt. The fix is now evidenced
> rather than inferred from the code path. §25's bare-command reply is a separate
> branch and remains unexercised live — low value, deliberately not run.

**Witnessed live during QA case B2.** The opportunity `opp_1791280007760` was written to the
sheet correctly, but the admin never saw *"Opportunity created!"*. Railway logs show why:

```
GrammyError: Call to 'sendMessage' failed!
(400: Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 150)
payload.text: "Opportunity created!\n\n**Full-Stack Web3 Developer**\n…\nID: opp_1791280007760"
payload.parse_mode: "Markdown"
```

Byte offset 150 is exactly the `_` in `opp_1791280007760`. Legacy Markdown reads `_` as
*italics start*; every generated ID is `opp_<timestamp>` with exactly one underscore, so the
entity never closes and Telegram rejects the **whole message** — deterministically, for every
opportunity ever created (`admin.ts:102-111`). This is Appendix B issue 2's predicted failure
mode, now proven live, and from a **static template**, not model output.

**Success masquerades as failure** — the mirror image of §23/§25. The write lands, the receipt
dies, and the natural admin reaction is to retry, creating duplicate roles. (During B2 the
admin stopped to investigate instead; the sheet shows one row, no duplicate.)

**Disposition:** Phase E, same family as Appendix B issue 2. Any message that interpolates
IDs, rates, or model prose into `parse_mode: "Markdown"` has this bug; the fix is escaping or
dropping parse_mode, not sprinkling more Markdown.

**Full audit completed in code 2026-10-06 (Phase E batch).** Every send site was classified:

- **Free-text interpolation (names, titles, skills, IDs) → parse_mode dropped,
  labels de-bolded**: admin list (`admin.ts`), gate access-request DM, welcome-back
  profile and match list (`gate.ts`), discovery profile confirmation and match list
  (`discovery.ts`), negotiation role-selected message and proposal summary
  (`negotiation.ts`). Keyboards are untouched — `reply_markup` is independent of
  parse_mode.
- **Model prose → `stripBoldMarkers()`** (new export in `services/presentation.ts`,
  unit-tested): Claude dresses prose in `**bold**`, which legacy Markdown never
  rendered anyway; without parse_mode the markers would arrive as literal
  asterisks. Applied to the three `qualitativeSummary` sites in `presentation.ts`,
  the match explanations in `gate.ts`/`discovery.ts`, and the free-chat replies in
  `discovery.ts`/`negotiation.ts`.
- **Static, balanced templates → parse_mode KEPT** (intentional): `review.ts:76`
  and `review.ts:~270` — no interpolated free text inside an entity, backticks
  balanced by construction.

The resulting policy: parse_mode only on fully-static balanced templates;
everything that interpolates user/model/sheet text goes out as plain text.

### 27. Every opportunity edit fails — 12 values into an 11-column range — and the retry would have wiped the rate minimum — FIXED, DEPLOYED 2026-10-06 (build `2026-10-06T12:30:21Z`, K8)

**Witnessed live during QA case B3** — the campaign's first FAIL. The admin sent
`/edit_opportunity opp_1791280007760 raise the maximum rate to 80` and got silence. Railway
logs (2026-10-06T10:10:52Z):

```
error: Requested writing within range [Opportunities!A5:K5], but tried writing to column [L]
body: [["opp_1791280007760", …, 30, 70, 0, 80, …, "open", "535329585", ""]]
```

**Two independent defects, one masking the other:**

1. **Schema drift makes every edit fail.** The Opportunities sheet has 11 columns (header row
   ends at `createdBy`; there is no `createdAt` column). The code's model has 12 fields:
   `getOpportunities` reads `A2:K` yet maps `row[11]` as `createdAt` — always undefined
   (`sheets.ts:56,69`); `updateOpportunity` serializes 12 values into the 11-wide range
   `A{n}:K{n}` (`sheets.ts:115-132`) → Google 400, deterministically, for **every** edit.
   The error is uncaught, so the admin gets silence. `/pause_opportunity` calls the same
   method → **B4 is equally broken**, as is the §19 reopen path (`status open` edit).

2. **The partial-edit merge zeroes unmentioned bounds.** `handleEditOpportunity` rebuilds the
   whole range from the extraction with `|| 0` defaults (`admin.ts:190-194`): "raise the
   maximum rate to 80" became `hourlyRate: {min: 0, max: 80}`. Commitment has the same trap
   (`min || 0`, `max || 100`, `admin.ts:196-200`). Defect 1 rejected the write, so **the bug
   that broke the command prevented the bug that would have corrupted the data.** Sheet
   verified unchanged: the role still reads $50–75.

**Why it survived 18 passing cases:** B3/B4 had never been run; `updateOpportunity` was
unexercised in production until today. Agreements use a separate, correct write path.

**Disposition:** blocks B3, B4 and the §19 reopen — cannot pass without a code fix and a
deploy. Fix both defects together: align the write (and the phantom `createdAt`) with the
real 11-column schema, and merge partial edits against the base row instead of `|| 0`
defaults. Scheduling decision (hotfix now vs. final Phase E deploy) recorded in the ledger
when taken.

### 28. Consumed invite tokens are refused server-side only — the signup form renders anyway (UPSTREAM OBSERVATION, 2026-10-07; not a bot defect)

Found during QA case G8 (single-use invite). Reusing the consumed 09-09 token
(`06ceee59…`) with a fresh wallet at `/member-sign-up`:

- **The property under test held.** DB verified: the invitation row stayed
  `isActive=0, usageCount=1/1`, and the attempt was refused org membership — the
  new user row has `organization_id=NULL`. G8 is a PASS.
- **But the frontend never checks the token before offering signup.** The page
  renders the full "Create Your Profile" form against a dead token; the refusal
  only happens server-side at submit. A real invitee would experience this as
  filling in a profile and silently failing, not as "this invite was already used".
- **And the attempt leaves residue:** an orphaned `Users` row (`92a9a5cc…`,
  "Coh3rence Tester", wallet `0x74ec…`, no org) was created before the refusal.

**Scope:** Collabberry frontend/backend (the client's app), not the bot — no bot
code change follows from this. Recorded for handover because it shapes the invite
UX the bot's links lead into.

**Cleanup (folded into decision D-e):** delete orphaned user `92a9a5cc…`;
deactivate the still-live, never-used invite `87903afd…` (minted 2026-09-14,
`usageCount 0/1`) so no stray signup can join the org through it.

### 29. A contributor whose proposal is under review gets silence, not a status answer (OPEN — UX gap, observed 2026-10-07)

Found attempting QA case C4. Aleksa (session phase `review`, own agreement
`a_1791295559074` under review for E6) sent the bot a free-text message; the bot
replied with nothing at all.

- **Why:** `message:text` in phase `review` routes to `handleReview`
  (src/bot.ts:92), whose entire body is an `if/else if` chain over `review:*`
  callback data. Free text that is not reviewer feedback matches no branch, so
  the function returns without replying (src/conversations/review.ts:10).
- **Ruled out first:** full health check passed (Anthropic key 200, Telegram
  identity, backend, frontend — 2026-10-07T18:36Z), container up since the
  2026-10-06T12:30Z build, no errors logged. This is by-design routing, not the
  §17 credit silence or a crash.
- **User impact:** a candidate asking "any update on my proposal?" during the
  48-hour review window — the most natural question at exactly that moment —
  gets dead air. Indistinguishable from a broken bot.

**Disposition:** no code change during this campaign (the fall-through is load-
bearing: anything the candidate types must not disturb a live review). Post-
campaign fix is one `else` branch: a short "your proposal is still with the
reviewers, I'll notify you the moment there's a decision" reply. Does not block
C4 — the case runs via `/start` → matching phase, which routes free text to
discovery (profile re-extraction) as designed.

### 30. Re-onboarding an existing contributor regenerates their identity on the sheet, orphaning their agreements (OPEN — found live by C4, 2026-10-08)

Found running QA case C4. Aleksa (an existing contributor) went through discovery
again; the bot replied correctly, but the Contributors row came out with a **new
id** (`c_1790157082079` → `c_1791455337784`) and a new `createdAt`.

- **Mechanism:** `discovery.ts:81` builds a *complete* `Contributor` object —
  including `id: c_${Date.now()}`, fresh `createdAt`, and `null` wallet/Collabberry
  fields — and passes the whole thing as the `updates` to
  `updateContributor(existing.id, contributor)` (discovery.ts:105). The sheet-side
  spread `{...current, ...updates}` therefore replaces **every** column, identity
  included. The code patches `contributor.id = existing.id` back *in memory* one
  line later (discovery.ts:106) — after the write — so session state and the sheet
  disagree.
- **Blast radius:** every Agreements row referencing the old id dangles. The 48h
  timeout sweep resolves the contributor and **silently skips** on failure
  (timeout.ts:91-94) — so a dangling agreement never escalates and never
  aggregates. For a *hired* contributor the overwrite would also null
  `walletAddress`/`collabberryUserId`/`collabberryInviteToken`, severing the
  Collabberry linkage. Gustavo's row was one re-onboarding away from exactly that.
- **Live impact 2026-10-08:** `a_1791295559074` (E6, the never-run 32nd case) was
  orphaned ~3.5h before its escalation window. Repaired by restoring the original
  id on the sheet — ledger **K9**. E6 unblocked.
- **Fix sketch (one commit):** pass only profile fields in the update — skills,
  rate, commitment, timezone, location, name, handle — never `id`, `createdAt`,
  `previousAttempts`, `status`, or the wallet/Collabberry columns. The existing
  §27 deep-merge precedent applies. Unit test: re-onboarding preserves identity
  and linkage columns.

**Disposition:** not shipped in today's Phase E deploy (batch is frozen and
tested; this fix deserves its own tests, and no remaining QA case re-onboards an
existing contributor — the friend is a brand-new row). Goes to the post-campaign
fix list alongside §29.

### 31. No match-score floor — the graceful decline is unreachable, 11% matches are offered for negotiation (C4 FAIL; FIXED IN CODE 2026-10-08, awaiting Phase E deploy)

QA case C4: a profile of "veterinary surgery, equine dentistry" was shown all
three open roles as tappable options — Community Manager 15%, Frontend Developer
12%, Smart Contract Developer 11%, each badged 🔴 — ending with "Select an
opportunity to start negotiating terms:".

- **Mechanism:** `matchOpportunities` (claude.ts) returns every opportunity the
  model scores; nothing filters on `overallScore`. The callers (gate.ts:92,
  discovery's matching block) decline only when the list is *empty* — which never
  happens, because the tool schema asks the model to score each opportunity, not
  to omit poor fits. So "No strong matches found right now. We'll keep your
  profile on file." is dead code on every realistic input.
- **Why it matters:** C4's premise — the bot should not steer an unsuitable
  candidate into negotiation — is the guard against wasting three reviewers'
  time on a proposal that can only be rejected (and the candidate then eats a
  3-day cooldown for applying to a role the bot itself scored at 11%).
- **The threshold already exists in presentation:** the badge logic calls <50 🔴
  ("bad") and ≥75 🟢 — the system *knows* these are poor matches and offers them
  anyway.
- **Fix sketch (small):** filter `score >= 50` (reuse the badge boundary) at the
  end of `matchOpportunities`, making the existing empty-list decline branch
  reachable. One unit test: all-low scores → empty result. Optionally tell the
  model it may return fewer matches than opportunities.

**Disposition:** recorded as the honest C4 result (FAIL). Decision (Aleksa,
2026-10-08): fix now. Commit `ea5da9c` — `presentableMatches` filters below
`MIN_MATCH_SCORE = 50` (the red-badge boundary) at the tail of
`matchOpportunities`, making both callers' existing decline branches reachable;
4 unit tests (169 pass). Rides the post-E6 Phase E deploy; C4 re-runs with one
`/start` afterwards (the veterinary profile is still in place), and the
verification record gets the re-run outcome alongside the original FAIL.

### 32. The counter-offer DM attributes the reviewer's number to the candidate — "your requested rate of $75" when they asked $95 — found live during F2/E4 2026-10-13; FIXED `baa5290`, DEPLOYED 2026-10-14 (build `2026-10-14T12:13:48Z`, K11)

Agreement `a_1791888028961` (Nikola, `opp_001`, asked $95/hr at 50%). Gustavo
countered `75` — "good profile, but above our budget for this role." — and Aleksa
approved; quorum closed at 2 of 3 and `aggregatedRate` was written as **75**
(correct). The prose sent to the candidate at `2026-10-13T17:05:00.944Z` reads:

> …your requested rate of **$75 per hour** is above our budget for this
> particular role…

- **Mechanism:** the synthesis call (`claude.ts:272-275`) is handed `feedbackText`
  and nothing else, where each stance renders as `Reviewer (countered at $75/hr):
  …`. The candidate's own ask never enters the prompt — `originalRate` is a
  parameter of `aggregateFeedback` but is used only by the all-approve fast-path
  (`claude.ts:211`) and the numeric guard's `supportedAmounts`
  (`claude.ts:277-281`). With no anchor for whose number is whose, the model
  folds the reviewer's counter into the candidate's voice.
- **Why the guard passes it:** `findSummaryViolation` rejects only figures absent
  from the feedback. $75 *is* supported, so a right-number/wrong-attribution
  sentence is clean by construction. §20 restated — the validator judges digits,
  not claims.
- **Self-contradicting too:** $75 sits inside `opp_001`'s $55–85 budget, so the
  sentence tells the candidate that the team's own offer exceeds the team's
  budget.
- **Blast radius:** the mixed path only (approve+counter, counter+counter).
  All-approve, all-reject and the single-reviewer pass-through are deterministic
  strings. No data impact: `aggregatedRate` comes from `meanOfCounters` and is
  never parsed back out of the prose.
- **Fix sketch (small):** prepend the ask to the synthesis payload ("The
  contributor proposed $95/hr at 50% commitment.") and state in the system prompt
  that rates carried in the feedback are the *team's* counter, to be presented as
  the offer. Unit-testable in the shape of the existing §20 validator tests.

**Disposition:** did **not** block F2 — Accept reconciles from `aggregatedRate`,
not the prose, and F2 passed with the rate moving 95 → 75.

**FIXED AND DEPLOYED 2026-10-14** (commit `baa5290`, build
`2026-10-14T12:13:48.728Z`, ledger K11). Reproduced first, against the live
inputs of `a_1791888028961` (`_agg32_tmp.ts`): **5/5 runs** misattributed the $75
("your rate of $75", "your proposed rate of $75") and **0/5** mentioned the real
$95 ask — structural, not model variance. Fix passes the ask into the synthesis
payload (`The contributor asked for $95/hr, 50% commitment.`) and instructs that
reviewer figures are the team's counter, never the contributor's request. Re-run:
**0/5** misattributed; sample output reads "our team is proposing a rate of $75
per hour at the 50% commitment level you requested". 169 unit tests still pass.
Deployed into the quiet window after F2 closed (nothing `under_review`); boot log
clean. The live retest rides on Cycle 1 — the next mixed-path counter-offer DM.

**VERIFIED LIVE 2026-10-16.** The mixed path ran on `a_1792023040163` (Aleksa,
`opp_002`, asked **$85**/hr at 50%): Simon `approve`, Nikola `counter 65`, quorum
closed 2 of 3 at 12:23:01Z, candidate notified 12:23:09Z. Stored
`aggregatedSummary` reads:

> …the team would like to move forward with an **offer of $65 per hour** at 50%
> commitment… We recognize this rate is **lower than what you proposed**…

The reviewer's figure is named as the team's offer and the candidate's ask is
acknowledged as the higher one — the inversion that produced "your requested rate
of $75" is gone, on the first live mixed verdict after the fix. `aggregatedRate`
= 65, matching the prose. Worth noting the counter carried **no** qualitative
text: Nikola sent the bare figure `65`, so `qualitativeFeedback` holds the
designed `(no qualitative feedback provided)` placeholder (not a parse failure —
`parseCounterFeedback` was checked directly against `65 - above our budget for
this role` and returns both halves). That is the weakest input the synthesis can
get — no stated reason to paraphrase — and attribution still held. §32 closed.

### 33. An abandoned draft shadows the reviewed round in the reviewer's "previous ask" block — FIXED `cbd37fa`, DEPLOYED 2026-10-14 (build `2026-10-14T13:28:21Z`, K12)

Found while cleaning up the stale round-2 draft on the Aleksa + `opp_002` pair
(ledger R7) — the cleanup was *motivated* by this and did not fix it, which is the
useful part of the finding.

- **Mechanism:** `priorTermsFromRows` (`sheets.ts:73-99`) filters only on
  contributor + opportunity + `excludeId`, then takes **the last matching row**.
  There is no status or review filter, so a `draft` the contributor abandoned —
  or one retired as `superseded` — is as eligible as a round that reviewers
  actually worked on.
- **Live evidence:** the pair's two rows are `a_1790186286202` (round 1, $75/hr at
  60%, reviewed, countered to **$60**) and `a_1790584489474` (round 2 draft at
  $60/hr, never submitted). The lookup returned the draft — `{hourlyRate: 60,
  counteredRate: null}` — so the round-2 reviewer DM would have read *"Previous
  ask: $60/hr, 60%"* with **no** `Reviewers countered:` line at all. The one fact
  the block exists to carry — that reviewers had already pushed $75 down to $60 —
  was the fact it dropped.
- **Marking the draft `superseded` changes nothing.** The selection ignores column
  J. Worth stating plainly: the obvious data-side cleanup is not a fix here.
- **Blast radius:** reviewer-facing copy on round ≥ 2 only
  (`review.ts:432-441`, best-effort and null-tolerant). No data impact — nothing
  is written from `PriorTerms`, and round numbering is unaffected because
  `nextRoundFromHistory` already counts only reviewed rows. Reachable in
  production without QA's help: tap **Modify Terms**, leave the draft, come back.
- **Fix:** prefer the last row whose column N (aggregated summary) is non-empty,
  falling back to the last attempt when the pair has no reviewed history. That is
  the *same* "reviewed" signal `nextRoundFromHistory` counts rounds by, so the
  round number in the DM's title and the terms in its body can no longer disagree
  about which attempts happened.
- **Tests:** 5 added to the existing `priorTermsFromRows` block, including the
  exact live shape above. 174 pass (was 169), typecheck clean. Verified against
  the production sheet: the lookup now returns `{hourlyRate: 75,
  commitmentPercent: 60, counteredRate: 60}`.

**Disposition:** not a campaign blocker — it only degrades reviewer context, and
Cycle 1's D2 test is about the round cap, not this block. Deployed anyway, in the
same quiet window (zero `under_review` rows), so Cycle 1's round-2 reviewer DM is
the live proof: it should read *"Previous ask: $75/hr, 60%, 3 months"* followed by
*"Reviewers countered: rate $60/hr"*.

**VERIFIED LIVE 2026-10-15.** Gustavo's reviewer DM for `a_1792023040163`
(dispatched 2026-10-15T00:10:40Z, after the K12 build) reads verbatim:

> Revised proposal for review — round 2 of 2
>
> Previous ask: $75/hr, 60%, 3 months
> Reviewers countered: rate $60/hr

Confirmed by forwarded screenshot. The block now quotes `a_1790186286202` — the
round the reviewers actually worked on — and carries the `$60` counter that the
pre-fix selection dropped. The abandoned `a_1790584489474` draft, still sitting
in the tab between that row and this one, no longer shadows it. Title and body
agree on the round number, which was the point of reusing `nextRoundFromHistory`'s
"reviewed" signal. §33 closed.
