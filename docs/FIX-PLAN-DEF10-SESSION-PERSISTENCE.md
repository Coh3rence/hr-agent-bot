# Fix plan — DEF-10 (conversation state lost on every restart)

**Author:** Prosperity Labs
**Date:** 2026-09-08
**Status:** Proposed — awaiting sign-off before implementation
**Defect source:** `docs/KNOWN-ISSUES-AND-DECISIONS.md` §10, observed live during the 2026-09-08 client QA session

---

## 1. Why this one

`src/bot.ts:48` installs grammy's `session()` with no storage adapter, so every conversation lives
in process memory. Any restart — deploy, crash, or the Telegram 409 `getUpdates` conflict that
Railway resolves by restarting the container — wipes all in-flight conversations.

This is not theoretical. During the 2026-09-08 QA session the bot restarted several times behind a
409 and a tester asked *"why does it ask for the same info 10x"*. The bot had genuinely forgotten
everything he had told it.

Three concrete failure modes:

| Phase lost | Consequence |
|---|---|
| `discovery` | `messageHistory` is gone, so the extractor re-derives the profile from nothing and the bot re-asks every question. Most visible, most embarrassing. |
| `reviewer_feedback` | `pendingReviewAgreementId` / `pendingReviewDecision` are gone. The reviewer's next message is no longer read as a counter-offer — it falls through to the generic router. Their decision is silently dropped. |
| `negotiating` | `negotiationContext` and `negotiationRound` are gone. The round counter resets, which quietly defeats the `MAX_NEGOTIATION_ROUNDS` cap that DEF-1 was fixed to enforce. |

The third is the one that matters most: a lost session does not merely inconvenience a user, it
reopens a business rule we have told the client is enforced.

It also constrains operations. Today the rule is "never deploy while anyone is mid-conversation",
which is unenforceable and gets less realistic as usage grows.

### 1.1 What is *not* affected

Anything already written to the Sheet survives. Contributors, agreements, and reviewer feedback are
durable. `handleResolution` already rehydrates from the sheet using the agreement id carried in the
callback data, specifically so the accept/reject buttons work on a cold session. That pattern is the
right one; this plan generalises it rather than replacing it.

---

## 2. Current behaviour

```typescript
// src/bot.ts:48
bot.use(
  session({
    initial: (): SessionData => ({ phase: "idle", /* … */ }),
  })
);
```

With no `storage` option grammy defaults to `MemorySessionStorage`, a `Map` in the process.

`SessionData` (`src/models/types.ts:101`) is small and JSON-serialisable, with one unbounded field:

```typescript
export interface SessionData {
  phase: ConversationPhase;
  contributorId: string | null;
  selectedOpportunityId: string | null;
  currentAgreementId: string | null;
  messageHistory: { role: "user" | "assistant"; content: string }[];  // grows without limit
  pendingReviewAgreementId: string | null;
  pendingReviewDecision: "counter" | "reject" | null;
  negotiationContext: string | null;
  negotiationRound: number;
}
```

Nothing in it is a class instance, a `Date`, or a closure, so it round-trips through JSON unchanged.
That is what makes this a small change.

---

## 3. Options considered

| Option | Survives restart | New infrastructure | Notes |
|---|---|---|---|
| **A. File adapter on a Railway volume** | Yes | A volume (no new service) | `@grammyjs/storage-file` v2.6.0. Single-instance only. |
| **B. Redis** | Yes | A Redis service | `@grammyjs/storage-redis` v2.6.0. Multi-instance safe, native TTL. |
| **C. The existing MySQL** | Yes | None | Couples the bot to the backend's database; needs a table, a migration and a custom adapter. |
| **D. A Sheet tab** | Yes | None | Rejected — see below. |

**D is rejected outright.** Sessions are written on *every* message. The Sheets API is
rate-limited per minute and each call costs hundreds of milliseconds; this would make the bot
visibly slower and would eventually start failing under quota. The Sheet is the right store for
business records precisely because they are written rarely.

**C is rejected for coupling.** The bot currently talks to the backend only over HTTP. Giving it
direct database credentials to serve its own scratch state trades a clean boundary for no
functional gain over A or B.

