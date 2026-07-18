/**
 * Shared column enum tuples — the single source of truth for the string-literal
 * enums that both Drizzle schemas declare (SQLite: `./schema.ts`, Postgres:
 * `./postgres/schema.ts`). Keeping them here guarantees the two dialects stay in
 * lockstep and can't drift a value or ordering apart.
 *
 * Each array is declared `as const` so it is a readonly literal tuple, which is
 * exactly what Drizzle's `text(name, { enum })` option expects.
 */

/** users.role, api_keys.role */
export const ROLES = ['admin', 'editor', 'viewer'] as const

/** webauthn_challenges.purpose */
export const WEBAUTHN_CHALLENGE_PURPOSES = ['registration', 'authentication'] as const

/** permission_grants.subject_type, page_rules.subject_type */
export const SUBJECT_TYPES = ['user', 'group', 'anonymous'] as const

/** permission_grants.effect, page_rules.effect */
export const PERMISSION_EFFECTS = ['allow', 'deny'] as const

/** page_rules.matcher */
export const PAGE_RULE_MATCHERS = ['exact', 'prefix', 'suffix', 'regex'] as const

/** pages.lifecycle */
export const PAGE_LIFECYCLES = ['active', 'archived', 'deleted'] as const

/** pages.status */
export const PAGE_STATUSES = ['draft', 'in-review', 'verified', 'outdated'] as const

/** page_revisions.action */
export const PAGE_REVISION_ACTIONS = ['created', 'updated', 'moved', 'deleted', 'archived', 'restored', 'purged'] as const

/** link_previews.kind */
export const LINK_PREVIEW_KINDS = ['unfurl', 'youtube-latest'] as const

/** wiki_events.event_type */
export const WIKI_EVENT_TYPES = ['page:changed'] as const

/** wiki_events.action */
export const WIKI_EVENT_ACTIONS = ['created', 'updated', 'moved', 'deleted'] as const

/** webhook_deliveries.status */
export const WEBHOOK_DELIVERY_STATUSES = ['pending', 'succeeded', 'failed'] as const

/** automation_rules.type */
export const AUTOMATION_RULE_TYPES = ['event-rule', 'page-updated-metadata'] as const
