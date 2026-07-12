import type { AdminRepository } from './admin.ts'
import type { AnalyticsRepository } from './analytics.ts'
import type { ApiKeyRepository } from './api-keys.ts'
import type { AssetRepository } from './assets.ts'
import type { AuthAccountRepository } from './auth-accounts.ts'
import type { AuthRecoveryRepository } from './auth-recovery.ts'
import type { AuthzRepository } from './authz.ts'
import type { CommentRepository } from './comments.ts'
import type { LinkPreviewRepository } from './link-previews.ts'
import type { NotificationRepository } from './notifications.ts'
import type { OidcStateRepository } from './oidc-states.ts'
import type { PageReadRepository, PageWriteRepository } from './pages.ts'
import type { PageShareRepository } from './page-shares.ts'
import type { PageTemplateRepository } from './page-templates.ts'
import type { PasskeyRepository } from './passkeys.ts'
import type { SettingsRepository } from './settings.ts'
import type { TotpRepository } from './totp.ts'
import type { UserPreferenceRepository } from './user-preferences.ts'
import type { UserRepository } from './users.ts'
import type { WebhookAutomationRepository, WebhookDeliveryRepository, WebhookSubscriptionRepository } from './webhooks.ts'

/** Complete driver-neutral persistence surface consumed by the service layer. */
export interface ServiceRepositories {
  readonly userPreferences: UserPreferenceRepository
  readonly pageTemplates: PageTemplateRepository
  readonly users: UserRepository
  readonly authAccounts: AuthAccountRepository
  readonly authRecovery: AuthRecoveryRepository
  readonly authz: AuthzRepository
  readonly oidcStates: OidcStateRepository
  readonly passkeys: PasskeyRepository
  readonly totp: TotpRepository
  readonly apiKeys: ApiKeyRepository
  readonly pageShares: PageShareRepository
  readonly analytics: AnalyticsRepository
  readonly linkPreviews: LinkPreviewRepository
  readonly notifications: NotificationRepository
  readonly comments: CommentRepository
  readonly admin: AdminRepository
  readonly webhookSubscriptions: WebhookSubscriptionRepository
  readonly webhookDeliveries: WebhookDeliveryRepository
  readonly webhookAutomation: WebhookAutomationRepository
  readonly assets: AssetRepository
  readonly settings: SettingsRepository
  readonly pageReads: PageReadRepository
}

export interface ServiceDataLayer {
  readonly repositories: ServiceRepositories
  readonly pageWrites: PageWriteRepository
}
