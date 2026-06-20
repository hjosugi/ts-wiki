# open-wiki Web

Vue 3 + Vite front end for the open-wiki hands-on project.

## What This Teaches

- typed API calls with Eden Treaty from the server's `App` type
- Vue component state and Pinia stores
- Markdown editing with CodeMirror
- search, page view, edit, login, and admin flows
- realtime page-change updates through server-sent events
- keeping UI code thin while domain rules stay in `@wiki/core`

## Run

From the repository root:

```bash
bun install
bun run db:seed
bun run dev
```

Open `http://localhost:5180`. Sign in with the seeded account:

```text
admin@example.com / password
```

## Useful Commands

```bash
bun --filter '@wiki/web' dev
bun --filter '@wiki/web' build
bun --filter '@wiki/web' preview
bun --filter '@wiki/web' typecheck
```

## Files To Read First

| File | Why it matters |
| --- | --- |
| `src/main.ts` | app bootstrap and plugin setup |
| `src/App.vue` | top-level layout and route shell |
| `src/lib/api.ts` | typed client contract with the server |
| `src/stores/auth.ts` | login/session state |
| `src/views/PageEdit.vue` | Markdown editing flow |

## Exercises

1. Add a loading and empty state to the search view.
2. Add a small keyboard shortcut for saving an edited page.
3. Create a route that shows page revision history after the server supports it.
4. Improve the editor preview while keeping the API contract typed.
