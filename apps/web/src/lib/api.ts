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
import type { ExtractedCalendarEvent } from '@ts-wiki/core'
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

const fetchJson = async <T>(path: string, init: RequestInit): Promise<T> => {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: { message?: string }; message?: string }
      | null
    throw new Error(body?.error?.message ?? body?.message ?? `Request failed (${res.status})`)
  }
  return (await res.json()) as T
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
  action: string
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
}
interface AuthResult {
  token: string
  user: PublicUser
}

export const Api = {
  health: () => call<{ ok: true; name: string; version: string }>(client().api.health.get()),
  publicSettings: () => fetchJson<PublicSettings>('/api/settings/public', { method: 'GET' }),

  // Auth
  register: (body: { email: string; name: string; password: string }) =>
    call<AuthResult>(client().api.auth.register.post(body)),
  login: (body: { email: string; password: string; totpCode?: string }) =>
    call<AuthResult>(client().api.auth.login.post(body)),
  me: () => call<{ user: PublicUser }>(client().api.auth.me.get()).then((d) => d.user),
  authProviders: () =>
    fetchJson<{ providers: PublicAuthProvider[] }>('/api/auth/providers', { method: 'GET' }).then((d) => d.providers),
  totpSetup: () =>
    fetchJson<{ secret: string; otpauthUrl: string }>('/api/auth/totp/setup', { method: 'POST' }),
  totpEnable: (code: string) =>
    fetchJson<{ user: PublicUser }>('/api/auth/totp/enable', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    }).then((d) => d.user),
  totpDisable: (code?: string) =>
    fetchJson<{ user: PublicUser }>('/api/auth/totp/disable', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    }).then((d) => d.user),
  passkeys: () =>
    fetchJson<{ passkeys: PasskeyView[] }>('/api/auth/passkeys', { method: 'GET' }).then((d) => d.passkeys),
  passkeyRegistrationOptions: () =>
    fetchJson<{ options: unknown }>('/api/auth/passkeys/register/options', { method: 'POST' }).then((d) => d.options),
  passkeyVerifyRegistration: (response: unknown, name?: string) =>
    fetchJson<{ passkey: PasskeyView }>('/api/auth/passkeys/register/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ response, name }),
    }).then((d) => d.passkey),
  passkeyDelete: (id: string) =>
    fetchJson<{ id: string }>(`/api/auth/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  passkeyLoginOptions: (email?: string) =>
    fetchJson<{ options: unknown }>('/api/auth/passkeys/login/options', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    }).then((d) => d.options),
  passkeyLoginVerify: (response: unknown) =>
    fetchJson<AuthResult & { passkey: PasskeyView }>('/api/auth/passkeys/login/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ response }),
    }),

  // Pages
  listPages: () => call<{ pages: PageSummary[] }>(client().api.pages.get()).then((d) => d.pages),
  trashPages: () => fetchJson<{ pages: PageSummary[] }>('/api/pages/trash', { method: 'GET' }).then((d) => d.pages),
  getPage: (path: string) =>
    call<{ page: Page }>(client().api.page.get({ query: { path } })).then((d) => d.page),
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
    fetchJson<{ page: Page }>('/api/page/restore-revision', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, revisionId }),
    }).then((d) => d.page),
  archivePage: (path: string) =>
    fetchJson<{ page: Page }>('/api/page/archive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    }).then((d) => d.page),
  restorePage: (path: string) =>
    fetchJson<{ page: Page }>('/api/page/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    }).then((d) => d.page),
  purgePage: (path: string) =>
    fetchJson<{ path: string }>(`/api/page/purge?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
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
    fetchJson<{ comment: PageComment }>(`/api/page/comments/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body }),
    }).then((d) => d.comment),
  resolveComment: (id: string) =>
    fetchJson<{ comment: PageComment }>(`/api/page/comments/${encodeURIComponent(id)}/resolve`, {
      method: 'POST',
    }).then((d) => d.comment),
  deleteComment: (id: string) =>
    fetchJson<{ id: string }>(`/api/page/comments/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  exportSite: () => fetchJson<{
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
  }>('/api/export/site', { method: 'GET' }),
  importMarkdown: (body: {
    path: string
    title?: string
    description?: string
    content: string
    labels?: string[]
    status?: Page['status']
    locale?: string | null
  }) =>
    fetchJson<{ page: Page }>('/api/import/markdown', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((d) => d.page),
  uploadAsset: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return fetchJson<AssetUpload>('/api/assets', { method: 'POST', body: form })
  },
  listAssets: () => fetchJson<{ assets: AssetView[] }>('/api/assets', { method: 'GET' }).then((d) => d.assets),
  deleteAsset: (id: string) =>
    fetchJson<{ asset: AssetView }>(`/api/assets/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(
      (d) => d.asset,
    ),
  renameAsset: (id: string, filename: string) =>
    fetchJson<{ asset: AssetView }>(`/api/assets/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename }),
    }).then((d) => d.asset),

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
  adminAnalytics: () => fetchJson<AnalyticsSummary>('/api/admin/analytics', { method: 'GET' }),
  adminUsers: () =>
    call<{ users: AdminUserView[] }>(client().api.admin.users.get()).then((d) => d.users),
  adminGroups: () =>
    call<{ groups: AuthzGroupView[] }>(client().api.admin.groups.get()).then((d) => d.groups),
  adminCreateGroup: (body: { key: string; name: string; description?: string }) =>
    call<{ group: AuthzGroupView }>(client().api.admin.groups.post(body)).then((d) => d.group),
  adminAddUserToGroup: (body: { userId: string; groupKey: string }) =>
    fetchJson<{ userId: string; groupKey: string }>('/api/admin/groups/members', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  adminRemoveUserFromGroup: (userId: string, groupKey: string) =>
    fetchJson<{ userId: string; groupKey: string }>(
      `/api/admin/groups/members?userId=${encodeURIComponent(userId)}&groupKey=${encodeURIComponent(groupKey)}`,
      { method: 'DELETE' },
    ),
  adminPageRules: () =>
    fetchJson<{ rules: PageRuleView[] }>('/api/admin/page-rules', { method: 'GET' }).then((d) => d.rules),
  adminCreatePageRule: (body: {
    subjectType: PageRuleView['subjectType']
    subjectId?: string | null
    action: string
    effect: PageRuleView['effect']
    matcher: PageRuleView['matcher']
    pattern: string
  }) =>
    fetchJson<{ rule: PageRuleView }>('/api/admin/page-rules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((d) => d.rule),
  adminDeletePageRule: (id: string) =>
    fetchJson<{ id: string }>(`/api/admin/page-rules/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  adminWebhooks: () =>
    fetchJson<{ webhooks: WebhookSubscriptionView[] }>('/api/admin/webhooks', { method: 'GET' }).then((d) => d.webhooks),
  adminCreateWebhook: (body: {
    name?: string
    targetUrl: string
    secret: string
    eventTypes: string[]
    enabled?: boolean
  }) =>
    fetchJson<{ webhook: WebhookSubscriptionView }>('/api/admin/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((d) => d.webhook),
  adminUpdateWebhook: (id: string, body: Partial<{
    name: string
    targetUrl: string
    secret: string
    eventTypes: string[]
    enabled: boolean
  }>) =>
    fetchJson<{ webhook: WebhookSubscriptionView }>(`/api/admin/webhooks/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((d) => d.webhook),
  adminDeleteWebhook: (id: string) =>
    fetchJson<{ id: string }>(`/api/admin/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  adminWebhookDeliveries: (status?: WebhookDeliveryView['status']) =>
    fetchJson<{ deliveries: WebhookDeliveryView[] }>(
      `/api/admin/webhooks/deliveries${status ? `?status=${encodeURIComponent(status)}` : ''}`,
      { method: 'GET' },
    ).then((d) => d.deliveries),
  adminRetryWebhookDelivery: (id: string) =>
    fetchJson<{ delivery: WebhookDeliveryView }>(
      `/api/admin/webhooks/deliveries/${encodeURIComponent(id)}/retry`,
      { method: 'POST' },
    ).then((d) => d.delivery),
  adminAutomationRules: () =>
    fetchJson<{ rules: AutomationRuleView[] }>('/api/admin/automation-rules', { method: 'GET' }).then((d) => d.rules),
  adminCreateAutomationRule: (body: {
    name?: string
    type: 'page-updated-metadata'
    enabled?: boolean
    config: { pathPrefix: string; label?: string; status?: Page['status'] }
  }) =>
    fetchJson<{ rule: AutomationRuleView }>('/api/admin/automation-rules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((d) => d.rule),
  adminDeleteAutomationRule: (id: string) =>
    fetchJson<{ id: string }>(`/api/admin/automation-rules/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  adminSetRole: (userId: string, role: 'admin' | 'editor' | 'viewer') =>
    call<{ user: AdminUserView }>(client().api.admin.users.role.put({ userId, role })).then(
      (d) => d.user,
    ),
  adminUpdateSettings: (body: Partial<PublicSettings>) =>
    fetchJson<{ settings: PublicSettings }>('/api/admin/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((d) => d.settings),
}
