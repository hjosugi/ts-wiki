/**
 * MySQL schema — the mysql-core mirror of the PostgreSQL schema
 * (`../postgres/schema.ts`), which itself mirrors the canonical SQLite schema
 * (`../schema.ts`). Used by the MySQL repository implementations (#365).
 *
 * It is a table-for-table, column-for-column copy of the Postgres schema with
 * the pg-core -> mysql-core substitutions below applied per column so the data
 * semantics stay identical and the driver-neutral contract tests behave the same:
 *   - epoch-millis / counter `bigint` (`millis`) stays `bigint` (`mode: 'number'`),
 *     read/written as JS numbers (safe below 2^53).
 *   - `boolean` stays a native `boolean`.
 *   - `bigserial(...).primaryKey()` autoincrement PKs -> `bigint(...).autoincrement().primaryKey()`.
 *   - `text({ enum })` -> `varchar({ length: 32, enum })`: MySQL needs a bounded
 *     type, the enum stays a TS-level / app-enforced constraint like SQLite & PG.
 *   - plain `text` that is a PRIMARY KEY / `.unique()` / part of any index ->
 *     `varchar({ length: 255 })`: MySQL cannot index or key a TEXT column without
 *     a prefix length.
 *   - plain `text` carrying a literal string default -> `varchar({ length: 512 })`
 *     keeping the default: MySQL TEXT columns cannot hold a literal DEFAULT.
 *   - the large / unbounded body columns (page, revision & template content,
 *     rendered HTML, comment body, audit data) stay `text` and therefore lose
 *     their Postgres default, since MySQL TEXT cannot default.
 *
 * The DDL is generated from these declarations by `./migrate.ts`; a parity test
 * fails loudly on drift. Full-text search (SQLite FTS5 -> MySQL `FULLTEXT`) is
 * intentionally NOT here yet — it lands in a later search slice.
 */
import { mysqlTable, varchar, text, bigint, boolean, index, primaryKey } from 'drizzle-orm/mysql-core'
import {
  ROLES,
  WEBAUTHN_CHALLENGE_PURPOSES,
  SUBJECT_TYPES,
  PERMISSION_EFFECTS,
  PAGE_RULE_MATCHERS,
  PAGE_LIFECYCLES,
  PAGE_STATUSES,
  PAGE_REVISION_ACTIONS,
  LINK_PREVIEW_KINDS,
  WIKI_EVENT_TYPES,
  WIKI_EVENT_ACTIONS,
  WEBHOOK_DELIVERY_STATUSES,
  AUTOMATION_RULE_TYPES,
  SEARCH_OUTBOX_OPERATIONS,
} from '../schema-enums'

/** SQLite epoch-millis / counter integers map to bigint read as a JS number. */
const millis = (name: string) => bigint(name, { mode: 'number' })

export const schemaMigrations = mysqlTable('schema_migrations', {
  version: millis('version').primaryKey(),
  appliedAt: millis('applied_at').notNull(),
})

export const users = mysqlTable('users', {
  id: varchar('id', { length: 255 }).primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: varchar('role', { length: 32, enum: ROLES })
    .notNull()
    .default('viewer'),
  totpSecret: text('totp_secret'),
  totpEnabled: millis('totp_enabled').notNull().default(0),
  disabledAt: millis('disabled_at'),
  tokenInvalidBefore: millis('token_invalid_before').notNull().default(0),
  emailVerifiedAt: millis('email_verified_at'),
  profileBio: text('profile_bio').notNull(),
  profileCoverUrl: varchar('profile_cover_url', { length: 512 }).notNull().default(''),
  profileLinks: text('profile_links').notNull(),
  profileFavoritePages: text('profile_favorite_pages').notNull(),
  createdAt: millis('created_at').notNull(),
})

export const authAccounts = mysqlTable(
  'auth_accounts',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    userId: varchar('user_id', { length: 255 }).notNull(),
    provider: varchar('provider', { length: 255 }).notNull(),
    providerSubject: varchar('provider_subject', { length: 255 }).notNull(),
    email: text('email').notNull(),
    createdAt: millis('created_at').notNull(),
    updatedAt: millis('updated_at').notNull(),
  },
  (t) => [index('auth_accounts_user_idx').on(t.userId), index('auth_accounts_provider_idx').on(t.provider, t.providerSubject)],
)

