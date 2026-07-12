#!/usr/bin/env bash
set -euo pipefail

image="${LIBSQL_TEST_IMAGE:-ghcr.io/tursodatabase/libsql-server:3ec6803}"
port="${LIBSQL_TEST_PORT:-18080}"
container="kawaii-wiki-libsql-contract-$$"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT

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

KAWAII_WIKI_TEST_LIBSQL_URL="http://127.0.0.1:${port}" \
  bun test apps/server/src/db/repositories/pages.test.ts
