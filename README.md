# ts-wiki

A **modern, lean, FP-leaning** open-source wiki — a deliberate, *finishable* reaction to Wiki.js.
Bun + Elysia + Drizzle (SQLite/FTS5) server, Vue 3 front end, end-to-end type safety with **zero codegen**.

> **Status: v0.4.7** — a small, complete, runnable wiki: Markdown pages with visual editing,
> FTS search, local/OIDC/TOTP/passkey auth, private-wiki mode, groups/page rules,
> R2 assets, libSQL/Turso support, webhooks, persisted page templates, shared
> and personal navigation state, runtime branding, configurable site locale/date
> defaults, and a typed API.

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

Search supports prefix matching, quoted phrases such as `"error code 42"`,
exclusions such as `banana -draft`, title-only mode, filters, pagination,
recent searches, page comments, and referenced asset filenames.

Japanese/CJK search: the default SQLite FTS tokenizer is `unicode61`, which is
best for English/European prose but only matches Japanese token prefixes. Set
`TS_WIKI_FTS_TOKENIZER=trigram` before first migration/seed for CJK substring
search. For an existing database, back it up and run
`TS_WIKI_FTS_TOKENIZER=trigram bun run db:reindex-search`.

Admins can customize the wiki from **Admin → Appearance**: site title, accent
color, light/dark/system default, logo, favicon, header links, footer text,
footer links, default page locale, timezone, date format, custom CSS, and
Markdown feature toggles. Emoji shortcodes are on by default; KaTeX math and
client-side Mermaid rendering are opt-in. Initial branding/date defaults can be
seeded with `TS_WIKI_SITE_TITLE`, `TS_WIKI_ACCENT_COLOR`, `TS_WIKI_THEME`,
`TS_WIKI_DEFAULT_LOCALE`, `TS_WIKI_TIMEZONE`, and `TS_WIKI_DATE_FORMAT`.
Trusted custom head HTML/analytics snippets are disabled by default and require
`TS_WIKI_ALLOW_HEAD_INJECTION=true`.

OIDC supports the backward-compatible single-provider `OIDC_*` variables, plus
multiple providers through numbered prefixes such as `OIDC_1_*` / `OIDC_2_*`
or a `TS_WIKI_OIDC_PROVIDERS` JSON array. Webhook delivery retry attempts,
backoff, response-body capture, and error capture are configurable with
`TS_WIKI_WEBHOOK_MAX_ATTEMPTS`, `TS_WIKI_WEBHOOK_BACKOFF_MS`,
`TS_WIKI_WEBHOOK_MAX_RESPONSE_BYTES`, and `TS_WIKI_WEBHOOK_MAX_ERROR_BYTES`.

Editors can manage reusable page templates from `/_templates`; admins see the
same manager on the Admin page. `_new` combines built-in starters with custom
templates, and the meeting-notes starter uses the browser timezone instead of a
hardcoded default.

Navigation is configurable from **Admin → Appearance**: admins can choose the
home page path, reorder/hide built-in header items, and add icon or grouped
custom links that remain reachable from the mobile header menu. Editors can pin
pages and set shared sidebar order from page metadata, while logged-in users get
server-backed starred pages, collapsed folders, and personal sidebar ordering.

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
docker pull ghcr.io/hjosugi/ts-wiki:v0.4.7
docker volume create ts-wiki-data
export JWT_SECRET="$(openssl rand -hex 32)"
docker run --rm -v ts-wiki-data:/data \
  -e JWT_SECRET="$JWT_SECRET" \
  -e TS_WIKI_SEED_ADMIN_PASSWORD="change-me-before-first-seed" \
  ghcr.io/hjosugi/ts-wiki:v0.4.7 bun --filter '@ts-wiki/server' db:seed
docker run -d --name ts-wiki --restart unless-stopped \
  -p 4000:4000 -v ts-wiki-data:/data \
  -e NODE_ENV=production \
  -e JWT_SECRET="$JWT_SECRET" \
  ghcr.io/hjosugi/ts-wiki:v0.4.7
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

## Security knobs

Set `TS_WIKI_PRIVATE=true` to require login for page/search/realtime read routes.
Set `TS_WIKI_REGISTRATION=off` to disable self-registration after the first
admin bootstrap. JWT lifetime is configurable with `TS_WIKI_JWT_TTL_SECONDS`,
and uploads are capped by `ASSET_MAX_BYTES` (default 25 MiB).

Branding defaults are configurable with `TS_WIKI_SITE_TITLE`,
`TS_WIKI_ACCENT_COLOR`, and `TS_WIKI_THEME`. Custom head HTML is admin-trusted
and only exposed when `TS_WIKI_ALLOW_HEAD_INJECTION=true`.

## License

0BSD. You can use, copy, modify, and distribute this project for almost any purpose.
