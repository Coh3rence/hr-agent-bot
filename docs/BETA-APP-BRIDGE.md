# Beta App Bridge — Agreement Creation Integration

How an approved proposal becomes an agreement record in Collabberry's Beta App.
This is the final unbuilt step (the `TODO` in `src/conversations/resolution.ts`,
`accept` branch).

## Status

- **Verified** against a self-hosted Collabberry backend fork (run locally via
  `docker compose up -d --build`): the full create → read-back → edit path works.
- **Buildable now** (no external dependency): the API client, rate mapping, and
  the idempotent create/update in the `accept` branch.
- **Blocked on a product answer**: the contributor → Collabberry user linkage
  flow (invite-only vs. also supporting admin-added). See "Linkage".

## Verified API contract

Base URL includes `/api` (all routes mounted under it). Bearer JWT in the
`Authorization` header; the token payload is just `{ walletAddress }`, signed
with the backend's `JWT_SECRET`.

| Operation | Endpoint | Notes |
|---|---|---|
| Create | `POST /api/orgs/agreement` | body below; behind `jwtMiddleware` + `adminMiddleware` |
| Read | `GET /api/orgs/contributors/:userId/agreements` | returns stored record |
| Edit | `PUT /api/orgs/agreement/:agreementId` | body **also requires `userId`** |

Body (all required): `{ userId, roleName, responsibilities, marketRate,
fiatRequested, commitment }`. `commitment` is 1–100. `marketRate` /
`fiatRequested` are plain numbers (2-dp decimals), no server-side units.

Behavior notes:
- `userId` must be a registered Collabberry user in the **same org** as the admin
  whose wallet is in the JWT, else 404.
- Re-submitting for a user who already has an agreement returns **400**
  ("User already has an agreement!") — *after* the one-line fork fix that loads
  the `agreement` relation; without it the duplicate INSERT surfaces as a 500.
  So the bot must GET first and PUT if an agreement exists.
- The agreement create is a **pure DB write** — no on-chain dependency. Minting
  TeamPoints / signing stays a separate manual admin action.
- `adminMiddleware` calls an **on-chain** `isAdmin` check (requires the org to
  have a deployed TeamPoints contract where the wallet is admin). For local
  testing the fork has an env-gated bypass: `ADMIN_CHECK_BYPASS=true` and
  `NODE_ENV != production`.

## Rate mapping

The bot negotiates an **hourly** rate; Collabberry's `marketRate` is **monthly**
(frontend label "Market Rate (per month)").

- `marketRate` = `round(agreement.hourlyRate × 160)` — 160 h/mo (40h × 4),
  confirmed by client.
- `commitment` = `agreement.commitmentPercent`.
- Base salary is **derived** by Collabberry (`marketRate × commitment%`) and is
  *not* sent — we only send `marketRate`, `fiatRequested`, `commitment`.
- `fiatRequested` = the portion of monthly comp paid in **fiat** (remainder in
  TeamPoints), validated `≤ marketRate × commitment%`. The bot does not capture
  this today. Default to `0` (all TeamPoints) unless/until we add a question.

## Linkage: contributor → Collabberry userId

The API needs the contributor's Collabberry **userId (UUID)**. The bot only
stores Telegram identity. A raw "type your wallet address" is rejected — there's
no proof of ownership and TeamPoints would mint to whatever was typed.

Ownership is proven by Collabberry's **SIWE** sign-in (sign a nonce with the
wallet). A Telegram bot can't sign, so lean on Collabberry's signup:

**Path A — invite link (proof-backed, automatic):**
1. Bot mints a **unique single-use** org invite, DMs the contributor the link.
2. They sign up on Collabberry, signing with their wallet (proves ownership).
3. Bot resolves `userId` from the **token they redeemed**; caches it to the sheet.

**Path B — admin adds the contributor (weaker):** no cryptographic proof (admin
vouches), and the mapping is **not** automatic — someone must record the
contributor's wallet/userId where the bot can read it (e.g. the sheet).

> Open question sent to client: support both, or standardize on Path A?

## Changes required

### Fork (backend) — only for Path A linkage
- `Invitation` entity: record **who redeemed** a token (not tracked today) and
  support single-use tokens (`usageLimit = 1`).
- Endpoint for the bot to resolve "which `userId` redeemed token X".
- (Already applied locally, unpushed) load the `agreement` relation in
  `addAgreement` so duplicates return 400 not 500.

### Bot
- New service `src/services/beta-app.ts`: `getAgreement`, `createAgreement`,
  `updateAgreement`, `createInvite`, `resolveUserIdByToken`. Bearer-authed.
- `resolution.ts` `accept` branch: resolve userId → build payload (rate mapping
  above) → GET-then-POST/PUT → handle 401/404/400/500.
- Contributors sheet: add `collabberryUserId`, `collabberryInviteToken`
  (optionally `walletAddress`). Cache userId once resolved.
- Config already has `BETA_APP_API_URL` (default ends in `/api`) and
  `BETA_APP_JWT` (optional). For local test: `BETA_APP_API_URL=http://localhost:3000/api`.

## Build order

1. `beta-app.ts` client + rate mapping + idempotent create/update in `accept`
   branch. Testable now against the fork with a manually-set `collabberryUserId`.
2. Linkage (Path A) + the fork invitation changes — once the client answers.
3. Fiat/TeamPoints split capture, if the client wants it (else keep default 0).

## Local test setup (recap)

- Fork stack: `docker compose up -d --build` in the backend fork; backend on
  `:3000`, MySQL on `:3306`. `JWT_SECRET=secret`, `ADMIN_CHECK_BYPASS=true`.
- Mint an admin JWT by signing `{ walletAddress }` with `secret`.
- Seed: register admin user → create org → fetch invite token → register
  contributor with it → POST agreement.
