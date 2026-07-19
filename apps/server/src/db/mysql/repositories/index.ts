import type { ServiceRepositories } from '../../../repositories/index.ts'
import type { MysqlDb } from '../client.ts'
import { createMysqlUserRepository } from './users.ts'
import { createMysqlAuthAccountRepository } from './auth-accounts.ts'
import { createMysqlAuthRecoveryRepository } from './auth-recovery.ts'
import { createMysqlUserPreferenceRepository } from './user-preferences.ts'
import { createMysqlAuthzRepository } from './authz.ts'
import { createMysqlOidcStateRepository } from './oidc-states.ts'
import { createMysqlPasskeyRepository } from './passkeys.ts'
import { createMysqlTotpRepository } from './totp.ts'
import { createMysqlApiKeyRepository } from './api-keys.ts'
import { createMysqlPageShareRepository } from './page-shares.ts'
import { createMysqlAnalyticsRepository } from './analytics.ts'
import { createMysqlLinkPreviewRepository } from './link-previews.ts'
import { createMysqlNotificationRepository } from './notifications.ts'
import { createMysqlCommentRepository } from './comments.ts'
import { createMysqlAdminRepository } from './admin.ts'
import { createMysqlWebhookSubscriptionRepository } from './webhook-subscriptions.ts'
import { createMysqlWebhookDeliveryRepository } from './webhook-deliveries.ts'
import { createMysqlWebhookAutomationRepository } from './webhook-automation.ts'
import { createMysqlAssetRepository } from './assets.ts'
import { createMysqlSettingsRepository } from './settings.ts'
import { createMysqlPageTemplateRepository } from './page-templates.ts'
import { createMysqlPageReadRepository } from './pages.ts'

/** MySQL composition of the driver-neutral repository surface. */
export const createMysqlDatabaseRepositories = (db: MysqlDb): ServiceRepositories => ({
  userPreferences: createMysqlUserPreferenceRepository(db),
  pageTemplates: createMysqlPageTemplateRepository(db),
  users: createMysqlUserRepository(db),
  authAccounts: createMysqlAuthAccountRepository(db),
  authRecovery: createMysqlAuthRecoveryRepository(db),
  authz: createMysqlAuthzRepository(db),
  oidcStates: createMysqlOidcStateRepository(db),
  passkeys: createMysqlPasskeyRepository(db),
  totp: createMysqlTotpRepository(db),
  apiKeys: createMysqlApiKeyRepository(db),
  pageShares: createMysqlPageShareRepository(db),
  analytics: createMysqlAnalyticsRepository(db),
  linkPreviews: createMysqlLinkPreviewRepository(db),
  notifications: createMysqlNotificationRepository(db),
  comments: createMysqlCommentRepository(db),
  admin: createMysqlAdminRepository(db),
  webhookSubscriptions: createMysqlWebhookSubscriptionRepository(db),
  webhookDeliveries: createMysqlWebhookDeliveryRepository(db),
  webhookAutomation: createMysqlWebhookAutomationRepository(db),
  assets: createMysqlAssetRepository(db),
  settings: createMysqlSettingsRepository(db),
  pageReads: createMysqlPageReadRepository(db),
})
