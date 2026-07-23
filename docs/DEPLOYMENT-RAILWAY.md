# Deployment — Railway (bot + backend + MySQL) & Vercel (frontend)

Production topology for the HR Agent MVP. Nothing on-chain needs hosting — the
Collabberry org is already live on **Arbitrum One mainnet** (org
`63e3ac6c-3e63-4eec-9ac0-de607adf7d05`).

```
Telegram ──▶ Bot (Railway, Bun worker, long-polling)
                │  X-Service-Key
                ▼
             Backend API (Railway, Node/Dockerfile) ──▶ MySQL (Railway plugin)
                ▲                                          Arbitrum One RPC
                │ SIWE signup + admin view
             Frontend (Vercel, Vite static)
```

## Services

| # | Service | Where | Source | Build |
|---|---------|-------|--------|-------|
| 1 | **MySQL** | Railway | Railway MySQL plugin | managed |
| 2 | **Backend API** | Railway | `Coh3rence/backend` | its `Dockerfile` (Node 20) |
| 3 | **Bot** | Railway | `Coh3rence/hr-agent-bot` | `Dockerfile` (oven/bun) via `railway.json` |
| 4 | **Frontend** | Vercel | `Coh3rence/frontend` | Vite static build |

The backend's `scheduled-jobs` / `roundsStartJob` process (Collabberry funding
rounds) is **not deployed** — the bot MVP does not use it.

---

## Deploy order

Stand up bottom-up so each service can reference the one below it.

### 1. MySQL (Railway)
- New project → **Add MySQL**. Railway provisions it and exposes
  `MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD`, `MYSQLDATABASE`.
- No schema step: the backend runs TypeORM `synchronize: true`
  (`data-source.ts:13`), so it auto-creates all tables (incl. the D-018 invite
  token column) on first connect.

### 2. Backend API (Railway)
- New service **from the `Coh3rence/backend` repo** — Railway auto-detects the
  `Dockerfile` and builds it (`yarn build` → `node dist/src/index.js`).
- Set the variables in **Backend env** below. Use Railway reference syntax to
  wire the DB, e.g. `DB_HOST=${{MySQL.MYSQLHOST}}`.
- After first deploy, note the service's public URL (e.g.
  `https://collabberry-backend-production.up.railway.app`). The bot and
  frontend point at `‹that URL›/api`.

### 3. Bot (Railway)
- New service **from the `Coh3rence/hr-agent-bot` repo** — `railway.json`
  selects the Dockerfile builder and the `bun run index.ts` start command.
- Set the variables in **Bot env** below. `BETA_APP_API_URL` = the backend URL
  from step 2 + `/api`.
- No inbound port needed (long-polling worker). Railway may warn about no
  exposed port — that is expected.

### 4. Frontend (Vercel)
- Import `Coh3rence/frontend`. Framework preset: Vite.
- Set the `VITE_*` vars in **Frontend env** below; `VITE_APP_BASE_URL` = the
  backend URL from step 2.
- After deploy, copy the Vercel URL back into the **bot's** `BETA_APP_INVITE_URL`
  (`‹vercel-url›/member-sign-up`) so invite links deep-link correctly.

---

## Env vars

Redacted — set the real values in each service's Railway/Vercel dashboard, never
in git. Bot vars are validated by `src/config.ts` (zod) on boot; a missing
required var exits the process with a clear error.

### Bot env (Railway service #3)

| Var | Required | Value / source |
|-----|----------|----------------|
| `NODE_ENV` | ✅ | `production` (disables the self-review hatch) |
| `BOT_TOKEN` | ✅ | **Production** Telegram bot token (not the dev bot) |
| `ANTHROPIC_API_KEY` | ✅ | Anthropic key |
| `GOOGLE_SHEETS_ID` | ✅ | The production sheet id |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | ✅ | Service-account email (has edit access to the sheet) |
| `GOOGLE_PRIVATE_KEY` | ✅ | Service-account private key, single line with literal `\n` (the bot un-escapes it, `sheets.ts:17`) |
| `BETA_APP_API_URL` | ✅ | `‹backend Railway URL›/api` |
| `BETA_APP_SERVICE_KEY` | ✅ | Shared unattended-auth key — **must equal** backend `SERVICE_API_KEY` |
| `BETA_APP_ORG_ID` | ✅ | `63e3ac6c-3e63-4eec-9ac0-de607adf7d05` |
| `BETA_APP_INVITE_URL` | ✅ | `‹Vercel URL›/member-sign-up` |
| `BETA_APP_INVITE_PARAM` | ✅ | `invitationToken` (the frontend reads this param) |
| `FTE_HOURS_PER_MONTH` | — | default `160` |
| `DEFAULT_FIAT_REQUESTED` | — | default `0` (all TeamPoints) |
| `REVIEWER_TIMEOUT_HOURS` | — | default `48` |
| `MAX_NEGOTIATION_ROUNDS` | — | default `2` |
| `COOLDOWN_DAYS` | — | default `3` |
| `ALLOW_SELF_REVIEW` | ❌ | **Do NOT set.** Only works with `NODE_ENV=development`; leave unset in prod |

