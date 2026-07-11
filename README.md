# kawaii-wiki.ts

A **modern, lean, FP-leaning** open-source wiki — a deliberate, *finishable* reaction to Wiki.js.
Bun + Elysia + Drizzle (SQLite/FTS5) server, Vue 3 front end, end-to-end type safety with **zero codegen**.

> **Status: v1.0.0** — a small, complete, runnable wiki: first-run `/setup`,
> Markdown pages with visual editing,
> FTS search, local/OIDC/TOTP/passkey auth with recovery codes,
> private-wiki mode, groups/page rules,
> R2 assets, libSQL/Turso support, webhooks plus event automation, persisted page
> templates, responsive mobile navigation, shared and personal navigation state,
> accessible dialog/focus/graph behavior, reduced-motion handling, skeleton
> loading states, runtime branding, configurable site locale/date defaults, and
> non-engineer editing workflows with visual-first defaults, slash insert,
> friendly errors, guide pages, path generation, crop/resize image upload,
> decorated public profiles, privacy-friendly YouTube/Twitch embeds,
> OG/oEmbed link cards, YouTube RSS latest-video widgets, VTuber templates,
> theme presets/backgrounds/fonts, page icons/covers, landing-page widgets, and
> page insights, daily notes, lazy admin panels, split performance chunks,
> an admin audit-log viewer, product-direction RFCs, and a typed API.

## Quick start

