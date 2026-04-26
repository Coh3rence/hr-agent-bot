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
- Skill matching should be semantic (not just substring) — e.g., "frontend dev" should match "React"

### 6. Missing Parameter: Equity Points
- Currently missing from the model: **equity vs. fiat split**
- Organizations may offer part of compensation as equity points
- Need to capture: what the org can provide in fiat vs. what will be equity
- This affects rate negotiation — a lower fiat rate may be acceptable if equity is offered
- TODO: Add equity fields to Opportunity and Agreement models