export const oauthStates = mysqlTable('oauth_states', {
  state: varchar('state', { length: 255 }).primaryKey(),
  provider: text('provider').notNull(),
  nonce: text('nonce').notNull(),
  codeVerifier: text('code_verifier').notNull(),
  redirectAfter: text('redirect_after'),
  expiresAt: millis('expires_at').notNull(),
  createdAt: millis('created_at').notNull(),
})

export const passwordResets = mysqlTable(
  'password_resets',
  {
    token: varchar('token', { length: 255 }).primaryKey(),
    userId: varchar('user_id', { length: 255 }).notNull(),
    expiresAt: millis('expires_at').notNull(),
    createdAt: millis('created_at').notNull(),
  },
  (t) => [index('password_resets_user_idx').on(t.userId), index('password_resets_expires_idx').on(t.expiresAt)],
)

export const emailVerifications = mysqlTable(
  'email_verifications',
  {
    token: varchar('token', { length: 255 }).primaryKey(),
    userId: varchar('user_id', { length: 255 }).notNull(),
    email: text('email').notNull(),
    expiresAt: millis('expires_at').notNull(),
    createdAt: millis('created_at').notNull(),
  },
  (t) => [index('email_verifications_user_idx').on(t.userId), index('email_verifications_expires_idx').on(t.expiresAt)],
)

export const passkeys = mysqlTable(
  'passkeys',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    userId: varchar('user_id', { length: 255 }).notNull(),
    name: text('name').notNull(),
    publicKey: text('public_key').notNull(),
    counter: millis('counter').notNull().default(0),
    transports: varchar('transports', { length: 512 }).notNull().default('[]'),
    deviceType: varchar('device_type', { length: 512 }).notNull().default('unknown'),
    backedUp: boolean('backed_up').notNull().default(false),
    createdAt: millis('created_at').notNull(),
    lastUsedAt: millis('last_used_at'),
  },
  (t) => [index('passkeys_user_idx').on(t.userId)],
)

export const totpRecoveryCodes = mysqlTable(
  'totp_recovery_codes',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    userId: varchar('user_id', { length: 255 }).notNull(),
    codeHash: text('code_hash').notNull(),
    createdAt: millis('created_at').notNull(),
    usedAt: millis('used_at'),
  },
  (t) => [
    index('totp_recovery_codes_user_idx').on(t.userId),
    index('totp_recovery_codes_used_idx').on(t.usedAt),
  ],
)

export const webauthnChallenges = mysqlTable(
  'webauthn_challenges',
  {
    challenge: varchar('challenge', { length: 255 }).primaryKey(),
    userId: varchar('user_id', { length: 255 }),
    purpose: varchar('purpose', { length: 32, enum: WEBAUTHN_CHALLENGE_PURPOSES }).notNull(),
    expiresAt: millis('expires_at').notNull(),
    createdAt: millis('created_at').notNull(),
  },
  (t) => [
    index('webauthn_challenges_user_idx').on(t.userId),
    index('webauthn_challenges_expires_idx').on(t.expiresAt),
  ],
)

export const apiKeys = mysqlTable(
  'api_keys',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    name: text('name').notNull(),
    keyHash: varchar('key_hash', { length: 255 }).notNull().unique(),
    role: varchar('role', { length: 32, enum: ROLES })
      .notNull()
      .default('viewer'),
    expiresAt: millis('expires_at'),
    lastUsedAt: millis('last_used_at'),
    revokedAt: millis('revoked_at'),
    createdAt: millis('created_at').notNull(),
  },
  (t) => [
    index('api_keys_hash_idx').on(t.keyHash),
    index('api_keys_expires_idx').on(t.expiresAt),
    index('api_keys_revoked_idx').on(t.revokedAt),
  ],
)

export const groups = mysqlTable('groups', {
  id: varchar('id', { length: 255 }).primaryKey(),
  key: varchar('key', { length: 255 }).notNull().unique(),
  name: text('name').notNull(),
  description: varchar('description', { length: 512 }).notNull().default(''),
  createdAt: millis('created_at').notNull(),
})

export const groupMemberships = mysqlTable(
  'group_memberships',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    userId: varchar('user_id', { length: 255 }).notNull(),
    groupId: varchar('group_id', { length: 255 }).notNull(),
    createdAt: millis('created_at').notNull(),
  },
  (t) => [index('group_memberships_user_idx').on(t.userId), index('group_memberships_group_idx').on(t.groupId)],
)

