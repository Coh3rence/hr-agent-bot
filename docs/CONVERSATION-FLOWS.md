# Conversation Flows

## Overview

The bot manages a 6-phase conversation state machine. Each user has a session that tracks their current phase.

```
idle ──► gate ──► discovery ──► matching ──► negotiation ──► review ──► resolution
  ▲                                              │              │            │
  └──────────────────────────────────────────────┘──────────────┘────────────┘
                          (reset on completion or rejection)
```

---

## Phase 1: Gate (Authorization)

**File:** `src/conversations/gate.ts`

**Purpose:** Verify the user is authorized to use the bot. Unauthorized users are silently ignored (no response = no AI token usage).

```
User sends /start or any message
        │
        ▼
  ┌─────────────┐     No
  │ Authorized?  │──────────► (silent ignore)
  └──────┬──────┘
         │ Yes
         ▼
  ┌─────────────┐     Yes
  │ On cooldown? │──────────► "You can re-apply in X days"
  └──────┬──────┘
         │ No
         ▼
  ┌─────────────┐     Yes
  │ Returning?   │──────────► "Welcome back, [name]!"
  └──────┬──────┘
         │ No
         ▼
  "Welcome! Tell me about yourself..."
  Phase → discovery
```

**Authorization model:** Invite-only. Core contributors add Telegram IDs to the AuthorizedUsers sheet. Role can be "user" or "admin".

---

## Phase 2: Discovery (Skill Collection + Matching)

**File:** `src/conversations/discovery.ts`

**Purpose:** Collect contributor profile through natural conversation. Claude extracts structured data via tool use.

```
User provides info (free-form text)
        │
        ▼
  Claude tool use: extract_profile
  {name, skills[], rate{min,max}, commitment%, timezone, location}
        │
        ▼
  ┌──────────────┐     No
  │ All required  │──────────► Claude asks for missing fields naturally
  │ fields?       │            User responds → loop back
  └──────┬───────┘
         │ Yes
         ▼
  Save to Google Sheets (Contributors tab)
        │
        ▼
  Run Matching Engine against open Opportunities
        │
        ▼
  ┌──────────────┐     0 matches
  │ Matches found?│──────────► "No opportunities right now" → idle
  └──────┬───────┘
         │ 1+ matches
         ▼
  Display top 3 as cards with inline keyboard:
    🟢 Role Title — 85% match
    Skills: 90% | Rate: 80% | Commitment: 85%
    [Select]

  Phase → matching (waiting for selection)
```

**Collected fields:**
| Field | Required | Example |
|-------|----------|---------|
| name | Yes | "Alex Chen" |
| skills | Yes | ["Solidity", "React", "Governance"] |
| desiredRate (min/max) | Yes | $60-80/hr |
| commitmentPercent | Yes | 50% (= ~20hrs/week) |
| timezone | No | "UTC+2" |
| location | No | "Berlin, Germany" |

---

## Phase 3: Negotiation (Terms + Settlement Likelihood)

**File:** `src/conversations/negotiation.ts`

**Purpose:** Contributor proposes agreement terms. Bot calculates settlement likelihood.

```
User selects opportunity from inline keyboard
        │
        ▼
  "You selected [Role]. Propose your terms:
   1. Hourly rate
   2. Commitment %
   3. Duration (months)"
        │
        ▼
  User proposes terms (free-form)
        │
        ▼
  Claude tool use: extract_terms
  {hourlyRate, commitmentPercent, durationMonths}
        │
        ▼
  Calculate Settlement Likelihood:
    likelihood = min(95, 50 + rateFactor + skillFactor)
    where:
      rateFactor = max(0, (1 - |ask - budgetMid| / budgetRange) × 30)
      skillFactor = skillMatchScore × 15
        │
        ▼
  Display draft agreement:
    Role: Governance Developer
    Rate: $70/hr
    Commitment: 40%
    Duration: 3 months
    Settlement Likelihood: 78% (Medium)

    [Submit for Review] [Modify Terms]
```

**Settlement Likelihood Scale:**
| Score | Label | Meaning |
|-------|-------|---------|
| 75-95% | High | Ask is within or close to budget, strong skill match |
| 50-74% | Medium | Some gap between ask and budget |
| <50% | Low | Significant gap, negotiation likely needed |

---

## Phase 4: Review (Multi-Reviewer Aggregation)

**File:** `src/conversations/review.ts`

**Purpose:** Send proposal to core contributors, collect feedback, aggregate via Claude.

