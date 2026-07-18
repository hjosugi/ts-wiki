/**
 * PostgreSQL schema — the pg-core mirror of the canonical SQLite schema
 * (`../schema.ts`), used by the PostgreSQL repository implementations (#364).
 *
 * Storage conventions are chosen so the data semantics match SQLite exactly and
 * the driver-neutral contract tests behave identically:
 *   - SQLite `integer` epoch-millis / counters -> `bigint` (`mode: 'number'`),
 *     which Drizzle reads/writes as JS numbers (safe below 2^53).
 *   - SQLite `integer({ mode: 'boolean' })` -> native `boolean` (both dialects
 *     surface JS booleans to the repositories).
 *   - SQLite autoincrement integer primary keys -> `bigserial`.
 *   - `text({ enum })` stays plain `text` with a TS-level enum, matching
 *     SQLite's app-enforced (not DB-enforced) enums.
 *
 * The DDL is generated from these declarations by `./migrate.ts`; a parity test
 * fails loudly on drift. Full-text search (SQLite FTS5 -> Postgres tsvector) is
 * intentionally NOT here yet — it lands in a later search slice (#364 / #366).
 */
import { pgTable, text, bigint, boolean, bigserial, index, primaryKey } from 'drizzle-orm/pg-core'
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
} from '../schema-enums'

/** SQLite epoch-millis / counter integers map to bigint read as a JS number. */
const millis = (name: string) => bigint(name, { mode: 'number' })

export const schemaMigrations = pgTable('schema_migrations', {
  version: millis('version').primaryKey(),
  appliedAt: millis('applied_at').notNull(),
})

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ROLES })
    .notNull()
    .default('viewer'),
  totpSecret: text('totp_secret'),
  totpEnabled: millis('totp_enabled').notNull().default(0),
  disabledAt: millis('disabled_at'),
  tokenInvalidBefore: millis('token_invalid_before').notNull().default(0),
  emailVerifiedAt: millis('email_verified_at'),
  profileBio: text('profile_bio').notNull().default(''),
  profileCoverUrl: text('profile_cover_url').notNull().default(''),
  profileLinks: text('profile_links').notNull().default('[]'),
  profileFavoritePages: text('profile_favorite_pages').notNull().default('[]'),
  createdAt: millis('created_at').notNull(),
})

export const authAccounts = pgTable(
  'auth_accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    provider: text('provider').notNull(),
    providerSubject: text('provider_subject').notNull(),
    email: text('email').notNull(),
    createdAt: millis('created_at').notNull(),
    updatedAt: millis('updated_at').notNull(),
  },
  (t) => [index('auth_accounts_user_idx').on(t.userId), index('auth_accounts_provider_idx').on(t.provider, t.providerSubject)],
)

export const oauthStates = pgTable('oauth_states', {
  state: text('state').primaryKey(),
  provider: text('provider').notNull(),
  nonce: text('nonce').notNull(),
  codeVerifier: text('code_verifier').notNull(),
  redirectAfter: text('redirect_after'),
  expiresAt: millis('expires_at').notNull(),
  createdAt: millis('created_at').notNull(),
})

export const passwordResets = pgTable(
  'password_resets',
  {
    token: text('token').primaryKey(),
    userId: text('user_id').notNull(),
    expiresAt: millis('expires_at').notNull(),
    createdAt: millis('created_at').notNull(),
  },
  (t) => [index('password_resets_user_idx').on(t.userId), index('password_resets_expires_idx').on(t.expiresAt)],
)

export const emailVerifications = pgTable(
  'email_verifications',
  {
    token: text('token').primaryKey(),
    userId: text('user_id').notNull(),
    email: text('email').notNull(),
    expiresAt: millis('expires_at').notNull(),
    createdAt: millis('created_at').notNull(),
  },
  (t) => [index('email_verifications_user_idx').on(t.userId), index('email_verifications_expires_idx').on(t.expiresAt)],
)

export const passkeys = pgTable(
  'passkeys',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    publicKey: text('public_key').notNull(),
    counter: millis('counter').notNull().default(0),
    transports: text('transports').notNull().default('[]'),
    deviceType: text('device_type').notNull().default('unknown'),
    backedUp: boolean('backed_up').notNull().default(false),
    createdAt: millis('created_at').notNull(),
    lastUsedAt: millis('last_used_at'),
  },
  (t) => [index('passkeys_user_idx').on(t.userId)],
)

export const totpRecoveryCodes = pgTable(
  'totp_recovery_codes',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    codeHash: text('code_hash').notNull(),
    createdAt: millis('created_at').notNull(),
    usedAt: millis('used_at'),
  },
  (t) => [
    index('totp_recovery_codes_user_idx').on(t.userId),
    index('totp_recovery_codes_used_idx').on(t.usedAt),
  ],
)

export const webauthnChallenges = pgTable(
  'webauthn_challenges',
  {
    challenge: text('challenge').primaryKey(),
    userId: text('user_id'),
    purpose: text('purpose', { enum: WEBAUTHN_CHALLENGE_PURPOSES }).notNull(),
    expiresAt: millis('expires_at').notNull(),
    createdAt: millis('created_at').notNull(),
  },
  (t) => [
    index('webauthn_challenges_user_idx').on(t.userId),
    index('webauthn_challenges_expires_idx').on(t.expiresAt),
  ],
)

