/**
 * Composition root for the service layer. Everything the HTTP layer needs is
 * built here from a single `DB` dependency and passed down explicitly.
 */
import type { DB } from '../db/client.ts'
import { createRenderer, type MarkdownRenderer } from '@kawaii-wiki/core'
import type { AssetUploadEnv, AuthEnv, BrandingEnv, LocalizationEnv, MailEnv, SearchEnv, WebhookEnv } from '../env.ts'
import type { StructuredLogger } from '../observability/logging.ts'
import { createDatabaseRepositories } from '../db/repositories/index.ts'
import { createPageService, type PageService } from './pages.ts'
import { createFtsSearchIndexer, createSearchService, type SearchService } from './search.ts'
import { createUserService, type UserService } from './users.ts'
import { createAssetService, type AssetService } from './assets.ts'
import { createAdminService, type AdminService } from './admin.ts'
import { createCommentService, type CommentService } from './comments.ts'
import { createAnalyticsService, type AnalyticsService } from './analytics.ts'
import { createSettingsService, type SettingsService } from './settings.ts'
import { createAuthzService, type AuthzService } from './authz.ts'
import { createAuthProviderService, type AuthProviderService } from './auth-providers.ts'
import { createOidcAuthProviders, createOidcService, type OidcService } from './oidc.ts'
import { createPasskeyService, type PasskeyService } from './passkeys.ts'
import { createPageShareService, type PageShareService } from './shares.ts'
import { createPageTemplateService, type PageTemplateService } from './templates.ts'
import { createUserPreferenceService, type UserPreferenceService } from './preferences.ts'
import { createLinkPreviewService, type LinkPreviewService } from './link-previews.ts'
import { createMailService, type MailSender, type MailService } from './mail.ts'
import { createAuthRecoveryService, type AuthRecoveryService } from './auth-recovery.ts'
import { createApiKeyService, type ApiKeyService } from './api-keys.ts'
import { createTotpService, type TotpService } from './totp.ts'
import { createNotificationService, type NotificationService } from './notifications.ts'
import {
  createWebhookService,
  type WebhookFetcher,
  type WebhookHostnameResolver,
  type WebhookService,
} from './webhooks.ts'

export interface ServiceOptions {
  readonly assetUrl?: (storageName: string) => string
  readonly auth?: AuthEnv
  readonly assetUpload?: AssetUploadEnv
  readonly search?: SearchEnv
  readonly branding?: BrandingEnv
  readonly localization?: LocalizationEnv
  readonly mail?: MailEnv
  readonly mailSender?: MailSender
  readonly logger?: StructuredLogger
  readonly webhookFetcher?: WebhookFetcher
  readonly webhookResolver?: WebhookHostnameResolver
  readonly allowPrivateWebhookTargets?: boolean
  readonly webhookPolicy?: Omit<WebhookEnv, 'allowPrivateTargets'>
}

export interface Services {
  readonly pages: PageService
  readonly search: SearchService
  readonly users: UserService
  readonly assets: AssetService
  readonly admin: AdminService
  readonly comments: CommentService
  readonly analytics: AnalyticsService
  readonly settings: SettingsService
  readonly authz: AuthzService
  readonly authProviders: AuthProviderService
  readonly oidc: OidcService
  readonly passkeys: PasskeyService
  readonly shares: PageShareService
  readonly templates: PageTemplateService
  readonly preferences: UserPreferenceService
  readonly linkPreviews: LinkPreviewService
  readonly mail: MailService
  readonly recovery: AuthRecoveryService
  readonly apiKeys: ApiKeyService
  readonly webhooks: WebhookService
  readonly totp: TotpService
  readonly notifications: NotificationService
}

const defaultAuth: AuthEnv = {
  siteName: 'kawaii-wiki.ts',
  publicOrigin: 'http://localhost:4000',
  passkeyRpId: 'localhost',
  tokenTtlSeconds: 30 * 24 * 60 * 60,
  registration: 'open',
  privateWiki: false,
  requireEmailVerification: false,
  requireTwoFactor: false,
  oidcProviders: [],
}

const defaultMail: MailEnv = {
  smtpUrl: null,
  from: 'kawaii-wiki.ts <no-reply@localhost>',
  timeoutMs: 10_000,
}

const defaultAssetUpload: AssetUploadEnv = {
  maxBytes: 25 * 1024 * 1024,
}

const defaultBranding: BrandingEnv = {
  siteTitle: null,
  accentColor: null,
  theme: null,
  allowHeadInjection: false,
}

const defaultLocalization: LocalizationEnv = {
  defaultLocale: null,
  timezone: null,
  dateFormat: null,
}

