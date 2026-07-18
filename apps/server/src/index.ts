/**
 * Server entry point. Wires env → db → app and starts listening.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnv } from './env.ts'
import { createDb } from './db/client.ts'
import { createSqliteDatabaseAdapter, type DatabaseAdapter } from './http/database-adapter.ts'
import { createApp } from './http/app.ts'

const env = loadEnv()
mkdirSync(join(env.dataDir, 'assets'), { recursive: true })

const database: DatabaseAdapter = createSqliteDatabaseAdapter(
  createDb(env.database, { ftsTokenizer: env.search.ftsTokenizer }),
)
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
