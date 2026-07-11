# kawaii-wiki.ts Server

Bun + Elysia API server for the kawaii-wiki.ts hands-on project.

## What This Teaches

- typed HTTP routes with Elysia
- dependency injection from environment -> database -> services -> app
- SQLite-backed persistence with Drizzle
- transaction boundaries for save -> render -> revision -> search index
- local auth, OIDC, TOTP, passkeys, permissions, and error mapping at the API edge
- server-sent events for page-change notifications

## Run

From the repository root:

```bash
bun install
bun run db:seed
bun run dev:server
```

The server listens on `http://localhost:4000` by default.

`db:seed` creates `admin@example.com` only when it does not already exist. Set
`KAWAII_WIKI_SEED_ADMIN_PASSWORD` before seeding to choose that admin password; otherwise
the seed command generates and prints a one-time random password.

## Production Configuration

Set `JWT_SECRET` to a strong unique value for every deployment. Production
refuses to start without it; local development generates an ephemeral random
secret when omitted, so sessions intentionally reset on restart.

JWTs expire by default after 30 days. `KAWAII_WIKI_JWT_TTL_SECONDS` seeds the
initial session lifetime, and admins can later change it from Admin -> Site
policy. Role changes and user deactivation are rechecked against the database
on every request, so old tokens do not keep stale admin access.

`KAWAII_WIKI_PRIVATE`, `KAWAII_WIKI_REGISTRATION`, `KAWAII_WIKI_REQUIRE_EMAIL_VERIFICATION`,
`KAWAII_WIKI_REQUIRE_2FA`, `KAWAII_WIKI_JWT_TTL_SECONDS`, and `ASSET_MAX_BYTES` are
bootstrap defaults for safe site policy. Admins can later change them from the
web UI. Secrets and infrastructure settings stay env-only: `JWT_SECRET`,
database/storage credentials, SMTP/OIDC secrets, ports, CORS, webhook SSRF
policy, and Git remotes.

Initial appearance settings can come from the environment:
`KAWAII_WIKI_SITE_TITLE`, `KAWAII_WIKI_ACCENT_COLOR` (`#rrggbb`), and
`KAWAII_WIKI_THEME` (`system`, `light`, or `dark`). Admins can later edit the same
values from the web UI. Custom head HTML/JavaScript is intentionally disabled
unless `KAWAII_WIKI_ALLOW_HEAD_INJECTION=true`; custom CSS does not require that
escape hatch.

Admin appearance settings also control Markdown features. Emoji shortcodes are
enabled by default; KaTeX math and Mermaid diagram rendering are opt-in. Page
writes render with the current settings, while Mermaid stays client-side and
falls back to escaped source when disabled.

Page templates live in the `page_templates` table and are exposed through the
editor-gated `/api/templates` CRUD API. Template metadata can prefill page
title, path, labels, status, locale, and review date when a new page is created.

Public settings also carry navigation configuration: `homePath`, ordered
`navItems` for built-in header links, and grouped/icon `navLinks` for custom
navigation.

For production seeding, set `KAWAII_WIKI_SEED_ADMIN_PASSWORD` or capture the generated
password from the `db:seed` output. The seed script never falls back to a shared
default admin password.

SQLite is the default database runtime:

```bash
DATABASE_DRIVER=sqlite DATABASE_PATH=/data/ts-wiki.sqlite
```

Search uses SQLite FTS5. The default tokenizer is `unicode61`, which is good
for English/European prose but only matches Japanese/CJK token prefixes. For
Japanese, Chinese, Korean, or mixed CJK deployments, set
`KAWAII_WIKI_FTS_TOKENIZER=trigram` before the first migration.

If an existing wiki already contains CJK content, the Admin page shows the
current tokenizer, CJK content ratio, and a guarded "Rebuild index as trigram"
action. Back up the database before rebuilding. The same rebuild is available
from the CLI:

```bash
KAWAII_WIKI_FTS_TOKENIZER=trigram bun --filter '@kawaii-wiki/server' db:reindex-search
```

libSQL/Turso is also supported. Local libSQL can use a `file:` URL; remote
Turso URLs run through a local embedded-replica file:

```bash
DATABASE_DRIVER=libsql
LIBSQL_URL=libsql://your-database.turso.io
LIBSQL_AUTH_TOKEN=your-turso-token
# Optional; defaults to DATA_DIR/kawaii-wiki.ts-libsql-replica.db for remote URLs.
LIBSQL_REPLICA_PATH=/data/kawaii-wiki.ts-libsql-replica.db
```

### Database repository boundary

Cross-database work is being migrated behind asynchronous repository contracts
under `src/repositories`. Concrete SQLite/libSQL queries live under
`src/db/repositories`; service modules consume only the driver-neutral
interfaces. Repository methods return promises even for embedded SQLite so a
remote or pooled database driver does not require another HTTP/service API
rewrite.

Users, external authentication accounts, password/email recovery tokens, OIDC
login states, passkey credentials/WebAuthn challenges, TOTP factors/recovery
codes, authorization groups/grants/page rules, user preferences, and page
templates currently use this boundary and run the same repository contract
suite against both SQLite and libSQL. User and authorization lookups are
asynchronous through authentication, profile, page/search access checks,
realtime, and Git mirror call chains. External account creation/linking,
recovery/OIDC/WebAuthn state consumption, TOTP enablement, default permission
initialization, and role membership synchronization keep their multi-table or
single-use mutations atomic. Passkey counter and TOTP recovery-code updates use
compare-and-set persistence to reject concurrent stale use. Remaining services
are being migrated incrementally under GitHub issue #363; until that work is
complete, PostgreSQL and MySQL are intentionally not exposed as selectable
production drivers.