Requires [Bun](https://bun.sh) >= 1.3.14.

```bash
bun install
bun run dev         # server :4000  +  web :5180
```

Open the URL Vite prints. On an empty database, kawaii-wiki.ts sends you to `/setup`
to create the owner account, site title/theme, search tokenizer, and first
pages. `bun run db:seed` is still available for CI/dev demos; it creates
**`admin@example.com`** and prints the password. Search `banana`, open a page,
and hit **Edit** for the live Markdown editor.

Search supports prefix matching, quoted phrases such as `"error code 42"`,
exclusions such as `banana -draft`, title-only mode, filters, pagination,
recent searches, page comments, and referenced asset filenames.

Japanese/CJK search: the default SQLite FTS tokenizer is `unicode61`, which is
best for English/European prose but only matches Japanese token prefixes. Set
`KAWAII_WIKI_FTS_TOKENIZER=trigram` before first migration/seed for CJK substring
search. For an existing database, back it up and run
`KAWAII_WIKI_FTS_TOKENIZER=trigram bun run db:reindex-search`.

Admins can customize the wiki from **Admin → Appearance**: site title, accent
color, light/dark/system default, theme preset, font family, site background,
logo, favicon, header links, footer text, footer links, default page locale,
timezone, date format, custom CSS, and Markdown feature toggles. Emoji
shortcodes are on by default; KaTeX math and client-side Mermaid rendering are
opt-in. Initial branding/date defaults can be seeded with
`KAWAII_WIKI_SITE_TITLE`, `KAWAII_WIKI_ACCENT_COLOR`, `KAWAII_WIKI_THEME`,
`KAWAII_WIKI_DEFAULT_LOCALE`, `KAWAII_WIKI_TIMEZONE`, and `KAWAII_WIKI_DATE_FORMAT`.
Trusted custom head HTML/analytics snippets are disabled by default and require
`KAWAII_WIKI_ALLOW_HEAD_INJECTION=true`.

OIDC supports the backward-compatible single-provider `OIDC_*` variables, plus
multiple providers through numbered prefixes such as `OIDC_1_*` / `OIDC_2_*`
or a `KAWAII_WIKI_OIDC_PROVIDERS` JSON array. The auth route layer uses a generic
provider registry, so OIDC is the first implementation behind a SAML/LDAP-ready
service boundary. Webhook delivery retry attempts,
backoff, response-body capture, and error capture are configurable with
`KAWAII_WIKI_WEBHOOK_MAX_ATTEMPTS`, `KAWAII_WIKI_WEBHOOK_BACKOFF_MS`,
`KAWAII_WIKI_WEBHOOK_MAX_RESPONSE_BYTES`, and `KAWAII_WIKI_WEBHOOK_MAX_ERROR_BYTES`.
Automation rules can react to page create/update/delete/move and comment-create
events, match by path, label, status, author, locale, and space, and then update
page metadata, move pages under a path, or fire custom webhook event types.

Editors can manage reusable page templates from `/_templates`; admins see the
same manager on the Admin page. `_new` combines built-in starters with custom
templates, and the meeting-notes starter uses the browser timezone instead of a
hardcoded default. The command palette includes a daily-note shortcut that opens
or creates `dailyNotesPath/YYYY-MM-DD`; admins can configure the base path from
**Admin -> Appearance**.

Product direction notes live in `docs/KAWAII_WIKI_DESIGN_RFC.md`,
`docs/INLINE_COMMENTS_RFC.md`, and `docs/LIVE_PREVIEW_EDITOR_SPIKE.md`.

Navigation is configurable from **Admin → Appearance**: admins can choose the
home page path, reorder/hide built-in header items, and add icon or grouped
custom links that remain reachable from the mobile header menu. Below tablet
widths, the page tree opens from the header hamburger as a focus-managed drawer,
and page tables of contents collapse above the article instead of disappearing.
Markdown and collaborative editors switch to full-height Write/Preview panes on
small screens, and the app shell includes skip-to-content navigation plus visible
focus states for keyboard users. The graph can be traversed and zoomed from the
keyboard, key loading states use skeletons instead of bare text, and motion-heavy
UI honors `prefers-reduced-motion`.
Editors can pin pages and set shared sidebar order from page metadata, while
logged-in users get server-backed starred pages, collapsed folders, and personal
sidebar ordering.

## Docker

Build a production image with the Vue UI baked in:

```bash
docker build -t kawaii-wiki.ts .
docker run --rm -p 4000:4000 -v kawaii-wiki.ts-data:/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e KAWAII_WIKI_FTS_TOKENIZER=trigram \
  kawaii-wiki.ts
```

The container serves the built web app from `/ui`, stores SQLite data plus
uploads under `/data`, and opens `/setup` until the first admin exists.
It runs as the unprivileged `bun` user (uid 1000). Docker named volumes inherit
the prepared `/data` ownership; for a host bind mount, make the directory
writable by uid 1000 before starting the container.

## Cheap public deploy

The lowest-cost production path is either a small Docker-capable VPS with one
persistent volume, or Render Free backed by Turso/libSQL and R2. SQLite under
`/data` remains the simplest single-host option.

Tagged releases publish a Docker image to GHCR:

```bash
docker pull ghcr.io/hjosugi/kawaii-wiki.ts:1.0.0
docker volume create kawaii-wiki.ts-data
export JWT_SECRET="$(openssl rand -hex 32)"
docker run -d --name kawaii-wiki.ts --restart unless-stopped \
  -p 4000:4000 -v kawaii-wiki.ts-data:/data \
  -e NODE_ENV=production \
  -e JWT_SECRET="$JWT_SECRET" \
  ghcr.io/hjosugi/kawaii-wiki.ts:1.0.0
```

Put Caddy, nginx, or a free Cloudflare Tunnel in front of port `4000` for TLS
and a public domain.

## Backup

kawaii-wiki.ts stores the canonical wiki state in SQLite and uploaded files under
`DATA_DIR` (`./data` locally, `/data` in Docker). The runtime image intentionally
does not include the `sqlite3` CLI, so run the online backup command on the host
against a bind-mounted data directory (or from a temporary SQLite container),
then copy uploads in the same maintenance window:

```bash
mkdir -p backups
sqlite3 data/ts-wiki.sqlite ".backup 'backups/kawaii-wiki.ts-$(date +%F).sqlite'"
rsync -a data/assets/ backups/assets/
```

The database runs in WAL mode. Never copy only a live `.sqlite` file: committed
data may still be in `-wal`. Use `.backup`/`VACUUM INTO`, or stop the server and
copy the database plus sidecars together. For continuous backup, run Litestream
as a sidecar sharing `/data` with this minimal configuration:

```yaml
dbs:
  - path: /data/ts-wiki.sqlite
    replica:
      url: s3://your-backup-bucket/kawaii-wiki
```

If Git mirroring is enabled, the Git repo is a useful content mirror, but SQLite
remains the source of truth for users, permissions, assets, search, and revision
metadata.

## What makes it different

- **Pure core, effects at the edges** — domain logic is pure functions in `@kawaii-wiki/core` returning `Result<T, E>`; no global `WIKI` god-object.
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
| **[docs/API.md](docs/API.md)** | 1.x API stability policy and OpenAPI endpoints |
| **[docs/CONFIGURATION.md](docs/CONFIGURATION.md)** | Complete environment-variable reference |
| **[docs/UPGRADING.md](docs/UPGRADING.md)** | Backup-first upgrade and restore-based rollback |
| **[docs/ISSUE_RESOLUTION.md](docs/ISSUE_RESOLUTION.md)** | 2026-07-05 issue triage decisions: completed surfaces, explicit non-goals, content-type scope |
| Per-package guides | [`packages/core`](packages/core/README.md) · [`apps/server`](apps/server/README.md) · [`apps/web`](apps/web/README.md) |

Run any task with `bun run <name>` (`dev`, `db:seed`, `db:reset`, `test`, `typecheck`, …) — full list in [docs/DESIGN.md](docs/DESIGN.md#scripts).

Interactive API documentation is available at `/api/docs`, with the raw OpenAPI
document at `/api/openapi.json`.

## Security knobs

`KAWAII_WIKI_PRIVATE`, `KAWAII_WIKI_REGISTRATION`, `KAWAII_WIKI_JWT_TTL_SECONDS`, and
`ASSET_MAX_BYTES` seed safe site policy defaults. After first setup, admins can
change those from Admin -> Site policy without redeploying. Secrets and
infrastructure settings such as `JWT_SECRET`, database/storage credentials,
SMTP/OIDC secrets, ports, CORS, webhook SSRF policy, and Git remotes stay in
the server environment.

Branding defaults are configurable with `KAWAII_WIKI_SITE_TITLE`,
`KAWAII_WIKI_ACCENT_COLOR`, and `KAWAII_WIKI_THEME`. Custom head HTML is admin-trusted
and only exposed when `KAWAII_WIKI_ALLOW_HEAD_INJECTION=true`.

## License

0BSD. You can use, copy, modify, and distribute this project for almost any purpose.
