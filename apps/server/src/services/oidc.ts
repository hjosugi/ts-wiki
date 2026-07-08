import { createHash, randomBytes } from 'node:crypto'
import { eq, lte } from 'drizzle-orm'
import {
  type AppError,
  type PublicAuthProvider,
  type Result,
  type Role,
  err,
  forbidden,
  ok,
  unauthorized,
  validationError,
} from '@ts-wiki/core'
import type { AuthEnv, OidcProviderEnv } from '../env.ts'
import type { DB } from '../db/client.ts'
import { oauthStates } from '../db/schema.ts'
import {
  createAuthProviderService,
  type AuthProvider,
  type AuthProviderCallbackParams,
  type AuthProviderCallbackResult,
} from './auth-providers.ts'
import type { AuthzService } from './authz.ts'

export interface OidcStart {
  readonly url: string
  readonly state: string
}

export type OidcCallbackResult = AuthProviderCallbackResult

export interface OidcService {
  publicProviders(): PublicAuthProvider[]
  start(providerId: string, redirectAfter?: string | null): Promise<Result<OidcStart, AppError>>
  callback(providerId: string, code: string, state: string): Promise<Result<OidcCallbackResult, AppError>>
}

export interface OidcServiceOptions {
  readonly now?: () => number
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
  now: number,
): Result<{ subject: string; email: string; name: string }, AppError> => {
  if (claims.iss !== provider.issuer) return err(unauthorized('OIDC issuer mismatch'))
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!aud.includes(provider.clientId)) return err(unauthorized('OIDC audience mismatch'))
  if (!claims.exp || claims.exp * 1000 <= now) return err(unauthorized('OIDC token expired'))
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

const OIDC_STATE_TTL_MS = 10 * 60_000

const requiredCallbackParam = (
  params: AuthProviderCallbackParams,
  key: string,
): Result<string, AppError> => {
  const value = params[key]
  return value ? ok(value) : err(validationError(`OIDC ${key} is required`, key))
}

export const createOidcAuthProviders = (
  db: DB,
  auth: AuthEnv,
  options: OidcServiceOptions = {},
): AuthProvider[] => {
  const now = options.now ?? (() => Date.now())

  const cleanupStates = (): void => {
    db.delete(oauthStates).where(lte(oauthStates.expiresAt, now())).run()
  }

  return auth.oidcProviders.map((provider): AuthProvider => ({
    id: provider.id,
    label: provider.label,
    kind: 'oidc',

    async startLogin(redirectAfter = null) {
      cleanupStates()
      const discovery = await discover(provider)
      const state = randomUrlToken()
      const nonce = randomUrlToken()
      const codeVerifier = randomUrlToken(48)
      const createdAt = now()
      db.insert(oauthStates)
        .values({
          state,
          provider: provider.id,
          nonce,
          codeVerifier,
          redirectAfter: safeRedirectAfter(redirectAfter),
          expiresAt: createdAt + OIDC_STATE_TTL_MS,
          createdAt,
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

    async handleCallback(params) {
      const code = requiredCallbackParam(params, 'code')
      if (!code.ok) return code
      const state = requiredCallbackParam(params, 'state')
      if (!state.ok) return state
      const stored = db.select().from(oauthStates).where(eq(oauthStates.state, state.value)).get()
      if (!stored || stored.provider !== provider.id) {
        return err(unauthorized('OIDC state is invalid or expired'))
      }
      const nowMs = now()
      if (stored.expiresAt <= nowMs) {
        db.delete(oauthStates).where(eq(oauthStates.state, state.value)).run()
        return err(unauthorized('OIDC state is invalid or expired'))
      }
      db.delete(oauthStates).where(eq(oauthStates.state, state.value)).run()

      const discovery = await discover(provider)
      const token = await fetchJson<TokenResponse>(discovery.token_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code.value,
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
      const claims = validateClaims(provider, verified.claims, stored.nonce, now())
      if (!claims.ok) return claims

      return ok({
        providerId: provider.id,
        providerKind: 'oidc',
        subject: claims.value.subject,
        email: claims.value.email,
        name: claims.value.name,
        emailVerified: true,
        allowRegistration: provider.allowRegistration,
        defaultRole: provider.defaultRole as Role,
      })
    },
  }))
}

export const createOidcService = (
  db: DB,
  auth: AuthEnv,
  authz: AuthzService,
  options: OidcServiceOptions = {},
): OidcService => {
  const service = createAuthProviderService(db, auth, authz, createOidcAuthProviders(db, auth, options))
  return {
    publicProviders: () => service.publicProviders(),
    start: (providerId, redirectAfter = null): Promise<Result<OidcStart, AppError>> =>
      service.start(providerId, redirectAfter) as Promise<Result<OidcStart, AppError>>,
    callback: (providerId, code, state) => service.callback(providerId, { code, state }),
  }
}
