# Fix plan — DEF-1 (negotiation round cap) and DEF-3 (silent returns)

**Author:** Prosperity Labs
**Date:** 2026-08-23
**Status:** Proposed — awaiting sign-off before implementation
**Defect source:** `docs/QA-TEST-PLAN.md` Part 10 (twelve defects found by code inspection, 2026-08-23)

---

## 1. Why these two

Twelve defects were found. These two are the only ones proposed for this pass.

**DEF-1** is the only defect that contradicts a rule we have written down as a business rule in client-facing documents. `MAX_NEGOTIATION_ROUNDS=2` is configured, documented, and never read. A contributor can negotiate indefinitely. Both `QA-VERIFICATION.md` and `docs/DELIVERY-STATUS.md` currently carry an explicit "not enforced" correction because of it. Fixing the code lets those corrections be removed rather than shipped to the client as a caveat.

**DEF-3** is cheap and improves every demo. Seven code paths return silently — the bot simply stops replying, with no message and no log line. During the 2026-07-31 production run this is indistinguishable from the bot being down. No logic changes, only user-facing replies.

Everything else (DEF-2, DEF-4 … DEF-12) is out of scope for this pass — see §7.

---

## 2. DEF-1 — enforce the negotiation round cap

### 2.1 Current behaviour

`src/conversations/negotiation.ts:113` hard-codes the round on every draft agreement:

```typescript
negotiationRound: 1,
```

The value is never incremented and `config.MAX_NEGOTIATION_ROUNDS` is never read anywhere in the codebase. The contributor can loop Submit → review → **Modify Terms** → Submit an unlimited number of times.

### 2.2 Design decisions

Two choices matter here, and both are worth confirming before the code is written.

**Decision A — enforce at the Modify button, not at agreement creation.**

The obvious place to put the guard is in `negotiation.ts`, where the agreement is created. That is the wrong place. By the time execution reaches line 100, the contributor has already had a full conversation with the bot and typed out their revised terms. Refusing there means throwing away work they just did and reads as a bug.

Instead the guard goes on the **Modify** branch in `src/conversations/resolution.ts:150`, which is the moment the contributor asks to start another round. They are told up front that they are out of rounds and are re-offered the two remaining choices — accept the reviewers' counter, or walk away.

**Decision B — read the round from the persisted agreement row, not from session state.**

`handleResolution` already documents (`resolution.ts:5-15`) that the candidate may tap these buttons hours later, on a cold session, after a process restart. Session state is in-memory and does not survive that. The agreement row does. So the count is authoritative in `agreement.negotiationRound` (persisted via `sheets.ts` column mapping); `ctx.session.negotiationRound` exists only to carry the value from the Modify tap forward to the next `addAgreement` call in the same conversation.

**Definition of a round:** one complete submit → review → modify cycle. The first draft is round 1. Tapping Modify after a review moves the next draft to round 2. With `MAX_NEGOTIATION_ROUNDS=2`, the contributor gets one revision after their first review, then must accept or walk away.

### 2.3 Exact changes

| # | File | Location | Change |
|---|---|---|---|
| 1 | `src/models/types.ts` | `SessionData`, line 101 | Add field `negotiationRound: number` |
| 2 | `src/bot.ts` | session `initial` factory, line 48 | Initialise `negotiationRound: 1` |
| 3 | `src/bot.ts` | `BotContext` type, line 21; injection middleware, line 38 | Add `config: Env` so handlers can read `MAX_NEGOTIATION_ROUNDS` without importing the module directly. `config` is already loaded at line 28 — this only widens the context alongside `sheets` / `claude` / `beta` |
| 4 | `src/conversations/resolution.ts` | `modify` branch, line 150 | Guard before the existing body: if `agreement.negotiationRound >= ctx.config.MAX_NEGOTIATION_ROUNDS`, reply that the revision limit is reached and re-send the Accept / Walk away keyboard, then `return`. Otherwise set `ctx.session.negotiationRound = agreement.negotiationRound + 1` and fall through to the existing re-entry logic |
| 5 | `src/conversations/negotiation.ts` | line 113 | `negotiationRound: ctx.session.negotiationRound` — replaces the hard-coded `1` |
| 6 | `src/bot.ts` | `select_opp` handler, line 123 | Reset `ctx.session.negotiationRound = 1` — a new opportunity is a new negotiation, not a continuation |
| 7 | `src/conversations/resolution.ts` | `resetSession`, line 248 | Reset `negotiationRound` to `1` alongside the other fields |

Items 6 and 7 are the ones that are easy to forget and would cause a contributor who walked away and re-applied to be immediately capped.

### 2.4 Proposed cap message

> You've already revised these terms once. To keep things moving, we cap revisions at two rounds. You can accept the team's counter-offer as it stands, or step away — you're welcome to re-apply later.

Wording is open to change; the keyboard beneath it must offer only **Accept** and **Walk away**, and must carry the agreement id in the callback data (`resolution:accept:<id>` / `resolution:walkaway:<id>`) to match the existing cold-session pattern.

---

## 3. DEF-3 — replace silent returns with user-facing replies

Seven `return` statements end a turn with no reply and no log. Each becomes a message. **No control flow changes** — the function still returns at the same point.

