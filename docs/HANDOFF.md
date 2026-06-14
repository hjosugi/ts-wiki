# open-wiki — Handoff / 引き継ぎ資料

A practical guide for whoever picks this up next (human or AI). The user-facing overview is in
[../README.md](../README.md); this document is the **developer handoff**: current status, why
things are the way they are, what bit us, and exactly where to plug in the next features.

- **As of:** 2026-06-14
- **State:** v0 — a small but *complete and verified* vertical slice. Everything below marked ✅
  has been run and confirmed (tests + live HTTP + typed client + build + typecheck).
- **Stack:** Bun 1.3 · Elysia · Drizzle ORM · SQLite (`bun:sqlite`) + FTS5 · Vue 3 · Vite ·
  UnoCSS · Pinia · CodeMirror 6 · Eden Treaty (no codegen).

---

## 1. Status at a glance

| Area | Status | Notes |
|---|---|---|
| Monorepo + Bun workspaces | ✅ | `packages/*`, `apps/*`; root scripts orchestrate via `bun --filter` |
| `@wiki/core` (pure domain) | ✅ | Result, errors, slug, permissions, markdown+TOC/link extraction, validation |
| DB schema + FTS5 migration | ✅ | `users`, `pages`, `page_revisions`, `assets`, `pages_fts` |
| Pages service (CRUD) | ✅ | transactional: render + revision + FTS index together |
| Search service (FTS5/BM25) | ✅ | weighted columns, snippets, prefix queries |
| Users + auth (local + JWT) | ✅ | bcrypt via `Bun.password`; first account → admin |
| Assets upload | ⚠️ partial | endpoint + static serving + DB row exist; **no UI** yet |
| Elysia HTTP app + Eden type | ✅ | exports `App`; error mapping centralised |
| Vue app: view/edit/search/graph/login | ✅ | breadcrumbs, page header actions, tree sidebar, graph view, empty states |
| Markdown editor (CodeMirror) | ✅ | split editor + live preview using the *same* core renderer |
| Tests / typecheck / build | ✅ | 22 tests pass; all 3 packages typecheck; web builds |
| Auth route guards in router | ⚠️ basic | `PageEdit` redirects if not editor; no global nav guard |

### Verified during the build (evidence)
- `bun run test` → **22 pass / 0 fail** (`packages/core/src/core.test.ts`, `apps/server/src/server.test.ts`).
- Live API via curl: register/login, 403 for anon writes, path normalization, render-on-save,
  search ranking+snippets, reindex-on-update, move, delete → 404.
- Eden Treaty client: every call shape (`get`/`post` body/`put` body+query/`move` body/`delete` body+query/`search`/`graph`) hit the live server successfully.
- `bun --filter '@wiki/web' build` → clean; `vue-tsc`, core & server `tsc` → 0 errors.

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

- **Dependencies point inward.** `@wiki/core` has no I/O and no globals. `apps/web` and
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

- **New domain logic that is pure → put it in `@wiki/core`** and unit-test it. If it touches the
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
3. **`bun test` from the root picks up the reference repos' tests.** The root `test` script is
   scoped to `bun test packages apps` for this reason. Don't change it back to bare `bun test`.
4. **Auto-descriptions must be re-derived on update.** Carrying the old auto-summary forward left
   stale words in the search index. `pages.update` passes `description: patch.description`
   (undefined → re-summarise from new content). See the comment there.
5. **`author_id` is a soft reference, not a FK.** A JWT can outlive its user; a hard FK made saves
   500. It's a plain column (documented in `schema.ts`/`migrate.ts`).
6. **Slugs use an allow-list** (`[^\p{L}\p{N}]+ → -`), not a block-list, so Japanese/Unicode
   survive and arbitrary punctuation is handled uniformly. Don't "simplify" it back to ASCII.
7. **FTS5 tokenizer & CJK.** Default `unicode61` doesn't segment Japanese. For CJK-heavy content,
   switch `FTS_TOKENIZER` in `migrate.ts` to `trigram`, then `db:reset && db:seed`.