```
Contributor submits agreement
        │
        ▼
  Agreement status → "under_review"
        │
        ▼
  DM each core contributor reviewer:
    "New proposal for [Role]:
     Candidate: [Name]
     Rate: $70/hr | Commitment: 40% | Duration: 3mo
     Skills: Solidity (match), React (match), Rust (no match)
     Settlement Likelihood: 78%

     [Approve] [Counter-Offer] [Reject]"
        │
        ▼
  ┌──────────────┐
  │ Collect       │
  │ responses     │ (48hr timeout, quorum = 2 of 3)
  └──────┬───────┘
         │
         ▼
  Counter-offers: each reviewer provides:
    • Suggested rate (quantitative)
    • Feedback text (qualitative)
         │
         ▼
  Claude aggregation:
    • Average suggested rates
    • Synthesize qualitative feedback into one coherent message
    • No individual reviewer identities revealed
         │
         ▼
  Send aggregated counter-offer to contributor:
    "The team suggests $65/hr (originally $70).
     Feedback: Strong technical skills noted, but the team
     would like to see governance-specific experience..."

    [Accept Counter] [Propose New Terms] [Decline]
```

**Quorum rules:**
- Minimum 2 of 3 reviewers must respond
- If quorum met before 48hrs, closes early
- If quorum not met at deadline, non-responders not counted
- If no quorum at all → escalation

**Max negotiation rounds:** 2 (configurable)

---

## Phase 5: Resolution (Approval/Rejection)

**File:** `src/conversations/resolution.ts`

**Purpose:** Finalize the agreement or handle rejection with cooldown.

```
  ┌──────────────────┐
  │ Agreement outcome │
  └────────┬─────────┘
           │
     ┌─────┴─────┐
     │           │
  Approved    Rejected
     │           │
     ▼           ▼
  "Congrats!    "Thank you for your time.
   Admin will    You can re-apply after
   create your   3 days."
   agreement        │
   in Beta App."    ▼
     │          Set cooldown:
     ▼            status = "cooldown"
  API call:       cooldownUntil = now + 3 days
  POST /orgs/     previousAttempts++
  agreement       Flag with context:
  {userId,          "Previously attempted,
   roleName,         reason: [rejection feedback]"
   responsibilities,
   marketRate,
   fiatRequested,
   commitment}
     │
     ▼
  Session reset → idle
```

---

## Admin Commands

**File:** `src/conversations/admin.ts`

**Purpose:** Core contributors manage opportunities through bot commands (not spreadsheet).

| Command | Description | Example |
|---------|-------------|---------|
| `/add_opportunity` | Create new open position | `/add_opportunity Governance Dev - Solidity, 30-50%, $60-80/hr` |
| `/list_opportunities` | View all positions with status | Shows 🟢 open, 🟡 paused, 🔴 filled |
| `/edit_opportunity` | Modify an existing position | `/edit_opportunity opp_123 rate $70-90/hr` |
| `/pause_opportunity` | Temporarily hide a position | `/pause_opportunity opp_123` |

Admin commands use Claude tool use to extract structured data from natural language input, so admins don't need to follow a rigid format.

---

## Data Entities

### Google Sheets Tabs

**Opportunities**
| Column | Type | Description |
|--------|------|-------------|
| id | string | `opp_${timestamp}` |
| title | string | Role name |
| description | string | Brief overview |
| skillsRequired | string (comma-sep) | Required skills |
| commitmentMin | number | Min % commitment |
| commitmentMax | number | Max % commitment |
| hourlyRateMin | number | Budget floor |
| hourlyRateMax | number | Budget ceiling |
| responsibilities | string | Detailed duties |
| status | enum | open / filled / paused |
| createdBy | string | Admin Telegram ID |
| createdAt | ISO date | Creation timestamp |

**Contributors**
| Column | Type | Description |
|--------|------|-------------|
| id | string | `c_${timestamp}` |
| telegramId | string | Telegram user ID |
| telegramHandle | string | @username |
| name | string | Display name |
| skills | string (comma-sep) | Offered skills |
| commitmentPercent | number | Available commitment |
| desiredRateMin | number | Rate floor |
| desiredRateMax | number | Rate ceiling |
| timezone | string | e.g. "UTC+2" |
| location | string | Country/city |
| status | enum | active / hired / rejected / cooldown |
| cooldownUntil | ISO date | Cooldown expiry |
| previousAttempts | number | Re-application count |
| createdAt | ISO date | First interaction |

**Agreements**
| Column | Type | Description |
|--------|------|-------------|
| id | string | `a_${timestamp}` |
| opportunityId | string | Linked opportunity |
| contributorId | string | Linked contributor |
| roleName | string | Position title |
| responsibilities | string | Agreed duties |
| hourlyRate | number | Agreed rate |
| commitmentPercent | number | Agreed commitment |
| durationMonths | number | Contract length |
| settlementLikelihood | number | 0-95% score |
| status | enum | draft / submitted / under_review / approved / rejected / signed |
| negotiationRound | number | Current round (max 2) |
| submittedAt | ISO date | Submission timestamp |

**AuthorizedUsers**
| Column | Type | Description |
|--------|------|-------------|
| telegramId | string | Telegram user ID |
| role | enum | user / admin |