| # | File:line | Condition | Proposed reply |
|---|---|---|---|
| 1 | `negotiation.ts:37` | No opportunity selected in session | "I've lost track of which role we were discussing. Send /start and I'll pick things back up." |
| 2 | `negotiation.ts:43` | Selected opportunity no longer open | "That role has just been closed or paused. Send /start to see what's currently open." |
| 3 | `negotiation.ts:77` | Same, on the terms-complete path | Same as #2 — plus a `console.error` with the opportunity id, since reaching here means the role closed mid-negotiation |
| 4 | `negotiation.ts:80` | Contributor row not found | "I can't find your profile. Send /start to set it up again." + `console.error` with the telegram id |
| 5 | `resolution.ts:24` | No agreement id in callback or session | "I couldn't tell which proposal that was about. Send /start and I'll re-send your current one." |
| 6 | `resolution.ts:27` | Agreement id present but row missing | Same message. `console.error` is already there — keep it |
| 7 | `review.ts:115-117` | Reviewer's pending decision lost | "I've lost track of which proposal you were responding to. Open the notification again and tap your choice." — the existing `ctx.session.phase = "idle"` reset stays |

---

## 4. Verification

**Automated**

- `bun run typecheck` — item 1 (new `SessionData` field) will fail the build anywhere the session is constructed and the field is missed, which is the point.
- `bun test` — existing suite must stay green.
- New unit coverage beside `src/conversations/review.test.ts`:
  - Modify at round 1 → new draft is created with `negotiationRound: 2`
  - Modify at round 2 with cap 2 → refused, no new agreement row written, Accept/Walk away keyboard re-sent
  - Cap read from `config`, not hard-coded — set `MAX_NEGOTIATION_ROUNDS=3` and assert a third round is permitted
  - `select_opp` and `resetSession` both return the session counter to 1

**Manual — cases already written in `docs/QA-TEST-PLAN.md`**

| Case | What it covers |
|---|---|
| N-10 | Round cap enforced at the second Modify |
| N-12 | Cap value honoured from environment override |
| N-13 | Walk away from the capped state enters 3-day cooldown |
| D-13 | Discovery re-entry after cap does not inherit the old count |
| RS-13 | Cap survives a process restart (round read from the sheet, not memory) |

Note that manual verification of anything conversational is **blocked until a valid `ANTHROPIC_API_KEY` is deployed** — Claude drives term extraction, so the negotiation path cannot be walked without it.

---

## 5. Documentation follow-up (part of the same change)

Once the code is in, three documents carry corrections that become obsolete and must be reverted:

1. `docs/QA-TEST-PLAN.md` Part 10 — remove DEF-1 and DEF-3 rows, renumber or mark them resolved with the fixing commit.
2. `QA-VERIFICATION.md` — business rules table row for `MAX_NEGOTIATION_ROUNDS` reverts to a plain "2"; test D2 reverts from "Known gap — no cap is enforced" to a normal expected result ("third revision attempt is refused; contributor is offered accept or walk away").
3. `docs/DELIVERY-STATUS.md` — design decisions table row "Max 2 negotiation rounds" drops the "**Not currently enforced in code**" qualifier; known limitation #6 is deleted.

`QA-VERIFICATION.html` and `QA-VERIFICATION.pdf` need rebuilding after item 2 (`bun scripts/build-qa-doc.ts`).

---

## 6. Risk

Low. The change is additive: one new session field, one guard branch, seven new replies.

The one behaviour that changes for an existing user mid-flight is a contributor who is already past round 1 when the fix deploys. Because the count is read from the persisted row and every existing row holds `negotiationRound: 1`, they get one more revision — not zero. No existing data is invalidated and no migration is needed.

---

## 7. Explicitly out of scope

The remaining ten defects are **not** addressed here. The significant one:

**DEF-2 — no signup auto-detection.** Nothing polls the backend for signup completion; the contributor must return to Telegram and tap "I've signed up", and tapping before signup completes silently does nothing. This is the most common source of confusion in a live demo. It is a real feature (a poll or a backend webhook), not a patch, and is documented as an accepted MVP limitation in both `QA-VERIFICATION.md` §5 and `docs/DELIVERY-STATUS.md`.

DEF-4 through DEF-12 (including DEF-12, `getOpportunities` reading `A2:K` but mapping `createdAt` from column L, so it is always empty) remain documented in `docs/QA-TEST-PLAN.md` Part 10 for the client to triage.

---

## 8. Open questions — need your call before I start

1. **Is the Modify-button placement right?** The alternative is refusing at agreement creation, which is simpler but discards terms the contributor has already typed. I believe the Modify placement is correct but it is a product decision, not a technical one.
2. **Is widening `BotContext` with `config` acceptable?** It follows the existing `sheets` / `claude` / `beta` injection pattern. The alternative is importing `loadConfig()` inside `resolution.ts`, which is fewer lines but harder to stub in tests.
3. **Fix these two, or disclose all twelve and fix none?** If the client would rather see the full defect list before any code moves, this plan should wait.

---

## 9. Estimate

Roughly half a day including tests and the documentation revert. The manual QA cases cannot be run until the Anthropic key is deployed, so sign-off on the change will lag the code.
