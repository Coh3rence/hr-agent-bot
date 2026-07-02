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

### Join key: the invite token, not the Telegram handle (decided)

Path A step 3 needs a **join key** to link the freshly-signed-up Collabberry user
back to the Telegram person the bot invited. Two candidates:

- **Telegram handle** — what the code does *today* (`resolveByHandle` in
  `src/services/betaApp.ts`): after signup the bot scans the org roster for a
  contributor whose `telegramHandle` matches. **Fragile**, because the handle is
  self-reported at signup:
  - The invite-link signup form (`SignUpWithInviteLink.tsx`) has a Telegram Handle
    field but it is **optional** (`Yup.string().notRequired()`) and free-typed — a
    skipped or mistyped handle (`@alex` vs real `@alexus`) silently breaks the link.
  - `createInviteLink()` mints a **shared org invite** (`GET /orgs/invitation`),
    `usageLimit: 10` in the fork — one token is *not* 1:1 with a contributor, so the
    token alone can't currently identify who signed up.

- **Invite token** — the robust design, and the target. The bot mints a
  **per-contributor** token (`usageLimit: 1`), stores `{token → telegramId}` in the
  Contributors sheet at invite time, and after signup resolves `userId` by the
  token the person redeemed. Signature proves wallet ownership; the token proves
  it's *our* invited person. No handle typing, no fuzzy match. The Telegram-handle
  field becomes optional metadata rather than the load-bearing key.

**Decision:** standardize on the **invite token** as the join key. The blocker is
purely on the fork — it does not persist which user redeemed a token today
(`registerUser` in `user.service.ts` only does `usageCount += 1`; the `Invitation`
entity in `orgInvitation.model.ts` has no redeemer/user link). Once the fork
records and exposes token→userId (below), the bot swaps `resolveByHandle` for
`resolveByToken`.

### Can we combine the Telegram ID + the wallet signature?

Two distinct facts get fused at signup, and it helps to be precise about what
proves what:

- **Wallet signature (SIWE)** proves *the person controls this wallet*. Strong,
  cryptographic.
- **Telegram ID** comes from *the bot*, which minted the invite and DM'd it to one
  Telegram user. Its trust is "whoever the bot privately sent this single-use link
  to" — operational, not cryptographic.

The **token model already combines them**: the token carries the Telegram identity
(via the bot's `{token → telegramId}` map), the signature carries wallet ownership,
and redeeming the token fuses both into one Collabberry `userId`. That is enough
for onboarding contributors the bot already trusts.

Stronger cryptographic fusion — making the contributor **sign a message that
embeds their Telegram ID** — is possible but a bigger lift (custom SIWE
statement + backend verification), and it does **not** actually raise the trust
floor on its own: the signer signs whatever Telegram ID the app puts in the
message, so a forwarded link still binds the wrong wallet. Truly binding both
sides needs a **Telegram-verified handshake** (e.g. Telegram Login Widget, or the
contributor tapping a bot deep-link that the bot cross-checks) *alongside* the
wallet sign. That is future hardening, out of scope for v1; the single-use,
privately-DM'd link is the practical binding for now.

## Changes required

### Fork (backend) — for token-as-join-key linkage
- Mint **single-use** invites (`usageLimit = 1`) so a token maps to exactly one
  signup. Today `createInviteLink` hits `GET /orgs/invitation` which defaults to
  `usageLimit: 10`.
- `registerUser` (`user.service.ts`): persist the redeemed `invitationToken` on the
  new user. Add an `invitationToken` column to `user.model.ts` (nullable) and set
  `user.invitationToken = userData.invitationToken`.
- Surface it on the roster: add `invitationToken` to the `getOrgById`
  contributor projection — same 1-line spot already used to expose `telegramHandle`.
- (Already applied locally, unpushed) load the `agreement` relation in
  `addAgreement` so duplicates return 400 not 500.

### Bot
- `src/services/betaApp.ts`: replace `resolveByHandle(telegramHandle)` with
  `resolveByToken(token)` — find the roster contributor whose `invitationToken`
  matches the token we minted. `createInviteLink`, `getRoster`, `createAgreement`
  already exist.
- `createInviteLink()`: store the returned `token` in the Contributors sheet
  against the contributor's `telegramId` (the `{token → telegramId}` map).
- `resolution.ts` `accept` branch: mint invite (single-use) → on "I've signed up"
  resolve userId via `resolveByToken` → build payload (rate mapping above) →
  GET-then-POST/PUT → handle 401/404/400/500.
- Contributors sheet: add `collabberryInviteToken` alongside the existing
  `collabberryUserId` / `walletAddress`. Cache userId once resolved.
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
