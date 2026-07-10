import { describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import type { AppError } from '@ts-wiki/core'
import type { AuthEnv } from '../env.ts'
import { createDb, type DB } from '../db/client.ts'
import { authAccounts, oauthStates, users } from '../db/schema.ts'
import { createAuthzService } from './authz.ts'
import { createOidcService } from './oidc.ts'

const NOW = 1_700_000_000_000

const authEnv = (provider: Partial<AuthEnv['oidcProviders'][number]> = {}): AuthEnv => ({
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
    ...provider,
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

const jsonResponse = (value: unknown): Response =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })

const base64urlJson = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url')

const testKeyPair = async (): Promise<{ privateKey: CryptoKey; publicJwk: JsonWebKey }> => {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  return {
    privateKey: pair.privateKey,
    publicJwk: { ...jwk, kid: 'test-key', alg: 'RS256', use: 'sig' } as JsonWebKey,
  }
}

const validClaims = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  iss: 'https://idp.example.com',
  sub: 'subject-1',
  aud: 'client-id',
  exp: Math.floor((NOW + 60_000) / 1000),
  nonce: 'nonce-1',
  email: 'Ada@Example.com',
  email_verified: true,
  name: 'Ada',
  ...patch,
})

const signIdToken = async (privateKey: CryptoKey, claims: Record<string, unknown>): Promise<string> => {
  const header = base64urlJson({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })
  const payload = base64urlJson(claims)
  const data = `${header}.${payload}`
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(data),
  )
  return `${data}.${Buffer.from(signature).toString('base64url')}`
}

const insertOauthState = (db: DB, patch: Partial<typeof oauthStates.$inferInsert> = {}): void => {
  db.insert(oauthStates).values({
    state: 'state-1',
    provider: 'oidc',
    nonce: 'nonce-1',
    codeVerifier: 'verifier-1',
    redirectAfter: null,
    expiresAt: NOW + 10 * 60_000,
    createdAt: NOW,
    ...patch,
  }).run()
}

const installOidcFetch = (
  idToken: string,
  publicJwk: JsonWebKey,
): { restore: () => void; calls: Array<{ url: string; init?: RequestInit }> } => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = (async (input, init) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url
    calls.push({ url, init })
    if (url.endsWith('/.well-known/openid-configuration')) return discoveryResponse()
    if (url === 'https://idp.example.com/token') return jsonResponse({ id_token: idToken })
    if (url === 'https://idp.example.com/jwks') return jsonResponse({ keys: [publicJwk] })
    return new Response('not found', { status: 404 })
  }) as typeof fetch
  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch
    },
  }
}

