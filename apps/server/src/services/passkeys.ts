import { eq, and, lt } from 'drizzle-orm'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from '@simplewebauthn/server'
import {
  type AppError,
  type Principal,
  type Result,
  err,
  notFound,
  ok,
  requirePermission,
  unauthorized,
} from '@kawaii-wiki/core'
import type { DB } from '../db/client.ts'
import type { AuthEnv } from '../env.ts'
import { passkeys, users, webauthnChallenges, type Passkey, type User } from '../db/schema.ts'
import { isUserActive } from './users.ts'

export interface PasskeyView {
  readonly id: string
  readonly name: string
  readonly deviceType: string
  readonly backedUp: boolean
  readonly transports: readonly string[]
  readonly createdAt: number
  readonly lastUsedAt: number | null
}

export interface PasskeyRegistrationOptions {
  readonly options: PublicKeyCredentialCreationOptionsJSON
}

export interface PasskeyAuthenticationOptions {
  readonly options: PublicKeyCredentialRequestOptionsJSON
}

export interface PasskeyLoginResult {
  readonly user: User
  readonly passkey: PasskeyView
}

export interface PasskeyService {
  list(principal: Principal | null): Result<PasskeyView[], AppError>
  hasForUser(userId: string): boolean
  delete(principal: Principal | null, id: string): Result<{ id: string }, AppError>
  registrationOptions(principal: Principal | null): Promise<Result<PasskeyRegistrationOptions, AppError>>
  verifyRegistration(
    principal: Principal | null,
    input: { response: RegistrationResponseJSON; name?: string },
  ): Promise<Result<PasskeyView, AppError>>
  authenticationOptions(input?: { email?: string }): Promise<Result<PasskeyAuthenticationOptions, AppError>>
  verifyAuthentication(input: { response: AuthenticationResponseJSON }): Promise<Result<PasskeyLoginResult, AppError>>
}

export interface PasskeyVerifier {
  readonly verifyRegistrationResponse: typeof verifyRegistrationResponse
  readonly verifyAuthenticationResponse: typeof verifyAuthenticationResponse
}

const CHALLENGE_TTL_MS = 5 * 60_000

const encodeBytes = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url')
const toStrictBytes = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => Uint8Array.from(bytes) as Uint8Array<ArrayBuffer>
const decodeBytes = (value: string): Uint8Array<ArrayBuffer> => toStrictBytes(Buffer.from(value, 'base64url'))