export const apiKeys = pgTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    role: text('role', { enum: ROLES })
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

export const groups = pgTable('groups', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  createdAt: millis('created_at').notNull(),
})

export const groupMemberships = pgTable(
  'group_memberships',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    groupId: text('group_id').notNull(),
    createdAt: millis('created_at').notNull(),
  },
  (t) => [index('group_memberships_user_idx').on(t.userId), index('group_memberships_group_idx').on(t.groupId)],
)

export const permissionGrants = pgTable(
  'permission_grants',
  {
    id: text('id').primaryKey(),
    subjectType: text('subject_type', { enum: SUBJECT_TYPES }).notNull(),
    subjectId: text('subject_id'),
    action: text('action').notNull(),
    effect: text('effect', { enum: PERMISSION_EFFECTS }).notNull(),
    createdAt: millis('created_at').notNull(),
  },
  (t) => [index('permission_grants_subject_idx').on(t.subjectType, t.subjectId)],
)

export const pageRules = pgTable(
  'page_rules',
  {
    id: text('id').primaryKey(),
    subjectType: text('subject_type', { enum: SUBJECT_TYPES }).notNull(),
    subjectId: text('subject_id'),
    action: text('action').notNull(),
    effect: text('effect', { enum: PERMISSION_EFFECTS }).notNull(),
    matcher: text('matcher', { enum: PAGE_RULE_MATCHERS }).notNull(),
    pattern: text('pattern').notNull(),
    createdAt: millis('created_at').notNull(),
  },
  (t) => [index('page_rules_subject_idx').on(t.subjectType, t.subjectId), index('page_rules_pattern_idx').on(t.pattern)],
)

export const pages = pgTable(
  'pages',
  {
    id: text('id').primaryKey(),
    path: text('path').notNull().unique(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    icon: text('icon').notNull().default(''),
    coverUrl: text('cover_url').notNull().default(''),
    coverPosition: text('cover_position').notNull().default('center'),
    content: text('content').notNull().default(''),
    renderedHtml: text('rendered_html').notNull().default(''),
    toc: text('toc').notNull().default('[]'),
    contentType: text('content_type').notNull().default('markdown'),
    lifecycle: text('lifecycle', { enum: PAGE_LIFECYCLES })
      .notNull()
      .default('active'),
    status: text('status', { enum: PAGE_STATUSES })
      .notNull()
      .default('draft'),
    labels: text('labels').notNull().default('[]'),
    ownerId: text('owner_id'),
    reviewAt: millis('review_at'),
    publishAt: millis('publish_at'),
    navOrder: millis('nav_order'),
    pinned: boolean('pinned').notNull().default(false),
    spaceKey: text('space_key').notNull().default('main'),
    locale: text('locale').notNull().default('und'),
    authorId: text('author_id'),
    createdAt: millis('created_at').notNull(),
    updatedAt: millis('updated_at').notNull(),
  },
  (t) => [index('pages_updated_idx').on(t.updatedAt), index('pages_nav_idx').on(t.pinned, t.navOrder, t.path)],
)

export const pageRevisions = pgTable(
  'page_revisions',
  {
    id: text('id').primaryKey(),
    pageId: text('page_id').notNull(),
    path: text('path').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    content: text('content').notNull().default(''),
    authorId: text('author_id'),
    action: text('action', { enum: PAGE_REVISION_ACTIONS }).notNull(),
    createdAt: millis('created_at').notNull(),
  },
  (t) => [index('revisions_page_idx').on(t.pageId), index('revisions_created_idx').on(t.createdAt)],
)

export const pageComments = pgTable(
  'page_comments',
  {
    id: text('id').primaryKey(),
    pageId: text('page_id').notNull(),
    path: text('path').notNull(),
    body: text('body').notNull(),
    authorId: text('author_id'),
    resolvedAt: millis('resolved_at'),
    createdAt: millis('created_at').notNull(),
    updatedAt: millis('updated_at').notNull(),
  },
  (t) => [index('comments_page_idx').on(t.pageId), index('comments_path_idx').on(t.path)],
)

export const pageWatchers = pgTable(
  'page_watchers',
  {
    userId: text('user_id').notNull(),
    path: text('path').notNull(),
    createdAt: millis('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.path] }),
    index('page_watchers_path_idx').on(t.path),
  ],
)

export const notifications = pgTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    kind: text('kind').notNull(),
    path: text('path'),
    message: text('message').notNull(),
    payload: text('payload').notNull().default('{}'),
    readAt: millis('read_at'),
    createdAt: millis('created_at').notNull(),
  },
  (t) => [
    index('notifications_user_idx').on(t.userId, t.createdAt),
    index('notifications_unread_idx').on(t.userId, t.readAt),
  ],
)

export const pageAnalytics = pgTable('page_analytics', {
  path: text('path').primaryKey(),
  views: millis('views').notNull().default(0),
  lastViewedAt: millis('last_viewed_at'),
})

