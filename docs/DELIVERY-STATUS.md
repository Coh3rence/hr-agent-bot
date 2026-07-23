# HR AI Agent - Delivery Status

**Project:** HR AI Agent MVP for Collabberry
**Client:** [Coh3rence](https://github.com/Coh3rence/) / [Collabberry](https://github.com/collabberry/)
**Developer:** Prosperity Labs

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

## End-to-End Status & Production Readiness (2026-07-23)

The full loop is **proven end-to-end in a test environment**: discovery → semantic match →
negotiation → submit → reviewer counter → resolution/accept → bot-minted invite → browser
signup (SIWE) → `resolveByToken` link → `createBetaAgreement` → agreement renders in the
Collabberry Team view on the Arbitrum One mainnet org. Verified with a fresh contributor
(status=hired, real wallet + collabberryUserId). All M2/M3 flow items above are functionally
complete despite the "Remaining" labels, which predate this run.

**Caveat:** this ran in test mode — `dev:stage` (`NODE_ENV=development`), local backend +
mysql (docker :3000), local frontend (`yarn start`, inline mainnet env), the dev Telegram
bot, and the self-review hatch. None of that is production.

### Production Readiness Checklist

**Hard blockers (before any real contributor):**
1. **Invite-token consumption** — the primary ordering bug is **fixed + committed** on the fork
   (`85b17ce`: email/wallet checks now run before token consume). Residual hardening remains:
   consume + user-create aren't in one transaction, and the consume is a non-atomic
   read-modify-write, so a double-submit/concurrent signup can still burn a single-use token or
   surface an uncaught 500 (address+email are DB-unique). See Known Issues #7.
2. **Decide + stand up the production backend + DB.** Currently local docker + mysql; the D-018
   token-persistence schema change lives only on the fork; the prod deploy target is **undecided**.
   This is the critical-path decision — env, secrets, sheet, and frontend URL all resolve once it's set.
3. **Run the bot in production mode** — `NODE_ENV=production`, real prod `.env` (prod Telegram bot
   token, not the dev bot; Anthropic key; Google service account; backend service key), on a hosted
   long-running process with restart (Railway per Tech Stack), not `bun --watch` locally.
4. **Restore the client reviewer `302836662`** in `AuthorizedUsers` (removed for solo testing) and
   validate real quorum with human reviewers — prod has no self-review shortcut
   (`selfReviewAllowed()` requires both `NODE_ENV=development` **and** `ALLOW_SELF_REVIEW=true`, so
   it is already prod-safe).

**Infra / hosting:**
5. **Frontend deploy** — hosted build with managed `VITE_*` prod env (currently inline, uncommitted);
   the `useAuth` invite-redirect fix lives on `Coh3rence/frontend`.
6. **Google Sheet** — confirm prod uses the intended sheet (dev is `1gI4rf8…`) + service-account access.
7. **Secrets management** — keys must not live in laptop `.env` files in prod.

**Hardening (not strictly blocking):**
8. **Manual "I've signed up" hinge** — finalization depends entirely on that tap; add polling /
   auto-detect via `resolveByToken`. See Known Issues #8.
9. **Bot logging / observability** — zero per-message logging today. See Known Issues #9.
10. **On-chain TP minting** — a manual admin signature (TP balance still 0%); document as an operator
    step, out of bot scope.

**Critical path = #2** (where the production backend lives).

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
