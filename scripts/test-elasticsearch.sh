#!/usr/bin/env bash
set -euo pipefail

# Provisions a real Elasticsearch server via docker compose and runs the search
# contracts that must hold against it. Mirrors scripts/test-postgres.sh. CI
# provisions Elasticsearch as a service container instead and sets the same env.

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
compose_file="${repo_root}/docker-compose.test.yml"

cleanup() {
  docker compose -f "$compose_file" down -v >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "== starting elasticsearch =="
docker compose -f "$compose_file" up -d --wait elasticsearch

export KAWAII_WIKI_TEST_ELASTICSEARCH_URL="http://127.0.0.1:19200"

echo "== elasticsearch contract: search/elasticsearch =="
bun test apps/server/src/search/elasticsearch
