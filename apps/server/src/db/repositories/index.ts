import type { DB } from '../client.ts'
import type { UserPreferenceRepository } from '../../repositories/user-preferences.ts'
import type { PageTemplateRepository } from '../../repositories/page-templates.ts'
import { createSqlitePageTemplateRepository } from './page-templates.ts'
import type { UserRepository } from '../../repositories/users.ts'
import { createSqliteUserRepository } from './users.ts'
import type { AuthAccountRepository } from '../../repositories/auth-accounts.ts'
import type { AuthRecoveryRepository } from '../../repositories/auth-recovery.ts'
import { createSqliteAuthAccountRepository } from './auth-accounts.ts'
import { createSqliteAuthRecoveryRepository } from './auth-recovery.ts'
import { createSqliteUserPreferenceRepository } from './user-preferences.ts'
import type { AuthzRepository } from '../../repositories/authz.ts'
import { createSqliteAuthzRepository } from './authz.ts'
import type { OidcStateRepository } from '../../repositories/oidc-states.ts'
import { createSqliteOidcStateRepository } from './oidc-states.ts'
import type { PasskeyRepository } from '../../repositories/passkeys.ts'
import { createSqlitePasskeyRepository } from './passkeys.ts'
import type { TotpRepository } from '../../repositories/totp.ts'
import { createSqliteTotpRepository } from './totp.ts'
import type { ApiKeyRepository } from '../../repositories/api-keys.ts'
import { createSqliteApiKeyRepository } from './api-keys.ts'
import type { PageShareRepository } from '../../repositories/page-shares.ts'
import { createSqlitePageShareRepository } from './page-shares.ts'
import type { AnalyticsRepository } from '../../repositories/analytics.ts'
import { createSqliteAnalyticsRepository } from './analytics.ts'
import type { LinkPreviewRepository } from '../../repositories/link-previews.ts'
import { createSqliteLinkPreviewRepository } from './link-previews.ts'
import type { NotificationRepository } from '../../repositories/notifications.ts'
import { createSqliteNotificationRepository } from './notifications.ts'
import type { CommentRepository } from '../../repositories/comments.ts'
import { createSqliteCommentRepository } from './comments.ts'
import type { AdminRepository } from '../../repositories/admin.ts'
import { createSqliteAdminRepository } from './admin.ts'
import type { WebhookDeliveryRepository, WebhookSubscriptionRepository } from '../../repositories/webhooks.ts'
import { createSqliteWebhookSubscriptionRepository } from './webhook-subscriptions.ts'
import { createSqliteWebhookDeliveryRepository } from './webhook-deliveries.ts'

/**
 * Repository composition boundary for the active database driver.
 *
 * New service migrations are added here while concrete SQL and schema imports
 * stay below `db/repositories`.
 */
export interface DatabaseRepositories {
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
}

export const createDatabaseRepositories = (db: DB): DatabaseRepositories => ({
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
})
