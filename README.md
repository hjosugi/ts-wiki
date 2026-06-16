# open-wiki

A **modern, lean, FP-leaning** open-source wiki. Bun + Elysia + Drizzle (SQLite/FTS5) on the
server, Vue 3 on the front end, end-to-end type safety with **zero codegen**.

It is inspired by [Wiki.js](https://js.wiki) — and is a deliberate reaction to it. Wiki.js v3
("vega") has been in development since 2021 with no beta as of 2025, while v2 sits in feature
freeze. open-wiki keeps the good ideas (rich Markdown rendering, weighted full-text search, an
embeddable "blocks" concept) and throws out the things that made v3 hard to finish: a global
mutable `WIKI` god-object, 1,000-line models, fire-and-forget rendering, non-transactional
writes, and a ~1 MB front-end bundle.

> Status: **v0 — a small, complete, runnable vertical slice.** Create/edit/delete pages in
> Markdown, rendered to HTML and full-text indexed atomically on save, with search, auth, and a
> clean typed API. Built to grow, not to impress a feature checklist.
>
> 👉 Continuing this project? Read **[docs/HANDOFF.md](docs/HANDOFF.md)** — implementation status,
> design decisions, gotchas already solved, a prioritised roadmap, and extension recipes.

---

## Why it's different from Wiki.js

| | Wiki.js v3 (vega) | open-wiki |
|---|---|---|
| Shared state | global mutable `WIKI` singleton, reached into everywhere | explicit dependency injection; pure core, effects at the edges |
| Domain logic | mixed into 1,000-line Objection models | pure functions in `@wiki/core`, returning `Result<T, E>` |
| Save → render | render is a fire-and-forget job; pages flash blank, index lags | render + revision + search index in **one transaction** |
| API | Apollo GraphQL (schema + resolvers + codegen) | Elysia typed routes = the contract; **Eden Treaty**, no codegen |
| Search | every backend (PG, Algolia, Elastic, …) | one backend done well: SQLite **FTS5**, BM25, weighted columns |
| Front-end | Quasar + TipTap + Monaco (~1 MB JS) | Vue 3 + UnoCSS + CodeMirror; reader bundle ~43 KB gzip |
| Auth | 20+ Passport strategies | local accounts + JWT, structured to extend |

## Architecture

A Bun workspace monorepo with one rule: **dependencies point inward**. The pure core knows
nothing about HTTP or the database; the web app and server both depend on the core, never on
each other (except the server's *type*, which the client imports for free).

```
open-wiki/
├── packages/
│   └── core/              @wiki/core — pure, isomorphic, no I/O
│       └── src/
│           ├── result.ts      Result<T, E> — exception-free errors
│           ├── errors.ts      AppError union → HTTP status mapping
│           ├── slug.ts        Unicode-safe path/heading slugs (keeps 日本語)
│           ├── permissions.ts can(principal, action) — one authz table
│           ├── markdown.ts    markdown-it pipeline → { html, toc }
│           └── page.ts        pure input validation
├── apps/
│   ├── server/            @wiki/server — Bun + Elysia
│   │   └── src/
│   │       ├── db/            Drizzle schema, FTS5 migration, seed/reset
│   │       ├── services/      pages · search · users · assets  (DI factories)
│   │       ├── http/          Elysia app (exports the `App` type) + error mapping
│   │       └── index.ts       env → db → app → listen
│   └── web/               @wiki/web — Vue 3 + Vite + UnoCSS + Pinia
│       └── src/
│           ├── lib/api.ts     Eden Treaty client (typed from the server's App)
│           ├── stores/        auth · pages (Pinia)
│           ├── components/    AppHeader · MarkdownEditor (CodeMirror) · PageToc
│           └── views/         PageView · PageEdit · SearchView · LoginView
└── reference/             Wiki.js v2 & v3 source (wiki-main, wiki-vega) — local study, gitignored
```

### Functional-programming choices

- **Pure core, effects at the edges.** `@wiki/core` is free of I/O and globals. Rendering,
  slugs, validation, and permissions are pure functions you can test in microseconds.
- **`Result<T, E>` over exceptions.** Services return typed results; the HTTP layer is the one
  place that turns an error into a status code (`unwrap` → `onError`).
- **Dependency injection, not singletons.** `createDb()` → `createServices(db)` → `createApp({ db, env })`.
  Tests spin up an in-memory database and inject it — no mocking globals.
- **The schema is the single source of truth.** Drizzle types flow through the services, out
  through Elysia, and into the Vue app via Eden Treaty, with no generated artifacts.

## Quick start

Requires [Bun](https://bun.sh) ≥ 1.1.

```bash
bun install
bun run db:seed     # creates ./apps/server/data/wiki.sqlite, an admin, and sample pages
bun run dev         # server :4000  +  web :5180
```

Open <http://localhost:5180> (Vite prints the exact URL). Sign in with the seeded admin **`admin@example.com` / `password`**
(or register — the first account to register becomes the admin). Try the search box (search for
`banana`), open a page, and hit **Edit** for the live Markdown editor.

### Scripts

| Command | What it does |
|---|---|
| `bun run dev` | Run server + web together (hot reload) |
| `bun run dev:server` / `dev:web` | Run one side |
| `bun run db:migrate` | Apply schema (also runs automatically on server boot) |
| `bun run db:seed` | Admin + sample pages (idempotent) |
| `bun run db:reset` | Delete the SQLite files |
| `bun run build` | Production build of the web app |
| `bun run test` | Core + server tests (`bun test`) |
| `bun run typecheck` | Typecheck all workspaces |

## Multi-instance mode

The server defaults to a DB-backed realtime event bus (`WIKI_EVENT_BUS=db`). Page-change events are
written to the shared SQLite database and every server process polls that log, so SSE subscribers on
one instance are notified when another instance creates, edits, moves, or deletes a page.

To run multiple API instances, point them at the same `DATABASE_PATH`, keep `JWT_SECRET` identical,
and give each process its own `PORT`:

```bash
DATABASE_PATH=./data/wiki.sqlite JWT_SECRET=dev PORT=4000 WIKI_INSTANCE_ID=wiki-1 bun run dev:server
DATABASE_PATH=./data/wiki.sqlite JWT_SECRET=dev PORT=4001 WIKI_INSTANCE_ID=wiki-2 bun run dev:server
```

For single-process tests or very small local runs, `WIKI_EVENT_BUS=memory` restores the old
in-process-only event bus.

## How it works

**Saving a page** (`createPage`/`updatePage`) is atomic. In one transaction the server: checks
the permission (`can`), validates & normalises the input, renders Markdown → HTML + a table of
contents, writes the page row, snapshots the previous version into `page_revisions`, and updates
the FTS5 index. When the call returns, the page is fully rendered **and** searchable — no race.

**Search** uses a SQLite FTS5 table with BM25 ranking and `snippet()` highlighting. Columns are
weighted title ≫ description ≫ body, mirroring the idea behind Wiki.js's PostgreSQL `tsvector`
setup — but with a single zero-dependency backend. User input is turned into a forgiving prefix
query so it feels good as-you-type.

> **CJK / Japanese search note.** The default FTS5 tokenizer is `unicode61`, which ranks prose
> (English/European) well but doesn't segment Japanese. For CJK-heavy content switch
> `FTS_TOKENIZER` in `apps/server/src/db/migrate.ts` to `trigram` (substring matching, ≥3 chars)
> and re-run `db:reset && db:seed`.

**Types** are shared without codegen. The server exports its `App` type; `apps/web/src/lib/api.ts`
does `treaty<App>(...)`, so every request's path, query, and body is checked against the real
routes at compile time.

## Intentionally simple (for now)

Kept out of v0 on purpose, easy to add later: page rename/move, per-page ACLs & groups,
multi-site, asset image management UI, OAuth/OIDC strategies, comments, page history UI, i18n,
SSR. The architecture has seams for all of them (e.g. `permissions.ts`, the storage-agnostic
service layer, the `assets` table).

## Reference code

`reference/wiki-main/` (Wiki.js v2) and `reference/wiki-vega/` (Wiki.js v3) are checked out locally
for study and are **gitignored** — they are not part of this project. Wiki.js is AGPL-3.0; this project does not
copy its code, only learns from its design.
