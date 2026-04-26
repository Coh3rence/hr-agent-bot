# Collabberry HR AI Agent Bot

An AI-powered Telegram bot that automates DAO contributor onboarding for [Collabberry](https://collabberry.xyz). Built by [Prosperity Labs](https://github.com/Prosperity-Labs) for [RnDAO](https://rndao.io).

The bot guides contributors through a structured 6-phase flow: **authorization -> skill discovery -> opportunity matching -> compensation negotiation -> core team review -> resolution** -- replacing manual back-and-forth with AI-assisted conversations.

## What It Does

**For Contributors:**
- Natural conversation to collect skills, rate expectations, availability, and timezone
- AI-powered opportunity matching with semantic skill evaluation (not keyword matching)
- Guided compensation negotiation with settlement likelihood scoring
- Submit proposals for core team review

**For Admins (Core Team):**
- Create and manage opportunities via bot commands (no spreadsheet editing needed)
- Authorize new users with role-based access (admin vs contributor)
- Review submitted proposals with approve/counter/reject workflows

## Architecture

```
Telegram
  |
  +-- Contributors (chat with bot)
  +-- Admins (manage via commands)
  |
  +--> HR Agent Bot (grammy + Bun)
         |
         +---> Claude API (Anthropic) -- skill extraction, semantic matching, feedback aggregation
         +---> Google Sheets -- opportunities, contributors, agreements, authorized users
         +---> Collabberry Beta App API -- on-chain agreement creation (planned)
```

## Conversation Flow

| Phase | What Happens |
|-------|-------------|
| **1. Gate** | Authorization check. Unauthorized users trigger admin notification with approve/reject buttons. Cooldown check for previously rejected contributors. |
| **2. Discovery** | Claude extracts profile from natural conversation: name, skills, hourly rate range, commitment %, timezone, location. |
| **3. Matching** | Claude evaluates each open opportunity semantically. Top 3 shown with scores (skill fit, rate alignment, commitment fit). |
| **4. Negotiation** | Contributor proposes terms. Bot calculates settlement likelihood (50-95%). Shows draft agreement. Submit or modify. |
| **5. Review** | Core team reviewers notified via DM. Approve, counter-offer, or reject with feedback. Quorum-based (2 of 3). 48hr timeout = auto-approve. |
| **6. Resolution** | Contributor sees aggregated decision. Accept, negotiate further (max 2 rounds), or walk away. Approved agreements bridge to Collabberry on-chain. |

> **Current status:** Milestone 1 (Foundation) is complete -- phases 1-2 plus admin commands and Sheets integration are fully working. Milestones 2 and 3 cover the matching engine, negotiation, review flow, and on-chain bridge. See [DELIVERY-STATUS.md](docs/DELIVERY-STATUS.md) for details.

## Tech Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| Runtime | [Bun](https://bun.sh) | Fast, native TypeScript, built-in .env |
| Bot | [grammy](https://grammy.dev) v1.41 | Lightweight, TypeScript-native, conversation middleware |
| LLM | [Claude Sonnet](https://docs.anthropic.com) via `@anthropic-ai/sdk` | Tool use for structured extraction + semantic evaluation |
| Database | [Google Sheets](https://developers.google.com/sheets/api) via `googleapis` | Client-inspectable, zero cost, sufficient for MVP volume |
| Validation | [Zod](https://zod.dev) v4 | Runtime type safety for env config |

## Project Structure

```
hr-agent-bot/
├── index.ts                           # Entry point
├── src/
│   ├── bot.ts                         # grammy setup, middleware, command routing, callbacks
│   ├── config.ts                      # Zod-validated environment variables
│   ├── models/
│   │   └── types.ts                   # TypeScript interfaces (Opportunity, Contributor, Agreement, etc.)
│   ├── services/
│   │   ├── claude.ts                  # Claude API: chat, extractStructured, matchOpportunities, aggregateFeedback
│   │   ├── sheets.ts                  # Google Sheets CRUD for all 4 tabs
│   │   └── matching.ts               # Scoring engine + settlement likelihood calculator
│   └── conversations/
│       ├── gate.ts                    # Phase 1: Authorization + cooldown
│       ├── discovery.ts               # Phase 2: Skill collection + profile extraction
│       ├── negotiation.ts             # Phase 3: Terms proposal + settlement likelihood
│       ├── review.ts                  # Phase 4: Reviewer notifications + feedback (partial)
│       ├── resolution.ts             # Phase 5: Approval/rejection + cooldown
│       └── admin.ts                   # Admin commands: /add_opportunity, /list, /edit, /pause, /authorize
├── scripts/
│   └── setup-sheets.ts               # One-time: creates Sheet tabs, headers, sample data
├── docs/
│   ├── ARCHITECTURE.md                # System design + tech stack rationale
│   ├── CONVERSATION-FLOWS.md          # Phase-by-phase flow diagrams
│   ├── BUILD-LOG.md                   # Development chronology
│   └── KNOWN-ISSUES-AND-DECISIONS.md  # Design decisions + gaps
├── .env.example                       # Environment variable template
├── package.json
└── tsconfig.json
```

## Setup

### Prerequisites

- [Bun](https://bun.sh) (v1.3+)
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- An [Anthropic API key](https://console.anthropic.com)
- A Google Cloud service account with Sheets API enabled

### 1. Clone and install

```bash
git clone git@github.com:Coh3rence/hr-agent-bot.git
cd hr-agent-bot
bun install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in your `.env`:

| Variable | Description |
|----------|-------------|
| `BOT_TOKEN` | Telegram bot token from BotFather |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude |
| `GOOGLE_SHEETS_ID` | Your Google Sheets spreadsheet ID |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | GCP service account email |
| `GOOGLE_PRIVATE_KEY` | Service account private key (PEM format, quotes required) |
| `BETA_APP_API_URL` | Collabberry Beta App API (optional, default: `https://beta.collabberry.xyz/api`) |
| `BETA_APP_JWT` | Admin JWT for Beta App (optional, for on-chain bridge) |
| `REVIEWER_TIMEOUT_HOURS` | Auto-approve timeout (default: `48`) |
| `MAX_NEGOTIATION_ROUNDS` | Max back-and-forth rounds (default: `2`) |
| `COOLDOWN_DAYS` | Days before rejected contributor can retry (default: `3`) |

### 3. Set up Google Sheets

Share your Google Sheet with the service account email (Editor access), then run:

```bash
bun scripts/setup-sheets.ts
```

This creates the 4 tabs (Opportunities, Contributors, Agreements, AuthorizedUsers), adds headers, and seeds 3 sample opportunities.

### 4. Run the bot

```bash
# Development (auto-reload on changes)
bun run dev

# Production
bun run start
```

### 5. First use

1. Message your bot on Telegram with `/start`
2. The bot will check if your Telegram ID is in the AuthorizedUsers sheet
3. The setup script adds your ID as admin -- you're ready to go
4. Use `/add_opportunity` to create roles, `/authorize <telegram_id>` to add users

## Admin Commands

| Command | Description |
|---------|-------------|
| `/add_opportunity <description>` | Create a new opportunity (Claude extracts structured fields from natural language) |
| `/list_opportunities` | View all opportunities with status badges |
| `/edit_opportunity <id> <changes>` | Modify an existing opportunity |
| `/pause_opportunity <id>` | Temporarily hide an opportunity from matching |
| `/authorize <telegram_id> [admin\|contributor]` | Grant access to a new user |

## Key Design Decisions

- **Semantic matching over keywords** -- Claude evaluates skill relevance contextually ("full stack engineering" matches frontend roles)
- **Commitment above max is positive** -- more availability means the contributor can fully fill the role
- **Settlement likelihood capped at 95%** -- never 100%, acknowledging negotiation uncertainty
- **Optimistic voting** -- silence from reviewers within 48hrs = auto-approval
- **Returning users skip discovery** -- profile already collected, go straight to matching
- **Max 2 negotiation rounds** -- prevents infinite loops while allowing meaningful back-and-forth

## Estimated Running Costs

| Service | Cost |
|---------|------|
| Bun hosting (Railway) | ~$5/month |
| Claude API (Anthropic) | ~$5-15/month at MVP volume |
| Google Sheets API | Free |
| Telegram Bot API | Free |
| **Total** | **~$10-20/month** |

## Remaining Work

See [docs/DELIVERY-STATUS.md](docs/DELIVERY-STATUS.md) for the full breakdown. In summary:

**Milestone 2:** AI-powered semantic skill matching, opportunity ranking, negotiation flow with settlement likelihood, multi-reviewer aggregation (DM notifications, inline keyboard feedback, quorum logic, Claude feedback aggregation), resolution loop.

**Milestone 3:** On-chain bridge via Beta App API, edge case hardening, end-to-end testing, deployment handoff.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) -- system design, tech stack rationale, data flow
- [Conversation Flows](docs/CONVERSATION-FLOWS.md) -- detailed phase-by-phase diagrams
- [Build Log](docs/BUILD-LOG.md) -- development decisions and chronology
- [Known Issues & Decisions](docs/KNOWN-ISSUES-AND-DECISIONS.md) -- design trade-offs and gaps

## License

Private. Built for RnDAO / Collabberry by Prosperity Labs.
