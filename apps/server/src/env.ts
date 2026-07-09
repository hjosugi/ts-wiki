/**
 * Typed runtime configuration. Read once, passed explicitly into the app
 * factory — no `process.env` reads scattered through the codebase, no globals.
 */
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_LIBSQL_REPLICA_FILENAME,
  DEFAULT_SQLITE_PATH,
  type DatabaseConfig,
  type DatabaseDriver,
} from './db/config.ts'
import type { FtsTokenizer } from './db/migrate.ts'
import type { AssetStorageConfig } from './storage/assets.ts'

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

export interface SearchEnv {
  readonly ftsTokenizer: FtsTokenizer
}

export interface OidcProviderEnv {
  readonly id: string
  readonly label: string
  readonly issuer: string
  readonly clientId: string
  readonly clientSecret: string
  readonly redirectUri: string
  readonly scopes: readonly string[]
  readonly allowRegistration: boolean
  readonly allowedEmailDomains: readonly string[]
  readonly defaultRole: 'admin' | 'editor' | 'viewer'
}

export interface AuthEnv {
  readonly siteName: string
  readonly publicOrigin: string
  readonly passkeyRpId: string
  readonly tokenTtlSeconds: number
  readonly registration: 'open' | 'off'
  readonly privateWiki: boolean
  readonly requireEmailVerification: boolean
  readonly requireTwoFactor: boolean
  readonly oidcProviders: readonly OidcProviderEnv[]
}

export interface AssetUploadEnv {
  readonly maxBytes: number
}

export interface WebhookEnv {
  readonly allowPrivateTargets: boolean
  readonly maxAttempts: number
  readonly backoffMs: readonly number[]
  readonly maxResponseBytes: number
  readonly maxErrorBytes: number
}

export interface AuditEnv {
  readonly persist: boolean
  readonly retentionDays: number
  readonly maxRows: number
}

export interface MailEnv {
  readonly smtpUrl: string | null
  readonly from: string
  readonly timeoutMs: number
}

export interface BrandingEnv {
  readonly siteTitle: string | null
  readonly accentColor: string | null
  readonly theme: 'system' | 'light' | 'dark' | null
  readonly allowHeadInjection: boolean
}

export interface LocalizationEnv {
  readonly defaultLocale: string | null
  readonly timezone: string | null
  readonly dateFormat: 'short' | 'medium' | 'long' | null
}

export interface Env {
  readonly port: number
  readonly database: DatabaseConfig
  /** @deprecated Use database.driver/path. Kept for older tests and callers. */
  readonly databasePath: string
  readonly dataDir: string
  readonly webDistDir: string
  readonly jwtSecret: string
  readonly trustProxyHeaders: boolean
  readonly cors: CorsEnv
  readonly auth: AuthEnv
  readonly search: SearchEnv
  readonly assetUpload: AssetUploadEnv
  readonly webhooks: WebhookEnv
  readonly audit: AuditEnv
  readonly mail: MailEnv
  readonly branding: BrandingEnv
  readonly localization: LocalizationEnv
  readonly assetStorage: AssetStorageConfig
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

const parseCsv = (value: string | undefined): readonly string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

const parseRole = (value: string | undefined): 'admin' | 'editor' | 'viewer' =>
  value === 'admin' || value === 'editor' ? value : 'viewer'

const parseDatabaseDriver = (value: string | undefined): DatabaseDriver => {
  const driver = value?.trim().toLowerCase() || 'sqlite'
  if (driver === 'sqlite' || driver === 'libsql') return driver
  throw new Error('DATABASE_DRIVER must be either "sqlite" or "libsql".')
}

const parseFtsTokenizer = (value: string | undefined): FtsTokenizer => {
  const tokenizer = value?.trim().toLowerCase() || 'unicode61'
  if (tokenizer === 'unicode61' || tokenizer === 'trigram') return tokenizer
  throw new Error('TS_WIKI_FTS_TOKENIZER must be either "unicode61" or "trigram".')
}

const parseTheme = (value: string | undefined): BrandingEnv['theme'] => {
  const theme = value?.trim().toLowerCase()
  if (!theme) return null
  if (theme === 'system' || theme === 'light' || theme === 'dark') return theme
  throw new Error('TS_WIKI_THEME must be "system", "light", or "dark".')
}

const parseAccentColor = (value: string | undefined): string | null => {
  const color = value?.trim()
  if (!color) return null
  if (!/^#[0-9a-f]{6}$/i.test(color)) {
    throw new Error('TS_WIKI_ACCENT_COLOR must be a hex color like #7c3aed.')
  }
  return color
}

const parseBoolean = (value: string | undefined): boolean =>
  value === 'true' || value === '1' || value === 'yes'

const parseBooleanDefault = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback
  return parseBoolean(value)
}

