/**
 * Drizzle schema — the typed surface for database queries. Column types flow
 * from here into the services, out through Elysia routes, and via Eden Treaty
 * all the way into the Vue app, with no codegen step.
 *
 * NOTE: the actual DDL (including the FTS5 virtual table, which Drizzle can't
 * express) lives in ./migrate.ts and is kept in sync with these definitions.
 */
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

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
    spaceKey: text('space_key').notNull().default('main'),
    locale: text('locale').notNull().default('und'),
    authorId: text('author_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('pages_updated_idx').on(t.updatedAt)],
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
  (t) => [index('revisions_page_idx').on(t.pageId)],
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

export const pageAnalytics = sqliteTable('page_analytics', {
  path: text('path').primaryKey(),
  views: integer('views').notNull().default(0),
  lastViewedAt: integer('last_viewed_at'),
})

export const siteSettings = sqliteTable('site_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(),
  filename: text('filename').notNull(),
  storageName: text('storage_name').notNull().default(''),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  authorId: text('author_id'),
  createdAt: integer('created_at').notNull(),
})

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
    type: text('type', { enum: ['page-updated-metadata'] }).notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    config: text('config').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('automation_rules_enabled_idx').on(t.enabled), index('automation_rules_type_idx').on(t.type)],
)

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type AuthAccount = typeof authAccounts.$inferSelect
export type OAuthState = typeof oauthStates.$inferSelect
export type Passkey = typeof passkeys.$inferSelect
export type WebauthnChallenge = typeof webauthnChallenges.$inferSelect
export type Group = typeof groups.$inferSelect
export type GroupMembership = typeof groupMemberships.$inferSelect
export type PermissionGrantRow = typeof permissionGrants.$inferSelect
export type PageRuleRow = typeof pageRules.$inferSelect
export type Page = typeof pages.$inferSelect
export type NewPage = typeof pages.$inferInsert
export type PageRevision = typeof pageRevisions.$inferSelect
export type PageComment = typeof pageComments.$inferSelect
export type PageAnalytics = typeof pageAnalytics.$inferSelect
export type SiteSetting = typeof siteSettings.$inferSelect
export type Asset = typeof assets.$inferSelect
export type WebhookSubscription = typeof webhookSubscriptions.$inferSelect
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect
export type AutomationRule = typeof automationRules.$inferSelect