export const createServices = (db: DB, options: ServiceOptions = {}): Services => {
  const repositories = createDatabaseRepositories(db)
  const authz = createAuthzService(db)
  authz.ensureDefaults()
  const auth = options.auth ?? defaultAuth
  const assetUpload = options.assetUpload ?? defaultAssetUpload
  const search = options.search ?? { ftsTokenizer: 'unicode61' as const }
  const branding = options.branding ?? defaultBranding
  const localization = options.localization ?? defaultLocalization
  const searchIndexer = createFtsSearchIndexer(db, { configuredTokenizer: search.ftsTokenizer })
  const settings = createSettingsService(db, {
    defaults: {
      ...(branding.siteTitle ? { siteTitle: branding.siteTitle } : {}),
      ...(branding.accentColor ? { accentColor: branding.accentColor } : {}),
      ...(branding.theme ? { theme: branding.theme } : {}),
      registration: auth.registration,
      privateWiki: auth.privateWiki,
      requireEmailVerification: auth.requireEmailVerification,
      requireTwoFactor: auth.requireTwoFactor,
      tokenTtlSeconds: auth.tokenTtlSeconds,
      assetMaxBytes: assetUpload.maxBytes,
      ...(localization.defaultLocale ? { defaultLocale: localization.defaultLocale } : {}),
      ...(localization.timezone ? { timezone: localization.timezone } : {}),
      ...(localization.dateFormat ? { dateFormat: localization.dateFormat } : {}),
    },
    allowHeadInjection: branding.allowHeadInjection,
  })
  const rendererCache = new Map<string, MarkdownRenderer>()
  const rendererForSettings = (): MarkdownRenderer => {
    const publicSettings = settings.public()
    const key = [
      publicSettings.enableMath ? 'math' : 'no-math',
      publicSettings.enableEmoji ? 'emoji' : 'no-emoji',
      publicSettings.defaultLocale,
      publicSettings.timezone,
      publicSettings.dateFormat,
    ].join(':')
    const cached = rendererCache.get(key)
    if (cached) return cached
    const renderer = createRenderer({
      features: {
        math: publicSettings.enableMath,
        emoji: publicSettings.enableEmoji,
      },
      dateTime: {
        locale: publicSettings.defaultLocale,
        timezone: publicSettings.timezone,
        dateFormat: publicSettings.dateFormat,
      },
    })
    rendererCache.set(key, renderer)
    return renderer
  }
  const mail = createMailService(options.mail ?? defaultMail, {
    sender: options.mailSender,
    logger: options.logger,
  })
  const pageService = createPageService(db, searchIndexer, {
    renderMarkdown: (content) => rendererForSettings().renderMarkdown(content),
    defaultLocale: () => settings.public().defaultLocale,
  })
  const authProviders = createAuthProviderService(db, auth, authz, createOidcAuthProviders(db, auth), {
    registration: () => settings.public().registration,
  })
  return {
    pages: pageService,
    search: createSearchService(db, { configuredTokenizer: search.ftsTokenizer, indexer: searchIndexer }),
    users: createUserService(repositories.users),
    assets: createAssetService(db, { urlForStorageName: options.assetUrl, searchIndexer }),
    admin: createAdminService(db, authz),
    comments: createCommentService(db, searchIndexer),
    analytics: createAnalyticsService(db),
    settings,
    authz,
    authProviders,
    oidc: createOidcService(db, auth, authz),
    passkeys: createPasskeyService(db, auth),
    shares: createPageShareService(db),
    templates: createPageTemplateService(repositories.pageTemplates),
    preferences: createUserPreferenceService(repositories.userPreferences),
    linkPreviews: createLinkPreviewService(db, {
      fetcher: options.webhookFetcher,
      resolver: options.webhookResolver,
    }),
    mail,
    recovery: createAuthRecoveryService(db, auth, mail),
    apiKeys: createApiKeyService(db, authz),
    totp: createTotpService(db, auth.siteName),
    notifications: createNotificationService(db),
    webhooks: createWebhookService(db, {
      fetcher: options.webhookFetcher,
      resolver: options.webhookResolver,
      allowPrivateTargets: options.allowPrivateWebhookTargets,
      policy: options.webhookPolicy,
      pageService,
    }),
  }
}

export type { PageService, SearchService, UserService, AssetService, AdminService, CommentService, AnalyticsService, SettingsService, AuthzService, AuthProviderService, OidcService, PasskeyService, PageShareService, PageTemplateService, UserPreferenceService, LinkPreviewService, MailService, MailSender, AuthRecoveryService, ApiKeyService, TotpService, NotificationService, WebhookService, WebhookFetcher, WebhookHostnameResolver }
