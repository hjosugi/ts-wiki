import { describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
  VerifiedAuthenticationResponse,
  VerifiedRegistrationResponse,
  WebAuthnCredential,
} from '@simplewebauthn/server'
import type { AuthEnv } from '../env.ts'
import { createDb } from '../db/client.ts'
import { passkeys } from '../db/schema.ts'
import { createServices } from '../db/services.ts'
import { createPasskeyService, type PasskeyVerifier } from './passkeys.ts'
import { createDatabaseRepositories } from '../db/repositories/index.ts'

const auth: AuthEnv = {
  siteName: 'ts-wiki',
  publicOrigin: 'http://localhost:4000',
  passkeyRpId: 'localhost',
  tokenTtlSeconds: 3600,
  registration: 'open',
  privateWiki: false,
  requireEmailVerification: false,
  requireTwoFactor: false,
  oidcProviders: [],
}

const credentialId = 'test-credential-id'
const publicKey = new Uint8Array([1, 2, 3, 4])

const b64 = (value: string): string => Buffer.from(value).toString('base64url')
const clientDataJSON = (challenge: string, type: 'webauthn.create' | 'webauthn.get'): string =>
  b64(JSON.stringify({ type, challenge, origin: auth.publicOrigin }))

const registrationResponse = (challenge: string): RegistrationResponseJSON => ({
  id: credentialId,
  rawId: credentialId,
  response: {
    clientDataJSON: clientDataJSON(challenge, 'webauthn.create'),
    attestationObject: b64('attestation'),
    transports: ['internal'],
  },
  authenticatorAttachment: 'platform',
  clientExtensionResults: {},
  type: 'public-key',
})

const authenticationResponse = (challenge: string): AuthenticationResponseJSON => ({
  id: credentialId,
  rawId: credentialId,
  response: {
    clientDataJSON: clientDataJSON(challenge, 'webauthn.get'),
    authenticatorData: b64('authenticator'),
    signature: b64('signature'),
  },
  authenticatorAttachment: 'platform',
  clientExtensionResults: {},
  type: 'public-key',
})

const verifiedRegistration = (counter: number): VerifiedRegistrationResponse => ({
  verified: true,
  registrationInfo: {
    fmt: 'none',
    aaguid: '00000000-0000-0000-0000-000000000000',
    credential: {
      id: credentialId,
      publicKey,
      counter,
      transports: ['internal'],
    } as WebAuthnCredential,
    credentialType: 'public-key',
    attestationObject: new Uint8Array(),
    userVerified: true,
    credentialDeviceType: 'singleDevice',
    credentialBackedUp: false,
    origin: auth.publicOrigin,
    rpID: auth.passkeyRpId,
  },
})

const verifiedAuthentication = (
  credential: WebAuthnCredential,
  verified: boolean,
  newCounter: number,
): VerifiedAuthenticationResponse => ({
  verified,
  authenticationInfo: {
    credentialID: credential.id,
    newCounter,
    userVerified: true,
    credentialDeviceType: 'multiDevice',
    credentialBackedUp: true,
    origin: auth.publicOrigin,
    rpID: auth.passkeyRpId,
  },
})

async function seedUser() {
  const db = createDb(':memory:')
  const userResult = await createServices(db).users.create({
    email: 'passkey@example.com',
    name: 'Passkey User',
    password: 'password',
    role: 'editor',
  })
  if (!userResult.ok) throw new Error('user seed failed')
  return {
    db,
    user: userResult.value,
    principal: { id: userResult.value.id, role: userResult.value.role },
  }
}

describe('passkey service', () => {
  test('stores verified registrations and updates authentication counters', async () => {
    const { db, user, principal } = await seedUser()
    const counters: number[] = []
    const verifier: PasskeyVerifier = {
      verifyRegistrationResponse: async () => verifiedRegistration(7),
      verifyAuthenticationResponse: async ({ credential }) => {
        counters.push(credential.counter)
        return verifiedAuthentication(credential, true, 8)
      },
    }
    const repositories = createDatabaseRepositories(db)
    const service = createPasskeyService(repositories.passkeys, repositories.users, auth, verifier)

    const options = await service.registrationOptions(principal)
    expect(options.ok).toBe(true)
    if (!options.ok) throw new Error('options failed')
    const registered = await service.verifyRegistration(principal, {
      response: registrationResponse(options.value.options.challenge),
      name: 'Work laptop',
    })
    expect(registered.ok).toBe(true)
    if (!registered.ok) throw new Error('registration failed')
    expect(registered.value).toMatchObject({
      id: credentialId,
      name: 'Work laptop',
      deviceType: 'singleDevice',
      backedUp: false,
      transports: ['internal'],
    })

    const authOptions = await service.authenticationOptions({ email: 'PASSKEY@example.com' })
    expect(authOptions.ok).toBe(true)
    if (!authOptions.ok) throw new Error('authentication options failed')
    expect(authOptions.value.options.allowCredentials?.[0]?.id).toBe(credentialId)

    const authenticated = await service.verifyAuthentication({
      response: authenticationResponse(authOptions.value.options.challenge),
    })
    expect(authenticated.ok).toBe(true)
    if (!authenticated.ok) throw new Error('authentication failed')
    expect(authenticated.value.user.id).toBe(user.id)
    expect(authenticated.value.passkey).toMatchObject({
      id: credentialId,
      deviceType: 'multiDevice',
      backedUp: true,
    })
    expect(authenticated.value.passkey.lastUsedAt).toBeGreaterThan(0)
    expect(counters).toEqual([7])

    const stored = db.select().from(passkeys).where(eq(passkeys.id, credentialId)).get()
    expect(stored?.counter).toBe(8)
    expect(stored?.backedUp).toBe(true)
    expect(stored?.deviceType).toBe('multiDevice')
  })

  test('rejects replayed authentication when the verifier rejects a stale counter', async () => {
    const { db, principal } = await seedUser()
    const verifier: PasskeyVerifier = {
      verifyRegistrationResponse: async () => verifiedRegistration(1),
      verifyAuthenticationResponse: async ({ credential }) =>
        verifiedAuthentication(credential, credential.counter < 2, 2),
    }
    const repositories = createDatabaseRepositories(db)
    const service = createPasskeyService(repositories.passkeys, repositories.users, auth, verifier)

    const registrationOptions = await service.registrationOptions(principal)
    expect(registrationOptions.ok).toBe(true)
    if (!registrationOptions.ok) throw new Error('registration options failed')
    const registered = await service.verifyRegistration(principal, {
      response: registrationResponse(registrationOptions.value.options.challenge),
    })
    expect(registered.ok).toBe(true)

    const firstOptions = await service.authenticationOptions()
    expect(firstOptions.ok).toBe(true)
    if (!firstOptions.ok) throw new Error('first options failed')
    const first = await service.verifyAuthentication({
      response: authenticationResponse(firstOptions.value.options.challenge),
    })
    expect(first.ok).toBe(true)
    expect(db.select().from(passkeys).where(eq(passkeys.id, credentialId)).get()?.counter).toBe(2)

    const replayOptions = await service.authenticationOptions()
    expect(replayOptions.ok).toBe(true)
    if (!replayOptions.ok) throw new Error('replay options failed')
    const replay = await service.verifyAuthentication({
      response: authenticationResponse(replayOptions.value.options.challenge),
    })
    expect(replay.ok).toBe(false)
    if (!replay.ok) expect(replay.error.kind).toBe('unauthorized')
    expect(db.select().from(passkeys).where(eq(passkeys.id, credentialId)).get()?.counter).toBe(2)
  })
})
