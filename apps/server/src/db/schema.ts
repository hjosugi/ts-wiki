/**
 * Drizzle schema — the typed surface for database queries. Column types flow
 * from here into the services, out through Elysia routes, and via Eden Treaty
 * all the way into the Vue app, with no codegen step.
 *
 * NOTE: the actual DDL (including the FTS5 virtual table, which Drizzle can't
 * express) lives in ./migrate.ts. Every migration finishes by comparing these
 * column/index declarations with SQLite and fails loudly on drift.
 */
import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core'

export const schemaMigrations = sqliteTable('schema_migrations', {
  version: integer('version').primaryKey(),
  appliedAt: integer('applied_at').notNull(),
})

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'editor', 'viewer'] })
    .notNull()
    .default('viewer'),
  totpSecret: text('totp_secret'),
  totpEnabled: integer('totp_enabled').notNull().default(0),
  disabledAt: integer('disabled_at'),
  tokenInvalidBefore: integer('token_invalid_before').notNull().default(0),
  emailVerifiedAt: integer('email_verified_at'),
  profileBio: text('profile_bio').notNull().default(''),
  profileCoverUrl: text('profile_cover_url').notNull().default(''),
  profileLinks: text('profile_links').notNull().default('[]'),
  profileFavoritePages: text('profile_favorite_pages').notNull().default('[]'),
  createdAt: integer('created_at').notNull(),
})

export const authAccounts = sqliteTable(
  'auth_accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    provider: text('provider').notNull(),
    providerSubject: text('provider_subject').notNull(),
    email: text('email').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('auth_accounts_user_idx').on(t.userId), index('auth_accounts_provider_idx').on(t.provider, t.providerSubject)],
)

export const oauthStates = sqliteTable('oauth_states', {
  state: text('state').primaryKey(),
  provider: text('provider').notNull(),
  nonce: text('nonce').notNull(),
  codeVerifier: text('code_verifier').notNull(),
  redirectAfter: text('redirect_after'),
  expiresAt: integer('expires_at').notNull(),
  createdAt: integer('created_at').notNull(),
})

export const passwordResets = sqliteTable(
  'password_resets',
  {
    token: text('token').primaryKey(),
    userId: text('user_id').notNull(),
    expiresAt: integer('expires_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('password_resets_user_idx').on(t.userId), index('password_resets_expires_idx').on(t.expiresAt)],
)

export const emailVerifications = sqliteTable(
  'email_verifications',
  {
    token: text('token').primaryKey(),
    userId: text('user_id').notNull(),
    email: text('email').notNull(),
    expiresAt: integer('expires_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('email_verifications_user_idx').on(t.userId), index('email_verifications_expires_idx').on(t.expiresAt)],
)

export const passkeys = sqliteTable(
  'passkeys',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    publicKey: text('public_key').notNull(),
    counter: integer('counter').notNull().default(0),
    transports: text('transports').notNull().default('[]'),
    deviceType: text('device_type').notNull().default('unknown'),
    backedUp: integer('backed_up', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
    lastUsedAt: integer('last_used_at'),
  },
  (t) => [index('passkeys_user_idx').on(t.userId)],
)

export const totpRecoveryCodes = sqliteTable(
  'totp_recovery_codes',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    codeHash: text('code_hash').notNull(),
    createdAt: integer('created_at').notNull(),
    usedAt: integer('used_at'),
  },
  (t) => [
    index('totp_recovery_codes_user_idx').on(t.userId),
    index('totp_recovery_codes_used_idx').on(t.usedAt),
  ],
)

export const webauthnChallenges = sqliteTable(
  'webauthn_challenges',
  {
    challenge: text('challenge').primaryKey(),
    userId: text('user_id'),
    purpose: text('purpose', { enum: ['registration', 'authentication'] }).notNull(),
    expiresAt: integer('expires_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('webauthn_challenges_user_idx').on(t.userId),
    index('webauthn_challenges_expires_idx').on(t.expiresAt),
  ],
)

export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    role: text('role', { enum: ['admin', 'editor', 'viewer'] })
      .notNull()
      .default('viewer'),
    expiresAt: integer('expires_at'),
    lastUsedAt: integer('last_used_at'),
    revokedAt: integer('revoked_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('api_keys_hash_idx').on(t.keyHash),
    index('api_keys_expires_idx').on(t.expiresAt),
    index('api_keys_revoked_idx').on(t.revokedAt),
  ],
)

export const groups = sqliteTable('groups', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  createdAt: integer('created_at').notNull(),
})

export const groupMemberships = sqliteTable(
  'group_memberships',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    groupId: text('group_id').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('group_memberships_user_idx').on(t.userId), index('group_memberships_group_idx').on(t.groupId)],
)

export const permissionGrants = sqliteTable(
  'permission_grants',
  {
    id: text('id').primaryKey(),
    subjectType: text('subject_type', { enum: ['user', 'group', 'anonymous'] }).notNull(),
    subjectId: text('subject_id'),
    action: text('action').notNull(),
    effect: text('effect', { enum: ['allow', 'deny'] }).notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('permission_grants_subject_idx').on(t.subjectType, t.subjectId)],
)

export const pageRules = sqliteTable(
  'page_rules',
  {
    id: text('id').primaryKey(),
    subjectType: text('subject_type', { enum: ['user', 'group', 'anonymous'] }).notNull(),
    subjectId: text('subject_id'),
    action: text('action').notNull(),
    effect: text('effect', { enum: ['allow', 'deny'] }).notNull(),
    matcher: text('matcher', { enum: ['exact', 'prefix', 'suffix', 'regex'] }).notNull(),
    pattern: text('pattern').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('page_rules_subject_idx').on(t.subjectType, t.subjectId), index('page_rules_pattern_idx').on(t.pattern)],
)

export const pages = sqliteTable(
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
    lifecycle: text('lifecycle', { enum: ['active', 'archived', 'deleted'] })
      .notNull()
      .default('active'),
    status: text('status', { enum: ['draft', 'in-review', 'verified', 'outdated'] })
      .notNull()
      .default('draft'),
    labels: text('labels').notNull().default('[]'),
    ownerId: text('owner_id'),
    reviewAt: integer('review_at'),
    publishAt: integer('publish_at'),
    navOrder: integer('nav_order'),
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    spaceKey: text('space_key').notNull().default('main'),
    locale: text('locale').notNull().default('und'),
    authorId: text('author_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('pages_updated_idx').on(t.updatedAt), index('pages_nav_idx').on(t.pinned, t.navOrder, t.path)],
)

export const pageRevisions = sqliteTable(
  'page_revisions',
  {
    id: text('id').primaryKey(),
    pageId: text('page_id').notNull(),
    path: text('path').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    content: text('content').notNull().default(''),
    authorId: text('author_id'),
    action: text('action', { enum: ['created', 'updated', 'moved', 'deleted', 'archived', 'restored', 'purged'] }).notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('revisions_page_idx').on(t.pageId), index('revisions_created_idx').on(t.createdAt)],
)

export const pageComments = sqliteTable(
  'page_comments',
  {
    id: text('id').primaryKey(),
    pageId: text('page_id').notNull(),
    path: text('path').notNull(),
    body: text('body').notNull(),
    authorId: text('author_id'),
    resolvedAt: integer('resolved_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('comments_page_idx').on(t.pageId), index('comments_path_idx').on(t.path)],
)

export const pageWatchers = sqliteTable(
  'page_watchers',
  {
    userId: text('user_id').notNull(),
    path: text('path').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.path] }),
    index('page_watchers_path_idx').on(t.path),
  ],
)

export const notifications = sqliteTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    kind: text('kind').notNull(),
    path: text('path'),
    message: text('message').notNull(),
    payload: text('payload').notNull().default('{}'),
    readAt: integer('read_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('notifications_user_idx').on(t.userId, t.createdAt),
    index('notifications_unread_idx').on(t.userId, t.readAt),
  ],
)

