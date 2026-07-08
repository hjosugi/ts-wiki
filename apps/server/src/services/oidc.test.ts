import { describe, expect, test } from 'bun:test'
import type { AuthEnv } from '../env.ts'
import { createDb } from '../db/client.ts'
import { oauthStates } from '../db/schema.ts'
import { createAuthzService } from './authz.ts'
import { createOidcService } from './oidc.ts'

const authEnv = (): AuthEnv => ({
  siteName: 'ts-wiki-test',
  publicOrigin: 'http://localhost',
  passkeyRpId: 'localhost',
  tokenTtlSeconds: 30 * 24 * 60 * 60,
  registration: 'open',
  privateWiki: false,
  requireEmailVerification: false,
  requireTwoFactor: false,
  oidcProviders: [{
    id: 'oidc',
    label: 'OIDC',
    issuer: 'https://idp.example.com',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    redirectUri: 'http://localhost/api/auth/oidc/oidc/callback',
    scopes: ['openid', 'email', 'profile'],
    allowRegistration: true,
    allowedEmailDomains: [],
    defaultRole: 'viewer',
  }],
})

const discoveryResponse = () =>
  new Response(JSON.stringify({
    authorization_endpoint: 'https://idp.example.com/auth',
    token_endpoint: 'https://idp.example.com/token',
    jwks_uri: 'https://idp.example.com/jwks',
  }), {
    headers: { 'content-type': 'application/json' },
  })

describe('OIDC service', () => {
  test('exposes OIDC providers through the generic public auth provider shape', () => {
    const db = createDb(':memory:')
    try {
      const service = createOidcService(db, authEnv(), createAuthzService(db))
      expect(service.publicProviders()).toEqual([{
        id: 'oidc',
        label: 'OIDC',
        kind: 'oidc',
        type: 'oidc',
        loginUrl: '/api/auth/oidc/start',
      }])
    } finally {
      db.$client.close()
    }
  })

  test('start sweeps expired oauth states before storing a new one', async () => {
    let now = 1_000_000
    const db = createDb(':memory:')
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => discoveryResponse()) as unknown as typeof fetch
    try {
      db.insert(oauthStates).values([
        {
          state: 'expired',
          provider: 'oidc',
          nonce: 'old-nonce',
          codeVerifier: 'old-verifier',
          redirectAfter: null,
          expiresAt: now,
          createdAt: now - 600_000,
        },
        {
          state: 'fresh',
          provider: 'oidc',
          nonce: 'fresh-nonce',
          codeVerifier: 'fresh-verifier',
          redirectAfter: null,
          expiresAt: now + 1,
          createdAt: now - 1,
        },
      ]).run()

      const service = createOidcService(db, authEnv(), createAuthzService(db), { now: () => now })
      const started = await service.start('oidc', '/after-login')

      expect(started.ok).toBe(true)
      if (!started.ok) return
      const states = db.select().from(oauthStates).all()
      expect(states.map((row) => row.state).sort()).toEqual(['fresh', started.value.state].sort())
      expect(states.find((row) => row.state === started.value.state)).toMatchObject({
        provider: 'oidc',
        redirectAfter: '/after-login',
        expiresAt: now + 10 * 60_000,
        createdAt: now,
      })
    } finally {
      globalThis.fetch = originalFetch
      db.$client.close()
    }
  })

  test('callback rejects and removes expired oauth states before network exchange', async () => {
    const now = 1_000_000
    const db = createDb(':memory:')
    const originalFetch = globalThis.fetch
    let fetchCalls = 0
    globalThis.fetch = (async () => {
      fetchCalls += 1
      return discoveryResponse()
    }) as unknown as typeof fetch
    try {
      db.insert(oauthStates).values({
        state: 'expired',
        provider: 'oidc',
        nonce: 'old-nonce',
        codeVerifier: 'old-verifier',
        redirectAfter: null,
        expiresAt: now,
        createdAt: now - 600_000,
      }).run()

      const service = createOidcService(db, authEnv(), createAuthzService(db), { now: () => now })
      const result = await service.callback('oidc', 'code', 'expired')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.message).toBe('OIDC state is invalid or expired')
      }
      expect(fetchCalls).toBe(0)
      expect(db.select().from(oauthStates).all()).toEqual([])
    } finally {
      globalThis.fetch = originalFetch
      db.$client.close()
    }
  })
})
