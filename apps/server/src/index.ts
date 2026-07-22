/**
 * Server entry point. Wires env → db → app and starts listening.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnv } from './env.ts'
import { createDb } from './db/client.ts'
import { createPostgresClient } from './db/postgres/client.ts'
import { runPostgresMigrations } from './db/postgres/migrate.ts'
import { createMysqlClient } from './db/mysql/client.ts'
import { runMysqlMigrations } from './db/mysql/migrate.ts'
import { createSqliteDatabaseAdapter, type DatabaseAdapter } from './http/database-adapter.ts'
import { createPostgresDatabaseAdapter } from './http/postgres-adapter.ts'
import { createMysqlDatabaseAdapter } from './http/mysql-adapter.ts'
import { createApp } from './http/app.ts'
import { createElasticsearchClient } from './search/elasticsearch/client.ts'
import { createElasticsearchSearchIndexer } from './search/elasticsearch/search.ts'
import { startOutboxWorker, type OutboxWorker } from './search/elasticsearch/worker.ts'
import type { SearchIndexer } from './services/search.ts'

const env = loadEnv()
mkdirSync(join(env.dataDir, 'assets'), { recursive: true })

/** Open the connection for the configured driver, migrating server DBs on boot. */
const openDatabase = async (): Promise<DatabaseAdapter> => {
  if (env.database.driver === 'postgres') {
    const client = createPostgresClient(env.database)
    await client.ping() // fail fast on an unreachable server before migrating
    await runPostgresMigrations(client.sql)
    return createPostgresDatabaseAdapter(client)
  }
  if (env.database.driver === 'mysql') {
    const client = createMysqlClient(env.database)
    await client.ping() // fail fast on an unreachable server before migrating
    await runMysqlMigrations(client.pool)
    return createMysqlDatabaseAdapter(client)
  }
  return createSqliteDatabaseAdapter(createDb(env.database, { ftsTokenizer: env.search.ftsTokenizer }))
}

const database = await openDatabase()
let searchIndexer: SearchIndexer | undefined
let searchWorker: OutboxWorker | undefined
let closeSearch = (): void => {}
if (env.search.backend === 'elasticsearch') {
  const config = env.search.elasticsearch
  if (!config) throw new Error('Elasticsearch configuration is missing.')
  const client = createElasticsearchClient(config)
  const elasticsearch = createElasticsearchSearchIndexer({
    ...database.elasticsearch,
    client,
    indexPrefix: config.indexPrefix,
  })
  await elasticsearch.initialize()
  searchWorker = startOutboxWorker({
    ...database.elasticsearch,
    client,
    indexPrefix: config.indexPrefix,
  })
  searchIndexer = elasticsearch
  closeSearch = () => client.close()
}

const app = createApp({ database, env, searchIndexer }).listen(env.port)

const shutdown = async () => {
  app.server?.stop(true)
  searchWorker?.stop()
  closeSearch()
  await database.close()
  process.exit(0)
}

process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)

console.log(`🌸 kawaii-wiki.ts server  →  http://localhost:${env.port}`)
console.log(`  database: ${database.driver}`)
console.log(`  search: ${env.search.backend ?? 'fts5'}`)
console.log(`  health: http://localhost:${env.port}/api/health`)

export type { App } from './http/app.ts'
export default app
