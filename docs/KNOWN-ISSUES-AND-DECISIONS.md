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

### 7. Invite-token consumption robustness (backend fork) — PARTIALLY FIXED
- **Original bug (FIXED, committed `85b17ce`):** the single-use invite token was consumed
  (`usageCount++`, `isActive=false`) *before* the email-uniqueness check, so a duplicate-email
  signup burned the token with no user created and the retry dead-ended with a misleading
  "Invalid or expired invitation token." Email + wallet checks now run **before** consume
  (`user.service.ts` `registerUser`, lines ~48-60 before ~62-92).
- **Residual (open) — atomicity:**
  - Token consume (findOne → `usageCount++` → save, ~line 89) and user-create (`save(user)`,
    ~line 106) are **not in one DB transaction**. `address` and `email` are DB-unique
    (`user.model.ts:10,13`), so a concurrent/duplicate submit can pass the service-level checks,
    consume the token, then throw an **uncaught unique-constraint 500** at `save(user)` — token
    burned, no rollback.
  - The consume itself is a non-atomic read-modify-write, so two concurrent redemptions of a
    `usageLimit:1` token can both read `usageCount=0` and **double-spend** it.
- **Fix options:** (a) wrap consume + user-create in a transaction so a save failure rolls back
  the increment; (b) make consume an atomic conditional `UPDATE … SET usageCount=usageCount+1
  WHERE token=? AND usageCount<usageLimit` and check affected rows; (c) catch the unique-constraint
  violation → return a clean 400 instead of a 500.
- Contributing cause (test hygiene, separate): `scripts/reset-test-data.ts` wipes the Sheet but
  not the backend DB, so stale users squat on the unique email/wallet. Extend the reset to also
  clear the org's users/agreements/invites, and use a fresh email + wallet per run.

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