export const permissionGrants = mysqlTable(
  'permission_grants',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    subjectType: varchar('subject_type', { length: 32, enum: SUBJECT_TYPES }).notNull(),
    subjectId: varchar('subject_id', { length: 255 }),
    action: text('action').notNull(),
    effect: varchar('effect', { length: 32, enum: PERMISSION_EFFECTS }).notNull(),
    createdAt: millis('created_at').notNull(),
  },
  (t) => [index('permission_grants_subject_idx').on(t.subjectType, t.subjectId)],
)

export const pageRules = mysqlTable(
  'page_rules',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    subjectType: varchar('subject_type', { length: 32, enum: SUBJECT_TYPES }).notNull(),
    subjectId: varchar('subject_id', { length: 255 }),
    action: text('action').notNull(),
    effect: varchar('effect', { length: 32, enum: PERMISSION_EFFECTS }).notNull(),
    matcher: varchar('matcher', { length: 32, enum: PAGE_RULE_MATCHERS }).notNull(),
    pattern: varchar('pattern', { length: 255 }).notNull(),
    createdAt: millis('created_at').notNull(),
  },
  (t) => [index('page_rules_subject_idx').on(t.subjectType, t.subjectId), index('page_rules_pattern_idx').on(t.pattern)],
)

export const pages = mysqlTable(
  'pages',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    path: varchar('path', { length: 255 }).notNull().unique(),
    title: text('title').notNull(),
    description: varchar('description', { length: 512 }).notNull().default(''),
    icon: varchar('icon', { length: 512 }).notNull().default(''),
    coverUrl: varchar('cover_url', { length: 512 }).notNull().default(''),
    coverPosition: varchar('cover_position', { length: 512 }).notNull().default('center'),
    content: text('content').notNull(),
    renderedHtml: text('rendered_html').notNull(),
    toc: text('toc').notNull(),
    contentType: varchar('content_type', { length: 512 }).notNull().default('markdown'),
    lifecycle: varchar('lifecycle', { length: 32, enum: PAGE_LIFECYCLES })
      .notNull()
      .default('active'),
    status: varchar('status', { length: 32, enum: PAGE_STATUSES })
      .notNull()
      .default('draft'),
    labels: text('labels').notNull(),
    ownerId: text('owner_id'),
    reviewAt: millis('review_at'),
    publishAt: millis('publish_at'),
    navOrder: millis('nav_order'),
    pinned: boolean('pinned').notNull().default(false),
    spaceKey: varchar('space_key', { length: 512 }).notNull().default('main'),
    locale: varchar('locale', { length: 512 }).notNull().default('und'),
    authorId: text('author_id'),
    createdAt: millis('created_at').notNull(),
    updatedAt: millis('updated_at').notNull(),
  },
  (t) => [index('pages_updated_idx').on(t.updatedAt), index('pages_nav_idx').on(t.pinned, t.navOrder, t.path)],
)

export const pageRevisions = mysqlTable(
  'page_revisions',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    pageId: varchar('page_id', { length: 255 }).notNull(),
    path: text('path').notNull(),
    title: text('title').notNull(),
    description: varchar('description', { length: 512 }).notNull().default(''),
    content: text('content').notNull(),
    authorId: text('author_id'),
    action: varchar('action', { length: 32, enum: PAGE_REVISION_ACTIONS }).notNull(),
    createdAt: millis('created_at').notNull(),
  },
  (t) => [index('revisions_page_idx').on(t.pageId), index('revisions_created_idx').on(t.createdAt)],
)

export const pageComments = mysqlTable(
  'page_comments',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    pageId: varchar('page_id', { length: 255 }).notNull(),
    path: varchar('path', { length: 255 }).notNull(),
    body: text('body').notNull(),
    authorId: text('author_id'),
    resolvedAt: millis('resolved_at'),
    createdAt: millis('created_at').notNull(),
    updatedAt: millis('updated_at').notNull(),
  },
  (t) => [index('comments_page_idx').on(t.pageId), index('comments_path_idx').on(t.path)],
)

