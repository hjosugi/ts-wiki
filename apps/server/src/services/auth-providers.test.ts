import { describe, expect, test } from 'bun:test'
import type { AuthEnv } from '../env.ts'
import { createDb } from '../db/client.ts'
import { authAccounts, users } from '../db/schema.ts'
import { createAuthProviderService, type AuthProvider } from './auth-providers.ts'
import { createAuthzService } from './authz.ts'

const authEnv = (registration: AuthEnv['registration'] = 'open'): AuthEnv => ({
  siteName: 'ts-wiki-test',
  publicOrigin: 'http://localhost',
  passkeyRpId: 'localhost',
  tokenTtlSeconds: 30 * 24 * 60 * 60,
  registration,
  privateWiki: false,
  requireEmailVerification: false,
  requireTwoFactor: false,
  oidcProviders: [],
})

const fakeSamlProvider = (): AuthProvider => ({
  id: 'saml-main',
  label: 'SAML',
  kind: 'saml',
  startLogin: async () => ({
    ok: true,
    value: { url: 'https://idp.example.com/saml/login' },
  }),
  handleCallback: async () => ({
    ok: true,
    value: {
      providerId: 'saml-main',
      providerKind: 'saml',
      subject: 'external-subject',
      email: 'Person@Example.COM',
      name: 'Person Example',
      emailVerified: true,
      allowRegistration: true,
      defaultRole: 'viewer',
    },
  }),
})

describe('auth provider service', () => {
  test('registers protocol providers and links external identities through a generic seam', async () => {
    const db = createDb(':memory:')
    try {
      const service = createAuthProviderService(db, authEnv(), createAuthzService(db), [fakeSamlProvider()])

      expect(service.publicProviders()).toEqual([{
        id: 'saml-main',
        label: 'SAML',
        kind: 'saml',
        type: 'saml',
        loginUrl: '/api/auth/saml-main/start',
      }])
      expect(await service.start('saml-main')).toEqual({
        ok: true,
        value: { url: 'https://idp.example.com/saml/login' },
      })

      const first = await service.callback('saml-main', { SAMLResponse: 'ok' })
      expect(first.ok).toBe(true)
      if (!first.ok) return
      expect(first.value.isNewUser).toBe(true)
      expect(first.value.user).toMatchObject({
        email: 'person@example.com',
        name: 'Person Example',
        role: 'viewer',
      })
      expect(db.select().from(authAccounts).all()).toMatchObject([{
        provider: 'saml-main',
        providerSubject: 'external-subject',
        email: 'person@example.com',
      }])

      const second = await service.callback('saml-main', { SAMLResponse: 'ok' })
      expect(second.ok).toBe(true)
      if (!second.ok) return
      expect(second.value.isNewUser).toBe(false)
      expect(second.value.user.id).toBe(first.value.user.id)
      expect(db.select().from(users).all()).toHaveLength(1)
    } finally {
      db.$client.close()
    }
  })

  test('applies shared external registration policy independent of provider protocol', async () => {
    const db = createDb(':memory:')
    try {
      const service = createAuthProviderService(db, authEnv('off'), createAuthzService(db), [fakeSamlProvider()])
      const result = await service.callback('saml-main', {})

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.message).toBe('External self-registration is disabled')
      expect(db.select().from(users).all()).toEqual([])
    } finally {
      db.$client.close()
    }
  })
})
