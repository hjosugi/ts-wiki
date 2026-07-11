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
  conflict,
  err,
  notFound,
  ok,
  requirePermission,
  unauthorized,
} from '@kawaii-wiki/core'
import type { AuthEnv } from '../env.ts'
import {
  DuplicatePasskeyCredentialError,
  type PasskeyRecord,
  type PasskeyRepository,
  type WebauthnChallengePurpose,
} from '../repositories/passkeys.ts'
import type { UserRecord, UserRepository } from '../repositories/users.ts'
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
  readonly user: UserRecord
  readonly passkey: PasskeyView
}

export interface PasskeyService {
  list(principal: Principal | null): Promise<Result<PasskeyView[], AppError>>
  hasForUser(userId: string): Promise<boolean>
  delete(principal: Principal | null, id: string): Promise<Result<{ id: string }, AppError>>
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

const toView = (row: PasskeyRecord): PasskeyView => ({
  id: row.id,
  name: row.name,
  deviceType: row.deviceType,
  backedUp: Boolean(row.backedUp),
  transports: parseTransports(row.transports),
  createdAt: row.createdAt,
  lastUsedAt: row.lastUsedAt,
})

const credentialFromRow = (row: PasskeyRecord): WebAuthnCredential => ({
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
  repository: PasskeyRepository,
  userRepository: UserRepository,
  auth: AuthEnv,
  verifier: PasskeyVerifier = { verifyRegistrationResponse, verifyAuthenticationResponse },
): PasskeyService => {
  const now = () => Date.now()

  const storeChallenge = async (
    challenge: string,
    purpose: WebauthnChallengePurpose,
    userId: string | null,
  ): Promise<void> => {
    await repository.cleanupChallenges(now())
    const createdAt = now()
    await repository.insertChallenge({
      challenge,
      userId,
      purpose,
      expiresAt: createdAt + CHALLENGE_TTL_MS,
      createdAt,
    })
  }

  const findUser = async (principal: Principal | null): Promise<UserRecord | null> => {
    if (!principal) return null
    const user = await userRepository.findById(principal.id)
    return isUserActive(user) ? user : null
  }

  return {
    async list(principal) {
      const user = await findUser(principal)
      if (!user) return err(unauthorized())
      return ok((await repository.listByUser(user.id)).map(toView))
    },

    async hasForUser(userId) {
      return (await repository.listByUser(userId)).length > 0
    },

    async delete(principal, id) {
      const user = await findUser(principal)
      if (!user) return err(unauthorized())
      const row = await repository.findById(id)
      if (!row) return err(notFound('Passkey not found'))
      if (row.userId !== user.id) {
        const allowed = requirePermission(principal, 'admin:access')
        if (!allowed.ok) return allowed
      }
      await repository.delete(id)
      return ok({ id })
    },

    async registrationOptions(principal) {
      const user = await findUser(principal)
      if (!user) return err(unauthorized())
      const existing = await repository.listByUser(user.id)
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
      await storeChallenge(options.challenge, 'registration', user.id)
      return ok({ options })
    },

    async verifyRegistration(principal, input) {
      const user = await findUser(principal)
      if (!user) return err(unauthorized())
      const responseChallenge = clientChallenge(input.response.response.clientDataJSON)
      if (!responseChallenge) return err(unauthorized('Passkey challenge is invalid or expired'))
      const challenge = await repository.consumeChallenge(responseChallenge, 'registration', now())
      if (!challenge || challenge.userId !== user.id) {
        return err(unauthorized('Passkey challenge is invalid or expired'))
      }

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
      const row: PasskeyRecord = {
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
      try {
        await repository.insert(row)
      } catch (error) {
        if (error instanceof DuplicatePasskeyCredentialError) {
          return err(conflict('Passkey is already registered'))
        }
        throw error
      }
      return ok(toView(row))
    },

    async authenticationOptions(input = {}) {
      const email = input.email?.trim().toLowerCase()
      const user = email ? await userRepository.findByEmail(email) : undefined
      const activeUser = isUserActive(user) ? user : null
      const credentials = activeUser ? await repository.listByUser(activeUser.id) : []
      const options = await generateAuthenticationOptions({
        rpID: auth.passkeyRpId,
        allowCredentials: activeUser ? credentials.map((credential) => ({
          id: credential.id,
          transports: parseTransports(credential.transports),
        })) : undefined,
        userVerification: 'preferred',
      })
      await storeChallenge(options.challenge, 'authentication', activeUser?.id ?? null)
      return ok({ options })
    },

    async verifyAuthentication(input) {
      const responseChallenge = clientChallenge(input.response.response.clientDataJSON)
      if (!responseChallenge) return err(unauthorized('Passkey challenge is invalid or expired'))
      const challenge = await repository.consumeChallenge(responseChallenge, 'authentication', now())
      if (!challenge) return err(unauthorized('Passkey challenge is invalid or expired'))

      const credential = await repository.findById(input.response.id)
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

      const lastUsedAt = now()
      const updated = await repository.updateAuthentication(credential.id, credential.counter, {
        counter: verified.authenticationInfo.newCounter,
        backedUp: verified.authenticationInfo.credentialBackedUp,
        deviceType: verified.authenticationInfo.credentialDeviceType,
        lastUsedAt,
      })
      if (!updated) return err(unauthorized('Passkey authentication was already used'))

      const user = await userRepository.findById(credential.userId)
      if (!isUserActive(user)) return err(unauthorized('Passkey user was not found'))
      return ok({
        user,
        passkey: toView({
          ...credential,
          counter: verified.authenticationInfo.newCounter,
          backedUp: verified.authenticationInfo.credentialBackedUp,
          deviceType: verified.authenticationInfo.credentialDeviceType,
          lastUsedAt,
        }),
      })
    },
  }
}
