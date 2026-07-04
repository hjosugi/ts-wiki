# ts-wiki — Handoff / 引き継ぎ資料

A practical guide for whoever picks this up next (human or AI). The user-facing overview is in
[../README.md](../README.md); this document is the **developer handoff**: current status, why
things are the way they are, what bit us, and exactly where to plug in the next features.

- **As of:** 2026-07-05
- **State:** v0.3 — a small but *complete and verified* vertical slice. Everything below marked ✅
  has been run and confirmed (tests + live HTTP + typed client + build + typecheck).
- **Stack:** Bun 1.3 · Elysia · Drizzle ORM · SQLite/libSQL + FTS5 · Vue 3 · Vite ·
  UnoCSS · Pinia · CodeMirror 6 · Eden Treaty · SimpleWebAuthn (no codegen).

---

## 1. Status at a glance

| Area | Status | Notes |
|---|---|---|
| Monorepo + Bun workspaces | ✅ | `packages/*`, `apps/*`; root scripts orchestrate via `bun --filter` |
| `@ts-wiki/core` (pure domain) | ✅ | Result, errors, slug, permissions, markdown+TOC/link extraction, validation |
| DB schema + FTS5 migration | ✅ | SQLite default plus libSQL/Turso embedded-replica support |
| Pages service (CRUD) | ✅ | transactional: render + revision + FTS index together |
| Search service (FTS5/BM25) | ✅ | weighted columns, snippets, prefix queries |
| Users + auth | ✅ | local password, expiring/revocable JWT, OIDC, TOTP, passkeys, private mode; first account → admin |
| Groups + page rules | ✅ | role default groups, memberships, path ACL rules, deny precedence |
| Assets upload | ✅ | local or R2 bytes, DB metadata, upload/picker UI |
| Elysia HTTP app + Eden type | ✅ | exports `App`; error mapping centralised |
| Vue app: view/edit/search/graph/login | ✅ | breadcrumbs, page header actions, tree sidebar, graph view, empty states |
| Markdown editor (CodeMirror + visual mode) | ✅ | Markdown remains canonical; visual mode round-trips common blocks |
| Webhooks + automation | ✅ | signed deliveries, retry history, page metadata automation rules |
| Tests / typecheck / build | ✅ | core/server Bun tests + web Vitest tests; all 3 packages typecheck; web builds |
| Auth route guards in router | ✅ | global router guard gates editor/admin routes |

### Verified during release batches (evidence)
- `bun run test` runs core/server Bun tests and web Vitest component/composable tests.
- Live API smoke has covered register/login, permission failures, path normalization,
  render-on-save, search, reindex-on-update, move, delete, SSE, WebSocket auth, and assets.
- Eden Treaty client keeps every request shape (`get`/`post`/`put`/`delete` + query/body)
  checked against the real server `App` type.
- `bun run typecheck`, `bun run build`, Docker build, and Docker smoke are part of release checks.

---

## 2. Architecture decisions (and why)

These three were explicitly chosen with the user up front:

1. **SQLite + FTS5** (not Postgres). Zero-setup, fast, BM25 + weighted columns are "rich enough"
   to start. Drizzle keeps the schema portable if Postgres is needed later.
2. **Elysia + Eden Treaty** (not GraphQL). The route definitions *are* the contract; types reach
   the Vue app with **no codegen**. Lighter and faster to build than Apollo.
3. **Lean Vue** (not Quasar). Port *logic* from Wiki.js's Vue (renderer, blocks idea, stores),
   but a fresh modern UnoCSS design. Smaller bundle, full design control.

Cross-cutting principles (the "FP-leaning architecture" the user asked for):

- **Dependencies point inward.** `@ts-wiki/core` has no I/O and no globals. `apps/web` and
  `apps/server` depend on core; never on each other except the server's *type* (Eden).
- **Pure core, effects at the edges.** Rendering/slug/validation/permissions are pure functions.
- **`Result<T, E>` over throwing.** Services return results; `apps/server/src/http/errors.ts`
  (`unwrap` + `onError`) is the single error→HTTP boundary.
- **DI, not singletons.** `createDb()` → `createServices(db)` → `createApp({ db, env })`. This is
  the deliberate antidote to Wiki.js's global mutable `WIKI` object. Tests inject `:memory:` DBs.
- **Atomic saves.** A page write renders Markdown, snapshots history, and updates the search
  index inside one transaction (`apps/server/src/services/pages.ts`). When the call returns, the
  page is rendered *and* searchable.

---

