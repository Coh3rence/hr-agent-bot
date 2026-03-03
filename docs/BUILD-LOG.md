# Build Log

Chronological record of development decisions, progress, and learnings. For case study reference.

---

## Session 1 — 2026-03-03 (Project Setup)

### Context
Client (Gustavo / RnDAO / Collabberry) accepted a $3,000 proposal for an HR AI Agent MVP — a Telegram bot for DAO contributor onboarding. 4-week timeline, 30 hours total.

### Client Communication
- Sent design questions document to Gustavo (Feb 2026)
- Received video response (20 min) answering all questions — see `docs/VIDEO-ANSWERS-ANALYSIS.md`
- Followed up asking: "Do you want to manage data via spreadsheet, bot commands, or another tool?"
- Gustavo's audio response (transcribed via OpenAI Whisper API):
  - Was confused by the question — needed clarification
  - Said contributor data already exists in the Collabberry Beta App
  - Didn't understand the distinction between contributor data vs. opportunities
- Sent clarifying message explaining the two data types
- **Gustavo's decision: Bot commands** (Option B) — admin manages opportunities through Telegram bot, not spreadsheet

### Key Discovery
After researching the existing Collabberry ecosystem (5 repos on GitHub, Beta App at beta.collabberry.xyz), we found:
- **Contributor agreements** (roles, salaries, commitment) → already exist in Beta App
- **Opportunities** (open positions with skills/budget) → don't exist anywhere, brand new data
- **agreements-assistant-backend** repo has salary CSV data and role taxonomy we can reuse
- Beta App uses Express.js + MSSQL + TypeORM, deploys on Arbitrum (TeamPoints ERC-20)

### Technical Decisions

| Decision | Choice | Alternatives Considered | Rationale |
|----------|--------|------------------------|-----------|
| Bot framework | grammy | Eliza (existing repo) | 6-phase flow too structured for character bot framework |
| LLM | Claude Sonnet | GPT-4 | Tool use for structured extraction, strong aggregation |
| Database | Google Sheets | Supabase, Airtable | Zero cost, sufficient for MVP, admin accesses via bot not sheet |
| Admin interface | Bot commands | Spreadsheet editing, Web dashboard | Client preference: "commands through the bot" |
| Runtime | Bun | Node.js | Fast, native TS, built-in .env |
| Hosting | Railway | Vercel, Fly.io | Auto-deploy, env vars, cheap |

### Work Completed

**GitHub Organization Setup:**
- Created `Coh3rence` GitHub org
- Forked 4 Collabberry repos: frontend, backend, smart-contracts, agreements-assistant-backend
- Created `Coh3rence/hr-agent-bot` repo
- Invited `sepu85` (Gustavo) as org admin

**Project Initialization:**
- Bun project with grammy, @anthropic-ai/sdk, googleapis, zod
- Full project structure: 6 conversation phases, 3 services, types
- All TypeScript — clean typecheck
- Initial commit pushed to main

**Files Created:**
| File | Purpose | Lines |
|------|---------|-------|
| `src/bot.ts` | Entry point, middleware, routing | 75 |
| `src/config.ts` | Zod-validated env config | 25 |
| `src/conversations/gate.ts` | Auth + cooldown check | 35 |
| `src/conversations/discovery.ts` | Skill collection + matching | 95 |
| `src/conversations/negotiation.ts` | Terms + settlement likelihood | 105 |
| `src/conversations/review.ts` | Multi-reviewer feedback | 45 |
| `src/conversations/resolution.ts` | Approval/rejection/cooldown | 55 |
| `src/conversations/admin.ts` | /add, /list, /edit, /pause commands | 160 |
| `src/services/claude.ts` | Claude API with tool use | 65 |
| `src/services/sheets.ts` | Google Sheets CRUD | 210 |
| `src/services/matching.ts` | Scoring engine + settlement calc | 85 |
| `src/models/types.ts` | All TypeScript interfaces | 85 |

### Matching Algorithm

```
Score = (skillOverlap × 0.40) + (rateAlignment × 0.25) + (commitmentFit × 0.35)
```

- **Skill overlap (40%):** % of required skills the contributor has (fuzzy string matching)
- **Rate alignment (25%):** How close their ask is to the budget range
- **Commitment fit (35%):** How well their availability matches the requirement

### Settlement Likelihood Formula

```
likelihood = min(95, 50 + rateFactor + skillFactor)
  rateFactor = max(0, (1 - |ask - budgetMid| / budgetRange) × 30)
  skillFactor = skillMatchScore × 15
```

Range: 0-95% (never 100% — always some uncertainty in human negotiation)

### Blockers / Waiting On
- [ ] Telegram bot token from Gustavo
- [ ] Google Sheets setup + service account
- [ ] Anthropic API key
- [ ] Sample opportunities data
- [ ] Beta App API access
- [ ] sepu85 to accept GitHub org invite

### Time Spent
~2.5 hours (setup, research, architecture, implementation)

---

## Session 2 — TBD

_(Next session: Google Sheets wiring, sample data seeding, Railway deployment)_
