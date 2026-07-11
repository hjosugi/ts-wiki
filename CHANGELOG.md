# Changelog

All notable changes are documented here. This project follows Semantic
Versioning; API compatibility details are in `docs/API.md`.

## [1.0.29] - 2026-07-12

### Changed

- Moved active/trash page listing, redirect listing, revision history,
  contributor aggregation, and recent-change pagination behind an asynchronous
  driver-neutral page-read repository.
- Derived spaces, graph, backlinks, labels, broken links, and calendar events
  from asynchronously loaded active-page records in the service layer.
- Converted page/search/system/export HTTP reads and Git synchronization to
  await remote-capable page reads.
- Preserved the existing synchronous atomic page-write path for the next
  migration slice.

### Tests

- Added shared SQLite and libSQL page-read contract coverage for lifecycle and
  path ordering, stable revision tie-breaks, cursors, redirect ordering,
  author joins, and contributor aggregation.

## [1.0.28] - 2026-07-12

### Changed

- Split the database-neutral search facade and query parser from the
  SQLite-specific FTS5 adapter.
- Moved FTS schema rebuilds, raw search statements, supplemental comment and
  asset indexing, and page-asset reference SQL under the database adapter
  boundary.
- Removed database, schema, Drizzle, and migration imports from the production
  search and asset-reference services.
- Routed service composition and the search reindex command through the
  explicit SQLite FTS adapter while preserving current synchronous page-write
  behavior ahead of the page repository migration.

### Tests

- Added shared SQLite and libSQL FTS adapter contract coverage for page,
  comment, and asset indexing, ACL filtering, tokenizer status and rebuilds,
  Japanese short queries, and index removal.

## [1.0.27] - 2026-07-12

### Changed

- Moved site-setting load and atomic batch upsert behind an asynchronous
  driver-neutral repository.
- Added a startup readiness barrier that loads persisted settings before HTTP
  handlers use the synchronous public-settings cache.
- Serialized setting updates and converted setup, admin, and official-docs
  call chains to await remote-capable persistence.
- Removed database and schema imports from the settings service.

### Tests

- Added shared SQLite and libSQL settings contract coverage for initial reads,
  inserts, updates, timestamps, and preservation of untouched keys.
- Kept the full HTTP suite green across setup, runtime policy, appearance,
  Markdown feature, and localization settings.

## [1.0.26] - 2026-07-12

### Changed

- Moved asset metadata listing, lookup, usage references, access paths, and
  trash lifecycle mutations behind an asynchronous driver-neutral repository.
- Converted asset routes, site export, and search refresh call chains to await
  remote-capable asset persistence.
- Removed database, schema, and Drizzle imports from the asset service while
  retaining permission checks, validation, normalization, and view mapping in
  the service layer.

### Tests

- Added shared SQLite and libSQL asset contract coverage for ordering, folder
  filters, active/deleted lookup, metadata mutation, page references, access
  paths, and deletion.

## [1.0.25] - 2026-07-12

### Changed

- Moved automation rule CRUD, priority ordering, enabled selection, and event
  page-context lookup behind an asynchronous driver-neutral repository.
- Removed database, schema, and Drizzle imports from the webhook composition
  and automation services while retaining condition matching and page actions
  in the service layer.
- Converted automation admin routes and event publication to await
  remote-capable persistence.

### Tests

- Added shared SQLite and libSQL automation contract coverage for page lookup,
  rule ordering, enabled filtering, updates, deletion, and missing records.

## [1.0.24] - 2026-07-12

### Changed

- Moved webhook delivery lookup, enqueue, state updates, status-filtered
  listing, and due-retry selection behind an asynchronous driver-neutral
  repository.
- Removed database, schema, and Drizzle imports from the webhook delivery
  service while preserving signed delivery, redirect validation, retry policy,
  and response-size limits.

### Tests

- Added shared SQLite and libSQL webhook delivery contract coverage for
  ordering, status filters, due selection, attempt limits, updates, and missing
  lookups.

## [1.0.23] - 2026-07-12

### Changed

- Moved webhook subscription lookup, ordered listing, enabled-event selection,
  creation, update, and deletion behind an asynchronous driver-neutral
  repository.
- Converted webhook subscription routes, delivery name resolution, retries,
  and event publication to await remote-capable subscription persistence.
- Removed database schema types from the shared webhook validation helpers.

### Tests

