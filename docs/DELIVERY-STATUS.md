# HR AI Agent - Delivery Status

**Project:** HR AI Agent MVP for Collabberry
**Client:** [Coh3rence](https://github.com/Coh3rence/) / [Collabberry](https://github.com/collabberry/)
**Developer:** Prosperity Labs
**Budget:** 30 hours

---

## Milestone 1: Foundation -- COMPLETE

| Deliverable | Status |
|-------------|--------|
| Telegram bot scaffolding (grammy + TypeScript + Bun) | Done |
| Application gate (invite-only, unauthorized user notification with approve/reject buttons) | Done |
| Google Sheets integration (4 tabs: Opportunities, Contributors, Agreements, AuthorizedUsers) | Done |
| Claude API integration (Sonnet, tool use, structured extraction) | Done |
| Discovery conversation (natural language profile collection: skills, rate, commitment %, timezone) | Done |
| Admin commands (/add_opportunity, /list, /edit, /pause, /authorize) | Done |
| Bot deployed and running (@coh3rencebot) | Done |

## Milestone 2: Core Features -- REMAINING

| Deliverable | Status |
|-------------|--------|
| AI-powered semantic skill matching (Claude tool_use, not substring) | Done (ahead of schedule) |
| Opportunity ranking and presentation | Done (ahead of schedule) |
| Negotiation flow (rate, hours, commitment %) | Done (ahead of schedule) |
| Settlement likelihood calculation | Done (ahead of schedule) |
| Submit proposal for review (status written to Sheets) | Done (ahead of schedule) |
| Telegram DM notifications to core team reviewers | Remaining |
| Reviewer approve/counter/reject buttons (inline keyboards) | Remaining |
| Multi-reviewer feedback collection & storage | Remaining |
| Quorum (2 of 3) & 48hr timeout logic (optimistic voting: silence = approval) | Remaining |
| Claude aggregates reviewer feedback into counter-offer | Remaining |
| Resolution loop (contributor sees decision: accept / negotiate / walk away) | Remaining |
| "Modify Terms" negotiation loop with conversation memory | Remaining |

## Milestone 3: Integration, Polish & Handoff -- REMAINING

| Deliverable | Status |
|-------------|--------|
| On-chain bridge (Beta App API: map terms to Collabberry compensation model, create agreement on Arbitrum) | Remaining |
| Cooldown & flagging system (2-3 day cooldown after rejection) | Remaining |
| Edge case hardening (unexpected messages, bot restart recovery, rate limits) | Remaining |
| End-to-end testing (5+ full test conversations) | Remaining |
| Documentation (README, conversation flows, maintenance guide) | Partially done |
| Deployment & handoff session | Remaining |

---

## Key Design Decisions (Locked In)

| Decision | Detail |
|----------|--------|
| Optimistic voting | No objection within 48hrs = auto-approved |
| Rejection requires explanation | Actionable feedback required (lower rate, more commitment, etc.) |
| Semantic matching | Claude evaluates skill fit, not keyword substring |
| Max 2 negotiation rounds | Prevents infinite loops |
| Commitment above max = positive | More availability is not penalized |
| Returning users skip discovery | Go straight to matching |

---

## Tech Stack (Delivered)

| Component | Technology |
|-----------|------------|
| Bot framework | grammy (TypeScript) |
| LLM | Claude Sonnet via @anthropic-ai/sdk |
| Database | Google Sheets (googleapis) |
| Hosting | Railway |
| Runtime | Bun |

---

## What's Next

Milestone 2 requires the **matching presentation, negotiation flow, and review flow** -- the multi-reviewer aggregation engine that is the core differentiator of this system. Several M2 items (matching, negotiation, settlement likelihood) were completed ahead of schedule during M1 development.

Milestone 3 bridges the approved agreements to Collabberry's on-chain system via the Beta App API, plus polish, testing, and handoff.
