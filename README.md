# ts-wiki

A **modern, lean, FP-leaning** open-source wiki — a deliberate, *finishable* reaction to Wiki.js.
Bun + Elysia + Drizzle (SQLite/FTS5) server, Vue 3 front end, end-to-end type safety with **zero codegen**.

> **Status: v0.3** — a small, complete, runnable wiki: Markdown pages with visual editing,
> FTS search, local/OIDC/TOTP/passkey auth, groups/page rules, R2 assets, libSQL/Turso support,
> webhooks, and a typed API.

## Quick start

Requires [Bun](https://bun.sh) >= 1.3.

```bash
bun install
bun run db:seed     # SQLite db + an admin + sample pages; prints the admin password
bun run dev         # server :4000  +  web :5180
```

Open the URL Vite prints, sign in as **`admin@example.com`** with the password printed by
`db:seed` (or set `TS_WIKI_SEED_ADMIN_PASSWORD` before seeding). Without a seeded admin, the
first registered account becomes admin. Search `banana`, open a page, and hit **Edit** for
the live Markdown editor.

Japanese/CJK search: the default SQLite FTS tokenizer is `unicode61`, which is
best for English/European prose but only matches Japanese token prefixes. Set
`TS_WIKI_FTS_TOKENIZER=trigram` before first migration/seed for CJK substring
search. For an existing database, back it up and run
`TS_WIKI_FTS_TOKENIZER=trigram bun run db:reindex-search`.

## Docker

Build a production image with the Vue UI baked in:

```bash
docker build -t ts-wiki .
docker run --rm -v ts-wiki-data:/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e TS_WIKI_FTS_TOKENIZER=trigram \
  -e TS_WIKI_SEED_ADMIN_PASSWORD="change-me-before-first-seed" \
  ts-wiki bun --filter '@ts-wiki/server' db:seed
docker run --rm -p 4000:4000 -v ts-wiki-data:/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e TS_WIKI_FTS_TOKENIZER=trigram \
  ts-wiki
```

The container serves the built web app from `/ui` and stores SQLite data plus
uploads under `/data`.

## Cheap public deploy

The lowest-cost production path is either a small Docker-capable VPS with one
persistent volume, or Render Free backed by Turso/libSQL and R2. SQLite under
`/data` remains the simplest single-host option.

Tagged releases publish a Docker image to GHCR:

```bash
docker pull ghcr.io/hjosugi/ts-wiki:v0.3.1
docker volume create ts-wiki-data
export JWT_SECRET="$(openssl rand -hex 32)"
docker run --rm -v ts-wiki-data:/data \
  -e JWT_SECRET="$JWT_SECRET" \
  -e TS_WIKI_SEED_ADMIN_PASSWORD="change-me-before-first-seed" \
  ghcr.io/hjosugi/ts-wiki:v0.3.1 bun --filter '@ts-wiki/server' db:seed
docker run -d --name ts-wiki --restart unless-stopped \
  -p 4000:4000 -v ts-wiki-data:/data \
  -e NODE_ENV=production \
  -e JWT_SECRET="$JWT_SECRET" \
  ghcr.io/hjosugi/ts-wiki:v0.3.1
```

Put Caddy, nginx, or a free Cloudflare Tunnel in front of port `4000` for TLS
and a public domain.

## Backup

ts-wiki stores the canonical wiki state in SQLite and uploaded files under
`DATA_DIR` (`./data` locally, `/data` in Docker). Use SQLite's online backup
command and copy uploads in the same maintenance window:

```bash
mkdir -p backups
sqlite3 data/ts-wiki.sqlite ".backup 'backups/ts-wiki-$(date +%F).sqlite'"
rsync -a data/assets/ backups/assets/
```

If Git mirroring is enabled, the Git repo is a useful content mirror, but SQLite
remains the source of truth for users, permissions, assets, search, and revision
metadata.

## What makes it different

- **Pure core, effects at the edges** — domain logic is pure functions in `@ts-wiki/core` returning `Result<T, E>`; no global `WIKI` god-object.
- **Atomic save** — render + revision + FTS5 index happen in one transaction, so a saved page is instantly rendered *and* searchable.
- **Zero-codegen type safety** — the Drizzle schema flows through Elysia to the Vue client via Eden Treaty; the server's type *is* the API contract.
- **One search backend, done well** — SQLite FTS5 with BM25 and weighted columns; bundle size is tracked from the Vite build output.
- **Realtime without extra infrastructure** — DB-backed page-change events, presence, and Yjs collaboration run from the Bun/Elysia server.

## Docs

| Where | What |
|---|---|
| **[docs/DESIGN.md](docs/DESIGN.md)** | Architecture, the Wiki.js comparison, FP choices, how save/search/types work, multi-instance mode, scripts |
| **[docs/HANDOFF.md](docs/HANDOFF.md)** | Implementation status, design decisions, gotchas solved, roadmap, extension recipes |
| **[docs/DEPLOY_FREE.md](docs/DEPLOY_FREE.md)** | Render Free + Turso + R2 deployment guide |
| **[docs/ISSUE_RESOLUTION.md](docs/ISSUE_RESOLUTION.md)** | 2026-07-05 issue triage decisions: completed surfaces, explicit non-goals, content-type scope |
| Per-package guides | [`packages/core`](packages/core/README.md) · [`apps/server`](apps/server/README.md) · [`apps/web`](apps/web/README.md) |

Run any task with `bun run <name>` (`dev`, `db:seed`, `db:reset`, `test`, `typecheck`, …) — full list in [docs/DESIGN.md](docs/DESIGN.md#scripts).