export const pageWatchers = mysqlTable(
  'page_watchers',
  {
    userId: varchar('user_id', { length: 255 }).notNull(),
    path: varchar('path', { length: 255 }).notNull(),
    createdAt: millis('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.path] }),
    index('page_watchers_path_idx').on(t.path),
  ],
)

export const notifications = mysqlTable(
  'notifications',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    userId: varchar('user_id', { length: 255 }).notNull(),
    kind: text('kind').notNull(),
    path: text('path'),
    message: text('message').notNull(),
    payload: text('payload').notNull(),
    readAt: millis('read_at'),
    createdAt: millis('created_at').notNull(),
  },
  (t) => [
    index('notifications_user_idx').on(t.userId, t.createdAt),
    index('notifications_unread_idx').on(t.userId, t.readAt),
  ],
)

export const pageAnalytics = mysqlTable('page_analytics', {
  path: varchar('path', { length: 255 }).primaryKey(),
  views: millis('views').notNull().default(0),
  lastViewedAt: millis('last_viewed_at'),
})

export const pageRedirects = mysqlTable('page_redirects', {
  fromPath: varchar('from_path', { length: 255 }).primaryKey(),
  toPath: text('to_path').notNull(),
  createdAt: millis('created_at').notNull(),
})

export const pageShares = mysqlTable(
  'page_shares',
  {
    token: varchar('token', { length: 255 }).primaryKey(),
    path: varchar('path', { length: 255 }).notNull(),
    createdBy: varchar('created_by', { length: 255 }).notNull(),
    expiresAt: millis('expires_at'),
    revokedAt: millis('revoked_at'),
    createdAt: millis('created_at').notNull(),
  },
  (t) => [index('page_shares_path_idx').on(t.path), index('page_shares_created_by_idx').on(t.createdBy)],
)

export const pageTemplates = mysqlTable(
  'page_templates',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    description: varchar('description', { length: 512 }).notNull().default(''),
    icon: varchar('icon', { length: 512 }).notNull().default(''),
    content: text('content').notNull(),
    metadata: text('metadata').notNull(),
    createdBy: text('created_by'),
    createdAt: millis('created_at').notNull(),
    updatedAt: millis('updated_at').notNull(),
  },
  (t) => [index('page_templates_name_idx').on(t.name), index('page_templates_updated_idx').on(t.updatedAt)],
)

export const siteSettings = mysqlTable('site_settings', {
  key: varchar('key', { length: 255 }).primaryKey(),
  value: text('value').notNull(),
  updatedAt: millis('updated_at').notNull(),
})

export const userPreferences = mysqlTable(
  'user_preferences',
  {
    userId: varchar('user_id', { length: 255 }).notNull(),
    key: varchar('key', { length: 255 }).notNull(),
    value: text('value').notNull(),
    updatedAt: millis('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.key] }),
    index('user_preferences_user_idx').on(t.userId),
  ],
)

export const linkPreviews = mysqlTable(
  'link_previews',
  {
    url: varchar('url', { length: 255 }).primaryKey(),
    kind: varchar('kind', { length: 32, enum: LINK_PREVIEW_KINDS }).notNull(),
    provider: varchar('provider', { length: 512 }).notNull().default(''),
    title: varchar('title', { length: 512 }).notNull().default(''),
    description: varchar('description', { length: 512 }).notNull().default(''),
    image: text('image'),
    author: text('author'),
    siteName: text('site_name'),
    contentType: text('content_type'),
    data: text('data').notNull(),
    fetchedAt: millis('fetched_at').notNull(),
    expiresAt: millis('expires_at').notNull(),
  },
  (t) => [index('link_previews_expires_idx').on(t.expiresAt), index('link_previews_kind_idx').on(t.kind)],
)

export const assets = mysqlTable('assets', {
  id: varchar('id', { length: 255 }).primaryKey(),
  filename: text('filename').notNull(),
  storageName: varchar('storage_name', { length: 512 }).notNull().default(''),
  folder: varchar('folder', { length: 512 }).notNull().default(''),
  mime: text('mime').notNull(),
  size: millis('size').notNull(),
  authorId: text('author_id'),
  createdAt: millis('created_at').notNull(),
  deletedAt: millis('deleted_at'),
})

export const pageAssetRefs = mysqlTable(
  'page_asset_refs',
  {
    pageId: varchar('page_id', { length: 255 }).notNull(),
    assetId: varchar('asset_id', { length: 255 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.pageId, t.assetId] }),
    index('page_asset_refs_asset_idx').on(t.assetId),
  ],
)