Passkeys/WebAuthn need a stable HTTPS origin in production:

```bash
KAWAII_WIKI_PUBLIC_ORIGIN=https://wiki.example.com
PASSKEY_RP_ID=wiki.example.com
```

OIDC can be enabled with `OIDC_ENABLED=true` plus issuer/client/redirect
settings for a single provider. For multiple providers, use numbered prefixes
(`OIDC_1_*`, `OIDC_2_*`) or a `KAWAII_WIKI_OIDC_PROVIDERS` JSON array. See
`../../docs/CONFIGURATION.md` for the full list.

Site-level date defaults can be set from env with `KAWAII_WIKI_DEFAULT_LOCALE`,
`KAWAII_WIKI_TIMEZONE`, and `KAWAII_WIKI_DATE_FORMAT`, then adjusted later from
Admin -> Appearance. They seed new page locales and the server/client date
rendering used by event cards and chrome timestamps.

Webhook delivery retry and capture limits are configurable with
`KAWAII_WIKI_WEBHOOK_MAX_ATTEMPTS`, `KAWAII_WIKI_WEBHOOK_BACKOFF_MS`,
`KAWAII_WIKI_WEBHOOK_MAX_RESPONSE_BYTES`, and `KAWAII_WIKI_WEBHOOK_MAX_ERROR_BYTES`.
Automation rules are managed from the admin UI and can react to page
create/update/delete/move plus comment-created events. Rules match by path,
label, status, author, locale, or space, run by priority, can stop later rules,
and can update metadata, move pages under a path, or fire custom webhook events.

Uploaded assets use local disk by default. Set `ASSET_STORAGE=r2` with R2
account credentials to store files in Cloudflare R2 while keeping the same
`/assets/...` serving route. `ASSET_MAX_BYTES` seeds the upload limit (default
25 MiB), which admins can later change from Site policy; non-image assets are
served as downloads.

The server can serve the built Vue app directly. Build the web workspace and set
`WEB_DIST_DIR` when the default `apps/web/dist` path is not correct:

```bash
bun run build
WEB_DIST_DIR=/srv/kawaii-wiki.ts/web/dist bun --filter '@kawaii-wiki/server' start
```

The bundled Dockerfile does this for you:

```bash
docker build -t kawaii-wiki.ts .
docker run --rm -p 4000:4000 -v kawaii-wiki.ts-data:/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e KAWAII_WIKI_SEED_ADMIN_PASSWORD="change-me-before-first-seed" \
  kawaii-wiki.ts
```

Local/dev CORS is permissive by default. In production, configure cross-origin
browser clients with a comma-separated allow-list:

```bash
KAWAII_WIKI_CORS_ORIGINS=https://wiki.example.com,https://admin.example.com
```

## Backup And Restore

Back up SQLite with its online backup command, then copy uploaded assets:

```bash
mkdir -p backups
sqlite3 data/ts-wiki.sqlite ".backup 'backups/kawaii-wiki.ts-$(date +%F).sqlite'"
rsync -a data/assets/ backups/assets/
```

Run those commands on the host against a bind-mounted data directory: the slim
runtime image does not contain `sqlite3`. SQLite uses WAL mode, so never `cp`
only a live database file; `.backup` includes committed WAL data safely. For
continuous backup, a Litestream sidecar can share `/data` and replicate
`/data/ts-wiki.sqlite`; see the root README for a minimal config.

To restore, stop the server, replace `DATABASE_PATH` with the backup file, copy
the assets directory back under `DATA_DIR`, then start the server. Git mirroring
is not a full backup because users, roles, assets, revisions, and search state
live in SQLite.

See `../../docs/UPGRADING.md` before changing image versions. Startup migrations
are atomic and versioned; rollback restores the pre-upgrade backup with the
previous image rather than running an old image against a newer schema.

## Observability

The HTTP app emits one structured JSON request log per handled request and audit
events for mutating actions such as auth, page writes, admin role changes, asset
uploads, Git sync, and collaborative autosave. Logs are written to stdout/stderr
so Docker, systemd, or a hosted log pipeline can collect them without an agent.

## Useful Commands

```bash
bun --filter '@kawaii-wiki/server' db:migrate
bun --filter '@kawaii-wiki/server' db:reindex-search
bun --filter '@kawaii-wiki/server' db:seed
bun --filter '@kawaii-wiki/server' db:reset
bun --filter '@kawaii-wiki/server' typecheck
bun test apps/server
```

## Files To Read First

| File | Why it matters |
| --- | --- |
| `src/index.ts` | turns env and DB setup into a running server |
| `src/http/app.ts` | route composition and HTTP error mapping |
| `src/observability/logging.ts` | structured request/audit logging |
| `src/services/pages.ts` | transactional page writes and FTS updates |
| `src/services/oidc.ts` / `src/services/passkeys.ts` | external login and WebAuthn auth |
| `src/services/authz.ts` | groups, membership, and page rules |
| `src/services/webhooks.ts` | signed webhooks, delivery history, automation rules |
| `src/repositories/` | asynchronous, driver-neutral persistence contracts |
| `src/db/repositories/` | SQLite/libSQL implementations of repository contracts |
| `src/db/schema.ts` | SQLite tables and relationships |
| `src/db/migrate.ts` | local schema setup, including FTS5 |

## Exercises

1. Add a route that returns recent page revisions.
2. Add a permission rule in `@kawaii-wiki/core`, then enforce it in a service.
3. Switch the event bus between memory and database mode and observe SSE behavior.
4. Add a new server test before changing a service method.