export const pageAnalytics = sqliteTable('page_analytics', {
  path: text('path').primaryKey(),
  views: integer('views').notNull().default(0),
  lastViewedAt: integer('last_viewed_at'),
})

export const pageRedirects = sqliteTable('page_redirects', {
  fromPath: text('from_path').primaryKey(),
  toPath: text('to_path').notNull(),
  createdAt: integer('created_at').notNull(),
})

export const pageShares = sqliteTable(
  'page_shares',
  {
    token: text('token').primaryKey(),
    path: text('path').notNull(),
    createdBy: text('created_by').notNull(),
    expiresAt: integer('expires_at'),
    revokedAt: integer('revoked_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('page_shares_path_idx').on(t.path), index('page_shares_created_by_idx').on(t.createdBy)],
)

export const pageTemplates = sqliteTable(
  'page_templates',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    icon: text('icon').notNull().default(''),
    content: text('content').notNull().default(''),
    metadata: text('metadata').notNull().default('{}'),
    createdBy: text('created_by'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('page_templates_name_idx').on(t.name), index('page_templates_updated_idx').on(t.updatedAt)],
)

export const siteSettings = sqliteTable('site_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const userPreferences = sqliteTable(
  'user_preferences',
  {
    userId: text('user_id').notNull(),
    key: text('key').notNull(),
    value: text('value').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.key] }),
    index('user_preferences_user_idx').on(t.userId),
  ],
)

export const linkPreviews = sqliteTable(
  'link_previews',
  {
    url: text('url').primaryKey(),
    kind: text('kind', { enum: ['unfurl', 'youtube-latest'] }).notNull(),
    provider: text('provider').notNull().default(''),
    title: text('title').notNull().default(''),
    description: text('description').notNull().default(''),
    image: text('image'),
    author: text('author'),
    siteName: text('site_name'),
    contentType: text('content_type'),
    data: text('data').notNull().default('{}'),
    fetchedAt: integer('fetched_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [index('link_previews_expires_idx').on(t.expiresAt), index('link_previews_kind_idx').on(t.kind)],
)

export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(),
  filename: text('filename').notNull(),
  storageName: text('storage_name').notNull().default(''),
  folder: text('folder').notNull().default(''),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  authorId: text('author_id'),
  createdAt: integer('created_at').notNull(),
  deletedAt: integer('deleted_at'),
})

