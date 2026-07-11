import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dataDir = mkdtempSync(join(tmpdir(), 'kawaii-wiki-e2e-'))

Object.assign(process.env, {
  NODE_ENV: 'production',
  PORT: process.env.PORT ?? '4100',
  DATA_DIR: dataDir,
  DATABASE_PATH: join(dataDir, 'wiki.sqlite'),
  JWT_SECRET: process.env.JWT_SECRET ?? 'e2e-only-secret-with-more-than-32-characters',
  WEB_DIST_DIR: join(import.meta.dir, '../apps/web/dist'),
})

await import('../apps/server/src/index.ts')