const closeDb = (db: DB): void => {
  db.$client.close()
}

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

  test('callback verifies an RS256 ID token and creates a linked external user', async () => {
    const db = createDb(':memory:')
    const keys = await testKeyPair()
    const idToken = await signIdToken(keys.privateKey, validClaims())
    const fetchStub = installOidcFetch(idToken, keys.publicJwk)

    try {
      insertOauthState(db)

      const service = createOidcService(db, authEnv(), createAuthzService(db), { now: () => NOW })
      const result = await service.callback('oidc', 'auth-code', 'state-1')

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.isNewUser).toBe(true)
      expect(result.value.user).toMatchObject({
        email: 'ada@example.com',
        name: 'Ada',
        role: 'viewer',
      })
      expect(result.value.identity).toMatchObject({
        providerId: 'oidc',
        providerKind: 'oidc',
        subject: 'subject-1',
        email: 'ada@example.com',
        emailVerified: true,
      })
      expect(db.select().from(oauthStates).all()).toEqual([])
      expect(db.select().from(authAccounts).where(eq(authAccounts.providerSubject, 'subject-1')).get()).toMatchObject({
        userId: result.value.user.id,
        provider: 'oidc',
        email: 'ada@example.com',
      })
      const tokenCall = fetchStub.calls.find((call) => call.url === 'https://idp.example.com/token')
      const tokenBody = tokenCall?.init?.body as URLSearchParams | undefined
      expect(tokenBody?.get('code')).toBe('auth-code')
      expect(tokenBody?.get('code_verifier')).toBe('verifier-1')
    } finally {
      fetchStub.restore()
      closeDb(db)
    }
  })

  test('callback rejects an ID token signed by a key outside the provider JWKS', async () => {
    const db = createDb(':memory:')
    const jwksKeys = await testKeyPair()
    const attackerKeys = await testKeyPair()
    const idToken = await signIdToken(attackerKeys.privateKey, validClaims())
    const fetchStub = installOidcFetch(idToken, jwksKeys.publicJwk)

    try {
      insertOauthState(db)

      const service = createOidcService(db, authEnv(), createAuthzService(db), { now: () => NOW })
      const result = await service.callback('oidc', 'auth-code', 'state-1')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toEqual({ kind: 'unauthorized', message: 'OIDC ID token signature is invalid' })
      }
      expect(db.select().from(users).all()).toEqual([])
      expect(db.select().from(authAccounts).all()).toEqual([])
    } finally {
      fetchStub.restore()
      closeDb(db)
    }
  })

  test('callback validates issuer, audience, expiry, and allowed email domains after signature verification', async () => {
    const cases: Array<{
      name: string
      claims: Record<string, unknown>
      provider?: Partial<AuthEnv['oidcProviders'][number]>
      error: { kind: AppError['kind']; message: string }
    }> = [
      {
        name: 'wrong issuer',
        claims: validClaims({ iss: 'https://evil.example.com' }),
        error: { kind: 'unauthorized', message: 'OIDC issuer mismatch' },
      },
      {
        name: 'wrong audience',
        claims: validClaims({ aud: 'other-client' }),
        error: { kind: 'unauthorized', message: 'OIDC audience mismatch' },
      },
      {
        name: 'expired token',
        claims: validClaims({ exp: Math.floor((NOW - 1) / 1000) }),
        error: { kind: 'unauthorized', message: 'OIDC token expired' },
      },
      {
        name: 'disallowed domain',
        claims: validClaims({ email: 'ada@other.example.com' }),
        provider: { allowedEmailDomains: ['example.com'] },
        error: { kind: 'forbidden', message: 'OIDC email domain is not allowed' },
      },
    ]

    for (const scenario of cases) {
      const db = createDb(':memory:')
      const keys = await testKeyPair()
      const idToken = await signIdToken(keys.privateKey, scenario.claims)
      const fetchStub = installOidcFetch(idToken, keys.publicJwk)

      try {
        insertOauthState(db)

        const service = createOidcService(
          db,
          authEnv(scenario.provider),
          createAuthzService(db),
          { now: () => NOW },
        )
        const result = await service.callback('oidc', 'auth-code', 'state-1')

        expect(result.ok, scenario.name).toBe(false)
        if (!result.ok) expect(result.error).toEqual(scenario.error)
        expect(db.select().from(users).all()).toEqual([])
        expect(db.select().from(authAccounts).all()).toEqual([])
      } finally {
        fetchStub.restore()
        closeDb(db)
      }
    }
  })

  test('callback links a valid external identity to an existing local user by email', async () => {
    const db = createDb(':memory:')
    const keys = await testKeyPair()
    const idToken = await signIdToken(keys.privateKey, validClaims({
      sub: 'existing-subject',
      email: 'ADA@example.com',
      name: 'OIDC Ada',
    }))
    const fetchStub = installOidcFetch(idToken, keys.publicJwk)

    try {
      db.insert(users).values({
        id: 'existing-user',
        email: 'ada@example.com',
        name: 'Existing Ada',
        passwordHash: 'hash',
        role: 'editor',
        totpSecret: null,
        totpEnabled: 0,
        disabledAt: null,
        tokenInvalidBefore: 0,
        emailVerifiedAt: NOW,
        profileBio: '',
        profileCoverUrl: '',
        profileLinks: '[]',
        profileFavoritePages: '[]',
        createdAt: NOW,
      }).run()
      insertOauthState(db)

      const service = createOidcService(
        db,
        authEnv({ allowRegistration: false }),
        createAuthzService(db),
        { now: () => NOW },
      )
      const result = await service.callback('oidc', 'auth-code', 'state-1')

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.isNewUser).toBe(false)
      expect(result.value.user.id).toBe('existing-user')
      expect(result.value.user.name).toBe('Existing Ada')
      expect(db.select().from(users).all()).toHaveLength(1)
      expect(db.select().from(authAccounts).where(eq(authAccounts.providerSubject, 'existing-subject')).get()).toMatchObject({
        userId: 'existing-user',
        provider: 'oidc',
        email: 'ada@example.com',
      })
    } finally {
      fetchStub.restore()
      closeDb(db)
    }
  })
})
