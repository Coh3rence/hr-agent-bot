#!/usr/bin/env bash
# Clears backend (Collabberry fork) test data for ONE org so a fresh end-to-end
# run starts clean. Companion to reset-test-data.ts (which only wipes the Google
# Sheet) — run BOTH, or the sheet and the backend DB drift apart and leftover
# Collabberry users squat on the email/wallet/handle a new signup tries to use.
#
# Deletes, scoped to $ORG_ID: agreements, non-admin Users, and invitations.
# Preserves the admin user (matched by $ADMIN_WALLET) and the organization row.
# Nulls the circular Users.agreement_id FK before deleting agreements.
#
# Usage:
#   ORG_ID=<uuid> ADMIN_WALLET=0x... bun ... # (env or flags below)
#   scripts/reset-backend-test-data.sh --org <uuid> --admin-wallet 0x...
#
# Defaults target the local docker fork (container "mysql", db "collabberry").
set -euo pipefail

CONTAINER="${DB_CONTAINER:-mysql}"
DB="${DB_NAME:-collabberry}"
DB_USER="${DB_USER:-root}"
DB_PASS="${DB_PASS:-password}"
ORG_ID="${ORG_ID:-}"
ADMIN_WALLET="${ADMIN_WALLET:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --org) ORG_ID="$2"; shift 2;;
    --admin-wallet) ADMIN_WALLET="$2"; shift 2;;
    *) echo "Unknown arg: $1" >&2; exit 1;;
  esac
done

if [ -z "$ORG_ID" ] || [ -z "$ADMIN_WALLET" ]; then
  echo "Usage: reset-backend-test-data.sh --org <uuid> --admin-wallet 0x..." >&2
  echo "(or set ORG_ID and ADMIN_WALLET env vars)" >&2
  exit 1
fi

ADMIN_WALLET_LC="$(printf '%s' "$ADMIN_WALLET" | tr '[:upper:]' '[:lower:]')"

echo "Resetting backend test data for org $ORG_ID (preserving admin $ADMIN_WALLET_LC)"

docker exec -i "$CONTAINER" mysql -u"$DB_USER" -p"$DB_PASS" "$DB" <<SQL
-- Break the circular FK (Users.agreement_id -> agreements.id) before deletes.
UPDATE Users SET agreement_id = NULL WHERE organization_id = '$ORG_ID';
DELETE FROM agreements WHERE user_id IN (
  SELECT id FROM (SELECT id FROM Users WHERE organization_id = '$ORG_ID') AS u
);
DELETE FROM Users
  WHERE organization_id = '$ORG_ID'
    AND LOWER(address) <> '$ADMIN_WALLET_LC';
DELETE FROM invitations WHERE organization_id = '$ORG_ID';
SQL

echo "Done. Backend org $ORG_ID cleared (admin + org row kept)."
