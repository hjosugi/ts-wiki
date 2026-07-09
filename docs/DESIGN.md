# ts-wiki — Design & Architecture

The big picture and the *why*. For setup and a one-minute overview see the
[README](../README.md); for implementation status and roadmap see [HANDOFF.md](HANDOFF.md).

## Why it's different from Wiki.js

ts-wiki is inspired by [Wiki.js](https://js.wiki) — and is a deliberate reaction to it. Wiki.js v3
("vega") has been in development since 2021 with no beta as of 2025, while v2 sits in feature
freeze. ts-wiki keeps the good ideas (rich Markdown rendering, weighted full-text search, an
embeddable "blocks" concept) and throws out the things that made v3 hard to finish: a global
mutable `WIKI` god-object, 1,000-line models, fire-and-forget rendering, non-transactional
writes, and a large rich-editor front-end bundle.

| | Wiki.js v3 (vega) | ts-wiki |
|---|---|---|
| Shared state | global mutable `WIKI` singleton, reached into everywhere | explicit dependency injection; pure core, effects at the edges |
| Domain logic | mixed into 1,000-line Objection models | pure functions in `@ts-wiki/core`, returning `Result<T, E>` |
| Save → render | render is a fire-and-forget job; pages flash blank, index lags | render + revision + search index in **one transaction** |
| API | Apollo GraphQL (schema + resolvers + codegen) | Elysia typed routes = the contract; **Eden Treaty**, no codegen |
| Search | every backend (PG, Algolia, Elastic, …) | one backend done well: SQLite **FTS5**, BM25, weighted columns |
| Front-end | Quasar + TipTap + Monaco (~1 MB JS) | Vue 3 + UnoCSS + CodeMirror; bundle size verified from Vite build output |
| Auth | 20+ Passport strategies | local/OIDC/TOTP/passkey auth, private mode, revocable JWT sessions |

## Architecture

A Bun workspace monorepo with one rule: **dependencies point inward**. The pure core knows
nothing about HTTP or the database; the web app and server both depend on the core, never on
each other (except the server's *type*, which the client imports for free).

```
ts-wiki/
├── packages/
│   └── core/              @ts-wiki/core — pure, isomorphic, no I/O
│       └── src/
│           ├── result.ts      Result<T, E> — exception-free errors
│           ├── errors.ts      AppError union → HTTP status mapping
│           ├── slug.ts        Unicode-safe path/heading slugs (keeps 日本語)
│           ├── permissions.ts can(principal, action) — one authz table
│           ├── markdown.ts    markdown-it pipeline → { html, toc }
│           ├── frontmatter.ts Markdown file frontmatter parse/serialize helpers
│           └── page.ts        pure input validation
├── apps/
│   ├── server/            @ts-wiki/server — Bun + Elysia
│   │   └── src/
│   │       ├── db/            Drizzle schema, FTS5 migration, seed/reset
│   │       ├── services/      pages · search · users · assets  (DI factories)
│   │       ├── http/          Elysia app (exports the `App` type) + error mapping
│   │       └── index.ts       env → db → app → listen
│   └── web/               @ts-wiki/web — Vue 3 + Vite + UnoCSS + Pinia
│       └── src/
│           ├── lib/api.ts     Eden Treaty client (typed from the server's App)
│           ├── lib/           branding · i18n · markdownEnhance · pageTemplates · realtime
│           ├── composables/   useSearch · useTheme · useMarkdownFeatures · usePresence · useForceGraph
│           ├── stores/        auth · pages (Pinia)
│           ├── components/    AppHeader/Footer · CommandPalette · PageHeader/Tree/Toc/Comments
│           │                  MarkdownEditor · VisualEditor · CollabEditor · ImageUploadDialog
│           │                  ModalDialog · DrawerSheet · InteractiveGraph · admin panels
│           └── views/         Admin · Page/View/Edit · Search · Graph · Events · Changes · Auth/Profile
└── reference/             Optional local Wiki.js v2/v3 source checkout for study, gitignored
```

### Functional-programming choices

- **Pure core, effects at the edges.** `@ts-wiki/core` is free of I/O and globals. Rendering,
  slugs, validation, and permissions are pure functions you can test in microseconds.
- **`Result<T, E>` over exceptions.** Services return typed results; the HTTP layer is the one
  place that turns an error into a status code (`unwrap` → `onError`).
- **Dependency injection, not singletons.** `createDb()` → `createServices(db)` → `createApp({ db, env })`.
  Tests spin up an in-memory database and inject it — no mocking globals.
- **The schema is the single source of truth.** Drizzle types flow through the services, out
  through Elysia, and into the Vue app via Eden Treaty, with no generated artifacts.

## How it works

**Saving a page** (`createPage`/`updatePage`) is atomic. In one transaction the server: checks
the permission (`can`), validates & normalises the input, renders Markdown → HTML + a table of
contents, writes the page row, snapshots the previous version into `page_revisions`, and updates
the FTS5 index. When the call returns, the page is fully rendered **and** searchable — no race.

**Search** uses a SQLite FTS5 table behind a `SearchIndexer` interface with BM25 ranking,
escaped `snippet()` highlighting, paging, total counts, and per-page ACL filtering. Columns are
weighted title ≫ description ≫ body ≫ comments/assets, mirroring the idea behind Wiki.js's
PostgreSQL `tsvector` setup — but with a single zero-dependency backend. User input is turned
into forgiving prefix queries; quoted phrases stay exact, `-term` excludes matches, title-only
scope is server-built, and exact/prefix title matches plus mild recency boosting shape ranking.
Comments and referenced asset filenames are indexed into the owning page result.

> **CJK / Japanese search note.** The default FTS5 tokenizer is `unicode61`, which ranks prose
> (English/European) well but doesn't segment Japanese. For CJK-heavy content set
> `TS_WIKI_FTS_TOKENIZER=trigram` before first migration. Existing databases need the
> FTS virtual table rebuilt: back up SQLite, then run
> `TS_WIKI_FTS_TOKENIZER=trigram bun run db:reindex-search`.
> Lightweight typo tolerance remains a future external-engine concern: SQLite FTS5 trigram helps
> CJK/substring matching, but portable spell-correction is deferred behind `SearchIndexer`.

**Theming and branding** are runtime settings, not rebuild-time constants. The
server exposes safe public settings for site title, accent color, theme, logo,
favicon, footer text/links, header links, and custom CSS. The web app maps the
appearance settings onto CSS variables (`--c-bg`, `--c-surface`, `--c-text`,
`--c-border`, `--c-accent`, `--radius`) so primary controls, rendered blocks,
and code blocks can update without recompiling. Custom head HTML is deliberately
separate from custom CSS and only leaves the server when
`TS_WIKI_ALLOW_HEAD_INJECTION=true`.

**Markdown rendering** is still pure and isomorphic, but now has an extension
seam. `createRenderer({ features, plugins, fences })` creates isolated
markdown-it instances for tests or embedding, while
`registerFenceRenderer(info, render)` adds a process-wide typed-fence renderer
to the default pipeline. Built-ins cover event, callout, infobox/profile,
links/social, embed, Mermaid-source, and content-tabs fences. Optional renderer
features add emoji shortcodes and KaTeX math. Mermaid is intentionally rendered
client-side only when the public `enableMermaid` setting is on; the server
stores escaped source as the fallback.

**Page templates** are split between deterministic built-ins in the web client
and persisted custom templates in SQLite. Editors manage custom templates via
`/api/templates` and `/_templates`; `_new` merges both sets into one picker.
Template metadata can prefill title, path, labels, status, locale, and review
date without adding another page model.

**Navigation settings** live in the public settings model. `homePath` controls
root page resolution and breadcrumb home links. `navItems` stores the visible
ordered built-in header items, while `navLinks` supports icon-bearing links and
one level of grouped children for desktop and mobile header menus.

**Types** are shared without codegen. The server exports its `App` type; `apps/web/src/lib/api.ts`
does `treaty<App>(...)`, so every request's path, query, and body is checked against the real
routes at compile time.

**Bundle size is measured from Vite output, not estimated.** As of v0.4.19,
Vite uses manual vendor chunks for Vue, Markdown rendering, CodeMirror, Yjs
collaboration, auth helpers, KaTeX, Mermaid, and highlight.js. A representative
`bun run build` reports: entry **36.56 KB gzip**, Vue **43.45 KB gzip**,
Markdown pipeline **68.72 KB gzip**, selected highlight languages **29.33 KB
gzip**, Yjs collaboration **29.57 KB gzip**, CodeMirror editor **855.62 KB
gzip**, and opt-in Mermaid **943.61 KB gzip**. Markdown highlighting uses
`highlight.js` core plus selected common languages, not the all-language entry.
The highlight.js CSS theme is loaded by Markdown enhancement only when rendered
code blocks are present. Future performance work should compare against the
checked build output instead of repeating older "`~43 KB gzip`" claims.

## Multi-instance mode

The server defaults to a DB-backed realtime event bus (`TS_WIKI_EVENT_BUS=db`). Page-change events are
written to the shared SQLite database and every server process polls that log, so SSE subscribers on
one instance are notified when another instance creates, edits, moves, or deletes a page.

To run multiple API instances, point them at the same `DATABASE_PATH`, keep `JWT_SECRET` identical,
and give each process its own `PORT`:

```bash
DATABASE_PATH=./data/ts-wiki.sqlite JWT_SECRET=dev PORT=4000 TS_WIKI_INSTANCE_ID=ts-wiki-1 bun run dev:server
DATABASE_PATH=./data/ts-wiki.sqlite JWT_SECRET=dev PORT=4001 TS_WIKI_INSTANCE_ID=ts-wiki-2 bun run dev:server
```

For single-process tests or very small local runs, `TS_WIKI_EVENT_BUS=memory` restores the old
in-process-only event bus.

## Realtime, Presence, And Collaboration

- `/api/events` is an authenticated Server-Sent Events stream. It carries
  `page:changed` events emitted by page writes, Git sync imports, and
  collaborative autosaves.
- `/api/presence` is a cosmetic WebSocket channel for "viewing/editing" state.
  Presence identities are display-only and are deduped server-side by user.
- `/api/collab/:room` speaks the Yjs websocket protocol. The server seeds each
  room from the current page content and version, requires an editor token, and
  persists through `pages.saveContent` with a stale-version check so old rooms
  cannot overwrite newer API or Git-sync writes.

## Admin, Git Sync, And Audit Logs

The first registered account or seeded admin is the initial admin. Admin-only
routes use the same pure permission checks as page mutations. Git sync is a
mirror/import adapter around the page service: DB writes commit Markdown files,
and external Git commits import through normal page create/update/delete paths.

Every HTTP request and write-side action emits structured JSON logs. Request logs
record method, path, status, duration, IP, and user id when available. Audit logs
record auth, page, admin, asset, Git sync, and collab autosave actions.

## Backup Strategy

SQLite is the canonical store. Back it up online with:

```bash
sqlite3 data/ts-wiki.sqlite ".backup 'backups/ts-wiki-$(date +%F).sqlite'"
rsync -a data/assets/ backups/assets/
```

Back up the uploaded assets directory with the database snapshot. Git mirroring
does not replace SQLite backups because roles, revision metadata, assets, and
search state are not fully represented by Markdown files.

## Scripts

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

## Intentionally simple (for now)

Kept out of v0 on purpose, easy to add later: multi-site, i18n, SSR, and
heavier editor/plugin marketplaces. The architecture has seams for them (e.g.
`permissions.ts`, the storage-agnostic service layer, `assets`, `SearchIndexer`,
and the Markdown renderer factory).

## Reference code

`reference/wiki-main/` (Wiki.js v2) and `reference/wiki-vega/` (Wiki.js v3) can be checked out
locally for study and are **gitignored** — they are not part of this project. Wiki.js is AGPL-3.0;
this project does not copy its code, only learns from its design.
