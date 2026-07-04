/**
 * Typed API client via Eden Treaty. The `App` type comes straight from the
 * server with no codegen, so every *request* below — path, query, and body —
 * is checked against the real routes. Change a route signature and this file
 * stops compiling.
 *
 * Note on response typing: because the server uses a global `onError` that
 * returns a JSON body, Elysia unions that error shape into each route's success
 * type. Rather than narrow that union at every call site, we state the expected
 * success shape once per method via `call<T>()` and unwrap Eden's envelope here.
 */
import { treaty } from '@elysiajs/eden'
import type { App } from '@ts-wiki/server/app'
import type { Action, ExtractedCalendarEvent } from '@ts-wiki/core'
import { API_BASE_URL } from './url'

const memoryStorage = new Map<string, string>()
const browserStorage = typeof window === 'undefined' ? undefined : window.localStorage
const tokenStorage = !browserStorage
  ? {
      getItem: (key: string): string | null => memoryStorage.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        memoryStorage.set(key, value)
      },
      removeItem: (key: string): void => {
        memoryStorage.delete(key)
      },
    }
  : browserStorage

let authToken: string | null = tokenStorage.getItem('token')

export const getToken = (): string | null => authToken
export const setToken = (token: string | null): void => {
  authToken = token
  if (token) tokenStorage.setItem('token', token)
  else tokenStorage.removeItem('token')
}

/** A fresh treaty instance per call so the current token is always attached. */
const client = () =>
  treaty<App>(API_BASE_URL, {
    headers: authToken ? { authorization: `Bearer ${authToken}` } : {},
  })

const messageOf = (error: unknown): string => {
  const e = error as
    | { value?: { error?: { message?: string }; message?: string }; status?: number }
    | null
    | undefined
  return e?.value?.error?.message ?? e?.value?.message ?? `Request failed (${e?.status ?? '?'})`
}

/** Await an Eden call, throw on error, and return the (asserted) success body. */
const call = async <T>(promise: Promise<{ data: unknown; error: unknown }>): Promise<T> => {
  const res = await promise
  if (res.error) throw new Error(messageOf(res.error))
  return res.data as T
}

// ── Domain types (the shapes the server returns) ─────────────────────────────
export interface PublicUser {
  id: string
  email: string
  name: string
  role: 'admin' | 'editor' | 'viewer'
  totpEnabled: boolean
}
export interface PublicAuthProvider {
  id: string
  label: string
  type: 'oidc'
}
export interface PasskeyView {
  id: string
  name: string
  deviceType: string
  backedUp: boolean
  transports: string[]
  createdAt: number
  lastUsedAt: number | null
}
export interface Page {
  id: string
  path: string
  title: string
  description: string
  content: string
  renderedHtml: string
  toc: string
  contentType: string
  lifecycle: 'active' | 'archived' | 'deleted'
  status: 'draft' | 'in-review' | 'verified' | 'outdated'
  labels: string
  ownerId: string | null
  reviewAt: number | null
  spaceKey: string
  locale: string
  authorId: string | null
  createdAt: number
  updatedAt: number
}
export interface PageLookup {
  page: Page
  redirectedFrom: string[]
}
export interface PageSummary {
  path: string
  title: string
  description: string
  lifecycle: 'active' | 'archived' | 'deleted'
  status: 'draft' | 'in-review' | 'verified' | 'outdated'
  labels: string
  ownerId: string | null
  reviewAt: number | null
  spaceKey: string
  locale: string
  updatedAt: number
}
export interface PageSpace {
  key: string
  pages: number
  updatedAt: number
}
export interface SearchHit {
  path: string
  title: string
  snippet: string
  rank: number
}
export interface PageGraphNode {
  path: string
  title: string
  kind: 'page' | 'missing'
}
export interface PageGraphEdge {
  source: string
  target: string
  kind: 'wikilink' | 'markdown'
}
export interface PageGraph {
  nodes: PageGraphNode[]
  edges: PageGraphEdge[]
}
export interface PageBacklink {
  path: string
  title: string
  label: string
  kind: 'wikilink' | 'markdown'
}
export interface PageRevision {
  id: string
  path: string
  title: string
  description: string
  content: string
  authorId: string | null
  action: 'created' | 'updated' | 'moved' | 'deleted' | 'archived' | 'restored' | 'purged'
  createdAt: number
}
export interface AssetUpload {
  id: string
  filename: string
  url: string
}
export interface AssetView {
  id: string
  filename: string
  storageName: string
  mime: string
  size: number
  authorId: string | null
  createdAt: number
  url: string
}
export interface PageComment {
  id: string
  path: string
  body: string
  authorId: string | null
  mentions: string[]
  resolvedAt: number | null
  createdAt: number
  updatedAt: number
}
export interface AdminUserView {
  id: string
  email: string
  name: string
  role: 'admin' | 'editor' | 'viewer'
  groups: string[]
  disabledAt: number | null
  tokenInvalidBefore: number
  createdAt: number
}
export interface AdminStats {
  users: number
  pages: number
  revisions: number
}
export interface AuthzGroupView {
  id: string
  key: string
  name: string
  description: string
  members: number
  createdAt: number
}
export interface PageRuleView {
  id: string
  subjectType: 'user' | 'group' | 'anonymous'
  subjectId: string | null
  action: Action
  effect: 'allow' | 'deny'
  matcher: 'exact' | 'prefix' | 'suffix' | 'regex'
  pattern: string
  createdAt: number
}
export interface WebhookSubscriptionView {
  id: string
  name: string
  targetUrl: string
  eventTypes: string[]
  enabled: boolean
  createdAt: number
  updatedAt: number
}
export interface WebhookDeliveryView {
  id: string
  subscriptionId: string
  subscriptionName: string | null
  eventId: string
  eventType: string
  status: 'pending' | 'succeeded' | 'failed'
  attempts: number
  nextAttemptAt: number | null
  responseStatus: number | null
  responseBody: string | null
  error: string | null
  createdAt: number
  updatedAt: number
  deliveredAt: number | null
}
export interface AutomationRuleView {
  id: string
  name: string
  type: 'page-updated-metadata'
  enabled: boolean
  config: {
    pathPrefix: string
    label?: string
    status?: Page['status']
  }
  createdAt: number
  updatedAt: number
}
export interface AnalyticsSummary {
  totalViews: number
  topPages: Array<{ path: string; views: number; lastViewedAt: number | null }>
}
export interface PublicSettings {
  siteTitle: string
  accentColor: string
  theme: 'system' | 'light' | 'dark'
  navLinks: Array<{ label: string; url: string }>
  privateWiki: boolean
  registration: 'open' | 'off'
}
interface AuthResult {
  token: string
  user: PublicUser
}