export const pageAssetRefs = sqliteTable(
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

export const wikiEvents = sqliteTable(
  'wiki_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceId: text('source_id').notNull(),
    eventType: text('event_type', { enum: ['page:changed'] }).notNull(),
    action: text('action', { enum: ['created', 'updated', 'moved', 'deleted'] }).notNull(),
    path: text('path').notNull(),
    fromPath: text('from_path'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('wiki_events_id_idx').on(t.id)],
)

export const rateLimitHits = sqliteTable(
  'rate_limit_hits',
  {
    bucketKey: text('bucket_key').notNull(),
    hitAt: integer('hit_at').notNull(),
  },
  (t) => [
    index('rate_limit_hits_bucket_idx').on(t.bucketKey, t.hitAt),
    index('rate_limit_hits_time_idx').on(t.hitAt),
  ],
)

export const realtimeTickets = sqliteTable(
  'realtime_tickets',
  {
    ticket: text('ticket').primaryKey(),
    userId: text('user_id').notNull(),
    expiresAt: integer('expires_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('realtime_tickets_expires_idx').on(t.expiresAt)],
)

export const webhookSubscriptions = sqliteTable(
  'webhook_subscriptions',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    targetUrl: text('target_url').notNull(),
    secret: text('secret').notNull(),
    eventTypes: text('event_types').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('webhook_subscriptions_enabled_idx').on(t.enabled)],
)

export const webhookDeliveries = sqliteTable(
  'webhook_deliveries',
  {
    id: text('id').primaryKey(),
    subscriptionId: text('subscription_id').notNull(),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: text('payload').notNull(),
    status: text('status', { enum: ['pending', 'succeeded', 'failed'] }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: integer('next_attempt_at'),
    responseStatus: integer('response_status'),
    responseBody: text('response_body'),
    error: text('error'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deliveredAt: integer('delivered_at'),
  },
  (t) => [
    index('webhook_deliveries_subscription_idx').on(t.subscriptionId),
    index('webhook_deliveries_status_idx').on(t.status),
    index('webhook_deliveries_next_attempt_idx').on(t.nextAttemptAt),
  ],
)

export const automationRules = sqliteTable(
  'automation_rules',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    type: text('type', { enum: ['event-rule', 'page-updated-metadata'] }).notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    priority: integer('priority').notNull().default(0),
    stopOnMatch: integer('stop_on_match', { mode: 'boolean' }).notNull().default(false),
    config: text('config').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('automation_rules_enabled_idx').on(t.enabled),
    index('automation_rules_type_idx').on(t.type),
    index('automation_rules_order_idx').on(t.enabled, t.priority, t.createdAt),
  ],
)

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    action: text('action').notNull(),
    userId: text('user_id'),
    path: text('path'),
    data: text('data').notNull().default('{}'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('audit_log_created_idx').on(t.createdAt),
    index('audit_log_action_idx').on(t.action),
    index('audit_log_user_idx').on(t.userId),
  ],
)

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type AuthAccount = typeof authAccounts.$inferSelect
export type OAuthState = typeof oauthStates.$inferSelect
export type PasswordReset = typeof passwordResets.$inferSelect
export type EmailVerification = typeof emailVerifications.$inferSelect
export type Passkey = typeof passkeys.$inferSelect
export type TotpRecoveryCode = typeof totpRecoveryCodes.$inferSelect
export type WebauthnChallenge = typeof webauthnChallenges.$inferSelect
export type ApiKey = typeof apiKeys.$inferSelect
export type Group = typeof groups.$inferSelect
export type GroupMembership = typeof groupMemberships.$inferSelect
export type PermissionGrantRow = typeof permissionGrants.$inferSelect
export type PageRuleRow = typeof pageRules.$inferSelect
export type Page = typeof pages.$inferSelect
export type NewPage = typeof pages.$inferInsert
export type PageRevision = typeof pageRevisions.$inferSelect
export type PageComment = typeof pageComments.$inferSelect
export type PageAnalytics = typeof pageAnalytics.$inferSelect
export type PageRedirect = typeof pageRedirects.$inferSelect
export type PageShare = typeof pageShares.$inferSelect
export type PageTemplate = typeof pageTemplates.$inferSelect
export type SiteSetting = typeof siteSettings.$inferSelect
export type UserPreference = typeof userPreferences.$inferSelect
export type LinkPreviewRow = typeof linkPreviews.$inferSelect
export type Asset = typeof assets.$inferSelect
export type WikiEventRow = typeof wikiEvents.$inferSelect
export type RateLimitHit = typeof rateLimitHits.$inferSelect
export type RealtimeTicket = typeof realtimeTickets.$inferSelect
export type WebhookSubscription = typeof webhookSubscriptions.$inferSelect
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect
export type AutomationRule = typeof automationRules.$inferSelect
export type AuditLogRow = typeof auditLog.$inferSelect
