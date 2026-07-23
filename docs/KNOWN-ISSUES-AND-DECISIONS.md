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
