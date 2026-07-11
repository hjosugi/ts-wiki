#!/bin/sh
set -eu

if [ -z "${JWT_SECRET:-}" ]; then
  secret_file="${KAWAII_WIKI_JWT_SECRET_FILE:-/data/.jwt-secret}"
  umask 077

  if [ -s "$secret_file" ]; then
    JWT_SECRET="$(cat "$secret_file")"
  else
    JWT_SECRET="$(bun -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
    printf '%s\n' "$JWT_SECRET" > "$secret_file"
  fi

  export JWT_SECRET
fi

exec "$@"
