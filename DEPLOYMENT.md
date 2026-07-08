# On-Chain Frontend Visibility — Deployment Runbook

Reference for standing up a **real, on-chain Collabberry org** so agreements (including
bot-created ones) render in the Collabberry frontend. This is **Tier B** — beyond the
signed SOW scope (the contracted M3 bridge = "agreement created in Beta App, ready for
admin signature", already done + verified). Kept here so we don't re-derive it.

Last verified: 2026-07-07 (Arbitrum Sepolia).

## Why the current test org (TestOrg) cannot be used as-is

1. **No contract deployed** — `teamPointsContractAddress` is the zero address (DB-seeded,
   never deployed). The frontend `checkAdminContributors` calls `isAdmin()` on `0x0` →
   reverts → member/agreement list renders empty.
2. **We don't hold its admin key** — TestOrg's admin wallet is the placeholder
   `0x1111…1111`; no private key exists, so you can't sign in as that org's admin.
3. **No "attach contract to existing org" screen** — the UI only sets
   `teamPointsContractAddress` *during org creation* (`SignUp.tsx` `createOrganization`).
   Retrofitting TestOrg = manual DB surgery AND still blocked by #2.

=> The clean route is a **fresh org**, not a patch of the old one.

## Verified prerequisites (all green on the machine side)

| Item | Value / status |
|---|---|
| TeamPoints Factory (Arb Sepolia) | `0x69a99AeAc1F2410e82A84E08268b336116Ab3B5a` — live on-chain (real bytecode) |
| Chain | Arbitrum Sepolia, chainId **421614** (`0x66eee`) |
| Frontend config (running dev server) | `VITE_APP_NETWORK="Arbitrum Sepolia"`, `VITE_APP_TEAM_POINTS_FACTORY_ADDRESS` set, `VITE_APP_BASE_URL=http://localhost:3000` |
| Org-creation flow | `collabberry-frontend/src/views/auth/SignUp/SignUp.tsx` — 3 steps: Profile → Organization (deploys contract) → Agreement |
| Deploy wiring | `deployTeamPoints(name, chain.id)` → `apiCreateOrganization({ teamPointsContractAddress, chainId })` |
| Backend accepts payload | `createOrg.model.ts` requires `teamPointsContractAddress`, allows `chainId ∈ {42161, 421614, 42220}` |
| Backend RPC for reads | `ARBITRUM_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc` (fixed 2026-07; the old zan.top endpoint rate-limited and caused 60s Team-page timeouts) |

**No code/config blocker remains.** The only gaps are wallet + gas — user actions.

## Mainnet variant (Arbitrum One 42161) — CHOSEN PATH (2026)

Decided to deploy on **Arbitrum One mainnet** instead of Sepolia: the Arb Sepolia faucet
gate-keeps on holding 0.1 ETH on L1 mainnet, so funding ~$5 of real ETH on Arbitrum and
deploying for a few cents of gas is cheaper and simpler.

**Verified:** mainnet factory `0x86207Ce1202766041F414C47134A8b0A1607d899` is live on
Arbitrum One (real bytecode). It's Collabberry's own prod factory
(`collabberry-frontend/docker-compose.ci-demo-01.yml`, `VITE_APP_NETWORK=Arbitrum`).

**Critical gotcha:** the frontend hard-gates the allowed wallet chains on the env flag —
`chains: env === Production ? [arbitrum, celo] : [arbitrumSepolia, celo]`
(`App.tsx:30`, `ChainService.ts:12`). So mainnet ONLY works if the frontend runs with
`VITE_NODE_ENV=production`; otherwise the wallet is rejected as "Unsupported chain: 42161".

**Frontend restart env (point at LOCAL backend, mainnet factory):**
- `VITE_NODE_ENV=production`  ← flips chain list to [arbitrum, celo]
- `VITE_APP_TEAM_POINTS_FACTORY_ADDRESS=0x86207Ce1202766041F414C47134A8b0A1607d899`
- `VITE_APP_BLOCK_EXPLORER=https://arbiscan.io/tx`
- `VITE_APP_BASE_URL=http://localhost:3000` (unchanged — your local backend)
- `VITE_APP_TEAM_POINTS_FACTORY_ADDRESS_CELO=0x0e414560fdEeC039c4636b9392176ddc938b182D` (unchanged, unused)

Backend needs NO change: already defaults chainId 42161 + `ARBITRUM_RPC_URL=arb1.arbitrum.io/rpc`;
`createOrg.model.ts` accepts 42161.

**Funding:** buy ~$5 ETH on a CEX and **withdraw directly to the Arbitrum One network** to the
admin wallet — do NOT bridge from L1 (bridge gas dwarfs $5). Deploy costs a few cents; SIWE
signatures are free (off-chain).

## Path A — Quick win (~15 min): prove the frontend renders a real agreement

1. **(User)** Use a wallet you control; switch it to **Arbitrum Sepolia**; fund it from a
   faucet (free testnet ETH).
2. **(User, browser)** Frontend `:5173` → **SignUp** →
   - **Create Profile** (name, email; Telegram handle optional)
   - **Create Organization** — signs the deploy tx in the wallet; factory mints the org's
     TeamPoints contract; **your wallet becomes the org admin**
   - **Add Agreement** (your own) — optional but gives something to look at
3. View Dashboard/Team as admin → the agreement renders. Proves the full stack works on
   your deployment.

## Path B — Full loop: see a BOT-created agreement render

4. **(Me)** Repoint the bot at the new org: set `BETA_APP_ORG_ID` to the new org id, and
   confirm `SERVICE_ADMIN_WALLET` matches an admin of that org (the wallet from step 1).
5. **(User)** Run the bot flow (`bun run dev:stage`); contributor redeems the invite and
   signs up **into the new org** with their own wallet (also needs a little Arb Sepolia
   ETH to sign SIWE).
6. **(User)** As admin, open Team → the bot's contributor + their agreement render.

## Hard boundary (only the user can do these)

- Deploy the contract (needs a funded wallet signing in the browser).
- Fund a wallet (faucet).
- Drive MetaMask / click the SignUp flow.

Everything else (bot repointing, backend/DB checks, config) is on the software side.

## Faucets / references

- Arbitrum Sepolia faucet: get testnet ETH (e.g. an Arbitrum Sepolia faucet or bridge a
  Sepolia ETH balance). Confirm balance before step 2.
- Block explorer: https://sepolia.arbiscan.io
