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
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/browser'
import type { App } from '@kawaii-wiki/server/app'
import type {
  Page as ServerPage,
  PageSummary as ServerPageSummary,
  SearchResponse as ServerSearchResponse,
  PageGraph as ServerPageGraph,
  PageBacklink as ServerPageBacklink,
  AssetView as ServerAssetView,
  CommentView as ServerCommentView,
  AdminUserView as ServerAdminUserView,
  WebhookDeliveryView as ServerWebhookDeliveryView,
} from '@kawaii-wiki/server/contracts'
import type {
  Action,
  ExtractedCalendarEvent,
  PublicAuthProvider,
  PublicSettings,
  Role,
  SettingsPatch,
  SiteSettings,
} from '@kawaii-wiki/core'
import { API_BASE_URL } from './url'
import { friendlyErrorMessage } from './friendlyErrors'

export type {
  BuiltInNavItem,
  BuiltInNavKey,
  NavLink,
  PublicAuthProvider,
  PublicSettings,
  SettingsPatch,
  SiteSettings,
} from '@kawaii-wiki/core'

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

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly kind?: string,
    readonly status?: number,
    readonly rawMessage?: string,
    readonly field?: string,
  ) {
    super(message)
    this.name = 'ApiClientError'
  }
}

const errorOf = (error: unknown): ApiClientError => {
  const e = error as
    | { value?: { error?: { kind?: string; message?: string; field?: string }; message?: string }; status?: number }
    | null
    | undefined
  const kind = e?.value?.error?.kind
  const status = e?.status
  const rawMessage = e?.value?.error?.message ?? e?.value?.message
  const field = e?.value?.error?.field
  return new ApiClientError(friendlyErrorMessage({ kind, status, message: rawMessage, field }), kind, status, rawMessage, field)
}

type ResponseGuard<T> = (value: unknown) => value is T

