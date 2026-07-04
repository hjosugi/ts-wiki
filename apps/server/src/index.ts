/**
 * Server entry point. Wires env → db → app and starts listening.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnv } from './env.ts'
import { createDb } from './db/client.ts'
import { createApp } from './http/app.ts'

const env = loadEnv()
mkdirSync(join(env.dataDir, 'assets'), { recursive: true })

const db = createDb(env.database)
const app = createApp({ db, env }).listen(env.port)

const shutdown = () => {
  app.server?.stop(true)
  db.$client.close()
  process.exit(0)
}

process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)

console.log(`▲ ts-wiki server  →  http://localhost:${env.port}`)
console.log(`  health: http://localhost:${env.port}/api/health`)

export type { App } from './http/app.ts'
export default app