const DEFAULT_WEBHOOK_BACKOFF_MS = [60_000, 120_000, 240_000, 480_000, 900_000] as const
const DEFAULT_OIDC_SCOPES = ['openid', 'email', 'profile'] as const

const parsePositiveInteger = (value: string | undefined, fallback: number, name: string): number => {
  if (!value?.trim()) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`)
  }
  return parsed
}

const parsePositiveIntegerList = (value: string | undefined, fallback: readonly number[], name: string): readonly number[] => {
  if (!value?.trim()) return fallback
  const parsed = value
    .split(',')
    .map((part) => Number(part.trim()))
  if (parsed.length === 0 || parsed.some((part) => !Number.isSafeInteger(part) || part <= 0)) {
    throw new Error(`${name} must be a comma-separated list of positive integers.`)
  }
  return parsed
}

const parseRegistration = (value: string | undefined): AuthEnv['registration'] => {
  const registration = value?.trim().toLowerCase() || 'open'
  if (registration === 'open' || registration === 'off') return registration
  throw new Error('TS_WIKI_REGISTRATION must be either "open" or "off".')
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

const optionalTrimmed = (value: string | undefined): string | null => value?.trim() || null

const optionalPublicBaseUrl = (value: string | undefined): string | null =>
  optionalTrimmed(value)?.replace(/\/+$/, '') || null

const requireEnv = (source: EnvSource, key: string, missing: string[]): string => {
  const value = optionalTrimmed(source[key])
  if (!value) {
    missing.push(key)
    return ''
  }
  return value
}

const isRemoteLibsqlUrl = (url: string): boolean => /^(libsql|https?|wss?):/i.test(url)

const loadDatabaseEnv = (source: EnvSource, dataDir: string): DatabaseConfig => {
  const driver = parseDatabaseDriver(source.DATABASE_DRIVER)
  if (driver === 'sqlite') {
    return {
      driver,
      path: source.DATABASE_PATH ?? DEFAULT_SQLITE_PATH,
    }
  }

  const missing: string[] = []
  const url = requireEnv(source, 'LIBSQL_URL', missing)
  if (missing.length > 0) {
    throw new Error(`DATABASE_DRIVER=libsql requires ${missing.join(', ')}.`)
  }
  return {
    driver,
    url,
    authToken: optionalTrimmed(source.LIBSQL_AUTH_TOKEN),
    replicaPath: optionalTrimmed(source.LIBSQL_REPLICA_PATH) ??
      (isRemoteLibsqlUrl(url) ? join(dataDir, DEFAULT_LIBSQL_REPLICA_FILENAME) : null),
  }
}

const loadAssetStorage = (source: EnvSource, dataDir: string): AssetStorageConfig => {
  const publicBaseUrl = optionalPublicBaseUrl(source.ASSET_PUBLIC_BASE_URL)
  const storageType = optionalTrimmed(source.ASSET_STORAGE)?.toLowerCase() ?? 'local'

  if (storageType === 'local') {
    return { type: 'local', dataDir, publicBaseUrl }
  }
  if (storageType !== 'r2') {
    throw new Error('ASSET_STORAGE must be either "local" or "r2".')
  }

  const missing: string[] = []
  const accessKeyId = requireEnv(source, 'R2_ACCESS_KEY_ID', missing)
  const secretAccessKey = requireEnv(source, 'R2_SECRET_ACCESS_KEY', missing)
  const bucket = requireEnv(source, 'R2_BUCKET', missing)
  const accountId = optionalTrimmed(source.R2_ACCOUNT_ID)
  const endpointOverride = optionalTrimmed(source.R2_ENDPOINT)
  const endpoint = endpointOverride ?? (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : null)
  if (!endpoint) {
    missing.push('R2_ACCOUNT_ID or R2_ENDPOINT')
  }
  if (missing.length > 0) {
    throw new Error(`ASSET_STORAGE=r2 requires ${missing.join(', ')}.`)
  }

  return {
    type: 'r2',
    publicBaseUrl,
    r2: {
      accountId,
      accessKeyId,
      secretAccessKey,
      bucket,
      endpoint: endpoint!,
    },
  }
}

const defaultPublicOrigin = (source: EnvSource): string => `http://localhost:${Number(source.PORT ?? 4000)}`

const originHost = (origin: string): string => {
  try {
    return new URL(origin).hostname
  } catch {
    return 'localhost'
  }
}

const cleanOidcProviderId = (value: string | null | undefined, fallback: string): string => {
  const id = (value ?? fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return id || fallback
}

const oidcScopes = (value: string | undefined): readonly string[] => {
  const scopes = parseCsv(value)
  return scopes.length ? scopes : DEFAULT_OIDC_SCOPES
}

const loadOidcProviderFromEnv = (
  source: EnvSource,
  prefix: string,
  fallbackId: string,
  fallbackLabel: string,
): OidcProviderEnv => {
  const missing: string[] = []
  const key = (suffix: string) => `${prefix}${suffix}`
  const issuer = requireEnv(source, key('ISSUER'), missing).replace(/\/+$/, '')
  const clientId = requireEnv(source, key('CLIENT_ID'), missing)
  const clientSecret = requireEnv(source, key('CLIENT_SECRET'), missing)
  const redirectUri = requireEnv(source, key('REDIRECT_URI'), missing)
  if (missing.length > 0) {
    throw new Error(`${prefix} OIDC provider requires ${missing.join(', ')}.`)
  }
  return {
    id: cleanOidcProviderId(optionalTrimmed(source[key('PROVIDER_ID')]), fallbackId),
    label: optionalTrimmed(source[key('PROVIDER_LABEL')]) ?? fallbackLabel,
    issuer,
    clientId,
    clientSecret,
    redirectUri,
    scopes: oidcScopes(source[key('SCOPES')]),
    allowRegistration: source[key('ALLOW_REGISTRATION')] !== 'false',
    allowedEmailDomains: parseCsv(source[key('EMAIL_DOMAINS')]).map((domain) => domain.toLowerCase()),
    defaultRole: parseRole(source[key('DEFAULT_ROLE')]),
  }
}

const numberedOidcPrefixes = (source: EnvSource): string[] => {
  const indices = new Set<number>()
  for (const key of Object.keys(source)) {
    const match = key.match(/^OIDC_(\d+)_/)
    if (match) indices.add(Number(match[1]))
  }
  return [...indices].sort((a, b) => a - b).map((index) => `OIDC_${index}_`)
}

const stringField = (source: Record<string, unknown>, key: string, context: string, required = true): string | null => {
  const value = source[key]
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (required) throw new Error(`${context}.${key} is required.`)
  return null
}

const booleanField = (source: Record<string, unknown>, key: string, fallback: boolean): boolean => {
  const value = source[key]
  return typeof value === 'boolean' ? value : fallback
}

const stringArrayField = (source: Record<string, unknown>, key: string): readonly string[] => {
  const value = source[key]
  if (Array.isArray(value)) return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
  if (typeof value === 'string') return parseCsv(value)
  return []
}

const loadJsonOidcProviders = (source: EnvSource): OidcProviderEnv[] => {
  const raw = optionalTrimmed(source.TS_WIKI_OIDC_PROVIDERS)
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('TS_WIKI_OIDC_PROVIDERS must be a JSON array.')
  }
  if (!Array.isArray(parsed)) throw new Error('TS_WIKI_OIDC_PROVIDERS must be a JSON array.')
  return parsed.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`TS_WIKI_OIDC_PROVIDERS[${index}] must be an object.`)
    }
    const record = item as Record<string, unknown>
    const context = `TS_WIKI_OIDC_PROVIDERS[${index}]`
    const fallbackId = `oidc-${index + 1}`
    const domains = stringArrayField(record, 'allowedEmailDomains').length
      ? stringArrayField(record, 'allowedEmailDomains')
      : stringArrayField(record, 'emailDomains')
    const scopes = stringArrayField(record, 'scopes')
    return {
      id: cleanOidcProviderId(stringField(record, 'id', context, false), fallbackId),
      label: stringField(record, 'label', context, false) ?? `OIDC ${index + 1}`,
      issuer: stringField(record, 'issuer', context)!.replace(/\/+$/, ''),
      clientId: stringField(record, 'clientId', context)!,
      clientSecret: stringField(record, 'clientSecret', context)!,
      redirectUri: stringField(record, 'redirectUri', context)!,
      scopes: scopes.length ? scopes : DEFAULT_OIDC_SCOPES,
      allowRegistration: booleanField(record, 'allowRegistration', true),
      allowedEmailDomains: domains.map((domain) => domain.toLowerCase()),
      defaultRole: parseRole(stringField(record, 'defaultRole', context, false) ?? undefined),
    }
  })
}

