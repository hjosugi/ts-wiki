import { createServiceLayer, type ServiceOptions, type Services } from '../../services/index.ts'
import type { MysqlClient } from './client.ts'
import { createMysqlDatabaseRepositories } from './repositories/index.ts'
import { createMysqlPageWriteRepository } from './repositories/pages.ts'
import { createMysqlSearchIndexer } from './repositories/search.ts'

/** MySQL composition root; services only receive driver-neutral contracts. */
export const createMysqlServices = (client: MysqlClient, options: ServiceOptions = {}): Services => {
  const searchIndexer = createMysqlSearchIndexer(client, {
    configuredTokenizer: options.search?.ftsTokenizer,
  })
  return createServiceLayer(
    {
      repositories: createMysqlDatabaseRepositories(client.db),
      pageWrites: createMysqlPageWriteRepository(client.db, searchIndexer),
      searchIndexer,
      ping: () => client.ping(),
    },
    options,
  )
}
