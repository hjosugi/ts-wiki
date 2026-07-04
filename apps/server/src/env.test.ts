import { describe, expect, test } from 'bun:test'
import { DEFAULT_JWT_SECRET, loadEnv } from './env.ts'

describe('loadEnv', () => {
  test('keeps local/dev startup permissive with the default JWT secret', () => {
    const env = loadEnv({})

    expect(env.jwtSecret).toBe(DEFAULT_JWT_SECRET)
    expect(env.database).toEqual({ driver: 'sqlite', path: './data/ts-wiki.sqlite' })
    expect(env.databasePath).toBe('./data/ts-wiki.sqlite')
    expect(env.trustProxyHeaders).toBe(false)
    expect(env.cors.origins).toBeNull()
    expect(env.search).toEqual({ ftsTokenizer: 'unicode61' })
    expect(env.assetUpload).toEqual({ maxBytes: 25 * 1024 * 1024 })
    expect(env.assetStorage).toEqual({
      type: 'local',
      dataDir: './data',
      publicBaseUrl: null,
    })
    expect(env.auth.tokenTtlSeconds).toBe(30 * 24 * 60 * 60)
    expect(env.auth.registration).toBe('open')
    expect(env.auth.privateWiki).toBe(false)
    expect(env.auth.oidcProviders).toEqual([])
  })

  test('refuses production with the default JWT secret', () => {
    expect(() => loadEnv({ NODE_ENV: 'production' })).toThrow(/default JWT secret/)
    expect(() =>
      loadEnv({ BUN_ENV: 'production', JWT_SECRET: DEFAULT_JWT_SECRET }),
    ).toThrow(/default JWT secret/)
    expect(() =>
      loadEnv({ NODE_ENV: 'production', JWT_SECRET: ` ${DEFAULT_JWT_SECRET} ` }),
    ).toThrow(/default JWT secret/)
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

  test('rejects unknown or incomplete database config', () => {
    expect(() => loadEnv({ DATABASE_DRIVER: 'postgres' })).toThrow(/DATABASE_DRIVER/)
    expect(() => loadEnv({ DATABASE_DRIVER: 'libsql' })).toThrow(/LIBSQL_URL/)
  })

  test('parses and validates the FTS tokenizer', () => {
    expect(loadEnv({ TS_WIKI_FTS_TOKENIZER: 'trigram' }).search.ftsTokenizer).toBe('trigram')
    expect(loadEnv({ TS_WIKI_FTS_TOKENIZER: 'UNICODE61' }).search.ftsTokenizer).toBe('unicode61')
    expect(() => loadEnv({ TS_WIKI_FTS_TOKENIZER: 'kuromoji' })).toThrow(/TS_WIKI_FTS_TOKENIZER/)
  })

  test('parses auth lifecycle and upload limit settings', () => {
    const env = loadEnv({
      TS_WIKI_PRIVATE: 'true',
      TS_WIKI_REGISTRATION: 'off',
      TS_WIKI_JWT_TTL_SECONDS: '604800',
      ASSET_MAX_BYTES: '1024',
    })

    expect(env.auth.privateWiki).toBe(true)
    expect(env.auth.registration).toBe('off')
    expect(env.auth.tokenTtlSeconds).toBe(604800)
    expect(env.assetUpload.maxBytes).toBe(1024)

    expect(() => loadEnv({ TS_WIKI_REGISTRATION: 'closed' })).toThrow(/TS_WIKI_REGISTRATION/)
    expect(() => loadEnv({ TS_WIKI_JWT_TTL_SECONDS: '0' })).toThrow(/TS_WIKI_JWT_TTL_SECONDS/)
    expect(() => loadEnv({ ASSET_MAX_BYTES: '-1' })).toThrow(/ASSET_MAX_BYTES/)
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
})
