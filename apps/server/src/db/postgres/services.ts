import { createServiceLayer, type ServiceOptions, type Services } from '../../services/index.ts'
import type { PostgresDb } from './client.ts'
import { createPostgresDatabaseRepositories } from './repositories/index.ts'
import { createPostgresPageWriteRepository } from './repositories/pages.ts'
import { createUnavailablePostgresSearchIndexer } from './search.ts'

/**
 * PostgreSQL composition root; services only receive driver-neutral contracts.
 *
 * Search is wired to the placeholder indexer until the tsvector implementation
 * lands, so every non-search flow works through the composed service layer.
 */
export const createPostgresServices = (db: PostgresDb, options: ServiceOptions = {}): Services => {
  const searchIndexer = createUnavailablePostgresSearchIndexer()
  return createServiceLayer(
    {
      repositories: createPostgresDatabaseRepositories(db),
      pageWrites: createPostgresPageWriteRepository(db, searchIndexer),
      searchIndexer,
    },
    options,
  )
}
