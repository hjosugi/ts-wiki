/**
 * Typed runtime configuration. Read once, passed explicitly into the app
 * factory — no `process.env` reads scattered through the codebase, no globals.
 */
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_JWT_SECRET = 'dev-insecure-secret-change-me'

type EnvSource = Record<string, string | undefined>

export interface GitEnv {
  readonly enabled: boolean
  readonly dir: string
  readonly branch: string
  readonly remote: string | null
  readonly remoteUrl?: string | null
  readonly authorName: string
  readonly authorEmail: string
  /** Auto-sync (pull→import→push) interval in ms; 0 disables the scheduler. */
  readonly syncIntervalMs: number
}

export interface RealtimeEnv {
  readonly eventBus: 'db' | 'memory'
  readonly instanceId: string
  readonly pollIntervalMs: number
}

export interface CorsEnv {
  /** null = permissive CORS, [] = no cross-origin allow-list, values = exact allowed origins. */
  readonly origins: readonly string[] | null
}

export interface Env {
  readonly port: number
  readonly databasePath: string
  readonly dataDir: string
  readonly webDistDir: string
  readonly jwtSecret: string
  readonly cors: CorsEnv
  readonly git: GitEnv
  readonly realtime: RealtimeEnv
}

const isProduction = (source: EnvSource): boolean =>
  source.NODE_ENV === 'production' || source.BUN_ENV === 'production'

const parseCorsOrigins = (value: string | undefined): readonly string[] | null => {
  if (!value?.trim()) return null
  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  return origins.length > 0 ? origins : null
}

const loadJwtSecret = (source: EnvSource): string => {
  const jwtSecret =
    source.JWT_SECRET && source.JWT_SECRET.trim().length > 0 ? source.JWT_SECRET : DEFAULT_JWT_SECRET

  if (isProduction(source) && jwtSecret.trim() === DEFAULT_JWT_SECRET) {
    throw new Error(
      'Refusing to start in production with the default JWT secret. Set JWT_SECRET to a strong unique value.',
    )
  }

  return jwtSecret
}

export const loadEnv = (source: EnvSource = process.env): Env => {
  const production = isProduction(source)
  const dataDir = source.DATA_DIR ?? './data'
  const eventBus = source.TS_WIKI_EVENT_BUS === 'memory' ? 'memory' : 'db'
  const configuredCorsOrigins = parseCorsOrigins(source.TS_WIKI_CORS_ORIGINS)
  const remoteUrl = source.TS_WIKI_GIT_REMOTE_URL?.trim() || null
  const remote = source.TS_WIKI_GIT_REMOTE?.trim() || (remoteUrl ? 'origin' : null)
  return {
    port: Number(source.PORT ?? 4000),
    databasePath: source.DATABASE_PATH ?? './data/ts-wiki.sqlite',
    dataDir,
    webDistDir: source.WEB_DIST_DIR ?? fileURLToPath(new URL('../../web/dist', import.meta.url)),
    jwtSecret: loadJwtSecret(source),
    cors: {
      origins: configuredCorsOrigins ?? (production ? [] : null),
    },
    git: {
      // NB: namespaced TS_WIKI_GIT_* — plain GIT_DIR / GIT_AUTHOR_* are reserved
      // Git env vars and would hijack every git command we run.
      enabled: source.TS_WIKI_GIT_ENABLED === 'true' || source.TS_WIKI_GIT_ENABLED === '1',
      dir: source.TS_WIKI_GIT_DIR ?? join(dataDir, 'repo'),
      branch: source.TS_WIKI_GIT_BRANCH ?? 'main',
      remote,
      remoteUrl,
      authorName: source.TS_WIKI_GIT_AUTHOR_NAME ?? 'ts-wiki',
      authorEmail: source.TS_WIKI_GIT_AUTHOR_EMAIL ?? 'ts-wiki@localhost',
      syncIntervalMs: Number(source.TS_WIKI_GIT_SYNC_INTERVAL_MS ?? 0),
    },
    realtime: {
      eventBus,
      instanceId: source.TS_WIKI_INSTANCE_ID ?? crypto.randomUUID(),
      pollIntervalMs: Number(source.TS_WIKI_EVENT_POLL_MS ?? 250),
    },
  }
}
