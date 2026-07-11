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
}

export const createDatabaseRepositories = (db: DB): DatabaseRepositories => ({
  userPreferences: createSqliteUserPreferenceRepository(db),
  pageTemplates: createSqlitePageTemplateRepository(db),
  users: createSqliteUserRepository(db),
  authAccounts: createSqliteAuthAccountRepository(db),
  authRecovery: createSqliteAuthRecoveryRepository(db),
  authz: createSqliteAuthzRepository(db),
  oidcStates: createSqliteOidcStateRepository(db),
})
