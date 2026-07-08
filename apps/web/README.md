# ts-wiki Web

Vue 3 + Vite front end for the ts-wiki hands-on project.

## What This Teaches

- typed API calls with Eden Treaty from the server's `App` type
- Vue component state and Pinia stores
- Markdown editing with CodeMirror
- search, page view, edit, login, and admin flows
- realtime page-change updates through server-sent events
- runtime branding through public settings and CSS variables
- lazy Markdown enhancements for KaTeX CSS, Mermaid diagrams, and content tabs
- built-in plus persisted page templates for new-page starters
- keeping UI code thin while domain rules stay in `@ts-wiki/core`

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
bun --filter '@ts-wiki/web' dev
bun --filter '@ts-wiki/web' build
bun --filter '@ts-wiki/web' preview
bun --filter '@ts-wiki/web' typecheck
```

## Files To Read First

| File | Why it matters |
| --- | --- |
| `src/main.ts` | app bootstrap and plugin setup |
| `src/App.vue` | top-level layout and route shell |
| `src/lib/api.ts` | typed client contract with the server |
| `src/lib/branding.ts` | applies title, favicon, custom CSS, and trusted head HTML |
| `src/lib/markdownEnhance.ts` | enhances rendered Markdown with copy buttons, KaTeX CSS, Mermaid, and tabs |
| `src/lib/pageTemplates.ts` | built-in starter templates and custom-template option helpers |
| `src/stores/auth.ts` | login/session state |
| `src/views/PageEdit.vue` | Markdown editing flow |
| `src/views/PageTemplatesView.vue` | editor-facing custom template manager |
| `src/app.css` / `uno.config.ts` | theme variables and token-backed shortcuts |

## Exercises

1. Add a loading and empty state to the search view.
2. Add a small keyboard shortcut for saving an edited page.
3. Create a route that shows page revision history after the server supports it.
4. Improve the editor preview while keeping the API contract typed.