export const Api = {
  health: () => call<{ ok: true; name: string; version: string }>(client().api.health.get()),
  publicSettings: () => call<PublicSettings>(client().api.settings.public.get()),

  // Auth
  register: (body: { email: string; name: string; password: string }) =>
    call<AuthResult>(client().api.auth.register.post(body)),
  login: (body: { email: string; password: string; totpCode?: string }) =>
    call<AuthResult>(client().api.auth.login.post(body)),
  me: () => call<{ user: PublicUser }>(client().api.auth.me.get()).then((d) => d.user),
  updateProfile: (body: { name?: string }) =>
    call<{ user: PublicUser }>(client().api.auth.profile.put(body)).then((d) => d.user),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    call<{ user: PublicUser }>(client().api.auth.password.put(body)).then((d) => d.user),
  authProviders: () =>
    call<{ providers: PublicAuthProvider[] }>(client().api.auth.providers.get()).then((d) => d.providers),
  totpSetup: () =>
    call<{ secret: string; otpauthUrl: string }>(client().api.auth.totp.setup.post()),
  totpEnable: (code: string) =>
    call<{ user: PublicUser }>(client().api.auth.totp.enable.post({ code })).then((d) => d.user),
  totpDisable: (code?: string) =>
    call<{ user: PublicUser }>(client().api.auth.totp.disable.post({ code })).then((d) => d.user),
  passkeys: () =>
    call<{ passkeys: PasskeyView[] }>(client().api.auth.passkeys.get()).then((d) => d.passkeys),
  passkeyRegistrationOptions: () =>
    call<{ options: unknown }>(client().api.auth.passkeys.register.options.post()).then((d) => d.options),
  passkeyVerifyRegistration: (response: unknown, name?: string) =>
    call<{ passkey: PasskeyView }>(client().api.auth.passkeys.register.verify.post({ response, name })).then((d) => d.passkey),
  passkeyDelete: (id: string) =>
    call<{ id: string }>(client().api.auth.passkeys({ id }).delete()),
  passkeyLoginOptions: (email?: string) =>
    call<{ options: unknown }>(client().api.auth.passkeys.login.options.post({ email })).then((d) => d.options),
  passkeyLoginVerify: (response: unknown) =>
    call<AuthResult & { passkey: PasskeyView }>(client().api.auth.passkeys.login.verify.post({ response })),

  // Pages
  listPages: () => call<{ pages: PageSummary[] }>(client().api.pages.get()).then((d) => d.pages),
  trashPages: () => call<{ pages: PageSummary[] }>(client().api.pages.trash.get()).then((d) => d.pages),
  getPageResult: (path: string) =>
    call<PageLookup>(client().api.page.get({ query: { path } })),
  getPage: (path: string) =>
    Api.getPageResult(path).then((d) => d.page),
  createPage: (body: {
    path: string
    title: string
    content: string
    description?: string
    labels?: string[]
    status?: Page['status']
    ownerId?: string | null
    reviewAt?: number | null
    locale?: string | null
  }) =>
    call<{ page: Page }>(client().api.pages.post(body)).then((d) => d.page),
  updatePage: (path: string, body: {
    title?: string
    content?: string
    description?: string
    labels?: string[]
    status?: Page['status']
    ownerId?: string | null
    reviewAt?: number | null
    locale?: string | null
    expectedUpdatedAt?: number | null
  }) =>
    call<{ page: Page }>(client().api.page.put(body, { query: { path } })).then((d) => d.page),
  restoreRevision: (path: string, revisionId: string) =>
    call<{ page: Page }>(client().api.page['restore-revision'].post({ path, revisionId })).then((d) => d.page),
  archivePage: (path: string) =>
    call<{ page: Page }>(client().api.page.archive.post({ path })).then((d) => d.page),
  restorePage: (path: string) =>
    call<{ page: Page }>(client().api.page.restore.post({ path })).then((d) => d.page),
  purgePage: (path: string) =>
    call<{ path: string }>(client().api.page.purge.delete(null, { query: { path } })),
  movePage: (oldPath: string, newPath: string) =>
    call<{ page: Page }>(client().api.page.move.post({ oldPath, newPath })).then((d) => d.page),
  deletePage: (path: string) =>
    call<{ path: string }>(client().api.page.delete(null, { query: { path } })),
  graph: () => call<PageGraph>(client().api.graph.get()),
  spaces: () => call<{ spaces: PageSpace[] }>(client().api.spaces.get()).then((d) => d.spaces),
  events: () =>
    call<{ events: ExtractedCalendarEvent[] }>(client().api.events.index.get()).then((d) => d.events),
  backlinks: (path: string) =>
    call<{ backlinks: PageBacklink[] }>(client().api.page.backlinks.get({ query: { path } })).then(
      (d) => d.backlinks,
    ),
  history: (path: string) =>
    call<{ revisions: PageRevision[] }>(client().api.page.history.get({ query: { path } })).then(
      (d) => d.revisions,
    ),
  comments: (path: string) =>
    call<{ comments: PageComment[] }>(client().api.page.comments.get({ query: { path } })).then(
      (d) => d.comments,
    ),
  createComment: (path: string, body: string) =>
    call<{ comment: PageComment }>(client().api.page.comments.post({ path, body })).then(
      (d) => d.comment,
    ),
  updateComment: (id: string, body: string) =>
    call<{ comment: PageComment }>(client().api.page.comments({ id }).put({ body })).then((d) => d.comment),
  resolveComment: (id: string) =>
    call<{ comment: PageComment }>(client().api.page.comments({ id }).resolve.post()).then((d) => d.comment),
  deleteComment: (id: string) =>
    call<{ id: string }>(client().api.page.comments({ id }).delete()),
  exportSite: () => call<{
    manifestVersion: number
    exportedAt: string
    pages: Array<{
      path: string
      title: string
      description: string
      content: string
      labels: string
      status: Page['status']
      ownerId: string | null
      reviewAt: number | null
      spaceKey: string
      locale: string
      createdAt: number
      updatedAt: number
    }>
    assets: AssetView[]
  }>(client().api.export.site.get()),
  importMarkdown: (body: {
    path: string
    title?: string
    description?: string
    content: string
    labels?: string[]
    status?: Page['status']
    locale?: string | null
  }) =>
    call<{ page: Page }>(client().api.import.markdown.post(body)).then((d) => d.page),
  uploadAsset: (file: File) => {
    return call<AssetUpload>(client().api.assets.post({ file }))
  },
  listAssets: () => call<{ assets: AssetView[] }>(client().api.assets.get()).then((d) => d.assets),
  deleteAsset: (id: string) =>
    call<{ asset: AssetView }>(client().api.assets({ id }).delete()).then((d) => d.asset),
  renameAsset: (id: string, filename: string) =>
    call<{ asset: AssetView }>(client().api.assets({ id }).put({ filename })).then((d) => d.asset),

  // Search
  search: (
    q: string,
    limit = 20,
    filters: { pathPrefix?: string; label?: string; status?: string; spaceKey?: string; locale?: string } = {},
  ) =>
    call<{ query: string; hits: SearchHit[] }>(
      client().api.search.get({ query: { q, limit, ...filters } }),
    ),

  // Admin
  adminStats: () => call<AdminStats>(client().api.admin.stats.get()),
  adminAnalytics: () => call<AnalyticsSummary>(client().api.admin.analytics.get()),
  adminUsers: () =>
    call<{ users: AdminUserView[] }>(client().api.admin.users.get()).then((d) => d.users),
  adminGroups: () =>
    call<{ groups: AuthzGroupView[] }>(client().api.admin.groups.get()).then((d) => d.groups),
  adminCreateGroup: (body: { key: string; name: string; description?: string }) =>
    call<{ group: AuthzGroupView }>(client().api.admin.groups.post(body)).then((d) => d.group),
  adminAddUserToGroup: (body: { userId: string; groupKey: string }) =>
    call<{ userId: string; groupKey: string }>(client().api.admin.groups.members.post(body)),
  adminRemoveUserFromGroup: (userId: string, groupKey: string) =>
    call<{ userId: string; groupKey: string }>(
      client().api.admin.groups.members.delete(null, { query: { userId, groupKey } }),
    ),
  adminPageRules: () =>
    call<{ rules: PageRuleView[] }>(client().api.admin['page-rules'].get()).then((d) => d.rules),
  adminCreatePageRule: (body: {
    subjectType: PageRuleView['subjectType']
    subjectId?: string | null
    action: PageRuleView['action']
    effect: PageRuleView['effect']
    matcher: PageRuleView['matcher']
    pattern: string
  }) =>
    call<{ rule: PageRuleView }>(client().api.admin['page-rules'].post(body)).then((d) => d.rule),
  adminDeletePageRule: (id: string) =>
    call<{ id: string }>(client().api.admin['page-rules']({ id }).delete()),
  adminWebhooks: () =>
    call<{ webhooks: WebhookSubscriptionView[] }>(client().api.admin.webhooks.get()).then((d) => d.webhooks),
  adminCreateWebhook: (body: {
    name?: string
    targetUrl: string
    secret: string
    eventTypes: string[]
    enabled?: boolean
  }) =>
    call<{ webhook: WebhookSubscriptionView }>(client().api.admin.webhooks.post(body)).then((d) => d.webhook),
  adminUpdateWebhook: (id: string, body: Partial<{
    name: string
    targetUrl: string
    secret: string
    eventTypes: string[]
    enabled: boolean
  }>) =>
    call<{ webhook: WebhookSubscriptionView }>(client().api.admin.webhooks({ id }).put(body)).then((d) => d.webhook),
  adminDeleteWebhook: (id: string) =>
    call<{ id: string }>(client().api.admin.webhooks({ id }).delete()),
  adminWebhookDeliveries: (status?: WebhookDeliveryView['status']) =>
    call<{ deliveries: WebhookDeliveryView[] }>(
      client().api.admin.webhooks.deliveries.get({ query: { status } }),
    ).then((d) => d.deliveries),
  adminRetryWebhookDelivery: (id: string) =>
    call<{ delivery: WebhookDeliveryView }>(
      client().api.admin.webhooks.deliveries({ id }).retry.post(),
    ).then((d) => d.delivery),
  adminAutomationRules: () =>
    call<{ rules: AutomationRuleView[] }>(client().api.admin['automation-rules'].get()).then((d) => d.rules),
  adminCreateAutomationRule: (body: {
    name?: string
    type: 'page-updated-metadata'
    enabled?: boolean
    config: { pathPrefix: string; label?: string; status?: Page['status'] }
  }) =>
    call<{ rule: AutomationRuleView }>(client().api.admin['automation-rules'].post(body)).then((d) => d.rule),
  adminDeleteAutomationRule: (id: string) =>
    call<{ id: string }>(client().api.admin['automation-rules']({ id }).delete()),
  adminSetRole: (userId: string, role: 'admin' | 'editor' | 'viewer') =>
    call<{ user: AdminUserView }>(client().api.admin.users.role.put({ userId, role })).then(
      (d) => d.user,
    ),
  adminSetPassword: (userId: string, password: string) =>
    call<{ user: AdminUserView }>(client().api.admin.users.password.put({ userId, password })).then(
      (d) => d.user,
    ),
  adminDeactivateUser: (userId: string) =>
    call<{ user: AdminUserView }>(client().api.admin.users.deactivate.post({ userId })).then(
      (d) => d.user,
    ),
  adminUpdateSettings: (body: Partial<PublicSettings>) =>
    call<{ settings: PublicSettings }>(client().api.admin.settings.put(body)).then((d) => d.settings),
}
