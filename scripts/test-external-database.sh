#!/usr/bin/env bash
set -euo pipefail

# Provisions a real external libSQL server and runs the driver contracts that
# must hold on a remote SQL database against it. Each contract file gets its own
# fresh primary so shared per-database state (FTS index, event log) from one
# file can never leak into another.

image="${LIBSQL_TEST_IMAGE:-ghcr.io/tursodatabase/libsql-server:3ec6803}"
base_port="${LIBSQL_TEST_PORT:-18080}"
containers=()

cleanup() {
  for container in "${containers[@]:-}"; do
    [ -n "$container" ] && docker rm -f "$container" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

run_contract() {
  local test_file="$1"
  local port="$2"
  local container="kawaii-wiki-libsql-contract-$$-${port}"
  containers+=("$container")

  docker run --detach --name "$container" \
    --publish "127.0.0.1:${port}:8080" \
    --env SQLD_NODE=primary \
    "$image" >/dev/null

  for attempt in $(seq 1 60); do
    if (echo >/dev/tcp/127.0.0.1/"$port") >/dev/null 2>&1; then
      break
    fi
    if [ "$attempt" = 60 ]; then
      docker logs "$container"
      exit 1
    fi
    sleep 1
  done

  echo "== external libSQL contract: ${test_file} =="
  KAWAII_WIKI_TEST_LIBSQL_URL="http://127.0.0.1:${port}" bun test "$test_file"

  docker rm -f "$container" >/dev/null 2>&1 || true
}

# The core page repository contract plus the cross-driver service contract
# (authorization, page, auth, automation, import/export, and realtime).
run_contract apps/server/src/db/repositories/pages.test.ts "$base_port"
run_contract apps/server/src/db/cross-driver-contract.test.ts "$((base_port + 1))"
