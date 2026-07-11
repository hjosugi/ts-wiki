# Changelog

All notable changes are documented here. This project follows Semantic
Versioning; API compatibility details are in `docs/API.md`.

## [1.0.5] - 2026-07-11

### Changed

- Replaced the legacy purple triangle with a compact rose sparkle mark and a
  matching favicon, and changed the default accent to an accessible rose.
- Unified tags, search states, page-tree selection, graph highlights, and other
  branded UI states around the configurable accent instead of hardcoded violet.
- Reworked the active page treatment from a heavy left stripe to a subtle
  outlined surface.

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
