import { describe, expect, test } from 'bun:test'
import { DEFAULT_JWT_SECRET, loadEnv } from './env.ts'

describe('loadEnv', () => {
  test('accepts the KAWAII_WIKI prefix and gives it precedence over legacy names', () => {
    const env = loadEnv({
      TS_WIKI_SITE_NAME: 'legacy-name',
      KAWAII_WIKI_SITE_NAME: 'new-name',
      KAWAII_WIKI_PRIVATE: 'true',
    })
    expect(env.auth.siteName).toBe('new-name')
    expect(env.auth.privateWiki).toBe(true)
  })

  test('validates Git source-of-truth mode', () => {
    const env = loadEnv({
      KAWAII_WIKI_GIT_ENABLED: 'true',
      KAWAII_WIKI_GIT_SOURCE_OF_TRUTH: 'true',
      KAWAII_WIKI_GIT_REMOTE_URL: 'git@github.com:owner/wiki-content.git',
    })

    expect(env.git.sourceOfTruth).toBe(true)
    expect(env.git.remoteUrl).toBe('git@github.com:owner/wiki-content.git')
    expect(() => loadEnv({ KAWAII_WIKI_GIT_SOURCE_OF_TRUTH: 'true' })).toThrow(/GIT_ENABLED/)
    expect(() => loadEnv({
      KAWAII_WIKI_GIT_ENABLED: 'true',
      KAWAII_WIKI_GIT_SOURCE_OF_TRUTH: 'true',
    })).toThrow(/GIT_REMOTE_URL/)
  })

  test('keeps local/dev startup permissive with the default JWT secret', () => {
    const env = loadEnv({})

    expect(env.jwtSecret).toBe(DEFAULT_JWT_SECRET)
    expect(env.database).toEqual({ driver: 'sqlite', path: './data/ts-wiki.sqlite' })
    expect(env.databasePath).toBe('./data/ts-wiki.sqlite')
    expect(env.trustProxyHeaders).toBe(false)
    expect(env.cors.origins).toBeNull()
    expect(env.search).toEqual({ ftsTokenizer: 'unicode61', backend: 'fts5', elasticsearch: null })
    expect(env.assetUpload).toEqual({ maxBytes: 25 * 1024 * 1024 })
    expect(env.webhooks).toEqual({
      allowPrivateTargets: false,
      maxAttempts: 3,
      backoffMs: [60_000, 120_000, 240_000, 480_000, 900_000],
      maxResponseBytes: 2000,
      maxErrorBytes: 1000,
    })
    expect(env.mail).toEqual({
      smtpUrl: null,
      from: 'kawaii-wiki.ts <no-reply@localhost>',
      timeoutMs: 10_000,
    })
    expect(env.assetStorage).toEqual({
      type: 'local',
      dataDir: './data',
      publicBaseUrl: null,
    })
    expect(env.auth.tokenTtlSeconds).toBe(30 * 24 * 60 * 60)
    expect(env.auth.registration).toBe('open')
    expect(env.auth.privateWiki).toBe(false)
    expect(env.auth.requireEmailVerification).toBe(false)
    expect(env.auth.requireTwoFactor).toBe(false)
    expect(env.auth.oidcProviders).toEqual([])
    expect(env.localization).toEqual({
      defaultLocale: null,
      timezone: null,
      dateFormat: null,
    })
  })

  test('refuses production with the default JWT secret', () => {
    expect(() => loadEnv({ NODE_ENV: 'production' })).toThrow(/JWT_SECRET/)
    expect(() =>
      loadEnv({ BUN_ENV: 'production', JWT_SECRET: DEFAULT_JWT_SECRET }),
    ).toThrow(/JWT secret/)
    expect(() =>
      loadEnv({ NODE_ENV: 'production', JWT_SECRET: ` ${DEFAULT_JWT_SECRET} ` }),
    ).toThrow(/JWT secret/)
  })

  test('accepts production with a custom JWT secret and parsed CORS origins', () => {
    const env = loadEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'prod-secret',
      TS_WIKI_CORS_ORIGINS: 'https://wiki.example.com, http://localhost:5173 ',
      TS_WIKI_TRUST_PROXY_HEADERS: 'true',
    })

    expect(env.jwtSecret).toBe('prod-secret')
    expect(env.trustProxyHeaders).toBe(true)
    expect(env.cors.origins).toEqual(['https://wiki.example.com', 'http://localhost:5173'])
  })

  test('defaults production CORS to same-origin only when no origins are configured', () => {
    const env = loadEnv({ NODE_ENV: 'production', JWT_SECRET: 'prod-secret' })

    expect(env.cors.origins).toEqual([])
  })

  test('parses explicit sqlite database config', () => {
    const env = loadEnv({
      DATABASE_DRIVER: 'sqlite',
      DATABASE_PATH: '/tmp/wiki.sqlite',
    })

    expect(env.database).toEqual({ driver: 'sqlite', path: '/tmp/wiki.sqlite' })
    expect(env.databasePath).toBe('/tmp/wiki.sqlite')
  })

  test('parses remote libsql database config with a local replica path', () => {
    const env = loadEnv({
      DATABASE_DRIVER: 'LIBSQL',
      LIBSQL_URL: 'libsql://wiki-example.turso.io',
      LIBSQL_AUTH_TOKEN: ' token ',
      DATA_DIR: '/data',
    })

    expect(env.database).toEqual({
      driver: 'libsql',
      url: 'libsql://wiki-example.turso.io',
      authToken: 'token',
      replicaPath: '/data/ts-wiki-libsql-replica.db',
    })
    expect(env.databasePath).toBe('./data/ts-wiki.sqlite')
  })

  test('parses local libsql database config without a replica path', () => {
    const env = loadEnv({
      DATABASE_DRIVER: 'libsql',
      LIBSQL_URL: 'file:/tmp/wiki-libsql.db',
    })

    expect(env.database).toEqual({
      driver: 'libsql',
      url: 'file:/tmp/wiki-libsql.db',
      authToken: null,
      replicaPath: null,
    })
  })

  test('parses postgres database config with ssl and pool options', () => {
    const env = loadEnv({
      DATABASE_DRIVER: 'POSTGRES',
      DATABASE_URL: 'postgres://wiki:secret@db.example.com:5432/wiki',
      DATABASE_SSL: 'require',
      DATABASE_POOL_MAX: '12',
    })

    expect(env.database).toEqual({
      driver: 'postgres',
      url: 'postgres://wiki:secret@db.example.com:5432/wiki',
      ssl: 'require',
      maxConnections: 12,
    })
  })

  test('defaults postgres ssl off and pool size unset', () => {
    const env = loadEnv({
      DATABASE_DRIVER: 'postgres',
      DATABASE_URL: 'postgres://localhost/wiki',
    })

    expect(env.database).toEqual({
      driver: 'postgres',
      url: 'postgres://localhost/wiki',
      ssl: false,
      maxConnections: null,
    })
  })

  test('rejects unknown or incomplete database config', () => {
    expect(() => loadEnv({ DATABASE_DRIVER: 'oracle' })).toThrow(/DATABASE_DRIVER must be one of/)
    expect(() => loadEnv({ DATABASE_DRIVER: 'postgres' })).toThrow(/DATABASE_DRIVER=postgres requires DATABASE_URL/)
    expect(() => loadEnv({ DATABASE_DRIVER: 'postgres', DATABASE_URL: 'postgres://x', DATABASE_SSL: 'maybe' })).toThrow(/DATABASE_SSL/)
    expect(() => loadEnv({ DATABASE_DRIVER: 'libsql' })).toThrow(/LIBSQL_URL/)
  })

  test('parses and validates the FTS tokenizer', () => {
    expect(loadEnv({ TS_WIKI_FTS_TOKENIZER: 'trigram' }).search.ftsTokenizer).toBe('trigram')
    expect(loadEnv({ TS_WIKI_FTS_TOKENIZER: 'UNICODE61' }).search.ftsTokenizer).toBe('unicode61')
    expect(() => loadEnv({ TS_WIKI_FTS_TOKENIZER: 'kuromoji' })).toThrow(/TS_WIKI_FTS_TOKENIZER/)
  })

  test('parses the elasticsearch search backend and its connection config', () => {
    const env = loadEnv({
      SEARCH_BACKEND: 'elasticsearch',
      ELASTICSEARCH_URL: 'http://es:9200',
      ELASTICSEARCH_API_KEY: 'secret-key',
      ELASTICSEARCH_INDEX_PREFIX: 'wiki',
    })
    expect(env.search.backend).toBe('elasticsearch')
    expect(env.search.elasticsearch).toEqual({
      url: 'http://es:9200',
      apiKey: 'secret-key',
      username: null,
      password: null,
      indexPrefix: 'wiki',
    })
  })

  test('elasticsearch requires a URL and the backend value is validated', () => {
    expect(() => loadEnv({ SEARCH_BACKEND: 'elasticsearch' })).toThrow(/ELASTICSEARCH_URL/)
    expect(() => loadEnv({ SEARCH_BACKEND: 'solr' })).toThrow(/SEARCH_BACKEND/)
  })

  test('parses auth lifecycle and upload limit settings', () => {
    const env = loadEnv({
      TS_WIKI_PRIVATE: 'true',
      TS_WIKI_REGISTRATION: 'off',
      TS_WIKI_REQUIRE_2FA: '1',
      TS_WIKI_JWT_TTL_SECONDS: '604800',
      ASSET_MAX_BYTES: '1024',
    })

    expect(env.auth.privateWiki).toBe(true)
    expect(env.auth.registration).toBe('off')
    expect(env.auth.requireTwoFactor).toBe(true)
    expect(env.auth.tokenTtlSeconds).toBe(604800)
    expect(env.assetUpload.maxBytes).toBe(1024)

    expect(() => loadEnv({ TS_WIKI_REGISTRATION: 'closed' })).toThrow(/TS_WIKI_REGISTRATION/)
    expect(() => loadEnv({ TS_WIKI_JWT_TTL_SECONDS: '0' })).toThrow(/TS_WIKI_JWT_TTL_SECONDS/)
    expect(() => loadEnv({ ASSET_MAX_BYTES: '-1' })).toThrow(/ASSET_MAX_BYTES/)
  })

  test('parses initial branding and customization settings', () => {
    const env = loadEnv({
      TS_WIKI_SITE_TITLE: 'Knowledge Base',
      TS_WIKI_ACCENT_COLOR: '#2563eb',
      TS_WIKI_THEME: 'dark',
      TS_WIKI_ALLOW_HEAD_INJECTION: 'true',
    })

    expect(env.branding).toEqual({
      siteTitle: 'Knowledge Base',
      accentColor: '#2563eb',
      theme: 'dark',
      allowHeadInjection: true,
    })
    expect(() => loadEnv({ TS_WIKI_ACCENT_COLOR: 'blue' })).toThrow(/TS_WIKI_ACCENT_COLOR/)
    expect(() => loadEnv({ TS_WIKI_THEME: 'sepia' })).toThrow(/TS_WIKI_THEME/)
  })

  test('parses localization defaults', () => {
    const env = loadEnv({
      TS_WIKI_DEFAULT_LOCALE: 'ja-JP',
      TS_WIKI_TIMEZONE: 'Asia/Tokyo',
      TS_WIKI_DATE_FORMAT: 'long',
    })

    expect(env.localization).toEqual({
      defaultLocale: 'ja-jp',
      timezone: 'Asia/Tokyo',
      dateFormat: 'long',
    })
    expect(() => loadEnv({ TS_WIKI_DEFAULT_LOCALE: 'not a locale' })).toThrow(/TS_WIKI_DEFAULT_LOCALE/)
    expect(() => loadEnv({ TS_WIKI_TIMEZONE: 'Mars/Base' })).toThrow(/TS_WIKI_TIMEZONE/)
    expect(() => loadEnv({ TS_WIKI_DATE_FORMAT: 'iso' })).toThrow(/TS_WIKI_DATE_FORMAT/)
  })

  test('parses webhook private-target escape hatch and delivery policy', () => {
    expect(loadEnv({ TS_WIKI_WEBHOOK_ALLOW_PRIVATE: 'true' }).webhooks.allowPrivateTargets).toBe(true)
    expect(loadEnv({ TS_WIKI_WEBHOOK_ALLOW_PRIVATE: '1' }).webhooks.allowPrivateTargets).toBe(true)
    expect(loadEnv({ TS_WIKI_WEBHOOK_ALLOW_PRIVATE: 'yes' }).webhooks.allowPrivateTargets).toBe(true)
    expect(loadEnv({ TS_WIKI_WEBHOOK_ALLOW_PRIVATE: 'false' }).webhooks.allowPrivateTargets).toBe(false)
    const env = loadEnv({
      TS_WIKI_WEBHOOK_MAX_ATTEMPTS: '5',
      TS_WIKI_WEBHOOK_BACKOFF_MS: '100, 250, 500',
      TS_WIKI_WEBHOOK_MAX_RESPONSE_BYTES: '50',
      TS_WIKI_WEBHOOK_MAX_ERROR_BYTES: '40',
    })
    expect(env.webhooks).toMatchObject({
      maxAttempts: 5,
      backoffMs: [100, 250, 500],
      maxResponseBytes: 50,
      maxErrorBytes: 40,
    })
    expect(() => loadEnv({ TS_WIKI_WEBHOOK_MAX_ATTEMPTS: '0' })).toThrow(/TS_WIKI_WEBHOOK_MAX_ATTEMPTS/)
    expect(() => loadEnv({ TS_WIKI_WEBHOOK_BACKOFF_MS: '100,nope' })).toThrow(/TS_WIKI_WEBHOOK_BACKOFF_MS/)
  })

  test('parses optional mail and email verification settings', () => {
    const env = loadEnv({
      TS_WIKI_PUBLIC_ORIGIN: 'https://wiki.example.com',
      SMTP_URL: ' smtp://user:pass@mail.example.com:587 ',
      SMTP_FROM: 'Wiki <wiki@example.com>',
      TS_WIKI_SMTP_TIMEOUT_MS: '5000',
      TS_WIKI_REQUIRE_EMAIL_VERIFICATION: 'yes',
    })

    expect(env.mail).toEqual({
      smtpUrl: 'smtp://user:pass@mail.example.com:587',
      from: 'Wiki <wiki@example.com>',
      timeoutMs: 5000,
    })
    expect(env.auth.requireEmailVerification).toBe(true)
    expect(() => loadEnv({ TS_WIKI_SMTP_TIMEOUT_MS: '0' })).toThrow(/TS_WIKI_SMTP_TIMEOUT_MS/)
  })

  test('parses R2 asset storage with the official account endpoint', () => {
    const env = loadEnv({
      ASSET_STORAGE: 'r2',
      ASSET_PUBLIC_BASE_URL: 'https://cdn.example.com/assets/',
      R2_ACCOUNT_ID: 'account-id',
      R2_ACCESS_KEY_ID: 'access-key',
      R2_SECRET_ACCESS_KEY: 'secret-key',
      R2_BUCKET: 'wiki-assets',
    })

    expect(env.assetStorage).toEqual({
      type: 'r2',
      publicBaseUrl: 'https://cdn.example.com/assets',
      r2: {
        accountId: 'account-id',
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
        bucket: 'wiki-assets',
        endpoint: 'https://account-id.r2.cloudflarestorage.com',
      },
    })
  })

  test('allows an R2 endpoint override', () => {
    const env = loadEnv({
      ASSET_STORAGE: 'r2',
      R2_ENDPOINT: 'https://custom-r2.example.com',
      R2_ACCESS_KEY_ID: 'access-key',
      R2_SECRET_ACCESS_KEY: 'secret-key',
      R2_BUCKET: 'wiki-assets',
    })

    expect(env.assetStorage).toMatchObject({
      type: 'r2',
      r2: {
        accountId: null,
        endpoint: 'https://custom-r2.example.com',
      },
    })
  })

  test('rejects incomplete or unknown asset storage config', () => {
    expect(() => loadEnv({ ASSET_STORAGE: 'ftp' })).toThrow(/ASSET_STORAGE/)
    expect(() =>
      loadEnv({
        ASSET_STORAGE: 'r2',
        R2_ACCESS_KEY_ID: 'access-key',
        R2_BUCKET: 'wiki-assets',
      }),
    ).toThrow(/R2_SECRET_ACCESS_KEY/)
  })

  test('parses a generic OIDC provider', () => {
    const env = loadEnv({
      OIDC_ENABLED: 'true',
      OIDC_ISSUER: 'https://idp.example.com/',
      OIDC_CLIENT_ID: 'client',
      OIDC_CLIENT_SECRET: 'secret',
      OIDC_REDIRECT_URI: 'https://wiki.example.com/api/auth/oidc/oidc/callback',
      OIDC_EMAIL_DOMAINS: 'example.com, example.org',
      OIDC_DEFAULT_ROLE: 'editor',
    })

    expect(env.auth.oidcProviders).toEqual([
      expect.objectContaining({
        id: 'oidc',
        issuer: 'https://idp.example.com',
        clientId: 'client',
        allowedEmailDomains: ['example.com', 'example.org'],
        defaultRole: 'editor',
      }),
    ])
  })

  test('parses multiple OIDC providers from numbered env and JSON', () => {
    const env = loadEnv({
      OIDC_1_ISSUER: 'https://accounts.google.com/',
      OIDC_1_CLIENT_ID: 'google-client',
      OIDC_1_CLIENT_SECRET: 'google-secret',
      OIDC_1_REDIRECT_URI: 'https://wiki.example.com/api/auth/oidc/google/callback',
      OIDC_1_PROVIDER_ID: 'google',
      OIDC_1_PROVIDER_LABEL: 'Google',
      OIDC_2_ISSUER: 'https://github.example.com',
      OIDC_2_CLIENT_ID: 'github-client',
      OIDC_2_CLIENT_SECRET: 'github-secret',
      OIDC_2_REDIRECT_URI: 'https://wiki.example.com/api/auth/oidc/github/callback',
      OIDC_2_PROVIDER_ID: 'github',
      TS_WIKI_OIDC_PROVIDERS: JSON.stringify([
        {
          id: 'okta',
          label: 'Okta',
          issuer: 'https://okta.example.com/',
          clientId: 'okta-client',
          clientSecret: 'okta-secret',
          redirectUri: 'https://wiki.example.com/api/auth/oidc/okta/callback',
          scopes: ['openid', 'email'],
          allowedEmailDomains: ['example.com'],
          defaultRole: 'editor',
        },
      ]),
    })

    expect(env.auth.oidcProviders.map((provider) => provider.id)).toEqual(['okta', 'google', 'github'])
    expect(env.auth.oidcProviders[0]).toMatchObject({
      label: 'Okta',
      issuer: 'https://okta.example.com',
      scopes: ['openid', 'email'],
      allowedEmailDomains: ['example.com'],
      defaultRole: 'editor',
    })
    expect(env.auth.oidcProviders[1]).toMatchObject({
      id: 'google',
      label: 'Google',
      issuer: 'https://accounts.google.com',
    })
    expect(() =>
      loadEnv({
        OIDC_1_ISSUER: 'https://a.example.com',
        OIDC_1_CLIENT_ID: 'a',
        OIDC_1_CLIENT_SECRET: 'a',
        OIDC_1_REDIRECT_URI: 'https://wiki.example.com/a',
        OIDC_1_PROVIDER_ID: 'same',
        OIDC_2_ISSUER: 'https://b.example.com',
        OIDC_2_CLIENT_ID: 'b',
        OIDC_2_CLIENT_SECRET: 'b',
        OIDC_2_REDIRECT_URI: 'https://wiki.example.com/b',
        OIDC_2_PROVIDER_ID: 'same',
      }),
    ).toThrow(/Duplicate OIDC provider id/)
  })
})
