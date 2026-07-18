import { join } from 'node:path'
import type { Env } from '../env.ts'
import { ASSET_MAX_BYTES } from '../services/assets.ts'

/**
 * Fully-populated Env for HTTP-layer tests.
 *
 * `database` is a placeholder — `createApp` reaches the database only through its
 * injected {@link DatabaseAdapter}, never through `env.database` — so the same
 * env drives the SQLite and Postgres app tests alike. Realtime uses the in-memory
 * bus to keep tests free of background polling.
 */
export const testEnv = (dataDir: string, cors: Env['cors'] = { origins: null }): Env => ({
  port: 0,
  database: { driver: 'sqlite', path: ':memory:' },
  databasePath: ':memory:',
  dataDir,
  webDistDir: join(dataDir, 'web-dist'),
  jwtSecret: 'test-secret',
  trustProxyHeaders: false,
  cors,
  auth: {
    siteName: 'ts-wiki-test',
    publicOrigin: 'http://localhost',
    passkeyRpId: 'localhost',
    tokenTtlSeconds: 30 * 24 * 60 * 60,
    registration: 'open',
    privateWiki: false,
    requireEmailVerification: false,
    requireTwoFactor: false,
    oidcProviders: [],
  },
  search: {
    ftsTokenizer: 'unicode61',
  },
  assetUpload: {
    maxBytes: ASSET_MAX_BYTES,
  },
  webhooks: {
    allowPrivateTargets: false,
    maxAttempts: 3,
    backoffMs: [60_000, 120_000, 240_000, 480_000, 900_000],
    maxResponseBytes: 2000,
    maxErrorBytes: 1000,
  },
  audit: {
    persist: true,
    retentionDays: 90,
    maxRows: 10_000,
  },
  mail: {
    smtpUrl: null,
    from: 'ts-wiki <no-reply@localhost>',
    timeoutMs: 10_000,
  },
  branding: {
    siteTitle: null,
    accentColor: null,
    theme: null,
    allowHeadInjection: false,
  },
  localization: {
    defaultLocale: null,
    timezone: null,
    dateFormat: null,
  },
  assetStorage: {
    type: 'local',
    dataDir,
    publicBaseUrl: null,
  },
  git: {
    enabled: false,
    sourceOfTruth: false,
    dir: join(dataDir, 'repo'),
    branch: 'main',
    remote: null,
    remoteUrl: null,
    authorName: 'Test',
    authorEmail: 'test@localhost',
    syncIntervalMs: 0,
  },
  realtime: {
    eventBus: 'memory',
    instanceId: 'test-instance',
    pollIntervalMs: 50,
  },
})
