import { createServiceLayer, type ServiceOptions, type Services } from '../../services/index.ts'
import type { PostgresClient } from './client.ts'
import { createPostgresDatabaseRepositories } from './repositories/index.ts'
import { createPostgresPageWriteRepository } from './repositories/pages.ts'
import { createPostgresSearchIndexer } from './repositories/search.ts'

/** PostgreSQL composition root; services only receive driver-neutral contracts. */
export const createPostgresServices = (client: PostgresClient, options: ServiceOptions = {}): Services => {
  const searchIndexer = options.searchIndexer ?? createPostgresSearchIndexer(client, {
    configuredTokenizer: options.search?.ftsTokenizer,
  })
  return createServiceLayer(
    {
      repositories: createPostgresDatabaseRepositories(client.db),
      pageWrites: createPostgresPageWriteRepository(client.db, searchIndexer, {
        searchBackend: options.search?.backend ?? 'fts5',
      }),
      searchIndexer,
      ping: () => client.ping(),
    },
    options,
  )
}
