import { randomBytes } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import {
  type AppError,
  type AuthProviderKind,
  type PublicAuthProvider,
  type Result,
  type Role,
  err,
  forbidden,
  ok,
  unauthorized,
  validationError,
} from '@ts-wiki/core'
import type { AuthEnv } from '../env.ts'
import type { DB } from '../db/client.ts'
import { authAccounts, users, type User } from '../db/schema.ts'
import { hashPassword } from './auth.ts'
import type { AuthzService } from './authz.ts'
import { isUserActive } from './users.ts'

export type AuthProviderCallbackParams = Readonly<Record<string, string | undefined>>

export interface AuthProviderLoginStart {
  readonly url: string
  readonly state?: string
}

export interface ExternalIdentity {
  readonly providerId: string
  readonly providerKind: AuthProviderKind
  readonly subject: string
  readonly email: string
  readonly name: string
  readonly emailVerified: boolean
  readonly allowRegistration: boolean
  readonly defaultRole: Role
}

export interface AuthProvider {
  readonly id: string
  readonly label: string
  readonly kind: AuthProviderKind
  startLogin(redirectAfter?: string | null): Promise<Result<AuthProviderLoginStart, AppError>>
  handleCallback(params: AuthProviderCallbackParams): Promise<Result<ExternalIdentity, AppError>>
}

export interface AuthProviderCallbackResult {
  readonly user: User
  readonly isNewUser: boolean
  readonly identity: ExternalIdentity
}

export interface AuthProviderService {
  publicProviders(): PublicAuthProvider[]
  start(providerId: string, redirectAfter?: string | null): Promise<Result<AuthProviderLoginStart, AppError>>
  callback(
    providerId: string,
    params: AuthProviderCallbackParams,
  ): Promise<Result<AuthProviderCallbackResult, AppError>>
}

const randomUrlToken = (bytes = 32): string => Buffer.from(randomBytes(bytes)).toString('base64url')

const notFoundProvider = (): AppError => validationError('Unknown auth provider', 'provider')

const cleanEmail = (email: string): string => email.trim().toLowerCase()

export const authProviderLoginUrl = (providerId: string): string =>
  `/api/auth/${encodeURIComponent(providerId)}/start`

const publicProvider = (provider: AuthProvider): PublicAuthProvider => ({
  id: provider.id,
  label: provider.label,
  kind: provider.kind,
  type: provider.kind,
  loginUrl: authProviderLoginUrl(provider.id),
})

export const createAuthProviderService = (
  db: DB,
  auth: AuthEnv,
  authz: AuthzService,
  providers: readonly AuthProvider[],
): AuthProviderService => {
  const byId = new Map(providers.map((provider) => [provider.id, provider]))

  const findUserByEmail = (email: string): User | undefined =>
    db.select().from(users).where(eq(users.email, email)).get()

  const findAccount = (provider: string, providerSubject: string): User | undefined => {
    const row = db
      .select({ user: users })
      .from(authAccounts)
      .innerJoin(users, eq(users.id, authAccounts.userId))
      .where(and(eq(authAccounts.provider, provider), eq(authAccounts.providerSubject, providerSubject)))
      .get()
    return row?.user
  }

  const linkAccount = (user: User, identity: ExternalIdentity): void => {
    const existing = db
      .select()
      .from(authAccounts)
      .where(and(
        eq(authAccounts.provider, identity.providerId),
        eq(authAccounts.providerSubject, identity.subject),
      ))
      .get()
    const now = Date.now()
    if (existing) {
      db.update(authAccounts)
        .set({ email: identity.email, userId: user.id, updatedAt: now })
        .where(eq(authAccounts.id, existing.id))
        .run()
      return
    }
    db.insert(authAccounts)
      .values({
        id: crypto.randomUUID(),
        userId: user.id,
        provider: identity.providerId,
        providerSubject: identity.subject,
        email: identity.email,
        createdAt: now,
        updatedAt: now,
      })
      .run()
  }

  const createExternalUser = async (identity: ExternalIdentity): Promise<User> => {
    const now = Date.now()
    const user: User = {
      id: crypto.randomUUID(),
      email: identity.email,
      name: identity.name,
      passwordHash: await hashPassword(randomUrlToken(48)),
      role: identity.defaultRole,
      totpSecret: null,
      totpEnabled: 0,
      disabledAt: null,
      tokenInvalidBefore: 0,
      emailVerifiedAt: now,
      createdAt: now,
    }
    db.insert(users).values(user).run()
    authz.syncRoleGroup(user.id, user.role)
    return user
  }

  const completeLogin = async (rawIdentity: ExternalIdentity): Promise<Result<AuthProviderCallbackResult, AppError>> => {
    const identity: ExternalIdentity = {
      ...rawIdentity,
      email: cleanEmail(rawIdentity.email),
      name: rawIdentity.name.trim() || cleanEmail(rawIdentity.email),
    }
    if (!identity.subject.trim()) return err(unauthorized('External subject missing'))
    if (!identity.email) return err(unauthorized('External email missing'))
    if (!identity.emailVerified) return err(unauthorized('External email is not verified'))

    const existingByAccount = findAccount(identity.providerId, identity.subject)
    if (existingByAccount) {
      if (!isUserActive(existingByAccount)) return err(unauthorized('Account is deactivated'))
      linkAccount(existingByAccount, identity)
      return ok({ user: existingByAccount, isNewUser: false, identity })
    }

    const existingByEmail = findUserByEmail(identity.email)
    if (existingByEmail) {
      if (!isUserActive(existingByEmail)) return err(unauthorized('Account is deactivated'))
      linkAccount(existingByEmail, identity)
      return ok({ user: existingByEmail, isNewUser: false, identity })
    }

    if (!identity.allowRegistration || auth.registration === 'off') {
      return err(forbidden('External self-registration is disabled'))
    }

    const user = await createExternalUser(identity)
    linkAccount(user, identity)
    return ok({ user, isNewUser: true, identity })
  }

  return {
    publicProviders() {
      return providers.map(publicProvider)
    },

    async start(providerId, redirectAfter = null) {
      const provider = byId.get(providerId)
      if (!provider) return err(notFoundProvider())
      return provider.startLogin(redirectAfter)
    },

    async callback(providerId, params) {
      const provider = byId.get(providerId)
      if (!provider) return err(notFoundProvider())
      const identity = await provider.handleCallback(params)
      if (!identity.ok) return identity
      return completeLogin(identity.value)
    },
  }
}