const assertUniqueOidcProviderIds = (providers: readonly OidcProviderEnv[]): void => {
  const seen = new Set<string>()
  for (const provider of providers) {
    if (seen.has(provider.id)) throw new Error(`Duplicate OIDC provider id: ${provider.id}.`)
    seen.add(provider.id)
  }
}

const loadAuthEnv = (source: EnvSource): AuthEnv => {
  const publicOrigin = optionalPublicBaseUrl(source.TS_WIKI_PUBLIC_ORIGIN) ?? defaultPublicOrigin(source)
  const oidcEnabled = source.OIDC_ENABLED === 'true' || source.OIDC_ENABLED === '1'
  const providers: OidcProviderEnv[] = [
    ...loadJsonOidcProviders(source),
    ...numberedOidcPrefixes(source).map((prefix, index) =>
      loadOidcProviderFromEnv(source, prefix, `oidc-${index + 1}`, `OIDC ${index + 1}`),
    ),
  ]
  if (oidcEnabled) {
    providers.push(loadOidcProviderFromEnv(source, 'OIDC_', 'oidc', 'OIDC'))
  }
  assertUniqueOidcProviderIds(providers)
  return {
    siteName: optionalTrimmed(source.TS_WIKI_SITE_NAME) ?? 'ts-wiki',
    publicOrigin,
    passkeyRpId: optionalTrimmed(source.PASSKEY_RP_ID) ?? originHost(publicOrigin),
    tokenTtlSeconds: parsePositiveInteger(source.TS_WIKI_JWT_TTL_SECONDS, 30 * 24 * 60 * 60, 'TS_WIKI_JWT_TTL_SECONDS'),
    registration: parseRegistration(source.TS_WIKI_REGISTRATION),
    privateWiki: parseBoolean(source.TS_WIKI_PRIVATE),
    requireEmailVerification: parseBoolean(source.TS_WIKI_REQUIRE_EMAIL_VERIFICATION),
    requireTwoFactor: parseBoolean(source.TS_WIKI_REQUIRE_2FA),
    oidcProviders: providers,
  }
}

