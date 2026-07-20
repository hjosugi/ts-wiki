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

const env = loadEnv()
mkdirSync(join(env.dataDir, 'assets'), { recursive: true })

// The Elasticsearch search backend is still being built; its config parses and
// its client is tested, but it is not yet wired into the composition. Fail fast
// rather than silently falling back to FTS5 (no placeholder choices).
if (env.search.backend === 'elasticsearch') {
  throw new Error('SEARCH_BACKEND=elasticsearch is not yet available; use the default fts5.')
}

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
const app = createApp({ database, env }).listen(env.port)

const shutdown = async () => {
  app.server?.stop(true)
  await database.close()
  process.exit(0)
}

process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)

console.log(`🌸 kawaii-wiki.ts server  →  http://localhost:${env.port}`)
console.log(`  database: ${database.driver}`)
console.log(`  health: http://localhost:${env.port}/api/health`)

export type { App } from './http/app.ts'
export default app
