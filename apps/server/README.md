# open-wiki Server

Bun + Elysia API server for the open-wiki hands-on project.

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

## Useful Commands

```bash
bun --filter '@wiki/server' db:migrate
bun --filter '@wiki/server' db:seed
bun --filter '@wiki/server' db:reset
bun --filter '@wiki/server' typecheck
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
2. Add a permission rule in `@wiki/core`, then enforce it in a service.
3. Switch the event bus between memory and database mode and observe SSE behavior.
4. Add a new server test before changing a service method.