const parseDateFormat = (value: string | undefined): LocalizationEnv['dateFormat'] => {
  const format = value?.trim().toLowerCase()
  if (!format) return null
  if (format === 'short' || format === 'medium' || format === 'long') return format
  throw new Error('TS_WIKI_DATE_FORMAT must be "short", "medium", or "long".')
}

const parseLocale = (value: string | undefined): string | null => {
  const locale = optionalTrimmed(value)
  if (!locale) return null
  if (!/^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8}){0,3}$/.test(locale)) {
    throw new Error('TS_WIKI_DEFAULT_LOCALE must be a BCP 47-style locale such as "en" or "ja-JP".')
  }
  return locale.toLowerCase()
}

const parseTimezone = (value: string | undefined): string | null => {
  const timezone = optionalTrimmed(value)
  if (!timezone) return null
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format(new Date())
    return timezone
  } catch {
    throw new Error('TS_WIKI_TIMEZONE must be a valid IANA timezone such as "UTC" or "Asia/Tokyo".')
  }
}

const defaultMailFrom = (publicOrigin: string): string =>
  `ts-wiki <no-reply@${originHost(publicOrigin)}>`

const loadMailEnv = (source: EnvSource, publicOrigin: string): MailEnv => ({
  smtpUrl: optionalTrimmed(source.SMTP_URL) ?? optionalTrimmed(source.TS_WIKI_SMTP_URL),
  from: optionalTrimmed(source.SMTP_FROM) ?? optionalTrimmed(source.TS_WIKI_MAIL_FROM) ?? defaultMailFrom(publicOrigin),
  timeoutMs: parsePositiveInteger(source.TS_WIKI_SMTP_TIMEOUT_MS, 10_000, 'TS_WIKI_SMTP_TIMEOUT_MS'),
})

