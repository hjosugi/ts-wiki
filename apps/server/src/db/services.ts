import type { DB } from './client.ts'
import { createDatabaseRepositories } from './repositories/index.ts'
import { createSqlitePageWriteRepository } from './repositories/pages.ts'
import { createFtsSearchIndexer } from './repositories/search.ts'
import { createServiceLayer, type ServiceOptions, type Services } from '../services/index.ts'

/** SQLite/libSQL composition root; services only receive driver-neutral contracts. */
export const createServices = (db: DB, options: ServiceOptions = {}): Services => {
  const search = options.search ?? { ftsTokenizer: 'unicode61' as const }
  const searchIndexer = options.searchIndexer ?? createFtsSearchIndexer(db, { configuredTokenizer: search.ftsTokenizer })
  return createServiceLayer({
    repositories: createDatabaseRepositories(db),
    pageWrites: createSqlitePageWriteRepository(db, searchIndexer, { searchBackend: search.backend ?? 'fts5' }),
    searchIndexer,
    ping: async () => { db.$client.prepare('SELECT 1 AS ready').get() },
  }, options)
}
