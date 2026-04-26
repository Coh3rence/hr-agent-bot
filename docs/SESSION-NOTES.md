# HR Agent Bot - Session Notes

## Milestone Overview

### 6-Phase Conversation Flow
Gate → Discovery → Matching → Negotiation → Review → Resolution

### Milestone 1: Profile Completion (Discovery → Matching)
- All required fields collected (name, skills, rate, commitment)
- Profile saved to Google Sheets
- Matching engine runs, top 3 opportunities presented with scores

### Milestone 2: Terms Submission → Review
- Contributor proposes terms (rate, commitment, duration)
- Settlement likelihood calculated and shown
- Agreement enters `under_review` status
- Core team reviewers DM'd with proposal
- Quorum: 2 of 3 reviewers within 48 hours
- Claude aggregates feedback into single anonymous counter-offer
- Max 2 negotiation rounds, 3-day cooldown on rejection

---

## Multi-User Session Handling

### Sessions are per-user (safe)
- grammy session middleware keyed by Telegram chat ID
- Each user gets isolated SessionData (phase, message history, agreement)
- Multiple contributors can negotiate simultaneously without cross-talk

### Review phase needs work
- Multiple reviewers interacting with same proposal needs concurrency control
- Feedback should be append-only per agreement
- Quorum check after each reviewer response
- Locking during Claude aggregation step

### What to build for Milestone 2
1. Reviewer feedback array — append-only (not overwrite)
2. Quorum check — 2-of-3 threshold per response
3. Claude aggregation — synthesize all feedback once quorum met
4. Locking — mark agreement as "aggregating" to prevent races

---

## Match Score Formula

```
score = (skillOverlap x 0.40) + (rateAlignment x 0.25) + (commitmentFit x 0.35)
```

### 1. Skill Overlap (40% weight)
- Substring matching: contributor skills vs. required skills
- `score = matched skills / total required skills`
- Normalized to lowercase, bidirectional substring check

### 2. Rate Alignment (25% weight)
- Ask midpoint within budget range → 100%
- Outside range: `score = max(0, 1 - distance / budgetSpread)`

### 3. Commitment Fit (35% weight)
- Contributor % within required range → 100%
- Outside range: same proportional penalty as rate

### Settlement Likelihood (separate, used in negotiation)
```
likelihood = min(95, 50 + rateFactor + skillFactor)
```
- rateFactor: up to +30 points (rate proximity to budget)
- skillFactor: up to +15 points (skill match score)
- Floor 50%, cap 95%

### Known Gaps
- **Semantic skill matching**: only substring today, "frontend dev" won't match "React"
- **Timezone/location**: collected but not scored
- **Experience level**: not captured
- **Duration preference**: not part of match