- Added shared SQLite and libSQL webhook subscription contract coverage for
  ordering, enabled filtering, missing lookup, updates, and deletion.

## [1.0.22] - 2026-07-12

### Changed

- Moved admin statistics, revision retention, page and audit listing, group
  membership reads, and user mutations behind an asynchronous driver-neutral
  repository.
- Converted admin service and HTTP call chains to await remote-capable
  persistence while retaining permission, validation, and last-admin policy in
  the service layer.

### Tests

- Added shared SQLite and libSQL admin contract coverage for counts, history
  byte totals, atomic revision deletion, filters, pagination, memberships, and
  user mutations.

## [1.0.21] - 2026-07-12

### Changed

- Moved active-page comment context, comment CRUD, author-name joins, and
  mutation result reporting behind an asynchronous driver-neutral repository.
- Converted comment routes and comment/search/notification call chains to await
  remote-capable persistence.
- Kept permission policy, body validation, and mention extraction in the
  service layer.

### Tests

- Added shared SQLite and libSQL comment contract coverage for active pages,
  ordered author joins, anonymous authors, updates, resolution, deletion, and
  missing-row mutation reporting.

## [1.0.20] - 2026-07-12

### Changed

- Moved notification listing/read state, page visibility context, mention-user
  lookup, notification insertion, and page watchers behind an asynchronous
  driver-neutral repository.
- Converted notification routes and page/comment side effects to await
  remote-capable persistence.
- Made watcher path moves atomic while merging conflicting destination watches.

### Tests

- Added shared SQLite and libSQL notification contract coverage for ordering,
  limits, scoped read state, context lookup, watcher moves, conflicts, and
  cleanup.

## [1.0.19] - 2026-07-12

### Changed

- Moved link-preview and YouTube RSS cache lookup/upsert persistence behind an
  asynchronous driver-neutral repository.
- Removed database, schema, and Drizzle imports from the link-preview service
  while keeping URL validation, SSRF protection, fetching, and parsing in the
  service layer.

### Tests

- Added shared SQLite and libSQL link-preview repository coverage for cache
  misses, inserts, and complete conflict-update replacement.

## [1.0.18] - 2026-07-12

### Changed

- Moved page-view analytics increments, lookup, summary, and popularity queries
  behind an asynchronous driver-neutral repository.
- Preserved buffered view aggregation while converting flush, page insight,
  admin summary, and popular-page call chains to await remote-capable
  persistence.
- Replaced the page-view helper's database schema type with the shared
  driver-neutral page record contract.

### Tests

- Added shared SQLite and libSQL analytics contract coverage for atomic batch
  increments, totals, ranking, cutoffs, and deterministic limits.

## [1.0.17] - 2026-07-12

### Changed

- Introduced a driver-neutral page record contract and moved page-share lookup,
  creation, expiry checks, and revocation behind an asynchronous repository.
- Removed database/schema imports from the page-share service and converted
  share administration, public share resolution, and static SEO rendering to
  await remote-capable persistence.
- Made share revocation idempotent in the adapter.

### Tests

- Added shared SQLite and libSQL page-share contract coverage for active page
  lookup, expiration, duplicate-token normalization, and revocation.

## [1.0.16] - 2026-07-12

### Changed

- Moved API-key listing, lookup, creation, revocation, and usage tracking behind
  an asynchronous, driver-neutral repository and removed database/schema
  imports from the API-key service.
- Made API-key revocation idempotent and guarded usage timestamps with an
  active-and-unexpired conditional update so a concurrent revocation cannot
  authenticate a stale lookup.
- Converted API-key administration HTTP routes to await remote-capable
  persistence.

### Tests

- Added shared SQLite and libSQL API-key contract coverage for ordered listing,
  hash lookup, duplicate normalization, usage tracking, expiry, and revocation.

## [1.0.15] - 2026-07-12

### Changed

- Moved TOTP user-factor and recovery-code persistence behind an asynchronous,
  driver-neutral repository and removed database/schema imports from the TOTP
  service.
- Made TOTP enablement plus recovery-code issuance atomic, and kept recovery
  codes single-use through compare-and-set consumption.
- Converted TOTP setup and disable HTTP call chains to await remote-capable
  persistence.

### Tests

- Added shared SQLite and libSQL TOTP contract coverage for secret setup,
  atomic enablement, recovery-code replacement/consumption, and disable cleanup.

