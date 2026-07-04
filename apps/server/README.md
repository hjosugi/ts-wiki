# ts-wiki Server

Bun + Elysia API server for the ts-wiki hands-on project.

## What This Teaches

- typed HTTP routes with Elysia
- dependency injection from environment -> database -> services -> app
- SQLite-backed persistence with Drizzle
- transaction boundaries for save -> render -> revision -> search index
- auth, permissions, and error mapping at the API edge
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

For production seeding, set `TS_WIKI_SEED_ADMIN_PASSWORD` or capture the generated
password from the `db:seed` output. The seed script never falls back to a shared
default admin password.

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

## Useful Commands

```bash
bun --filter '@ts-wiki/server' db:migrate
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
| `src/services/pages.ts` | transactional page writes and FTS updates |
| `src/db/schema.ts` | SQLite tables and relationships |
| `src/db/migrate.ts` | local schema setup, including FTS5 |

## Exercises

1. Add a route that returns recent page revisions.
2. Add a permission rule in `@ts-wiki/core`, then enforce it in a service.
3. Switch the event bus between memory and database mode and observe SSE behavior.
4. Add a new server test before changing a service method.
