# Contributing

Thank you for helping improve kawaii-wiki.ts. For substantial product-scope
changes, open an issue before implementation. Security reports belong in the
private process described in `SECURITY.md`.

Development requires Bun 1.3.14. From the repository root:

```bash
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run test
bun run build
```

Run `bunx playwright install chromium` once before `bun run test:e2e`. Keep PRs
focused, add regression tests for behavior changes, preserve existing API
compatibility, and update documentation or the changelog when users or
operators need to act differently. See `docs/HANDOFF.md` for architecture and
development details.