export const wikiEvents = mysqlTable(
  'wiki_events',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    sourceId: text('source_id').notNull(),
    eventType: varchar('event_type', { length: 32, enum: WIKI_EVENT_TYPES }).notNull(),
    action: varchar('action', { length: 32, enum: WIKI_EVENT_ACTIONS }).notNull(),
    path: text('path').notNull(),
    fromPath: text('from_path'),
    createdAt: millis('created_at').notNull(),
  },
  (t) => [index('wiki_events_id_idx').on(t.id)],
)

export const searchOutbox = mysqlTable(
  'search_outbox',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    pageId: varchar('page_id', { length: 255 }).notNull(),
    operation: varchar('operation', { length: 32, enum: SEARCH_OUTBOX_OPERATIONS }).notNull(),
    enqueuedAt: millis('enqueued_at').notNull(),
    attempts: millis('attempts').notNull().default(0),
    nextAttemptAt: millis('next_attempt_at').notNull(),
    lastError: text('last_error'),
  },
  (t) => [index('search_outbox_due_idx').on(t.nextAttemptAt)],
)

export const rateLimitHits = mysqlTable(
  'rate_limit_hits',
  {
    bucketKey: varchar('bucket_key', { length: 255 }).notNull(),
    hitAt: millis('hit_at').notNull(),
  },
  (t) => [
    index('rate_limit_hits_bucket_idx').on(t.bucketKey, t.hitAt),
    index('rate_limit_hits_time_idx').on(t.hitAt),
  ],
)

export const realtimeTickets = mysqlTable(
  'realtime_tickets',
  {
    ticket: varchar('ticket', { length: 255 }).primaryKey(),
    userId: text('user_id').notNull(),
    expiresAt: millis('expires_at').notNull(),
    createdAt: millis('created_at').notNull(),
  },
  (t) => [index('realtime_tickets_expires_idx').on(t.expiresAt)],
)

export const webhookSubscriptions = mysqlTable(
  'webhook_subscriptions',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    name: text('name').notNull(),
    targetUrl: text('target_url').notNull(),
    secret: text('secret').notNull(),
    eventTypes: text('event_types').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: millis('created_at').notNull(),
    updatedAt: millis('updated_at').notNull(),
  },
  (t) => [index('webhook_subscriptions_enabled_idx').on(t.enabled)],
)

export const webhookDeliveries = mysqlTable(
  'webhook_deliveries',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    subscriptionId: varchar('subscription_id', { length: 255 }).notNull(),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: text('payload').notNull(),
    status: varchar('status', { length: 32, enum: WEBHOOK_DELIVERY_STATUSES }).notNull().default('pending'),
    attempts: millis('attempts').notNull().default(0),
    nextAttemptAt: millis('next_attempt_at'),
    responseStatus: millis('response_status'),
    responseBody: text('response_body'),
    error: text('error'),
    createdAt: millis('created_at').notNull(),
    updatedAt: millis('updated_at').notNull(),
    deliveredAt: millis('delivered_at'),
  },
  (t) => [
    index('webhook_deliveries_subscription_idx').on(t.subscriptionId),
    index('webhook_deliveries_status_idx').on(t.status),
    index('webhook_deliveries_next_attempt_idx').on(t.nextAttemptAt),
  ],
)

export const automationRules = mysqlTable(
  'automation_rules',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    name: text('name').notNull(),
    type: varchar('type', { length: 32, enum: AUTOMATION_RULE_TYPES }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    priority: millis('priority').notNull().default(0),
    stopOnMatch: boolean('stop_on_match').notNull().default(false),
    config: text('config').notNull(),
    createdAt: millis('created_at').notNull(),
    updatedAt: millis('updated_at').notNull(),
  },
  (t) => [
    index('automation_rules_enabled_idx').on(t.enabled),
    index('automation_rules_type_idx').on(t.type),
    index('automation_rules_order_idx').on(t.enabled, t.priority, t.createdAt),
  ],
)

export const auditLog = mysqlTable(
  'audit_log',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    action: varchar('action', { length: 255 }).notNull(),
    userId: varchar('user_id', { length: 255 }),
    path: text('path'),
    data: text('data').notNull(),
    createdAt: millis('created_at').notNull(),
  },
  (t) => [
    index('audit_log_created_idx').on(t.createdAt),
    index('audit_log_action_idx').on(t.action),
    index('audit_log_user_idx').on(t.userId),
  ],
)
