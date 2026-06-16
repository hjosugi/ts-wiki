/**
 * Typed runtime configuration. Read once, passed explicitly into the app
 * factory — no `process.env` reads scattered through the codebase, no globals.
 */
import { join } from 'node:path'

export interface GitEnv {
  readonly enabled: boolean
  readonly dir: string
  readonly branch: string
  readonly remote: string | null
  readonly authorName: string
  readonly authorEmail: string
}

export interface RealtimeEnv {
  readonly eventBus: 'db' | 'memory'
  readonly instanceId: string
  readonly pollIntervalMs: number
}

export interface Env {
  readonly port: number
  readonly databasePath: string
  readonly dataDir: string
  readonly jwtSecret: string
  readonly git: GitEnv
  readonly realtime: RealtimeEnv
}

export const loadEnv = (): Env => {
  const dataDir = process.env.DATA_DIR ?? './data'
  const eventBus = process.env.WIKI_EVENT_BUS === 'memory' ? 'memory' : 'db'
  return {
    port: Number(process.env.PORT ?? 4000),
    databasePath: process.env.DATABASE_PATH ?? './data/wiki.sqlite',
    dataDir,
    jwtSecret: process.env.JWT_SECRET ?? 'dev-insecure-secret-change-me',
    git: {
      // NB: namespaced WIKI_GIT_* — plain GIT_DIR / GIT_AUTHOR_* are reserved
      // Git env vars and would hijack every git command we run.
      enabled: process.env.WIKI_GIT_ENABLED === 'true' || process.env.WIKI_GIT_ENABLED === '1',
      dir: process.env.WIKI_GIT_DIR ?? join(dataDir, 'repo'),
      branch: process.env.WIKI_GIT_BRANCH ?? 'main',
      remote: process.env.WIKI_GIT_REMOTE ?? null,
      authorName: process.env.WIKI_GIT_AUTHOR_NAME ?? 'open-wiki',
      authorEmail: process.env.WIKI_GIT_AUTHOR_EMAIL ?? 'wiki@localhost',
    },
    realtime: {
      eventBus,
      instanceId: process.env.WIKI_INSTANCE_ID ?? crypto.randomUUID(),
      pollIntervalMs: Number(process.env.WIKI_EVENT_POLL_MS ?? 250),
    },
  }
}