## [1.0.14] - 2026-07-12

### Changed

- Moved passkey credentials and WebAuthn challenges behind an asynchronous,
  driver-neutral repository and removed database/schema imports from the
  passkey service.
- Made WebAuthn challenge consumption atomic and single-use, and protected
  authentication counter updates with compare-and-set persistence.
- Converted passkey list, presence, deletion, registration, and login call
  chains to await remote-capable user and credential repositories.

### Tests

- Added shared SQLite and libSQL passkey contract coverage for credential CRUD,
  duplicate normalization, challenge expiry/single-use behavior, and guarded
  authentication counter updates.

## [1.0.13] - 2026-07-11

### Changed

- Moved OIDC login state persistence behind an asynchronous, driver-neutral
  repository and removed database/schema imports from the OIDC service.
- Made OIDC state validation and one-time consumption atomic so concurrent
  callbacks cannot replay the same login state.

### Tests

- Added shared SQLite and libSQL OIDC state contract coverage for provider
  isolation, expiry cleanup, and single-use consumption.

## [1.0.12] - 2026-07-11

### Changed

- Moved authorization groups, memberships, grants, and page rules behind an
  asynchronous, driver-neutral repository contract.
- Converted principal assembly, role-group synchronization, anonymous page
  policy checks, and admin authorization routes to await remote-capable
  persistence.
- Kept default policy initialization and exclusive role-group membership
  updates atomic inside the SQLite/libSQL adapter.

### Tests

- Added shared SQLite and libSQL authorization repository coverage for
  idempotent defaults, group membership counts, role synchronization, duplicate
  normalization, and page-rule persistence.
- Re-ran authorization-sensitive HTTP coverage for pages, search, feeds,
  assets, OIDC, registration, setup, realtime, and admin role changes.

## [1.0.11] - 2026-07-11

### Changed

- Moved external authentication accounts and password/email recovery tokens
  behind asynchronous, driver-neutral repository contracts.
- Made external-user creation plus account linking atomic, and made recovery
  token validation, user mutation, and one-time consumption atomic.
- Converted email verification and all related service/HTTP call chains to
  await remote-capable persistence.

### Tests

- Added shared SQLite and libSQL contract coverage for external account
  creation/relinking, password resets, email verification, one-time token
  consumption, expiry cleanup, and user updates.

## [1.0.10] - 2026-07-11

### Changed

- Moved user persistence behind the asynchronous cross-database repository
  boundary and propagated async lookups through registration, login, profiles,
  realtime authentication, seeding, and Git mirror attribution.
- Normalized duplicate-email persistence failures into a driver-neutral error
  instead of leaking SQLite/libSQL constraint details into the user service.

### Tests

- Added shared SQLite and libSQL user repository contract coverage for count,
  lookup, insert, update, and duplicate-email behavior.

### Fixed

- Removed the duplicate Admin view authentication redirect so the router's
  authoritative admin guard cannot race component mounting on direct loads.

## [1.0.9] - 2026-07-11

### Fixed

- Made authoritative Git startup re-import every tracked Markdown page, restore
  matching archived paths, publish Git-reviewed pages, and refuse to reconcile
  an empty repository so a partial first sync cannot hide an entire wiki.

## [1.0.8] - 2026-07-11

### Changed

- Began the cross-database repository migration from issue #363 with
  asynchronous, driver-neutral contracts for user preferences and page
  templates.
- Kept concrete Drizzle queries below the SQLite/libSQL adapter boundary and
  made multi-preference updates transactional.

### Tests

- Added shared repository contract suites that run against both in-memory
  SQLite and libSQL.

## [1.0.7] - 2026-07-11

### Added

- Git source-of-truth mode, which waits for the configured content repository
  at startup and reconciles database-only pages.
- Page comment policies for hidden, read-only, signed-in, group-only, and
  rate-limited anonymous posting.
- Direct page attachments, a localized shared file picker, and visual
  regression tests for the Minimal theme and core page layout.

### Changed

- Centered and simplified the header, compacted page graphs, clarified display
  settings and staged two-factor login, and redesigned redirect management.
- Made `hjosugi/kawaii-wiki.ts-doc` the authoritative Markdown source for the
  deployed documentation site.

### Fixed

- Restored confirmation buttons removed by production CSS extraction and made
  page action menus close on outside click and Escape.
