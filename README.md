# open-wiki

A **modern, lean, FP-leaning** open-source wiki — a deliberate, *finishable* reaction to Wiki.js.
Bun + Elysia + Drizzle (SQLite/FTS5) server, Vue 3 front end, end-to-end type safety with **zero codegen**.

> **Status: v0** — a small, complete, runnable vertical slice: create/edit/delete Markdown pages,
> rendered to HTML and full-text indexed **atomically on save**, with search, auth, and a typed API.

## Quick start

Requires [Bun](https://bun.sh) ≥ 1.1.

```bash
bun install
bun run db:seed     # SQLite db + an admin + sample pages
bun run dev         # server :4000  +  web :5180
```

Open the URL Vite prints, sign in with **`admin@example.com` / `password`** (or register — the first
account becomes admin), search `banana`, open a page, and hit **Edit** for the live Markdown editor.

## What makes it different

- **Pure core, effects at the edges** — domain logic is pure functions in `@wiki/core` returning `Result<T, E>`; no global `WIKI` god-object.
- **Atomic save** — render + revision + FTS5 index happen in one transaction, so a saved page is instantly rendered *and* searchable.
- **Zero-codegen type safety** — the Drizzle schema flows through Elysia to the Vue client via Eden Treaty; the server's type *is* the API contract.
- **One search backend, done well** — SQLite FTS5 with BM25 and weighted columns; reader bundle ~43 KB gzip.

## Docs

After `bun run db:seed`, these docs are also published inside the wiki at `/docs`.
Run `bun run docs:publish` to refresh the wiki pages from the repository Markdown files.

| Where | What |
|---|---|
| **[docs/DESIGN.md](docs/DESIGN.md)** | Architecture, the Wiki.js comparison, FP choices, how save/search/types work, multi-instance mode, scripts |
| **[docs/HANDOFF.md](docs/HANDOFF.md)** | Implementation status, design decisions, gotchas solved, roadmap, extension recipes |
| Per-package guides | [`packages/core`](packages/core/README.md) · [`apps/server`](apps/server/README.md) · [`apps/web`](apps/web/README.md) |

Run any task with `bun run <name>` (`dev`, `db:seed`, `db:reset`, `test`, `typecheck`, …) — full list in [docs/DESIGN.md](docs/DESIGN.md#scripts).