## 3. Conventions to keep when extending

> Follow these so the codebase stays coherent.

- **New domain logic that is pure → put it in `@ts-wiki/core`** and unit-test it. If it touches the
  DB or network, it's a *service*, not core.
- **Services are factories:** `createXService(db) => { ...methods }`. Return `Result<T, AppError>`
  for expected failures (validation/permission/conflict/not-found). Don't throw for those.
- **Every multi-row write goes in a `db.transaction(...)`.** If a write affects search, update
  `pages_fts` in the same transaction (see `reindex()` in `pages.ts`).
- **Permissions:** add the action to `Action` in `packages/core/src/permissions.ts` and the
  role→action matrix; call `can(principal, action)` at the top of the service method. Don't
  scatter checks.
- **HTTP handlers stay thin:** validate with Elysia `t.*`, call a service, `unwrap()` the Result,
  return plain data. New error kinds go in `packages/core/src/errors.ts` + `httpStatus()`.
- **Page path is a query param** (`/api/page?path=...`), not a route segment, because wiki paths
  contain slashes. The Eden client mirrors this.
- **The web client re-states response shapes** in `apps/web/src/lib/api.ts` (see §4 gotcha). Keep
  new methods in that file; components/stores never call `treaty` directly.

---

## 4. Gotchas we already hit (don't re-discover these)

1. **Eden `delete` takes `(body, options)`** — query must be the *second* arg:
   `client().api.page.delete(null, { query: { path } })`. `delete({ query })` silently 422s.
2. **Eden + global `onError` unions the error body into each route's success type.** So
   `res.data.page` won't narrow. We localise this in `api.ts` by stating the success shape per
   call via `call<T>()`. The *request* (path/query/body) is still fully type-checked — that's the
   safety that matters.
3. **`bun test` from the root picks up unrelated tests.** The root `test` script is scoped to
   `bun test packages apps/server && bun --filter '@ts-wiki/web' test`; keep web SFC tests on
   Vitest and don't change the root script back to bare `bun test`.
4. **Auto-descriptions must be re-derived on update.** Carrying the old auto-summary forward left
   stale words in the search index. `pages.update` passes `description: patch.description`
   (undefined → re-summarise from new content). See the comment there.
5. **`author_id` is a soft reference, not a FK.** Tokens are now revalidated against the user row
   on every request, but historical pages/revisions still need to survive user deletion. It's a
   plain column (documented in `schema.ts`/`migrate.ts`).
6. **Slugs use an allow-list** (`[^\p{L}\p{N}]+ → -`), not a block-list, so Japanese/Unicode
   survive and arbitrary punctuation is handled uniformly. Don't "simplify" it back to ASCII.
7. **FTS5 tokenizer & CJK.** Default `unicode61` doesn't segment Japanese. For CJK-heavy content,
   set `TS_WIKI_FTS_TOKENIZER=trigram` before first migration. For an existing DB,
   back it up and run `TS_WIKI_FTS_TOKENIZER=trigram bun run db:reindex-search`.