### Backend env (Railway service #2)

| Var | Required | Value / source |
|-----|----------|----------------|
| `NODE_ENV` | ✅ | `production` |
| `PORT` | — | Railway injects it; backend reads `process.env.PORT` |
| `DB_HOST` | ✅ | `${{MySQL.MYSQLHOST}}` |
| `DB_PORT` | ✅ | `${{MySQL.MYSQLPORT}}` |
| `DB_UNAME` | ✅ | `${{MySQL.MYSQLUSER}}` |
| `DB_PASS` | ✅ | `${{MySQL.MYSQLPASSWORD}}` |
| `DB_NAME` | ✅ | `${{MySQL.MYSQLDATABASE}}` |
| `JWT_SECRET` | ✅ | Strong random secret |
| `SERVICE_API_KEY` | ✅ | Shared key — **must equal** bot `BETA_APP_SERVICE_KEY` |
| `SERVICE_ADMIN_WALLET` | ✅ | `0xD02f13D88512f82be8eCfecF1a167D68B3965878` (admin the bot impersonates) |
| `ARBITRUM_RPC_URL` | ✅ | `https://arb1.arbitrum.io/rpc` |
| `CELO_RPC_URL` | — | `https://forno.celo.org` (celo factory reference) |
| `FRONT_URL` / `CORS_ORIGINS` | ✅ | The Vercel frontend URL (CORS + invitation links) |
| `EMAILS_ENABLED` | — | `false` unless Postmark/SMTP is configured |
| `ADMIN_CHECK_BYPASS` | ❌ | **Do NOT set** — local-test bypass only |

> The backend also references `AWS_*`/S3 (profile pictures) and Postmark/SMTP
> email vars. All optional: avatar upload is skipped when AWS is unset
> (commit `ec46c39`), and email is off with `EMAILS_ENABLED=false`.

### Frontend env (Vercel, service #4)

| Var | Value |
|-----|-------|
| `VITE_NODE_ENV` | `production` (gates wallet chains to Arbitrum/Celo) |
| `VITE_APP_BASE_URL` | `‹backend Railway URL›` |
| `VITE_APP_URL` | The Vercel URL |

> Mainnet factory `0x86207Ce1202766041F414C47134A8b0A1607d899` (Arbitrum One),
> celo factory `0x0e414560fdEeC039c4636b9392176ddc938b182D`. Confirm the
> frontend's current env keys against `Coh3rence/frontend` before deploy.

---

## Production-safety checklist (before the first real contributor)

- [ ] `NODE_ENV=production` on **both** bot and backend.
- [ ] `ALLOW_SELF_REVIEW` unset on the bot; `ADMIN_CHECK_BYPASS` unset on the backend.
- [ ] Restore the client reviewer **`302836662`** in the `AuthorizedUsers` sheet
      tab (removed during solo testing) and validate real 2-of-N quorum.
- [ ] `BETA_APP_SERVICE_KEY` (bot) === `SERVICE_API_KEY` (backend).
- [ ] Confirm the production `GOOGLE_SHEETS_ID` and that the service account has
      edit access to that sheet.
- [ ] Secrets live only in Railway/Vercel dashboards — never in git or a laptop `.env`.
- [ ] `synchronize: true` is on in the backend fork — fine for greenfield, but be
      aware it can alter columns on entity changes; review before future schema edits.

## Post-deploy verification

1. **Backend up:** `POST ‹backend URL›/api/users/auth/nonce` with
   `{"walletAddress":"0x…"}` → `200`.
2. **Bot up:** Railway logs show `Google Sheets connected` + `Starting HR Agent
   Bot...` with no `409` (only one instance may poll a given `BOT_TOKEN`).
3. **Frontend up:** the Vercel `/member-sign-up` route loads and can connect a wallet.
4. **End-to-end:** run one real contributor loop (discovery → match → negotiate →
   submit → reviewer decision → accept → signup → agreement). Use a fresh wallet.