**B is the textbook answer** and where we end up if the bot is ever scaled past one instance. It is
more infrastructure than the current load justifies.

### Recommendation: A, with B as the documented upgrade path

The bot runs at `numReplicas=1`. A file adapter on a mounted volume is roughly a five-line change,
adds no service, no credentials, and no new failure mode. Moving to Redis later is a swap of one
adapter for another behind the same `storage` option — the session code itself does not change.

**The single-instance constraint is a recorded design decision**, not an oversight — see
`docs/KNOWN-ISSUES-AND-DECISIONS.md` §12. A file adapter is safe only while exactly one instance
runs; two replicas would write the same files concurrently and corrupt sessions. Scaling the `bot`
service past one replica therefore requires swapping the adapter first, and that swap is a one-line
change to the `storage` option.

---

## 4. Implementation

### 4.1 Attach a Railway volume

Mount a volume on the `bot` service at `/data`. Railway volumes persist across deploys and
restarts. Without this the files land on the container's ephemeral filesystem and the fix is a
no-op — **this step is the actual fix; the code change alone does nothing.**

### 4.2 Wire the adapter

```typescript
import { FileAdapter } from "@grammyjs/storage-file";

bot.use(
  session({
    initial: (): SessionData => ({ /* unchanged */ }),
    storage: new FileAdapter<SessionData>({ dirName: config.SESSION_DIR }),
  })
);
```

`SESSION_DIR` is a new env var defaulting to `/data/sessions`, added to the zod schema in
`src/config.ts`. A default keeps local development working with no `.env` change; pointing it at a
gitignored local path means `bun run dev` also stops forgetting conversations on every file-watch
restart, which is a quiet quality-of-life win.

### 4.3 Bound `messageHistory`

Sessions become durable, so an unbounded array becomes an unbounded file, and it is also sent to
Claude on every discovery turn — this is a token-cost issue today and a disk issue after the change.

Cap it in `handleDiscovery` where entries are appended, keeping the most recent N turns
(N ≈ 20, i.e. ten exchanges — comfortably more than a profile needs). Trim on write rather than on
read so the stored copy is the bounded one.

### 4.4 Expire stale sessions

An abandoned conversation should not pin state forever. `FileAdapter` has no TTL, so add a sweep
alongside the existing review-timeout sweep in `src/services/timeout.ts` — that scheduler already
exists and runs every 15 minutes.

Delete session files untouched for **7 days**. That is comfortably longer than the 48-hour reviewer
window, so no live review is ever swept, and short enough that abandoned discovery chats do not
accumulate. Anything genuinely important is in the Sheet regardless.

---

## 5. Testing

Adapter wiring is configuration, so the valuable tests are on the pieces with logic:

1. **`messageHistory` trimming** — unit test the cap: under the limit is untouched, over the limit
   keeps the newest N in order, and the oldest are dropped.
2. **Session expiry** — unit test the sweep predicate against fabricated timestamps either side of
   the 7-day boundary.
3. **Round-trip** — assert a fully-populated `SessionData` survives `JSON.parse(JSON.stringify(x))`
   unchanged. Cheap, and it fails loudly if someone later adds a `Date` or a `Map` to the type.
4. **Manual, on Railway, after deploy** — start a discovery conversation, give the bot a name and
   skills, restart the service from the dashboard, then send one more message. The bot must
   continue rather than re-ask. This is the only test that proves the volume is actually mounted,
   and it is the one that reproduces what the tester hit on 2026-09-08.

---

## 6. Rollout

Deploying this **discards all in-flight sessions one final time** — the memory store is empty on
boot and there is nothing to migrate from. Deploy when no one is mid-conversation, and confirm the
log tail has no recent 409 first.

No data migration, no backfill, and the change is revertible by removing the `storage` option.

---

## 7. Out of scope

- **Redis / multi-instance.** Deliberately deferred; §3 records the trigger.
- **DEF-8 (the manual "I've signed up" tap).** Independent of session storage — it survives a
  restart today because the callback carries the agreement id.
- **Replacing the Sheet as the business-record store.** Unrelated, and intentional for the MVP.