const loadBrandingEnv = (source: EnvSource): BrandingEnv => ({
  siteTitle: optionalTrimmed(source.TS_WIKI_SITE_TITLE) ?? optionalTrimmed(source.TS_WIKI_SITE_NAME),
  accentColor: parseAccentColor(source.TS_WIKI_ACCENT_COLOR),
  theme: parseTheme(source.TS_WIKI_THEME),
  allowHeadInjection: parseBoolean(source.TS_WIKI_ALLOW_HEAD_INJECTION),
})

const loadLocalizationEnv = (source: EnvSource): LocalizationEnv => ({
  defaultLocale: parseLocale(source.TS_WIKI_DEFAULT_LOCALE),
  timezone: parseTimezone(source.TS_WIKI_TIMEZONE),
  dateFormat: parseDateFormat(source.TS_WIKI_DATE_FORMAT),
})

export const loadEnv = (source: EnvSource = process.env): Env => {
  const production = isProduction(source)
  const dataDir = source.DATA_DIR ?? './data'
  const database = loadDatabaseEnv(source, dataDir)
  const eventBus = source.TS_WIKI_EVENT_BUS === 'memory' ? 'memory' : 'db'
  const configuredCorsOrigins = parseCorsOrigins(source.TS_WIKI_CORS_ORIGINS)
  const remoteUrl = source.TS_WIKI_GIT_REMOTE_URL?.trim() || null
  const remote = source.TS_WIKI_GIT_REMOTE?.trim() || (remoteUrl ? 'origin' : null)
  const auth = loadAuthEnv(source)
  return {
    port: Number(source.PORT ?? 4000),
    database,
    databasePath: database.driver === 'sqlite' ? database.path : source.DATABASE_PATH ?? DEFAULT_SQLITE_PATH,
    dataDir,
    webDistDir: source.WEB_DIST_DIR ?? fileURLToPath(new URL('../../web/dist', import.meta.url)),
    jwtSecret: loadJwtSecret(source),
    trustProxyHeaders: source.TS_WIKI_TRUST_PROXY_HEADERS === 'true' || source.TS_WIKI_TRUST_PROXY_HEADERS === '1',
    cors: {
      origins: configuredCorsOrigins ?? (production ? [] : null),
    },
    auth,
    search: {
      ftsTokenizer: parseFtsTokenizer(source.TS_WIKI_FTS_TOKENIZER),
    },
    assetUpload: {
      maxBytes: parsePositiveInteger(source.ASSET_MAX_BYTES, 25 * 1024 * 1024, 'ASSET_MAX_BYTES'),
    },
    webhooks: {
      allowPrivateTargets: parseBoolean(source.TS_WIKI_WEBHOOK_ALLOW_PRIVATE),
      maxAttempts: parsePositiveInteger(source.TS_WIKI_WEBHOOK_MAX_ATTEMPTS, 3, 'TS_WIKI_WEBHOOK_MAX_ATTEMPTS'),
      backoffMs: parsePositiveIntegerList(source.TS_WIKI_WEBHOOK_BACKOFF_MS, DEFAULT_WEBHOOK_BACKOFF_MS, 'TS_WIKI_WEBHOOK_BACKOFF_MS'),
      maxResponseBytes: parsePositiveInteger(source.TS_WIKI_WEBHOOK_MAX_RESPONSE_BYTES, 2000, 'TS_WIKI_WEBHOOK_MAX_RESPONSE_BYTES'),
      maxErrorBytes: parsePositiveInteger(source.TS_WIKI_WEBHOOK_MAX_ERROR_BYTES, 1000, 'TS_WIKI_WEBHOOK_MAX_ERROR_BYTES'),
    },
    audit: {
      persist: parseBooleanDefault(source.TS_WIKI_AUDIT_DB, true),
      retentionDays: parsePositiveInteger(source.TS_WIKI_AUDIT_RETENTION_DAYS, 90, 'TS_WIKI_AUDIT_RETENTION_DAYS'),
      maxRows: parsePositiveInteger(source.TS_WIKI_AUDIT_MAX_ROWS, 10_000, 'TS_WIKI_AUDIT_MAX_ROWS'),
    },
    mail: loadMailEnv(source, auth.publicOrigin),
    branding: loadBrandingEnv(source),
    localization: loadLocalizationEnv(source),
    assetStorage: loadAssetStorage(source, dataDir),
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
