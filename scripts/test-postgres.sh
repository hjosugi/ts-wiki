#!/usr/bin/env bash
set -euo pipefail

# Provisions a real PostgreSQL server via docker compose and runs the driver
# contracts that must hold on Postgres against it. Mirrors
# scripts/test-external-database.sh (libSQL). CI provisions Postgres as a
# service container instead and sets the same env var.

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
compose_file="${repo_root}/docker-compose.test.yml"

cleanup() {
  docker compose -f "$compose_file" down -v >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "== starting postgres =="
docker compose -f "$compose_file" up -d --wait postgres

export KAWAII_WIKI_TEST_POSTGRES_URL="postgres://wiki:wiki@127.0.0.1:15432/wiki"

echo "== postgres contract: db/postgres =="
bun test apps/server/src/db/postgres
