import type { DB } from '../client.ts'
import type { UserPreferenceRepository } from '../../repositories/user-preferences.ts'
import type { PageTemplateRepository } from '../../repositories/page-templates.ts'
import { createSqlitePageTemplateRepository } from './page-templates.ts'
import { createSqliteUserPreferenceRepository } from './user-preferences.ts'

/**
 * Repository composition boundary for the active database driver.
 *
 * New service migrations are added here while concrete SQL and schema imports
 * stay below `db/repositories`.
 */
export interface DatabaseRepositories {
  readonly userPreferences: UserPreferenceRepository
  readonly pageTemplates: PageTemplateRepository
}

export const createDatabaseRepositories = (db: DB): DatabaseRepositories => ({
  userPreferences: createSqliteUserPreferenceRepository(db),
  pageTemplates: createSqlitePageTemplateRepository(db),
})
