# Collabberry backend patches (D-018 token join key)

The bot's Beta App bridge depends on backend changes that are **not yet pushed to a
remote** (we work from a local clone of `collabberry/backend` with no fork / write
access). To avoid losing them, the commits are preserved here as a git bundle.

## Where the code lives (local clones)

- **Backend**  `../collabberry-backend`  — clone of `collabberry/backend` (upstream, read-only)
- **Frontend** `../collabberry-frontend` — clone of `collabberry/frontend` (upstream, read-only)
- **Bot**      this repo (`hr-agent-bot`) — remote `Coh3rence/hr-agent-bot` (pushable)

All three sit side-by-side under `~/Desktop/development/`.

## What's in the bundle

`d018-token-join-key.bundle` contains 3 commits on top of upstream `cee2d97`
(merge of PR #97):

| commit    | summary |
|-----------|---------|
| `68e19c2` | fix(agreement): load agreement relation so duplicate create returns 400 |
| `ca8d53a` | feat: service-key auth for unattended bot + telegramHandle on roster |
| `6454176` | feat: persist redeemed invite token for the bot's token join key (D-018) |

## Restore into a backend clone

```sh
cd ../collabberry-backend
git bundle verify /path/to/hr-agent-bot/patches/collabberry-backend/d018-token-join-key.bundle
git pull /path/to/hr-agent-bot/patches/collabberry-backend/d018-token-join-key.bundle HEAD
# then rebuild so synchronize:true applies the invitationToken column:
docker compose up -d --build
```

The base ref `cee2d97` must already exist in the target clone (it's upstream
`collabberry/backend` main). Rebuild the container to auto-apply the new nullable
`invitationToken` column (TypeORM `synchronize: true`).

> Regenerate after new backend commits: `git -C ../collabberry-backend bundle create
> patches/collabberry-backend/d018-token-join-key.bundle cee2d97..HEAD`