/** Await an Eden call, throw on error, and optionally validate its success body. */
const call = async <T>(
  promise: Promise<{ data: unknown; error: unknown }>,
  guard?: ResponseGuard<T>,
): Promise<T> => {
  const res = await promise
  if (res.error) throw errorOf(res.error)
  if (guard && !guard(res.data)) {
    throw new ApiClientError(
      friendlyErrorMessage({ kind: 'internal', message: 'The server returned an unexpected response.' }),
      'invalid_response',
      502,
      'The server returned an unexpected response.',
    )
  }
  return res.data as T
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

const parseStringArray = (value: unknown): string[] => {
  if (isStringArray(value)) return value
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value) as unknown
    return isStringArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export interface TocItem {
  id: string
  text: string
  level: number
}

const parseToc = (value: unknown): TocItem[] => {
  if (typeof value === 'string') {
    try {
      return parseToc(JSON.parse(value) as unknown)
    } catch {
      return []
    }
  }
  return Array.isArray(value)
    ? value.filter((item): item is TocItem =>
        isRecord(item)
        && typeof item.id === 'string'
        && typeof item.text === 'string'
        && typeof item.level === 'number',
      )
    : []
}

// ── Domain types (the shapes the server returns) ─────────────────────────────
export interface PublicUser {
  id: string
  email: string
  name: string
  role: 'admin' | 'editor' | 'viewer'
  totpEnabled: boolean
  profileBio: string
  profileCoverUrl: string
  profileLinks: ProfileLink[]
  profileFavoritePages: string[]
}
export interface ProfileLink {
  label: string
  url: string
}
export interface PublicUserProfile {
  id: string
  name: string
  role: 'admin' | 'editor' | 'viewer'
  profileBio: string
  profileCoverUrl: string
  profileLinks: ProfileLink[]
  profileFavoritePages: string[]
  createdAt: number
}
export interface UserProfileResponse {
  profile: PublicUserProfile
  favoritePages: PageSummary[]
  authoredPages: PageSummary[]
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
  icon: string
  coverUrl: string
  coverPosition: string
  content: string
  renderedHtml: string
  toc: TocItem[]
  contentType: string
  lifecycle: 'active' | 'archived' | 'deleted'
  status: 'draft' | 'in-review' | 'verified' | 'outdated'
  labels: string[]
  ownerId: string | null
  authorId: string | null
  reviewAt: number | null
  publishAt: number | null
  navOrder: number | null
  pinned: boolean
  spaceKey: string
  locale: string
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
  icon: string
  coverUrl: string
  coverPosition: string
  lifecycle: 'active' | 'archived' | 'deleted'
  status: 'draft' | 'in-review' | 'verified' | 'outdated'
  labels: string[]
  ownerId: string | null
  authorId: string | null
  reviewAt: number | null
  publishAt: number | null
  navOrder: number | null
  pinned: boolean
  spaceKey: string
  locale: string
  updatedAt: number
}
export interface PageTemplateMetadata {
  title?: string
  path?: string
  labels?: string[]
  status?: Page['status']
  locale?: string
  reviewAt?: number | null
}
export interface PageTemplate {
  id: string
  name: string
  description: string
  icon: string
  content: string
  metadata: PageTemplateMetadata
  createdBy: string | null
  createdAt: number
  updatedAt: number
}
export interface LinkPreviewView {
  url: string
  provider: string
  title: string
  description: string
  image: string | null
  author: string | null
  siteName: string | null
  contentType: string | null
  fetchedAt: number
  expiresAt: number
}
export interface YoutubeLatestVideo {
  id: string
  title: string
  url: string
  author: string
  publishedAt: string
  thumbnail: string | null
}
export interface YoutubeLatestView {
  channelId: string
  videos: YoutubeLatestVideo[]
  fetchedAt: number
  expiresAt: number
}
export interface PageSpace {
  key: string
  pages: number
  updatedAt: number
}
export interface SearchHit {
  path: string
  title: string
  icon: string
  coverUrl: string
  coverPosition: string
  snippet: string
  rank: number
  kind: 'page' | 'comment' | 'asset'
  anchor?: string
  updatedAt: number
}
export type SearchScope = 'all' | 'title'
export type SearchSort = 'relevance' | 'recent'
export type FtsTokenizer = 'unicode61' | 'trigram'
export interface SearchTokenizerHint {
  kind: 'cjk-tokenizer'
  tokenizer: FtsTokenizer
  recommendedTokenizer: 'trigram'
  message: string
}
export interface SearchShortQueryHint {
  kind: 'trigram-short-query'
  tokenizer: 'trigram'
  terms: string[]
  message: string
}
export interface SearchResponse {
  query: string
  hits: SearchHit[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
  tokenizerHint?: SearchTokenizerHint
  shortQueryHint?: SearchShortQueryHint
  truncatedTerms?: string[]
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
export interface LabelCount {
  label: string
  count: number
}
export interface BrokenLink {
  path: string
  title: string
  target: string
  label: string
  kind: 'wikilink' | 'markdown'
}
export interface RecentChange {
  id: string
  path: string
  title: string
  action: 'created' | 'updated' | 'moved' | 'deleted' | 'archived' | 'restored' | 'purged'
  authorId: string | null
  authorName: string | null
  createdAt: number
}
export interface PopularPage extends PageSummary {
  views: number
  lastViewedAt: number | null
}
export interface PageInsightContributor {
  authorId: string | null
  authorName: string
  revisions: number
  lastContributionAt: number
}
export interface PageInsight {
  path: string
  views: number
  lastViewedAt: number | null
  revisionCount: number
  contributors: PageInsightContributor[]
}
export interface PageRedirectView {
  fromPath: string
  toPath: string
  createdAt: number
}
export interface PageRevision {
  id: string
  path: string
  title: string
  description: string
  content: string
  authorId: string | null
  authorName: string | null
  action: 'created' | 'updated' | 'moved' | 'deleted' | 'archived' | 'restored' | 'purged'
  createdAt: number
}
export type UserPreferenceKey = 'nav:collapsed' | 'nav:starred' | 'nav:page-order' | 'editor:mode'
export type UserPreferenceMap = Partial<Record<UserPreferenceKey, unknown>>
export interface AssetUpload {
  id: string
  filename: string
  folder: string
  url: string
}
export interface AssetView {
  id: string
  filename: string
  storageName: string
  folder: string
  mime: string
  size: number
  authorId: string | null
  createdAt: number
  deletedAt: number | null
  url: string
  thumbUrl: string | null
}
export interface AssetUsagePage {
  path: string
  title: string
}
export interface AssetUsage {
  asset: AssetView
  pages: AssetUsagePage[]
}
export interface PageComment {
  id: string
  path: string
  body: string
  authorId: string | null
  authorName: string | null
  mentions: string[]
  resolvedAt: number | null
  createdAt: number
  updatedAt: number
}
export interface PageShareView {
  token: string
  path: string
  createdBy: string
  expiresAt: number | null
  revokedAt: number | null
  createdAt: number
}
export interface SharedPage {
  share: PageShareView
  page: Page
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
export interface SearchIndexStatus {
  tokenizer: FtsTokenizer
  configuredTokenizer: FtsTokenizer
  totalPages: number
  cjkPages: number
  cjkPageRatio: number
  indexedCharacters: number
  cjkCharacters: number
  cjkCharacterRatio: number
  recommendedTokenizer: FtsTokenizer
  needsTrigram: boolean
}
export interface AdminHistoryStats {
  revisions: number
  historyBytes: number
}
export interface PurgeHistoryResult extends AdminHistoryStats {
  deleted: number
  olderThan: number
  keepLatest: number
}
export interface AdminPageView {
  path: string
  title: string
  status: Page['status']
  labels: string[]
  ownerId: string | null
  authorId: string | null
  authorName: string | null
  spaceKey: string
  locale: string
  updatedAt: number
}
export interface AdminPageList {
  pages: AdminPageView[]
  total: number
  limit: number
  offset: number
}
export interface AdminAuditEvent {
  id: number
  action: string
  userId: string | null
  path: string | null
  data: Record<string, unknown>
  createdAt: number
}
export interface AdminAuditList {
  events: AdminAuditEvent[]
  total: number
  limit: number
  offset: number
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
export interface ApiKeyView {
  id: string
  name: string
  role: Role
  expiresAt: number | null
  lastUsedAt: number | null
  revokedAt: number | null
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
  type: 'event-rule' | 'page-updated-metadata'
  enabled: boolean
  priority: number
  stopOnMatch: boolean
  config: {
    trigger: 'page.created' | 'page.updated' | 'page.deleted' | 'page.moved' | 'comment.created'
    conditions: {
      pathPrefix?: string
      label?: string
      status?: Page['status']
      authorId?: string
      locale?: string
      spaceKey?: string
    }
    actions: {
      addLabel?: string
      setStatus?: Page['status']
      setReviewAt?: number | null
      moveToPath?: string
      fireWebhookEvent?: string
    }
  }
  createdAt: number
  updatedAt: number
}
export type AutomationRuleInput = {
  name?: string
  type: AutomationRuleView['type']
  enabled?: boolean
  priority?: number
  stopOnMatch?: boolean
  config:
    | AutomationRuleView['config']
    | { pathPrefix: string; label?: string; status?: Page['status'] }
}
export interface AnalyticsSummary {
  totalViews: number
  topPages: Array<{ path: string; views: number; lastViewedAt: number | null }>
}
export interface RealtimeTicket {
  ticket: string
  expiresAt: number
}
export interface GitStatus {
  enabled: boolean
  dir: string
  branch: string
  remote: string | null
  remoteUrl: string | null
  head: string | null
  clean: boolean
  lastSuccessAt: number | null
  lastErrorAt: number | null
  lastError: string | null
}
export interface NotificationView {
  id: string
  kind: string
  path: string | null
  message: string
  payload: Record<string, unknown>
  readAt: number | null
  createdAt: number
}
export interface NotificationList {
  notifications: NotificationView[]
  unread: number
}
export interface SetupStatus {
  needsSetup: boolean
}
export interface SetupInput {
  email: string
  name: string
  password: string
  siteTitle: string
  theme: 'system' | 'light' | 'dark'
  tokenizer: FtsTokenizer
  sampleContent: boolean
}
interface AuthResult {
  token: string
  user: PublicUser
}
export type TotpEnableResult = ({ user: PublicUser } | AuthResult) & { recoveryCodes: string[] }
export interface SetupResult extends AuthResult {
  settings: SiteSettings
  home: Page
  searchIndex: SearchIndexStatus
}
export interface VerificationRequiredResult {
  verificationRequired: true
}
export interface TwoFactorSetupRequiredResult {
  twoFactorSetupRequired: true
  setupToken: string
  user: PublicUser
}

type RawPage = Omit<Page, 'labels' | 'toc'> & { labels: string | string[]; toc: string | TocItem[] }
type RawPageSummary = Omit<PageSummary, 'labels'> & { labels: string | string[] }
type RawAdminPageView = Omit<AdminPageView, 'labels'> & { labels: string | string[] }

const isRawPage = (value: unknown): value is RawPage =>
  isRecord(value)
  && typeof value.id === 'string'
  && typeof value.path === 'string'
  && typeof value.title === 'string'
  && typeof value.content === 'string'
  && typeof value.renderedHtml === 'string'
  && (typeof value.labels === 'string' || isStringArray(value.labels))
  && (typeof value.toc === 'string' || Array.isArray(value.toc))

const pageOf = (page: RawPage): Page => ({
  ...page,
  labels: parseStringArray(page.labels),
  toc: parseToc(page.toc),
})

const pageSummaryOf = (page: RawPageSummary): PageSummary => ({
  ...page,
  labels: parseStringArray(page.labels),
})

const adminPageOf = (page: RawAdminPageView): AdminPageView => ({
  ...page,
  labels: parseStringArray(page.labels),
})

const isPublicSettings = (value: unknown): value is PublicSettings =>
  isRecord(value)
  && typeof value.siteTitle === 'string'
  && typeof value.accentColor === 'string'
  && typeof value.homePath === 'string'
  && Array.isArray(value.navItems)
  && Array.isArray(value.navLinks)

const isSearchResponse = (value: unknown): value is SearchResponse =>
  isRecord(value)
  && typeof value.query === 'string'
  && Array.isArray(value.hits)
  && typeof value.total === 'number'
  && typeof value.limit === 'number'
  && typeof value.offset === 'number'

const isPageEnvelope = (value: unknown): value is { page: RawPage } =>
  isRecord(value) && isRawPage(value.page)

const isPageLookupEnvelope = (value: unknown): value is { page: RawPage; redirectedFrom: string[] } =>
  isRecord(value) && isRawPage(value.page) && isStringArray(value.redirectedFrom)

type ContractMatches<Client, Server> = Client extends Server ? true : false
type AssertContract<T extends true> = T
type ServerShapedPage = Omit<Page, 'labels' | 'toc'> & { labels: string; toc: string }
type ServerShapedPageSummary = Omit<PageSummary, 'labels'> & { labels: string }
type _PageContract = AssertContract<ContractMatches<ServerShapedPage, ServerPage>>
type _PageSummaryContract = AssertContract<ContractMatches<ServerShapedPageSummary, ServerPageSummary>>
type _SearchContract = AssertContract<ContractMatches<SearchResponse, ServerSearchResponse>>
type _GraphContract = AssertContract<ContractMatches<PageGraph, ServerPageGraph>>
type _BacklinkContract = AssertContract<ContractMatches<PageBacklink, ServerPageBacklink>>
type _AssetContract = AssertContract<ContractMatches<AssetView, ServerAssetView>>
type _CommentContract = AssertContract<ContractMatches<PageComment, ServerCommentView>>
type _AdminUserContract = AssertContract<ContractMatches<AdminUserView, ServerAdminUserView>>
type _WebhookDeliveryContract = AssertContract<ContractMatches<WebhookDeliveryView, ServerWebhookDeliveryView>>
type ApiContracts = [
  _PageContract,
  _PageSummaryContract,
  _SearchContract,
  _GraphContract,
  _BacklinkContract,
  _AssetContract,
  _CommentContract,
  _AdminUserContract,
  _WebhookDeliveryContract,
]
void (0 as unknown as ApiContracts)

export const Api = {
  health: () => call<{ ok: true; name: string; version: string }>(client().api.health.get()),
  publicSettings: () => call<PublicSettings>(client().api.settings.public.get(), isPublicSettings),
  unfurl: (url: string) =>
    call<{ preview: LinkPreviewView }>(client().api.unfurl.get({ query: { url } })).then((d) => d.preview),
  youtubeLatest: (channelId: string, limit?: number) =>
    call<{ channel: YoutubeLatestView }>(
      client().api.youtube.latest.get({ query: { channelId, ...(limit ? { limit } : {}) } }),
    ).then((d) => d.channel),
  setupStatus: () => call<SetupStatus>(client().api.setup.status.get()),
  completeSetup: (body: SetupInput) =>
    call<Omit<SetupResult, 'home'> & { home: RawPage }>(client().api.setup.complete.post(body))
      .then((result) => ({ ...result, home: pageOf(result.home) })),
  realtimeTicket: () => call<RealtimeTicket>(client().api.realtime.ticket.post()),
  gitStatus: () => call<GitStatus>(client().api.git.status.get()),
  gitSync: () => call<{ enabled: boolean; pulled: boolean; pushed: boolean; upserted: string[]; deleted: string[] }>(client().api.git.sync.post()),
  notifications: (limit = 50) => call<NotificationList>(client().api.notifications.get({ query: { limit } })),
  markNotificationsRead: (id?: string) => call<{ readAt: number }>(client().api.notifications.read.post({ id })),
  pageWatch: (path: string) => call<{ path: string; watching: boolean }>(client().api.page.watch.get({ query: { path } })),
  setPageWatch: (path: string, watching: boolean) => call<{ path: string; watching: boolean }>(client().api.page.watch.post({ path, watching })),

  // Auth
  register: (body: { email: string; name: string; password: string }) =>
    call<AuthResult | VerificationRequiredResult>(client().api.auth.register.post(body)),
  login: (body: { email: string; password: string; totpCode?: string }) =>
    call<AuthResult | TwoFactorSetupRequiredResult>(client().api.auth.login.post(body)),
  forgotPassword: (email: string) =>
    call<{ ok: true }>(client().api.auth.forgot.post({ email })),
  resetPassword: (token: string, password: string) =>
    call<{ userId: string }>(client().api.auth.reset.post({ token, password })),
  verifyEmail: (token: string) =>
    call<{ userId: string }>(client().api.auth.email.verify.post({ token })),
  requestEmailVerification: () =>
    call<{ sent: boolean }>(client().api.auth.email.verification.post()),
  me: () => call<{ user: PublicUser }>(client().api.auth.me.get()).then((d) => d.user),
  preferences: () =>
    call<{ preferences: UserPreferenceMap }>(client().api.me.preferences.get()).then((d) => d.preferences),
  updatePreferences: (preferences: UserPreferenceMap) =>
    call<{ preferences: UserPreferenceMap }>(client().api.me.preferences.put({ preferences })).then((d) => d.preferences),
  updateProfile: (body: {
    name?: string
    bio?: string
    coverUrl?: string
    links?: ProfileLink[]
    favoritePages?: string[]
  }) =>
    call<{ user: PublicUser }>(client().api.auth.profile.put(body)).then((d) => d.user),
  userProfile: (id: string) =>
    call<UserProfileResponse>(client().api.users({ id }).profile.get()),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    call<{ user: PublicUser }>(client().api.auth.password.put(body)).then((d) => d.user),
  authProviders: () =>
    call<{ providers: PublicAuthProvider[] }>(client().api.auth.providers.get()).then((d) => d.providers),
  totpSetup: (setupToken?: string) =>
    call<{ secret: string; otpauthUrl: string }>(client().api.auth.totp.setup.post(setupToken ? { setupToken } : undefined)),
  totpEnable: (code: string, setupToken?: string) =>
    call<TotpEnableResult>(client().api.auth.totp.enable.post(setupToken ? { code, setupToken } : { code })),
  totpRecoveryCodes: (code: string) =>
    call<{ recoveryCodes: string[] }>(client().api.auth.totp['recovery-codes'].post({ code })).then((d) => d.recoveryCodes),
  totpDisable: (code?: string) =>
    call<{ user: PublicUser }>(client().api.auth.totp.disable.post({ code })).then((d) => d.user),
  passkeys: () =>
    call<{ passkeys: PasskeyView[] }>(client().api.auth.passkeys.get()).then((d) => d.passkeys),
  passkeyRegistrationOptions: () =>
    call<{ options: unknown }>(client().api.auth.passkeys.register.options.post()).then((d) => d.options),
  passkeyVerifyRegistration: (response: RegistrationResponseJSON, name?: string) =>
    call<{ passkey: PasskeyView }>(client().api.auth.passkeys.register.verify.post({ response, name })).then((d) => d.passkey),
  passkeyDelete: (id: string) =>
    call<{ id: string }>(client().api.auth.passkeys({ id }).delete()),
  passkeyLoginOptions: (email?: string) =>
    call<{ options: unknown }>(client().api.auth.passkeys.login.options.post({ email })).then((d) => d.options),
  passkeyLoginVerify: (response: AuthenticationResponseJSON) =>
    call<AuthResult & { passkey: PasskeyView }>(client().api.auth.passkeys.login.verify.post({ response })),

  // Pages
  listPages: () => call<{ pages: RawPageSummary[] }>(client().api.pages.get({ query: { limit: 1_000 } })).then((d) => d.pages.map(pageSummaryOf)),
  trashPages: () => call<{ pages: RawPageSummary[] }>(client().api.pages.trash.get({ query: { limit: 1_000 } })).then((d) => d.pages.map(pageSummaryOf)),
  getPageResult: (path: string) =>
    call<{ page: RawPage; redirectedFrom: string[] }>(client().api.page.get({ query: { path } }), isPageLookupEnvelope)
      .then((result): PageLookup => ({ ...result, page: pageOf(result.page) })),
  getPage: (path: string) =>
    Api.getPageResult(path).then((d) => d.page),
  sharedPage: (token: string) =>
    call<Omit<SharedPage, 'page'> & { page: RawPage }>(client().api.shared({ token }).get())
      .then((result) => ({ ...result, page: pageOf(result.page) })),
  currentPageShare: (path: string) =>
    call<{ share: PageShareView | null }>(client().api.page.share.get({ query: { path } })).then((d) => d.share),
  createPageShare: (path: string, expiresAt?: number | null) =>
    call<{ share: PageShareView }>(client().api.page.share.post({ path, expiresAt })).then((d) => d.share),
  revokePageShare: (token: string) =>
    call<{ share: PageShareView }>(client().api.page.share({ token }).delete()).then((d) => d.share),
  createPage: (body: {
    path: string
    title: string
    content: string
    description?: string
    icon?: string
    coverUrl?: string
    coverPosition?: string
    labels?: string[]
    status?: Page['status']
    ownerId?: string | null
    reviewAt?: number | null
    publishAt?: number | null
    locale?: string | null
    navOrder?: number | null
    pinned?: boolean
  }) =>
    call<{ page: RawPage }>(client().api.pages.post(body), isPageEnvelope).then((d) => pageOf(d.page)),
  copyPage: (fromPath: string, newPath: string, keepStatus = false) =>
    call<{ page: RawPage }>(client().api.page.copy.post({ fromPath, newPath, keepStatus }), isPageEnvelope).then((d) => pageOf(d.page)),
  updatePage: (path: string, body: {
    title?: string
    content?: string
    description?: string
    icon?: string
    coverUrl?: string
    coverPosition?: string
    labels?: string[]
    status?: Page['status']
    ownerId?: string | null
    reviewAt?: number | null
    publishAt?: number | null
    locale?: string | null
    navOrder?: number | null
    pinned?: boolean
    expectedUpdatedAt?: number | null
  }) =>
    call<{ page: RawPage }>(client().api.page.put(body, { query: { path } }), isPageEnvelope).then((d) => pageOf(d.page)),
  restoreRevision: (path: string, revisionId: string) =>
    call<{ page: RawPage }>(client().api.page['restore-revision'].post({ path, revisionId }), isPageEnvelope).then((d) => pageOf(d.page)),
  archivePage: (path: string) =>
    call<{ page: RawPage }>(client().api.page.archive.post({ path }), isPageEnvelope).then((d) => pageOf(d.page)),
  restorePage: (path: string) =>
    call<{ page: RawPage }>(client().api.page.restore.post({ path }), isPageEnvelope).then((d) => pageOf(d.page)),
  purgePage: (path: string) =>
    call<{ path: string }>(client().api.page.purge.delete(null, { query: { path } })),
  movePage: (oldPath: string, newPath: string) =>
    call<{ page: RawPage }>(client().api.page.move.post({ oldPath, newPath }), isPageEnvelope).then((d) => pageOf(d.page)),
  deletePage: (path: string) =>
    call<{ path: string }>(client().api.page.delete(null, { query: { path } })),
  graph: () => call<PageGraph>(client().api.graph.get()),
  spaces: () => call<{ spaces: PageSpace[] }>(client().api.spaces.get({ query: { limit: 1_000 } })).then((d) => d.spaces),
  events: () =>
    call<{ events: ExtractedCalendarEvent[] }>(client().api.events.index.get()).then((d) => d.events),
  labels: () => call<{ labels: LabelCount[] }>(client().api.labels.get()).then((d) => d.labels),
  brokenLinks: () =>
    call<{ links: BrokenLink[] }>(client().api.links.broken.get()).then((d) => d.links),
  recentChanges: (limit?: number, before?: number) =>
    call<{ changes: RecentChange[] }>(client().api.changes.get({ query: { ...(limit ? { limit } : {}), ...(before ? { before } : {}) } })).then(
      (d) => d.changes,
    ),
  popularPages: (days?: number, limit?: number) =>
    call<{ pages: Array<Omit<PopularPage, 'labels'> & { labels: string | string[] }> }>(
      client().api.pages.popular.get({ query: { ...(days ? { days } : {}), ...(limit ? { limit } : {}) } }),
    ).then((d) => d.pages.map((page) => ({ ...page, labels: parseStringArray(page.labels) }))),
  pageInsights: (path: string) =>
    call<PageInsight>(client().api.page.insights.get({ query: { path } })),
  redirects: () =>
    call<{ redirects: PageRedirectView[] }>(client().api.redirects.get()).then((d) => d.redirects),
  createRedirect: (fromPath: string, toPath: string) =>
    call<{ redirect: PageRedirectView }>(client().api.redirects.post({ fromPath, toPath })).then((d) => d.redirect),
  deleteRedirect: (fromPath: string) =>
    call<{ fromPath: string }>(client().api.redirects.delete(null, { query: { fromPath } })),
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
  templates: () =>
    call<{ templates: PageTemplate[] }>(client().api.templates.get()).then((d) => d.templates),
  createTemplate: (body: {
    name?: string
    description?: string
    icon?: string
    content?: string
    metadata?: PageTemplateMetadata | null
  }) =>
    call<{ template: PageTemplate }>(client().api.templates.post(body)).then((d) => d.template),
  updateTemplate: (id: string, body: {
    name?: string
    description?: string
    icon?: string
    content?: string
    metadata?: PageTemplateMetadata | null
  }) =>
    call<{ template: PageTemplate }>(client().api.templates({ id }).put(body)).then((d) => d.template),
  deleteTemplate: (id: string) =>
    call<{ id: string }>(client().api.templates({ id }).delete()),
  exportSite: () => call<{
    manifestVersion: number
    exportedAt: string
    pages: Array<{
      path: string
      title: string
      description: string
      icon: string
      coverUrl: string
      coverPosition: string
      content: string
      labels: string
      status: Page['status']
      ownerId: string | null
      reviewAt: number | null
      publishAt: number | null
      navOrder: number | null
      pinned: boolean
      spaceKey: string
      locale: string
      createdAt: number
      updatedAt: number
    }>
    assets: AssetView[]
  }>(client().api.export.site.get({ query: { format: 'json' } })),
  exportSiteZip: async () => {
    const response = await fetch(new URL('/api/export/site?format=zip', API_BASE_URL), {
      headers: authToken ? { authorization: `Bearer ${authToken}` } : {},
    })
    if (!response.ok) throw new ApiClientError('Could not export the site.', 'export_failed', response.status)
    return response.blob()
  },
  importSite: (manifest: {
    pages: Array<{
      path: string; title: string; description?: string; icon?: string; coverUrl?: string; coverPosition?: string
      content: string; labels: string; status?: Page['status']; locale?: string; navOrder?: number | null; pinned?: boolean
    }>
  }, conflictPolicy: 'upsert' | 'skip' = 'upsert') =>
    call<{ results: Array<{ path: string; ok: boolean; error?: string }> }>(client().api.import.site.post({ pages: manifest.pages, conflictPolicy })),
  importBulk: (files: File[]) =>
    call<{ results: Array<{ file: string; path: string; ok: boolean; error?: string }> }>(client().api.import.bulk.post({ files })),
  importMarkdown: (body: {
    path: string
    title?: string
    description?: string
    icon?: string
    coverUrl?: string
    coverPosition?: string
    content: string
    labels?: string[]
    status?: Page['status']
    locale?: string | null
    navOrder?: number | null
    pinned?: boolean
  }) =>
    call<{ page: RawPage }>(client().api.import.markdown.post(body), isPageEnvelope).then((d) => pageOf(d.page)),
  uploadAsset: (file: File, folder?: string) => {
    return call<AssetUpload>(client().api.assets.post({ file, folder }))
  },
  listAssets: (folder?: string, q?: string) =>
    call<{ assets: AssetView[] }>(client().api.assets.get({ query: { ...(folder ? { folder } : {}), ...(q ? { q } : {}), limit: 1_000 } })).then((d) => d.assets),
  assetFolders: () =>
    call<{ folders: string[] }>(client().api.assets.folders.get()).then((d) => d.folders),
  trashAssets: () => call<{ assets: AssetView[] }>(client().api.assets.trash.get({ query: { limit: 1_000 } })).then((d) => d.assets),
  assetUsage: (path?: string) =>
    call<{ usage: AssetUsage[] }>(client().api.assets.usage.get({ query: path ? { path } : {} })).then(
      (d) => d.usage,
    ),
  orphanAssets: () =>
    call<{ assets: AssetView[] }>(client().api.assets.orphans.get()).then((d) => d.assets),
  deleteOrphanAssets: (ids: string[]) =>
    call<{ assets: AssetView[]; skipped: number }>(client().api.assets.orphans.delete.post({ ids })),
  deleteAsset: (id: string) =>
    call<{ asset: AssetView }>(client().api.assets({ id }).delete()).then((d) => d.asset),
  restoreAsset: (id: string) =>
    call<{ asset: AssetView }>(client().api.assets({ id }).restore.post()).then((d) => d.asset),
  purgeAsset: (id: string) =>
    call<{ asset: AssetView }>(client().api.assets({ id }).purge.delete()).then((d) => d.asset),
  updateAsset: (id: string, body: { filename?: string; folder?: string }) =>
    call<{ asset: AssetView }>(client().api.assets({ id }).patch(body)).then((d) => d.asset),
  renameAsset: (id: string, filename: string) =>
    Api.updateAsset(id, { filename }),

  // Search
  search: (
    q: string,
    options: {
      limit?: number
      offset?: number
      scope?: SearchScope
      sort?: SearchSort
      filters?: {
        pathPrefix?: string
        label?: string
        status?: string
        spaceKey?: string
        locale?: string
        author?: string
        updatedAfter?: number
        updatedBefore?: number
      }
    } = {},
  ) =>
    call<SearchResponse>(
      client().api.search.get({
        query: {
          q,
          ...(options.limit ? { limit: options.limit } : {}),
          ...(options.offset ? { offset: options.offset } : {}),
          ...(options.scope ? { scope: options.scope } : {}),
          ...(options.sort ? { sort: options.sort } : {}),
          ...options.filters,
        },
      }),
      isSearchResponse,
    ),

  // Admin
  adminStats: () => call<AdminStats>(client().api.admin.stats.get()),
  adminSearchIndex: () =>
    call<{ searchIndex: SearchIndexStatus }>(client().api.admin['search-index'].get()).then((d) => d.searchIndex),
  adminRebuildSearchIndex: (tokenizer: FtsTokenizer = 'trigram') =>
    call<{ searchIndex: SearchIndexStatus }>(
      client().api.admin['search-index'].rebuild.post({ tokenizer }),
    ).then((d) => d.searchIndex),
  adminHistoryStats: () => call<AdminHistoryStats>(client().api.admin.history.get()),
  adminPurgeHistory: (body: { olderThanDays: number; keepLatest: number }) =>
    call<PurgeHistoryResult>(client().api.admin.history.purge.post(body)),
  adminPages: (query: {
    limit?: number
    offset?: number
    status?: string
    label?: string
    spaceKey?: string
    authorId?: string
  } = {}) =>
    call<Omit<AdminPageList, 'pages'> & { pages: RawAdminPageView[] }>(client().api.admin.pages.get({ query }))
      .then((result): AdminPageList => ({ ...result, pages: result.pages.map(adminPageOf) })),
  adminAudit: (query: {
    limit?: number
    offset?: number
    action?: string
    userId?: string
    from?: number
    to?: number
  } = {}) =>
    call<AdminAuditList>(client().api.admin.audit.get({ query })),
  adminAnalytics: () => call<AnalyticsSummary>(client().api.admin.analytics.get()),
  adminUsers: () =>
    call<{ users: AdminUserView[] }>(client().api.admin.users.get({ query: { limit: 1_000 } })).then((d) => d.users),
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
  adminApiKeys: () =>
    call<{ apiKeys: ApiKeyView[] }>(client().api.admin['api-keys'].get()).then((d) => d.apiKeys),
  adminCreateApiKey: (body: { name: string; role?: Role; expiresAt?: number | null }) =>
    call<{ apiKey: ApiKeyView; secret: string }>(client().api.admin['api-keys'].post(body)),
  adminRevokeApiKey: (id: string) =>
    call<{ apiKey: ApiKeyView }>(client().api.admin['api-keys']({ id }).delete()).then((d) => d.apiKey),
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
  installOfficialDocs: () =>
    call<{ version: string; results: Array<{ path: string; created: boolean }> }>(
      client().api.import['official-docs'].post(),
    ),
  adminRetryWebhookDelivery: (id: string) =>
    call<{ delivery: WebhookDeliveryView }>(
      client().api.admin.webhooks.deliveries({ id }).retry.post(),
    ).then((d) => d.delivery),
  adminAutomationRules: () =>
    call<{ rules: AutomationRuleView[] }>(client().api.admin['automation-rules'].get()).then((d) => d.rules),
  adminCreateAutomationRule: (body: AutomationRuleInput) =>
    call<{ rule: AutomationRuleView }>(client().api.admin['automation-rules'].post(body)).then((d) => d.rule),
  adminUpdateAutomationRule: (id: string, body: Partial<Omit<AutomationRuleInput, 'type'>>) =>
    call<{ rule: AutomationRuleView }>(client().api.admin['automation-rules']({ id }).put(body)).then((d) => d.rule),
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
  adminUpdateSettings: (body: SettingsPatch) =>
    call<{ settings: SiteSettings }>(client().api.admin.settings.put(body)).then((d) => d.settings),
}