export const pageRedirects = pgTable('page_redirects', {
  fromPath: text('from_path').primaryKey(),
  toPath: text('to_path').notNull(),
  createdAt: millis('created_at').notNull(),
})

export const pageShares = pgTable(
  'page_shares',
  {
    token: text('token').primaryKey(),
    path: text('path').notNull(),
    createdBy: text('created_by').notNull(),
    expiresAt: millis('expires_at'),
    revokedAt: millis('revoked_at'),
    createdAt: millis('created_at').notNull(),
  },
  (t) => [index('page_shares_path_idx').on(t.path), index('page_shares_created_by_idx').on(t.createdBy)],
)

export const pageTemplates = pgTable(
  'page_templates',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    icon: text('icon').notNull().default(''),
    content: text('content').notNull().default(''),
    metadata: text('metadata').notNull().default('{}'),
    createdBy: text('created_by'),
    createdAt: millis('created_at').notNull(),
    updatedAt: millis('updated_at').notNull(),
  },
  (t) => [index('page_templates_name_idx').on(t.name), index('page_templates_updated_idx').on(t.updatedAt)],
)

export const siteSettings = pgTable('site_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: millis('updated_at').notNull(),
})

export const userPreferences = pgTable(
  'user_preferences',
  {
    userId: text('user_id').notNull(),
    key: text('key').notNull(),
    value: text('value').notNull(),
    updatedAt: millis('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.key] }),
    index('user_preferences_user_idx').on(t.userId),
  ],
)

export const linkPreviews = pgTable(
  'link_previews',
  {
    url: text('url').primaryKey(),
    kind: text('kind', { enum: LINK_PREVIEW_KINDS }).notNull(),
    provider: text('provider').notNull().default(''),
    title: text('title').notNull().default(''),
    description: text('description').notNull().default(''),
    image: text('image'),
    author: text('author'),
    siteName: text('site_name'),
    contentType: text('content_type'),
    data: text('data').notNull().default('{}'),
    fetchedAt: millis('fetched_at').notNull(),
    expiresAt: millis('expires_at').notNull(),
  },
  (t) => [index('link_previews_expires_idx').on(t.expiresAt), index('link_previews_kind_idx').on(t.kind)],
)

export const assets = pgTable('assets', {
  id: text('id').primaryKey(),
  filename: text('filename').notNull(),
  storageName: text('storage_name').notNull().default(''),
  folder: text('folder').notNull().default(''),
  mime: text('mime').notNull(),
  size: millis('size').notNull(),
  authorId: text('author_id'),
  createdAt: millis('created_at').notNull(),
  deletedAt: millis('deleted_at'),
})

export const pageAssetRefs = pgTable(
  'page_asset_refs',
  {
    pageId: text('page_id').notNull(),
    assetId: text('asset_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.pageId, t.assetId] }),
    index('page_asset_refs_asset_idx').on(t.assetId),
  ],
)

export const wikiEvents = pgTable(
  'wiki_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sourceId: text('source_id').notNull(),
    eventType: text('event_type', { enum: WIKI_EVENT_TYPES }).notNull(),
    action: text('action', { enum: WIKI_EVENT_ACTIONS }).notNull(),
    path: text('path').notNull(),
    fromPath: text('from_path'),
    createdAt: millis('created_at').notNull(),
  },
  (t) => [index('wiki_events_id_idx').on(t.id)],
)

export const rateLimitHits = pgTable(
  'rate_limit_hits',
  {
    bucketKey: text('bucket_key').notNull(),
    hitAt: millis('hit_at').notNull(),
  },
  (t) => [
    index('rate_limit_hits_bucket_idx').on(t.bucketKey, t.hitAt),
    index('rate_limit_hits_time_idx').on(t.hitAt),
  ],
)

export const realtimeTickets = pgTable(
  'realtime_tickets',
  {
    ticket: text('ticket').primaryKey(),
    userId: text('user_id').notNull(),
    expiresAt: millis('expires_at').notNull(),
    createdAt: millis('created_at').notNull(),
  },
  (t) => [index('realtime_tickets_expires_idx').on(t.expiresAt)],
)

export const webhookSubscriptions = pgTable(
  'webhook_subscriptions',
  {
    id: text('id').primaryKey(),
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

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: text('id').primaryKey(),
    subscriptionId: text('subscription_id').notNull(),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: text('payload').notNull(),
    status: text('status', { enum: WEBHOOK_DELIVERY_STATUSES }).notNull().default('pending'),
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

export const automationRules = pgTable(
  'automation_rules',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    type: text('type', { enum: AUTOMATION_RULE_TYPES }).notNull(),
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

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    action: text('action').notNull(),
    userId: text('user_id'),
    path: text('path'),
    data: text('data').notNull().default('{}'),
    createdAt: millis('created_at').notNull(),
  },
  (t) => [
    index('audit_log_created_idx').on(t.createdAt),
    index('audit_log_action_idx').on(t.action),
    index('audit_log_user_idx').on(t.userId),
  ],
)
