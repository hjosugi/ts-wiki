# ts-wiki Server

Bun + Elysia API server for the ts-wiki hands-on project.

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
`TS_WIKI_SEED_ADMIN_PASSWORD` before seeding to choose that admin password; otherwise
the seed command generates and prints a one-time random password.

## Production Configuration

Set `JWT_SECRET` to a strong unique value before running with `NODE_ENV=production`
or `BUN_ENV=production`; the server refuses to start with the development
default in production mode.

JWTs expire by default after 30 days. Set `TS_WIKI_JWT_TTL_SECONDS` to shorten
or lengthen that window. Role changes and user deactivation are rechecked
against the database on every request, so old tokens do not keep stale admin
access.

Set `TS_WIKI_PRIVATE=true` to require login for page/search/realtime read
routes. Set `TS_WIKI_REGISTRATION=off` to disable self-registration after the
first-admin bootstrap.

For production seeding, set `TS_WIKI_SEED_ADMIN_PASSWORD` or capture the generated
password from the `db:seed` output. The seed script never falls back to a shared
default admin password.

SQLite is the default database runtime:

```bash
DATABASE_DRIVER=sqlite DATABASE_PATH=/data/ts-wiki.sqlite
```

Search uses SQLite FTS5. The default tokenizer is `unicode61`, which is good
for English/European prose but only matches Japanese/CJK token prefixes. For
CJK-heavy deployments, set `TS_WIKI_FTS_TOKENIZER=trigram` before the first
migration. For an existing database, back it up and rebuild the virtual search
table:

```bash
TS_WIKI_FTS_TOKENIZER=trigram bun --filter '@ts-wiki/server' db:reindex-search
```

libSQL/Turso is also supported. Local libSQL can use a `file:` URL; remote
Turso URLs run through a local embedded-replica file:

```bash
DATABASE_DRIVER=libsql
LIBSQL_URL=libsql://your-database.turso.io
LIBSQL_AUTH_TOKEN=your-turso-token
# Optional; defaults to DATA_DIR/ts-wiki-libsql-replica.db for remote URLs.
LIBSQL_REPLICA_PATH=/data/ts-wiki-libsql-replica.db
```

Passkeys/WebAuthn need a stable HTTPS origin in production:

```bash
TS_WIKI_PUBLIC_ORIGIN=https://wiki.example.com
PASSKEY_RP_ID=wiki.example.com
```

OIDC can be enabled with `OIDC_ENABLED=true` plus issuer/client/redirect
settings. See `.env.example` for the full list.

Uploaded assets use local disk by default. Set `ASSET_STORAGE=r2` with R2
account credentials to store files in Cloudflare R2 while keeping the same
`/assets/...` serving route. `ASSET_MAX_BYTES` controls the upload limit
(default 25 MiB); non-image assets are served as downloads.

The server can serve the built Vue app directly. Build the web workspace and set
`WEB_DIST_DIR` when the default `apps/web/dist` path is not correct:

```bash
bun run build
WEB_DIST_DIR=/srv/ts-wiki/web/dist bun --filter '@ts-wiki/server' start
```

The bundled Dockerfile does this for you:

```bash
docker build -t ts-wiki .
docker run --rm -p 4000:4000 -v ts-wiki-data:/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e TS_WIKI_SEED_ADMIN_PASSWORD="change-me-before-first-seed" \
  ts-wiki
```

Local/dev CORS is permissive by default. In production, configure cross-origin
browser clients with a comma-separated allow-list:

```bash
TS_WIKI_CORS_ORIGINS=https://wiki.example.com,https://admin.example.com
```

## Backup And Restore

Back up SQLite with its online backup command, then copy uploaded assets:

```bash
mkdir -p backups
sqlite3 data/ts-wiki.sqlite ".backup 'backups/ts-wiki-$(date +%F).sqlite'"
rsync -a data/assets/ backups/assets/
```

To restore, stop the server, replace `DATABASE_PATH` with the backup file, copy
the assets directory back under `DATA_DIR`, then start the server. Git mirroring
is not a full backup because users, roles, assets, revisions, and search state
live in SQLite.

## Observability

The HTTP app emits one structured JSON request log per handled request and audit
events for mutating actions such as auth, page writes, admin role changes, asset
uploads, Git sync, and collaborative autosave. Logs are written to stdout/stderr
so Docker, systemd, or a hosted log pipeline can collect them without an agent.

## Useful Commands

```bash
bun --filter '@ts-wiki/server' db:migrate
bun --filter '@ts-wiki/server' db:reindex-search
bun --filter '@ts-wiki/server' db:seed
bun --filter '@ts-wiki/server' db:reset
bun --filter '@ts-wiki/server' typecheck
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
| `src/db/schema.ts` | SQLite tables and relationships |
| `src/db/migrate.ts` | local schema setup, including FTS5 |

## Exercises

1. Add a route that returns recent page revisions.
2. Add a permission rule in `@ts-wiki/core`, then enforce it in a service.
3. Switch the event bus between memory and database mode and observe SSE behavior.
4. Add a new server test before changing a service method.