8. **No drizzle-kit.** The DDL (incl. the FTS5 virtual table, which drizzle-kit can't express) is
   hand-written in `migrate.ts` and must be kept in sync with `schema.ts`. Adopting drizzle-kit
   later is fine, but FTS5 will still need a manual migration step.

---

## 5. Roadmap — next steps, prioritised

Product direction from 2026-06-14 onward: **prioritise everyday usability and reusable UI
components over storage/search breadth**. Keep SQLite + FTS5 and the current storage model simple
until the wiki feels excellent to browse, create, edit, reorganise, and recover from mistakes.

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
- [x] **Graph view** — `extractPageLinks()` in core handles `[[Wiki Links]]` and internal Markdown
      links; `pages.graph()` returns page/missing nodes + edges; `GET /api/graph`; `GraphView.vue`
      visualises links and backlinks, with missing nodes opening `_new?path=...`.
- [x] **Reader chrome components** — added `PageHeader`, `WikiBreadcrumbs`, `PageTree`, and
      `EmptyState`; page view now has copy-path, edit, new-child, updated-at metadata, and a
      structured sidebar without API changes.
- [x] **Page rename / move** — `move(oldPath, newPath, principal)` in `pages.ts`; `POST /api/page/move`;
      `Api.movePage()`; editable path in `PageEdit.vue`; tests cover path normalization, FTS preservation,
      and conflict refusal.
- [ ] **Page history UI** — data already exists in `page_revisions`. Add `getRevisions(path)` to
      `pages.ts`, a route, an `Api.history()` call, and a `HistoryView.vue` (diff via `diff` lib).
- [ ] **Asset image UI** — endpoint exists (`POST /api/assets`). Wire an upload button +
      drag-drop into `MarkdownEditor.vue` that inserts `![](/assets/…)`.
- [ ] **Editor ergonomics** — add toolbar buttons for heading/bold/link/image/code/table, upload
      and paste-image affordances, unsaved-change warning, and a clearer save/error/status strip
      in `MarkdownEditor.vue` / `PageEdit.vue`.
- [ ] **Quick switcher / command palette** — keyboard-first `Cmd/Ctrl+K` for search, jump to page,
      create page, and common edit actions. This should sit in `AppHeader.vue` + a new modal
      component and can reuse `Api.listPages()` / `Api.search()`.
- [ ] **Templates / starter pages** — let `_new` prefill from templates such as "Decision",
      "How-to", "Meeting notes", and "Spec". Keep this web-only first; persist templates later if
      users actually need custom ones.
- [ ] **Global router auth guard** — centralise the `canEdit` redirect (currently only in
      `PageEdit.vue onMounted`) into `router.beforeEach`.

**Medium**
- [ ] **Backlinks + linked mentions on page view** — graph extraction already exists; show
      "Linked from" directly on `PageView.vue`, and turn missing `[[links]]` into one-click page
      creation in rendered markdown.
- [ ] **Navigation management** — evolve the generated tree into collapsible folders, recent pages,
      starred pages, and optional manual ordering. Avoid building a heavy collection model until
      the component behavior is proven.
- [ ] **Markdown plugins** — KaTeX math, Mermaid/diagrams, footnotes already partly in markdown-it.
      Add in `packages/core/src/markdown.ts` (stays isomorphic → server render + live preview both
      get it for free).
- [ ] **"Blocks"** (Wiki.js's best idea) — framework-agnostic web components embedded in pages
      (e.g. `<block-index path="docs">`). See `reference/wiki-vega/blocks/` for the pattern.
- [ ] **Roles/permissions UI + user management** — `users` table + `permissions.ts` exist; needs
      admin routes + screens.
- [ ] **Production web serving** — serve `apps/web/dist` from Elysia (`@elysiajs/static`) for a
      single-process deploy; add a Dockerfile.

**Larger / later**
- [ ] OAuth/OIDC strategies (structure: a `modules/auth/*` registry like Wiki.js, but typed).
- [ ] Comments, tags, multi-site, i18n, SSR.
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
  markdown.ts      renderMarkdown() → {html, toc}, extractPageLinks(), toPlainText
  page.ts          validatePageInput()                          (pure)
  core.test.ts     unit tests for all of the above

apps/server/src/
  env.ts           typed config (loadEnv)
  db/
    schema.ts      Drizzle tables + inferred types
    migrate.ts     DDL incl. FTS5 (+ `bun src/db/migrate.ts`); FTS_TOKENIZER lives here
    client.ts      createDb() — bun:sqlite + drizzle, exposes $client for raw FTS
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
  components/      AppHeader.vue, MarkdownEditor.vue, PageHeader.vue, PageTree.vue,
                   WikiBreadcrumbs.vue, EmptyState.vue, PageToc.vue
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
bun run test        # 22 tests
bun run typecheck   # all workspaces
bun run build       # web production build
```

Reference repos live under `reference/` (`wiki-main` v2, `wiki-vega` v3) and are gitignored —
local study only.
