# HR Agent Bot - Collabberry/RnDAO

## Project Overview
Telegram bot for DAO contributor onboarding: skill matching, agreement negotiation, and multi-reviewer aggregation.

## Tech Stack
- **Runtime**: Bun
- **Bot framework**: grammy (Telegram)
- **LLM**: Claude Sonnet via @anthropic-ai/sdk (tool use for structured extraction)
- **Database**: Google Sheets (Opportunities, Contributors, Agreements, AuthorizedUsers tabs)
- **Language**: TypeScript

## Bun Defaults
- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun install` instead of `npm install`
- Bun automatically loads .env, so don't use dotenv

## Architecture
- `src/bot.ts` - Entry point, middleware, routing
- `src/conversations/` - Phase handlers (gate, discovery, negotiation, review, resolution, admin)
- `src/services/` - Claude API, Google Sheets CRUD, matching engine
- `src/models/` - TypeScript types

## Key Patterns
- Admin manages opportunities via bot commands (`/add_opportunity`, `/list_opportunities`, `/edit_opportunity`, `/pause_opportunity`)
- Contributors interact through natural conversation, Claude extracts structured data via tool use
- Session state tracks conversation phase per user
- Settlement likelihood = f(rate proximity to budget, skill match score)
- Multi-reviewer feedback aggregated by Claude into single counter-offer
- 48hr reviewer timeout, max 2 negotiation rounds, 3-day cooldown on rejection

## Integration Points
- Collabberry Beta App API (POST /orgs/agreement) for final agreement creation
- Google Sheets as backing store (admin never edits directly — all through bot)

## Commands
- `bun run dev` - Dev mode with watch
- `bun run start` - Production
- `bun run typecheck` - Type checking
