import type { DB } from '../client.ts'
import type { ServiceRepositories } from '../../repositories/index.ts'
import { createSqlitePageTemplateRepository } from './page-templates.ts'
import { createSqliteUserRepository } from './users.ts'
import { createSqliteAuthAccountRepository } from './auth-accounts.ts'
import { createSqliteAuthRecoveryRepository } from './auth-recovery.ts'
import { createSqliteUserPreferenceRepository } from './user-preferences.ts'
import { createSqliteAuthzRepository } from './authz.ts'
import { createSqliteOidcStateRepository } from './oidc-states.ts'
import { createSqlitePasskeyRepository } from './passkeys.ts'
import { createSqliteTotpRepository } from './totp.ts'
import { createSqliteApiKeyRepository } from './api-keys.ts'
import { createSqlitePageShareRepository } from './page-shares.ts'
import { createSqliteAnalyticsRepository } from './analytics.ts'
import { createSqliteLinkPreviewRepository } from './link-previews.ts'
import { createSqliteNotificationRepository } from './notifications.ts'
import { createSqliteCommentRepository } from './comments.ts'
import { createSqliteAdminRepository } from './admin.ts'
import { createSqliteWebhookSubscriptionRepository } from './webhook-subscriptions.ts'
import { createSqliteWebhookDeliveryRepository } from './webhook-deliveries.ts'
import { createSqliteWebhookAutomationRepository } from './webhook-automation.ts'
import { createSqliteAssetRepository } from './assets.ts'
import { createSqliteSettingsRepository } from './settings.ts'
import { createSqlitePageReadRepository } from './pages.ts'

/**
 * Repository composition boundary for the active database driver.
 *
 * New service migrations are added here while concrete SQL and schema imports
 * stay below `db/repositories`.
 */
export const createDatabaseRepositories = (db: DB): ServiceRepositories => ({
  userPreferences: createSqliteUserPreferenceRepository(db),
  pageTemplates: createSqlitePageTemplateRepository(db),
  users: createSqliteUserRepository(db),
  authAccounts: createSqliteAuthAccountRepository(db),
  authRecovery: createSqliteAuthRecoveryRepository(db),
  authz: createSqliteAuthzRepository(db),
  oidcStates: createSqliteOidcStateRepository(db),
  passkeys: createSqlitePasskeyRepository(db),
  totp: createSqliteTotpRepository(db),
  apiKeys: createSqliteApiKeyRepository(db),
  pageShares: createSqlitePageShareRepository(db),
  analytics: createSqliteAnalyticsRepository(db),
  linkPreviews: createSqliteLinkPreviewRepository(db),
  notifications: createSqliteNotificationRepository(db),
  comments: createSqliteCommentRepository(db),
  admin: createSqliteAdminRepository(db),
  webhookSubscriptions: createSqliteWebhookSubscriptionRepository(db),
  webhookDeliveries: createSqliteWebhookDeliveryRepository(db),
  webhookAutomation: createSqliteWebhookAutomationRepository(db),
  assets: createSqliteAssetRepository(db),
  settings: createSqliteSettingsRepository(db),
  pageReads: createSqlitePageReadRepository(db),
})
