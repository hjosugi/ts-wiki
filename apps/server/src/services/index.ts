/**
 * Composition root for the service layer. Everything the HTTP layer needs is
 * built here from a single `DB` dependency and passed down explicitly.
 */
import type { DB } from '../db/client.ts'
import type { AuthEnv } from '../env.ts'
import { createPageService, type PageService } from './pages.ts'
import { createSearchService, type SearchService } from './search.ts'
import { createUserService, type UserService } from './users.ts'
import { createAssetService, type AssetService } from './assets.ts'
import { createAdminService, type AdminService } from './admin.ts'
import { createCommentService, type CommentService } from './comments.ts'
import { createAnalyticsService, type AnalyticsService } from './analytics.ts'
import { createSettingsService, type SettingsService } from './settings.ts'
import { createAuthzService, type AuthzService } from './authz.ts'
import { createOidcService, type OidcService } from './oidc.ts'
import { createPasskeyService, type PasskeyService } from './passkeys.ts'
import { createWebhookService, type WebhookFetcher, type WebhookService } from './webhooks.ts'

export interface ServiceOptions {
  readonly assetUrl?: (storageName: string) => string
  readonly auth?: AuthEnv
  readonly webhookFetcher?: WebhookFetcher
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
  readonly oidc: OidcService
  readonly passkeys: PasskeyService
  readonly webhooks: WebhookService
}

const defaultAuth: AuthEnv = {
  siteName: 'ts-wiki',
  publicOrigin: 'http://localhost:4000',
  passkeyRpId: 'localhost',
  tokenTtlSeconds: 30 * 24 * 60 * 60,
  registration: 'open',
  privateWiki: false,
  oidcProviders: [],
}

export const createServices = (db: DB, options: ServiceOptions = {}): Services => {
  const authz = createAuthzService(db)
  authz.ensureDefaults()
  const auth = options.auth ?? defaultAuth
  return {
    pages: createPageService(db),
    search: createSearchService(db),
    users: createUserService(db),
    assets: createAssetService(db, { urlForStorageName: options.assetUrl }),
    admin: createAdminService(db, authz),
    comments: createCommentService(db),
    analytics: createAnalyticsService(db),
    settings: createSettingsService(db),
    authz,
    oidc: createOidcService(db, auth, authz),
    passkeys: createPasskeyService(db, auth),
    webhooks: createWebhookService(db, { fetcher: options.webhookFetcher }),
  }
}

export type { PageService, SearchService, UserService, AssetService, AdminService, CommentService, AnalyticsService, SettingsService, AuthzService, OidcService, PasskeyService, WebhookService, WebhookFetcher }