- Fixed page-tree icon clipping, duplicate New page symbols, and native English
  file inputs on Japanese screens.

## [1.0.6] - 2026-07-11

### Fixed

- Prevented late editor initialization from clearing a title entered immediately
  after opening the new-page settings screen.

## [1.0.5] - 2026-07-11

### Changed

- Replaced the legacy purple triangle with a compact rose sparkle mark and a
  matching favicon, and changed the default accent to an accessible rose.
- Unified tags, search states, page-tree selection, graph highlights, and other
  branded UI states around the configurable accent instead of hardcoded violet.
- Reworked the active page treatment from a heavy left stripe to a subtle
  outlined surface.
- Split page creation and editing into focused settings and content views,
  collapsed page appearance/path/template controls by default, and replaced
  full template previews with a compact picker.
- Added Japanese built-in template content, localized page status badges, a
  Japanese Core package guide, and explicit language labels for English
  repository-source documentation.

### Fixed

- Restored readable foreground colors for plain text inside highlighted code
  blocks on light themes.

## [1.0.4] - 2026-07-11

### Added

- Searchable page and template lists, a collapsible Recent section, persistent
  sidebar visibility/density controls, and a desktop sidebar toggle.
- Localized template names and Japanese administration labels for appearance,
  policy, import, redirects, and custom templates.
- SSH client support in the production image so Git mirrors can use writable
  GitHub Deploy Keys without embedding access tokens in remote URLs.

### Changed

- Reworked the administration layout to use the available content width,
  remove the redundant page sidebar, enlarge navigation text, and make cards,
  forms, API badges, exports, and tables responsive.
- Simplified page reading controls, hid graphs by default, removed duplicate
  article headings and internal documentation labels, improved page-tree icons
  and hierarchy, and kept the configured wiki title visible as the primary
  brand.

## [1.0.3] - 2026-07-11

- Build architecture-independent web assets and typecheck on the native build
  platform so multi-architecture Docker releases do not compile the frontend
  under slow CPU emulation.

## [1.0.2] - 2026-07-11

### Added

- Bundled official documentation for users, administrators, operators, and
  developers, plus an admin installer and a maintenance command for docs sites.
- A searchable, categorized administration sidebar, REST/OpenAPI status panel,
  Git setup guidance, and a persistent graph visibility preference.
- A Docker Compose setup and a secure Docker entrypoint that generates and
  persists the JWT secret when one is not supplied.

### Changed

- Simplified the README into a Docker-first entry point and moved detailed
  product, deployment, backup, configuration, and development guidance into the
  deployed documentation wiki.
- Made the configured wiki title the primary brand, clarified view/edit modes
  and navigation labels, replaced ambiguous emoji controls with accessible SVG
  icons and tooltips, and consolidated secondary page actions.
- Contained header, page rail, graph, tables, menus, and admin navigation at
  narrow viewport widths.

## [1.0.1] - 2026-07-11

- Updated frontend dependencies and GitHub Actions without changing the public
  product or API contract.

## [1.0.0] - 2026-07-11

### Added

- OpenAPI/Scalar documentation, a written 1.x API stability contract, schema
  migration versions, old-database migration coverage, and upgrade/rollback
  guidance.
- Production browser smoke tests, container smoke tests, linting, dependency
  audits, Dependabot, multi-architecture GHCR images, and floating semver tags.
- DB-aware container health checks, non-root runtime operation, configuration,
  backup, security, and contribution documentation.

### Changed

- Webhook delivery is queued, bounded, timeout-protected, redirect-validated,
  and pinned to its validated DNS address.
- Search, asset reference tracking, graph loading, revisions, recent changes,
  exports, realtime refresh, and editor bundling are bounded or batched.
- Core setup, search, page error, mobile navigation, tree controls, and Japanese
  localization flows have been polished for the 1.0 release.

### Security

- Fixed email-verification migration bypass, required-2FA passkey bypass,
  cross-endpoint page ACL leaks, private asset reads, predictable JWT signing,
  share-token logging, presence spoofing, and login timing enumeration.
- Added SQLite contention handling and typed conflict responses for concurrent
  unique-key races.

## [0.5.0] - 2026-07-06

- Completed the pre-1.0 feature and accessibility audit, including first-run
  setup, OIDC/passkeys/TOTP, assets, automation, realtime collaboration, runtime
  branding, responsive navigation, and deployment documentation.
