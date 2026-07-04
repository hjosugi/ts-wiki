import { createHash, randomBytes } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import {
  type AppError,
  type Result,
  type Role,
  conflict,
  err,
  forbidden,
  ok,
  unauthorized,
  validationError,
} from '@ts-wiki/core'
import type { AuthEnv, OidcProviderEnv } from '../env.ts'
import type { DB } from '../db/client.ts'
import { authAccounts, oauthStates, users, type User } from '../db/schema.ts'
import { hashPassword } from './auth.ts'
import type { AuthzService } from './authz.ts'
import { isUserActive } from './users.ts'

export interface PublicAuthProvider {
  readonly id: string
  readonly label: string
  readonly type: 'oidc'
}

export interface OidcStart {
  readonly url: string
  readonly state: string
}

export interface OidcCallbackResult {
  readonly user: User
  readonly isNewUser: boolean
}

export interface OidcService {
  publicProviders(): PublicAuthProvider[]
  start(providerId: string, redirectAfter?: string | null): Promise<Result<OidcStart, AppError>>
  callback(providerId: string, code: string, state: string): Promise<Result<OidcCallbackResult, AppError>>
}

interface OidcDiscovery {
  readonly authorization_endpoint: string
  readonly token_endpoint: string
  readonly jwks_uri: string
}

interface TokenResponse {
  readonly id_token?: string
  readonly error?: string
  readonly error_description?: string
}

interface IdTokenClaims {
  readonly iss?: string
  readonly sub?: string
  readonly aud?: string | string[]
  readonly exp?: number
  readonly nonce?: string
  readonly email?: string
  readonly email_verified?: boolean
  readonly name?: string
}

const base64url = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString('base64url')

const randomUrlToken = (bytes = 32): string => base64url(randomBytes(bytes))

const sha256Base64Url = (value: string): string =>
  createHash('sha256').update(value).digest('base64url')

const decodeJwtPart = <T>(part: string): T | null => {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as T
  } catch {
    return null
  }
}

const providerById = (auth: AuthEnv, id: string): OidcProviderEnv | undefined =>
  auth.oidcProviders.find((provider) => provider.id === id)

const fetchJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init)
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`OIDC request failed (${response.status})${text ? `: ${text.slice(0, 200)}` : ''}`)
  }
  return response.json() as Promise<T>
}

const discover = (provider: OidcProviderEnv): Promise<OidcDiscovery> =>
  fetchJson<OidcDiscovery>(`${provider.issuer}/.well-known/openid-configuration`)

const importRsaJwk = (jwk: JsonWebKey): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )

const verifyJwtSignature = async (
  idToken: string,
  jwksUri: string,
): Promise<{ header: Record<string, unknown>; claims: IdTokenClaims } | null> => {
  const [encodedHeader, encodedClaims, encodedSignature] = idToken.split('.')
  if (!encodedHeader || !encodedClaims || !encodedSignature) return null
  const header = decodeJwtPart<Record<string, unknown>>(encodedHeader)
  const claims = decodeJwtPart<IdTokenClaims>(encodedClaims)
  if (!header || !claims || header.alg !== 'RS256') return null

  const jwks = await fetchJson<{ keys?: JsonWebKey[] }>(jwksUri)
  const key = (jwks.keys ?? []).find((candidate) => {
    const kid = (candidate as JsonWebKey & { kid?: string }).kid
    return !header.kid || kid === header.kid
  })
  if (!key) return null

  const cryptoKey = await importRsaJwk(key)
  const data = new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`)
  const signature = Buffer.from(encodedSignature, 'base64url')
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signature, data)
  return ok ? { header, claims } : null
}

const validateClaims = (
  provider: OidcProviderEnv,
  claims: IdTokenClaims,
  nonce: string,
): Result<{ subject: string; email: string; name: string }, AppError> => {
  if (claims.iss !== provider.issuer) return err(unauthorized('OIDC issuer mismatch'))
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!aud.includes(provider.clientId)) return err(unauthorized('OIDC audience mismatch'))
  if (!claims.exp || claims.exp * 1000 < Date.now()) return err(unauthorized('OIDC token expired'))
  if (claims.nonce !== nonce) return err(unauthorized('OIDC nonce mismatch'))
  if (!claims.sub) return err(unauthorized('OIDC subject missing'))
  const email = claims.email?.trim().toLowerCase()
  if (!email) return err(unauthorized('OIDC email missing'))
  if (claims.email_verified === false) return err(unauthorized('OIDC email is not verified'))
  const domain = email.split('@')[1] ?? ''
  if (provider.allowedEmailDomains.length && !provider.allowedEmailDomains.includes(domain)) {
    return err(forbidden('OIDC email domain is not allowed'))
  }
  return ok({ subject: claims.sub, email, name: claims.name?.trim() || email })
}

const safeRedirectAfter = (value: string | null | undefined): string | null =>
  value && value.startsWith('/') && !value.startsWith('//') ? value.slice(0, 500) : null

export const createOidcService = (db: DB, auth: AuthEnv, authz: AuthzService): OidcService => {
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

  const linkAccount = (user: User, provider: OidcProviderEnv, subject: string, email: string): void => {
    const existing = db
      .select()
      .from(authAccounts)
      .where(and(eq(authAccounts.provider, provider.id), eq(authAccounts.providerSubject, subject)))
      .get()
    const now = Date.now()
    if (existing) {
      db.update(authAccounts)
        .set({ email, userId: user.id, updatedAt: now })
        .where(eq(authAccounts.id, existing.id))
        .run()
      return
    }
    db.insert(authAccounts)
      .values({
        id: crypto.randomUUID(),
        userId: user.id,
        provider: provider.id,
        providerSubject: subject,
        email,
        createdAt: now,
        updatedAt: now,
      })
      .run()
  }

  const createExternalUser = async (provider: OidcProviderEnv, email: string, name: string): Promise<User> => {
    const now = Date.now()
    const user: User = {
      id: crypto.randomUUID(),
      email,
      name,
      passwordHash: await hashPassword(randomUrlToken(48)),
      role: provider.defaultRole as Role,
      totpSecret: null,
      totpEnabled: 0,
      disabledAt: null,
      tokenInvalidBefore: 0,
      createdAt: now,
    }
    db.insert(users).values(user).run()
    authz.syncRoleGroup(user.id, user.role)
    return user
  }

  return {
    publicProviders() {
      return auth.oidcProviders.map((provider) => ({
        id: provider.id,
        label: provider.label,
        type: 'oidc' as const,
      }))
    },

    async start(providerId, redirectAfter = null) {
      const provider = providerById(auth, providerId)
      if (!provider) return err(notFoundProvider())
      const discovery = await discover(provider)
      const state = randomUrlToken()
      const nonce = randomUrlToken()
      const codeVerifier = randomUrlToken(48)
      const now = Date.now()
      db.insert(oauthStates)
        .values({
          state,
          provider: provider.id,
          nonce,
          codeVerifier,
          redirectAfter: safeRedirectAfter(redirectAfter),
          expiresAt: now + 10 * 60_000,
          createdAt: now,
        })
        .run()
      const url = new URL(discovery.authorization_endpoint)
      url.searchParams.set('client_id', provider.clientId)
      url.searchParams.set('redirect_uri', provider.redirectUri)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('scope', provider.scopes.join(' '))
      url.searchParams.set('state', state)
      url.searchParams.set('nonce', nonce)
      url.searchParams.set('code_challenge', sha256Base64Url(codeVerifier))
      url.searchParams.set('code_challenge_method', 'S256')
      return ok({ url: url.toString(), state })
    },

    async callback(providerId, code, state) {
      const provider = providerById(auth, providerId)
      if (!provider) return err(notFoundProvider())
      const stored = db.select().from(oauthStates).where(eq(oauthStates.state, state)).get()
      if (!stored || stored.provider !== provider.id || stored.expiresAt < Date.now()) {
        return err(unauthorized('OIDC state is invalid or expired'))
      }
      db.delete(oauthStates).where(eq(oauthStates.state, state)).run()

      const discovery = await discover(provider)
      const token = await fetchJson<TokenResponse>(discovery.token_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: provider.clientId,
          client_secret: provider.clientSecret,
          redirect_uri: provider.redirectUri,
          code_verifier: stored.codeVerifier,
        }),
      })
      if (token.error || !token.id_token) {
        return err(unauthorized(token.error_description ?? token.error ?? 'OIDC token exchange failed'))
      }

      const verified = await verifyJwtSignature(token.id_token, discovery.jwks_uri)
      if (!verified) return err(unauthorized('OIDC ID token signature is invalid'))
      const claims = validateClaims(provider, verified.claims, stored.nonce)
      if (!claims.ok) return claims

      const existingByAccount = findAccount(provider.id, claims.value.subject)
      if (existingByAccount) {
        if (!isUserActive(existingByAccount)) return err(unauthorized('Account is deactivated'))
        linkAccount(existingByAccount, provider, claims.value.subject, claims.value.email)
        return ok({ user: existingByAccount, isNewUser: false })
      }

      const existingByEmail = findUserByEmail(claims.value.email)
      if (existingByEmail) {
        if (!isUserActive(existingByEmail)) return err(unauthorized('Account is deactivated'))
        linkAccount(existingByEmail, provider, claims.value.subject, claims.value.email)
        return ok({ user: existingByEmail, isNewUser: false })
      }

      if (!provider.allowRegistration || auth.registration === 'off') {
        return err(forbidden('OIDC self-registration is disabled'))
      }
      const user = await createExternalUser(provider, claims.value.email, claims.value.name)
      linkAccount(user, provider, claims.value.subject, claims.value.email)
      return ok({ user, isNewUser: true })
    },
  }
}

const notFoundProvider = (): AppError => validationError('Unknown auth provider', 'provider')