8. **No drizzle-kit.** The DDL (incl. the FTS5 virtual table, which drizzle-kit can't express) is
   hand-written in `migrate.ts` and must be kept in sync with `schema.ts`. Adopting drizzle-kit
   later is fine, but FTS5 will still need a manual migration step.
9. **Backups are SQLite-first.** Use `.backup` for `data/ts-wiki.sqlite` and copy `data/assets/`.
   Git mirroring is a content mirror, not a full system backup.
10. **Structured logs are stdout JSON.** Request logs cover method/path/status/duration/IP/user;
   audit logs cover auth, page/admin mutations, asset uploads, Git sync, and collab autosave.
11. **Realtime auth split.** SSE and Yjs collab require tokens. Presence is cosmetic in public
   mode, but private wiki mode requires a valid token before opening the socket.

---

## 5. Roadmap — next steps, prioritised

Product direction from 2026-06-14 onward: **prioritise everyday usability and reusable UI
components over storage/search breadth**. Keep SQLite + FTS5 and the current storage model simple
until the wiki feels excellent to browse, create, edit, reorganise, and recover from mistakes.
Calendar/event workflows are a priority surface: meeting notes, project events, launch dates,
deadlines, and embedded schedules should be easy to paste into pages and easy to send into real
calendars.

Reference patterns worth borrowing:
- **BookStack** (`https://www.bookstackapp.com/`): page revisions, image management, and simple
  content organisation are core UX.
- **Outline** (`https://www.getoutline.com/`): fast document/collection workflows, quick creation,
  and document-level sharing are more important than backend variety.
- **Docusaurus** (`https://docusaurus.io/docs/sidebar`): generated sidebars/categories and
  predictable docs navigation make large docs feel navigable without manual bookkeeping.
- **Wiki.js** (`https://docs.requarks.io/`): structured page tree navigation, assets, editors, and
  page management are the practical surface users touch daily.

Each item notes **where to plug in**.

**High value, low effort**
- [x] **Pasteable calendar event cards** — Markdown fences with info string `event` render as
      `wiki-event-card` with title, time, timezone, location, URL, description, a Google Calendar
      template link, and downloadable `.ics`; `MarkdownEditor.vue` has an `Event` snippet button.
      This is the first calendar vertical slice and intentionally does not require OAuth.
- [x] **Graph view** — `extractPageLinks()` in core handles `[[Wiki Links]]` and internal Markdown
      links; `pages.graph()` returns page/missing nodes + edges; `GET /api/graph`; reusable
      `InteractiveGraph.vue` provides an Obsidian-style force graph with zoom, pan, node dragging,
      local/global mode, depth, missing-node toggle, and node sizing by link degree. `PageView.vue`
      shows a compact local graph in the right rail; `GraphView.vue` shows the full graph.
- [x] **Reader chrome components** — added `PageHeader`, `WikiBreadcrumbs`, `PageTree`, and
      `EmptyState`; page view now has copy-path, edit, new-child, updated-at metadata, and a
      structured sidebar without API changes.
- [x] **Page rename / move** — `move(oldPath, newPath, principal)` in `pages.ts`; `POST /api/page/move`;
      `Api.movePage()`; editable path in `PageEdit.vue`; tests cover path normalization, FTS preservation,
      and conflict refusal.
- [x] **Page history UI** — `pages.history()`, `/api/page/history`, `Api.history()`, and
      `HistoryView.vue` provide revision browsing, diff display, and revision restore.
- [x] **Asset image UI** — `MarkdownEditor.vue` supports upload button, drag-drop, paste-image
      upload, and `AssetPicker.vue` for browsing existing assets.
- [x] **Editor ergonomics** — toolbar buttons cover heading/bold/link/code/table/event/assets,
      with paste-image affordances, `.ics` import, unsaved-change warnings, and save status in
      `MarkdownEditor.vue` / `PageEdit.vue`.
- [x] **Calendar import/export UX** — `.ics` parsing lives in `@ts-wiki/core`; the editor can
      import `.ics` events into `event` fences and rendered event cards export downloadable `.ics`.
- [x] **Quick switcher / command palette** — `CommandPalette.vue` supports keyboard-first search,
      page jumps, new-page creation, and common navigation actions.
- [x] **Templates / starter pages** — `_new` can prefill blank, decision, how-to, meeting-notes,
      and spec templates. These remain built-in and web-only until custom persisted templates are
      worth the extra model.
- [x] **Global router auth guard** — `router.beforeEach` gates admin/edit routes and preserves a
      redirect query for login.

**Medium**
- [x] **Event extraction + event index** — `pages.events()` and `/api/events/index` extract event
      fences across pages; `EventsView.vue` shows upcoming/past events with page links and `.ics`.
- [x] **Google Calendar integration (no OAuth)** — event cards include Google Calendar template
      links and `.ics` import/export. OAuth calendar mutation is intentionally out of scope for the
      lean core; see `docs/ISSUE_RESOLUTION.md`.
- [x] **Backlinks + linked mentions on page view** — `pages.backlinks()`, `/api/page/backlinks`,
      and `PageView.vue` show incoming links directly on the reader view.
- [ ] **Navigation management** — evolve the generated tree into collapsible folders, recent pages,
      starred pages, and optional manual ordering. Avoid building a heavy collection model until
      the component behavior is proven.
- [x] **Markdown plugins / typed blocks** — `packages/core/src/markdown.ts` supports safe callout,
      embed, event, and Mermaid-source fences, shared by server render and live preview.
- [x] **"Blocks"** (Wiki.js's best idea) — the current typed-fence approach covers the useful
      lightweight subset without introducing framework-specific custom elements yet.
- [x] **Roles/permissions UI + user management** — admin users, role changes, default groups,
      group membership management, and page path rules are implemented.
- [x] **Production web serving** — Elysia serves `apps/web/dist` under `/ui` and the Dockerfile
      builds a single production image.

**Larger / later**
- [x] OAuth/OIDC strategy — generic OIDC provider config, login start/callback, account linking,
      registration controls, and domain allow-listing are implemented.
- [x] Comments — page comments with mentions, resolve/update/delete, and webhook events are implemented.
- [ ] Tags, multi-site, i18n, SSR.
- [ ] **Rust-backed search adapter.** Keep SQLite FTS5 as the default embedded engine, but add a
      `SearchIndexer` interface before swapping engines. Best first external option is
      **Meilisearch** (`https://www.meilisearch.com/docs/getting_started/overview`) for Rust-built,
      typo-tolerant, search-as-you-type UX. **Tantivy** (`https://github.com/quickwit-oss/tantivy`)
      is the lower-level Rust/Lucene-style library if we want to own the indexer. **Quickwit**
      (`https://quickwit.io/`) is larger-scale/log-search oriented and probably overkill for this
      wiki until the content volume is much higher. SQLite FTS5 trigram
      (`https://sqlite.org/fts5.html`) remains the smallest upgrade for CJK/substring matching.

---

## 6. File map (where things live)

```
packages/core/src/
  result.ts        Result<T,E>, ok/err, map/flatMap/...        (pure)
  errors.ts        AppError union + httpStatus()                (pure)
  slug.ts          normalizePath / slugifyHeading (Unicode)     (pure)
  permissions.ts   Role, Action, can()                          (pure)
  markdown.ts      renderMarkdown() → {html, toc}, event cards, extractPageLinks(), toPlainText
  page.ts          validatePageInput()                          (pure)
  core.test.ts     unit tests for all of the above

apps/server/src/
  env.ts           typed config (loadEnv)
  db/
    schema.ts      Drizzle tables + inferred types
    migrate.ts     DDL incl. FTS5 (+ `bun src/db/migrate.ts`); tokenizer comes from TS_WIKI_FTS_TOKENIZER
    client.ts      createDb() — SQLite/libSQL + drizzle, exposes $client for raw FTS
    seed.ts        admin + sample pages   (bun run db:seed)
    reset.ts       delete db files        (bun run db:reset)
  services/
    pages.ts       create/update/move/remove/get/list/graph — the transactional core
    search.ts      FTS5 query (BM25, snippet) + buildMatchQuery()
    users.ts       count/find/create
    assets.ts      record/list
    auth.ts        hashPassword/verifyPassword (Bun.password)
    index.ts       createServices(db) — composition root
  http/
    app.ts         createApp({db,env}) → Elysia; **exports `App` type for Eden**
    errors.ts      HttpError, unwrap(), toErrorResponse()
  index.ts         entry: env → db → app.listen
  server.test.ts   in-memory-db integration tests (create/search/update/delete/permissions)

apps/web/src/
  lib/api.ts       Eden Treaty client + Api.* methods (the only place treaty is used)
  stores/          auth.ts, pages.ts (Pinia)
  router/index.ts  routes (/_login /_search /_graph /_new /_edit/:path /:path) + paramToPath()
  components/      AppHeader.vue, MarkdownEditor.vue, InteractiveGraph.vue, PageHeader.vue,
                   PageTree.vue, WikiBreadcrumbs.vue, EmptyState.vue, PageToc.vue
  views/           PageView.vue, PageEdit.vue, SearchView.vue, GraphView.vue, LoginView.vue
  main.ts, App.vue, app.css, uno.config.ts, vite.config.ts
```

---

## 7. Extension recipes

**Add an API endpoint** → add a service method (returns `Result`) → add a route in `http/app.ts`
(`t.*` schema, `unwrap()`), keeping the single chained instance so Eden's `App` type updates →
add an `Api.*` wrapper in `web/src/lib/api.ts` → use it from a store/view.

**Add a new entity** → table in `db/schema.ts` → matching DDL in `db/migrate.ts` → `createXService`
in `services/` → register in `services/index.ts` → routes in `http/app.ts`.

**Add a permission** → extend `Action` + matrix in `core/permissions.ts` → `can(principal, action)`
in the service method.

**Add a Markdown feature** → a markdown-it plugin in `core/markdown.ts`. It's isomorphic, so the
server's render-on-save and the editor's live preview both pick it up automatically.

---

## 8. Running it

```bash
bun install
bun run db:seed     # admin@example.com / password  + sample pages
bun run dev         # server :4000 + web :5180
bun run test        # 28 tests
bun run typecheck   # all workspaces
bun run build       # web production build
```

Reference repos live under `reference/` (`wiki-main` v2, `wiki-vega` v3) and are gitignored —
local study only.
