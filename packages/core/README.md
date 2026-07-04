# ts-wiki Core

Pure TypeScript domain package shared by the server and web app.

## What This Teaches

- functional core, imperative shell architecture
- typed `Result<T, E>` error handling instead of throwing through domain logic
- validation and normalization before persistence
- permission checks expressed as a small policy table
- Markdown rendering and slug generation without HTTP or database dependencies

## Run

From the repository root:

```bash
bun test packages/core
bun --filter '@ts-wiki/core' typecheck
```

## Files To Read First

| File | Why it matters |
| --- | --- |
| `src/result.ts` | success/error values used across the app |
| `src/errors.ts` | typed application errors |
| `src/page.ts` | page input validation |
| `src/permissions.ts` | central authorization policy |
| `src/markdown.ts` | Markdown to HTML pipeline |
| `src/slug.ts` | Unicode-safe slug behavior |

## Exercises

1. Add a new permission action and cover it with a test.
2. Add validation for a new page field without importing server code.
3. Extend Markdown rendering and keep the function deterministic.
4. Add a failing test first, then update the pure function.
