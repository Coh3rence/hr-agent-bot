# Architecture Overview

## System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        TELEGRAM                                      │
│                                                                      │
│   ┌─────────────┐         ┌──────────────────┐                       │
│   │ Contributors │◄───────►│   HR Agent Bot    │                      │
│   │  (Telegram)  │         │   (grammy + Bun)  │                      │
│   └─────────────┘         └────────┬─────────┘                       │
│                                    │                                  │
│   ┌─────────────┐                  │                                  │
│   │Core Contributors│◄─────────────┘                                  │
│   │  (Admin DMs)  │                                                   │
│   └─────────────┘                                                    │
└──────────────────────────────────────────────────────────────────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    │                │                │
                    ▼                ▼                ▼
            ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
            │  Claude API   │ │ Google Sheets │ │  Beta App    │
            │  (Anthropic)  │ │  (Database)   │ │  API         │
            │               │ │               │ │              │
            │ • Skill       │ │ • Opportunities│ │ • Create     │
            │   extraction  │ │ • Contributors │ │   Agreement  │
            │ • Profile     │ │ • Agreements   │ │ • User       │
            │   parsing     │ │ • Authorized   │ │   linking    │
            │ • Feedback    │ │   Users        │ │ • Blockchain │
            │   aggregation │ │               │ │   signing    │
            └──────────────┘ └──────────────┘ └──────────────┘
```

## Tech Stack Rationale

| Component | Choice | Why |
|-----------|--------|-----|
| **Runtime** | Bun | Fast, native TypeScript, built-in .env loading |
| **Bot Framework** | grammy | Lightweight, TS-native, conversation middleware, inline keyboards |
| **LLM** | Claude Sonnet (Anthropic SDK) | Tool use for structured extraction, strong at aggregation/synthesis |
| **Database** | Google Sheets | Client can inspect data, zero cost, sufficient for MVP volume (~100 rows) |
| **Hosting** | Railway | Auto-deploy from GitHub, env vars, logs, $5/mo |
| **Validation** | Zod | Runtime type safety for env config and API payloads |

### Why NOT Eliza Framework?
The original Collabberry repo (sepu85/HR_AI_Agent) uses Eliza — a general-purpose AI character framework. We decided against forking it because:
- The 6-phase negotiation flow is too structured for a character bot
- grammy gives us explicit conversation state management
- Claude tool use gives us structured data extraction (not just chat)
- Less framework overhead, more control over the flow

## Data Flow

```
Contributor ──► /start ──► Gate (auth check) ──► Discovery (skill collection)
                                                        │
                                                        ▼
                                                  Matching Engine
                                                  (score & rank)
                                                        │
                                                        ▼
                                                  Negotiation
                                                  (terms + settlement likelihood)
                                                        │
                                                        ▼
                                              Core Team Review
                                              (DM reviewers, collect feedback)
                                                        │
                                                        ▼
                                              Aggregation
                                              (Claude synthesizes counter-offer)
                                                        │
                                                        ▼
                                              Resolution
                                              (approve → Beta App / reject → cooldown)
```

## Project Structure

```
hr-agent-bot/
├── index.ts                          # Entry point
├── src/
│   ├── bot.ts                        # grammy setup, middleware, routing
│   ├── config.ts                     # Zod-validated environment config
│   ├── conversations/
│   │   ├── gate.ts                   # Phase 1: Authorization + cooldown check
│   │   ├── discovery.ts              # Phase 2: Skill collection + opportunity matching
│   │   ├── negotiation.ts            # Phase 3: Terms proposal + settlement likelihood
│   │   ├── review.ts                 # Phase 4: Core team notification + feedback
│   │   ├── resolution.ts            # Phase 5: Approval/rejection + cooldown
│   │   └── admin.ts                  # Admin commands for opportunity management
│   ├── services/
│   │   ├── claude.ts                 # Claude API: chat, tool use, feedback aggregation
│   │   ├── sheets.ts                 # Google Sheets CRUD for all entities
│   │   └── matching.ts              # Scoring engine + settlement calculator
│   ├── models/
│   │   └── types.ts                  # TypeScript interfaces
│   └── data/                         # Salary CSVs (to be copied from agreements-assistant)
├── .env.example
├── package.json
└── CLAUDE.md
```
