<!-- i18n: language-switcher -->
[English](ISSUE_RESOLUTION.md) | [日本語](ISSUE_RESOLUTION.ja.md)

# Issue Resolution Notes

As of 2026-07-05, the open GitHub issues were triaged against the current
implementation and the product stance in `docs/HANDOFF.md`.

This is not a promise to clone every Wiki.js or Confluence surface. The
resolution rule for this pass is:

- keep `kawaii-wiki.ts` Markdown-first, local-first, cheap to run, and small enough to
  understand;
- close broad parity issues once the useful subset is implemented or explicitly
  scoped out;
- reopen future work as narrow issues only when there is a concrete user need.

## 2026-07-10 Open-Issue Sweep

The second pass addresses the open audit backlog from #165 through #261 as
cohesive slices instead of one-off patches:

| Issues | Implemented resolution |
| --- | --- |
| #165–#174 | Toast and styled-dialog hosts, print styles, active TOC tracking, reading controls, platform-correct shortcut labels, realtime connection status, lossy visual-mode warnings, shared modal/form/status/segmented controls, and token-based content cards. |
| #176–#181 | Native dialogs were removed, locale switching persists with legacy-key migration, core navigation/editor surfaces and admin navigation use the typed en/ja catalog, API errors map to friendly localized messages, and catalog parity plus runtime fallback are enforced. |
| #183–#187 | Public profiles, in-app notifications, page watches, real draft visibility gates, and scheduled publication are backed by persisted data and permission-aware HTTP APIs. |
| #188–#193 | Print-ready export, JSON restore, Markdown ZIP export with assets and manifest, multi-file/ZIP import, arbitrary revision diff modes, and duplicate-as-draft are available from the UI/API. |
| #203, #210 | Frontmatter TOC controls and backlink-preserving link rewrites on page moves are part of the core write path. |
| #214–#229 | Permission and page-write gates are centralized; user/webhook queries are batched; schema column/index drift fails at startup; TOTP and Git status have service boundaries; lookup races return typed errors; list APIs paginate; derived page data and auth policies cache safely; analytics writes are buffered; unsafe timer/error casts are centralized or removed. |
| #234–#243 | Markdown calendar/block/link concerns, visual conversion, PageEdit state/meta UI, editor commands/toolbars/uploads, async data/CRUD state, response validation/contracts, page fetching, and labels/TOC decoding are separated and shared. |
| #261 | Packages, UI defaults, docs, container references, env names, webhook headers, browser storage, and the GitHub repository are rebranded to `kawaii-wiki.ts`, with legacy env/storage/database compatibility retained. |

The implementation deliberately keeps the legacy `TS_WIKI_*`, `ts-wiki:*`,
SQLite filename, and webhook headers as read/emit aliases. New names win when
both are supplied; removing those aliases would break existing installations.

## Completed or Covered

| Issue | Resolution |
| --- | --- |
| #42 Pluggable auth, self-registration, 2FA, and passkeys | Covered by local email/password auth, first-user admin bootstrap, TOTP setup/enable/disable, a generic auth-provider registry with OIDC as the first implementation, and Passkey/WebAuthn registration + login. SAML/LDAP remain outside this release; they now have a service boundary to plug into instead of blocking the core auth path. |
| #34 Templates / starter pages | Covered by built-in create-page templates plus persisted custom page templates. `_new` merges blank, decision, how-to, meeting notes, spec, and custom templates; editors manage custom templates through `/_templates` and `/api/templates`. Templates can prefill title, path, labels, status, locale, review date, and content. |
| #37 Google Calendar integration | Covered by the zero-OAuth event workflow: `event` fences render calendar cards, include Google Calendar template links and `.ics` downloads, `.ics` files can be imported into the editor, and `/api/events/index` powers the Events view. Full OAuth calendar sync is not part of the current product. |
| #40 Markdown/rendering plugins | Covered by the safe renderer extensions already in core: syntax highlighting, heading anchors, wiki links, event blocks, callout blocks, rich embed/bookmark blocks, and Mermaid source blocks. Raw HTML remains disabled. Client-side diagram execution, KaTeX, and emoji shortcodes should only be added as small, opt-in follow-ups. |
| #44 Zero-cost Render + Turso + R2 hosting | Covered by R2-backed asset storage, explicit `DATABASE_DRIVER=sqlite\|libsql` config, local libSQL support, and Turso support through a libSQL embedded replica (`LIBSQL_URL` + optional `LIBSQL_REPLICA_PATH`). Render Free deployments should pair Turso with R2 because local disk is ephemeral. |
| #45 Fine-grained groups and page rules | Covered by DB-backed groups, role default groups, group membership management, permission grants, page path rules with exact/prefix/suffix/regex matchers, and deny precedence in `@kawaii-wiki/core`. Admin UI exposes group creation, membership edits, and page rule management. |
| #49 Visual/rich editor | Covered by a Markdown-first visual editor mode that round-trips headings, paragraphs, formatting, lists, tables, images/assets, callouts, and unsupported Markdown as raw blocks. Markdown remains canonical; visual mode is an authoring aid, not a separate document model. |
| #51 Admin console | Covered at the v0 operations level: stats, users/role changes with last-admin protection, analytics, site appearance/nav settings, Markdown import, trash/archive restore/purge, and asset management. Group/auth-provider/audit-log UIs are intentionally not bundled into this broad issue. |
| #52 Wiki.js / Confluence audit | Completed by the issue body plus this resolution note. The audit now feeds concrete product boundaries instead of staying open as a perpetual parity checklist. |
| #57 Automation, webhooks, and integration hooks | Covered by DB-backed webhook subscriptions, HMAC-signed versioned payloads, delivery history, manual and scheduled retry, admin APIs, and event automation rules with triggers, conditions, priority, page metadata/move actions, and custom webhook event firing. |
| #59 Additional Confluence content types | Completed by the content-type decision below. |

## Explicitly Out Of Scope For Now

| Issue | Resolution |
| --- | --- |
| SAML / LDAP directories | Still out of scope for this release. They need provider-specific group mapping and recovery/admin fallback design beyond the generic OIDC + passkey/TOTP work. |

## Content-Type Decisions For #59

| Confluence surface | kawaii-wiki.ts decision |
| --- | --- |
| Pages | Core content type. Markdown pages remain canonical. |
| Live docs | Covered by collaborative editing on pages; no separate content model. |
| Blog/news posts | Use normal pages under paths such as `news/` or `changelog/`, with labels/status/templates. No separate blog table. |
| Databases | Full database/spreadsheet products are out of scope. Use Markdown tables now; consider future typed blocks only for small, read-only inventories/runbooks. |
| Smart Links | Covered by `embed` fences as safe bookmark blocks. Rich previews can evolve inside the typed-block renderer without changing the page model. |
| Whiteboards | Out of scope. Link or embed external diagrams/boards instead. |
| Slides | Out of scope. Use pages for notes/specs; dedicated presenter mode is not a wiki-core feature. |
| AI-generated content | Out of scope as a required feature. Generated text can be pasted into Markdown like any other content. |

## Cost Impact

The completed subset keeps the default deployment at zero extra services:

- SQLite and local assets continue to work for local development and cheap
  single-host production.
- Event cards, templates, callouts, embeds, search filters, comments, analytics,
  and admin operations do not require paid APIs.
- Render Free can use Turso + R2 instead of relying on persistent local disk.
- Features that would require provider-specific enterprise directory design,
  background queues, or client-side renderer execution were closed as out of
  scope unless they can return later as focused, optional work.
