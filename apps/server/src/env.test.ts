import { describe, expect, test } from 'bun:test'
import { DEFAULT_JWT_SECRET, loadEnv } from './env.ts'

describe('loadEnv', () => {
  test('keeps local/dev startup permissive with the default JWT secret', () => {
    const env = loadEnv({})

    expect(env.jwtSecret).toBe(DEFAULT_JWT_SECRET)
    expect(env.cors.origins).toBeNull()
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
    })

    expect(env.jwtSecret).toBe('prod-secret')
    expect(env.cors.origins).toEqual(['https://wiki.example.com', 'http://localhost:5173'])
  })

  test('defaults production CORS to same-origin only when no origins are configured', () => {
    const env = loadEnv({ NODE_ENV: 'production', JWT_SECRET: 'prod-secret' })

    expect(env.cors.origins).toEqual([])
  })
})
