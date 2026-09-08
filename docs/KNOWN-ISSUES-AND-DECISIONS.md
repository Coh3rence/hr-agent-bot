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

### 10. Conversation state is in-memory only — lost on every restart — HARDENING
- `src/bot.ts` installs grammy's `session()` with no storage adapter, so all conversation state
  (phase, message history, in-flight agreement/review ids) lives in process memory.
- Any restart — deploy, crash, or the Telegram 409 `getUpdates` conflict / Railway restart cycle —
  wipes every in-flight conversation. Discovery then re-asks for details it had already collected,
  and a reviewer mid-`reviewer_feedback` loses the pending decision.
- Observed live 2026-09-07 during the client QA session: a tester asked "why does it ask for the
  same info 10x" after the bot restarted several times behind a 409.
- **Operational workaround:** never `railway up` mid-session; confirm the log tail has no recent 409
  before a witnessed run.
- **Fix idea:** back `session()` with a persistent adapter (a Sheet tab, Redis, or the existing
  MySQL) keyed on Telegram id, so state survives restarts.

### 11. Reviewer counter rate is only parsed from a LEADING number — FIXED IN CODE, AWAITING DEPLOY
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