const parseTransports = (value: string): AuthenticatorTransportFuture[] => {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((item): item is AuthenticatorTransportFuture => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

const toView = (row: Passkey): PasskeyView => ({
  id: row.id,
  name: row.name,
  deviceType: row.deviceType,
  backedUp: Boolean(row.backedUp),
  transports: parseTransports(row.transports),
  createdAt: row.createdAt,
  lastUsedAt: row.lastUsedAt,
})

const credentialFromRow = (row: Passkey): WebAuthnCredential => ({
  id: row.id,
  publicKey: decodeBytes(row.publicKey),
  counter: row.counter,
  transports: parseTransports(row.transports),
})

const userIdBytes = (id: string): Uint8Array<ArrayBuffer> => toStrictBytes(new TextEncoder().encode(id))

const cleanPasskeyName = (value: string | undefined, fallback: string): string => {
  const clean = value?.trim()
  return clean ? clean.slice(0, 80) : fallback
}

const passkeyLabel = (response: RegistrationResponseJSON): string => {
  if (response.authenticatorAttachment === 'platform') return 'This device'
  if (response.authenticatorAttachment === 'cross-platform') return 'Security key'
  return 'Passkey'
}

const clientChallenge = (clientDataJSON: string): string | null => {
  try {
    const parsed = JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8')) as Record<string, unknown>
    return typeof parsed.challenge === 'string' ? parsed.challenge : null
  } catch {
    return null
  }
}

export const createPasskeyService = (
  db: DB,
  auth: AuthEnv,
  verifier: PasskeyVerifier = { verifyRegistrationResponse, verifyAuthenticationResponse },
): PasskeyService => {
  const now = () => Date.now()

  const cleanupChallenges = (): void => {
    db.delete(webauthnChallenges).where(lt(webauthnChallenges.expiresAt, now())).run()
  }

  const storeChallenge = (challenge: string, purpose: 'registration' | 'authentication', userId: string | null): void => {
    cleanupChallenges()
    const createdAt = now()
    db.insert(webauthnChallenges)
      .values({
        challenge,
        userId,
        purpose,
        expiresAt: createdAt + CHALLENGE_TTL_MS,
        createdAt,
      })
      .run()
  }

  const takeChallenge = (challenge: string, purpose: 'registration' | 'authentication') => {
    const row = db
      .select()
      .from(webauthnChallenges)
      .where(and(eq(webauthnChallenges.challenge, challenge), eq(webauthnChallenges.purpose, purpose)))
      .get()
    if (!row || row.expiresAt < now()) return null
    db.delete(webauthnChallenges).where(eq(webauthnChallenges.challenge, challenge)).run()
    return row
  }

  const findUser = (principal: Principal | null): User | null => {
    if (!principal) return null
    const user = db.select().from(users).where(eq(users.id, principal.id)).get() ?? null
    return isUserActive(user) ? user : null
  }

  const passkeysForUser = (userId: string): Passkey[] =>
    db.select().from(passkeys).where(eq(passkeys.userId, userId)).all()

  return {
    list(principal) {
      const user = findUser(principal)
      if (!user) return err(unauthorized())
      return ok(passkeysForUser(user.id).map(toView))
    },

    hasForUser(userId) {
      return passkeysForUser(userId).length > 0
    },

    delete(principal, id) {
      const user = findUser(principal)
      if (!user) return err(unauthorized())
      const row = db.select().from(passkeys).where(eq(passkeys.id, id)).get()
      if (!row) return err(notFound('Passkey not found'))
      if (row.userId !== user.id) {
        const allowed = requirePermission(principal, 'admin:access')
        if (!allowed.ok) return allowed
      }
      db.delete(passkeys).where(eq(passkeys.id, id)).run()
      return ok({ id })
    },

    async registrationOptions(principal) {
      const user = findUser(principal)
      if (!user) return err(unauthorized())
      const existing = passkeysForUser(user.id)
      const options = await generateRegistrationOptions({
        rpName: auth.siteName,
        rpID: auth.passkeyRpId,
        userID: userIdBytes(user.id),
        userName: user.email,
        userDisplayName: user.name,
        attestationType: 'none',
        excludeCredentials: existing.map((credential) => ({
          id: credential.id,
          transports: parseTransports(credential.transports),
        })),
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'preferred',
        },
      })
      storeChallenge(options.challenge, 'registration', user.id)
      return ok({ options })
    },

    async verifyRegistration(principal, input) {
      const user = findUser(principal)
      if (!user) return err(unauthorized())
      const responseChallenge = clientChallenge(input.response.response.clientDataJSON)
      if (!responseChallenge) return err(unauthorized('Passkey challenge is invalid or expired'))
      const challenge = takeChallenge(responseChallenge, 'registration')
      if (!challenge || challenge.userId !== user.id) return err(unauthorized('Passkey challenge is invalid or expired'))

      const verified = await verifier.verifyRegistrationResponse({
        response: input.response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: auth.publicOrigin,
        expectedRPID: auth.passkeyRpId,
        requireUserVerification: false,
      })
      if (!verified.verified) return err(unauthorized('Passkey registration failed'))

      const { credential, credentialDeviceType, credentialBackedUp } = verified.registrationInfo
      const createdAt = now()
      const row: Passkey = {
        id: credential.id,
        userId: user.id,
        name: cleanPasskeyName(input.name, passkeyLabel(input.response)),
        publicKey: encodeBytes(credential.publicKey),
        counter: credential.counter,
        transports: JSON.stringify(input.response.response.transports ?? []),
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        createdAt,
        lastUsedAt: null,
      }
      db.insert(passkeys).values(row).run()
      return ok(toView(row))
    },

    async authenticationOptions(input = {}) {
      const email = input.email?.trim().toLowerCase()
      const user = email ? db.select().from(users).where(eq(users.email, email)).get() : null
      const activeUser = isUserActive(user) ? user : null
      const credentials = activeUser ? passkeysForUser(activeUser.id) : []
      const options = await generateAuthenticationOptions({
        rpID: auth.passkeyRpId,
        allowCredentials: activeUser ? credentials.map((credential) => ({
          id: credential.id,
          transports: parseTransports(credential.transports),
        })) : undefined,
        userVerification: 'preferred',
      })
      storeChallenge(options.challenge, 'authentication', activeUser?.id ?? null)
      return ok({ options })
    },

    async verifyAuthentication(input) {
      const responseChallenge = clientChallenge(input.response.response.clientDataJSON)
      if (!responseChallenge) return err(unauthorized('Passkey challenge is invalid or expired'))
      const challenge = takeChallenge(responseChallenge, 'authentication')
      if (!challenge) return err(unauthorized('Passkey challenge is invalid or expired'))

      const credential = db.select().from(passkeys).where(eq(passkeys.id, input.response.id)).get()
      if (!credential || (challenge.userId && credential.userId !== challenge.userId)) {
        return err(unauthorized('Passkey is not registered'))
      }

      const verified = await verifier.verifyAuthenticationResponse({
        response: input.response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: auth.publicOrigin,
        expectedRPID: auth.passkeyRpId,
        credential: credentialFromRow(credential),
        requireUserVerification: false,
      })
      if (!verified.verified) return err(unauthorized('Passkey authentication failed'))

      db.update(passkeys)
        .set({
          counter: verified.authenticationInfo.newCounter,
          backedUp: verified.authenticationInfo.credentialBackedUp,
          deviceType: verified.authenticationInfo.credentialDeviceType,
          lastUsedAt: now(),
        })
        .where(eq(passkeys.id, credential.id))
        .run()

      const user = db.select().from(users).where(eq(users.id, credential.userId)).get()
      if (!isUserActive(user)) return err(unauthorized('Passkey user was not found'))
      return ok({
        user,
        passkey: toView({
          ...credential,
          counter: verified.authenticationInfo.newCounter,
          backedUp: verified.authenticationInfo.credentialBackedUp,
          deviceType: verified.authenticationInfo.credentialDeviceType,
          lastUsedAt: now(),
        }),
      })
    },
  }
}
