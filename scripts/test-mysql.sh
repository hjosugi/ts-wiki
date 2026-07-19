#!/usr/bin/env bash
set -euo pipefail

# Provisions a real MySQL server via docker compose and runs the driver
# contracts that must hold on MySQL against it. Mirrors scripts/test-postgres.sh.
# CI provisions MySQL as a service container instead and sets the same env var.

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
compose_file="${repo_root}/docker-compose.test.yml"

cleanup() {
  docker compose -f "$compose_file" down -v >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "== starting mysql =="
docker compose -f "$compose_file" up -d --wait mysql

export KAWAII_WIKI_TEST_MYSQL_URL="mysql://wiki:wiki@127.0.0.1:13306/wiki"

echo "== mysql contract: db/mysql =="
bun test apps/server/src/db/mysql
