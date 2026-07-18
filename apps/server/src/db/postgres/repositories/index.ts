import type { ServiceRepositories } from '../../../repositories/index.ts'
import type { PostgresDb } from '../client.ts'
import { createPostgresUserRepository } from './users.ts'
import { createPostgresAuthAccountRepository } from './auth-accounts.ts'
import { createPostgresAuthRecoveryRepository } from './auth-recovery.ts'
import { createPostgresUserPreferenceRepository } from './user-preferences.ts'
import { createPostgresAuthzRepository } from './authz.ts'
import { createPostgresOidcStateRepository } from './oidc-states.ts'
import { createPostgresPasskeyRepository } from './passkeys.ts'
import { createPostgresTotpRepository } from './totp.ts'
import { createPostgresApiKeyRepository } from './api-keys.ts'
import { createPostgresPageShareRepository } from './page-shares.ts'
import { createPostgresAnalyticsRepository } from './analytics.ts'
import { createPostgresLinkPreviewRepository } from './link-previews.ts'
import { createPostgresNotificationRepository } from './notifications.ts'
import { createPostgresCommentRepository } from './comments.ts'
import { createPostgresAdminRepository } from './admin.ts'
import { createPostgresWebhookSubscriptionRepository } from './webhook-subscriptions.ts'
import { createPostgresWebhookDeliveryRepository } from './webhook-deliveries.ts'
import { createPostgresWebhookAutomationRepository } from './webhook-automation.ts'
import { createPostgresAssetRepository } from './assets.ts'
import { createPostgresSettingsRepository } from './settings.ts'
import { createPostgresPageTemplateRepository } from './page-templates.ts'
import { createPostgresPageReadRepository } from './pages.ts'

/** PostgreSQL composition of the driver-neutral repository surface. */
export const createPostgresDatabaseRepositories = (db: PostgresDb): ServiceRepositories => ({
  userPreferences: createPostgresUserPreferenceRepository(db),
  pageTemplates: createPostgresPageTemplateRepository(db),
  users: createPostgresUserRepository(db),
  authAccounts: createPostgresAuthAccountRepository(db),
  authRecovery: createPostgresAuthRecoveryRepository(db),
  authz: createPostgresAuthzRepository(db),
  oidcStates: createPostgresOidcStateRepository(db),
  passkeys: createPostgresPasskeyRepository(db),
  totp: createPostgresTotpRepository(db),
  apiKeys: createPostgresApiKeyRepository(db),
  pageShares: createPostgresPageShareRepository(db),
  analytics: createPostgresAnalyticsRepository(db),
  linkPreviews: createPostgresLinkPreviewRepository(db),
  notifications: createPostgresNotificationRepository(db),
  comments: createPostgresCommentRepository(db),
  admin: createPostgresAdminRepository(db),
  webhookSubscriptions: createPostgresWebhookSubscriptionRepository(db),
  webhookDeliveries: createPostgresWebhookDeliveryRepository(db),
  webhookAutomation: createPostgresWebhookAutomationRepository(db),
  assets: createPostgresAssetRepository(db),
  settings: createPostgresSettingsRepository(db),
  pageReads: createPostgresPageReadRepository(db),
})
