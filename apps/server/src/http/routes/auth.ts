import { t } from 'elysia'
import { eq } from 'drizzle-orm'
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server'
import {
  forbidden,
  type Principal,
  type Role,
  unauthorized,
} from '@ts-wiki/core'
import type { Env } from '../../env.ts'
import type { DB } from '../../db/client.ts'
import type { Services } from '../../services/index.ts'
import { users, type User } from '../../db/schema.ts'
import { otpauthUrl, randomBase32Secret, verifyPassword, verifyTotpCode } from '../../services/auth.ts'
import type { AuthProviderCallbackParams } from '../../services/auth-providers.ts'
import { isUserActive } from '../../services/users.ts'
import type { AutomationEvent } from '../../services/webhooks.ts'
import { audit, type StructuredLogger } from '../../observability/logging.ts'
import { HttpError, unwrap } from '../errors.ts'
import type { RequestIpServer } from '../rate-limit.ts'
import { publicUser } from '../representations.ts'
import type { BaseApp } from '../base.ts'

interface JwtSigner {
  sign(payload: Record<string, unknown>): Promise<string>
  verify(token: string): Promise<unknown>
}

const MFA_SETUP_TOKEN_TTL_SECONDS = 10 * 60

const base64UrlString = t.String({ minLength: 1 })
const credentialType = t.Literal('public-key')
const authenticatorAttachment = t.Union([t.Literal('platform'), t.Literal('cross-platform')])
const authenticatorTransport = t.Union([
  t.Literal('ble'),
  t.Literal('cable'),
  t.Literal('hybrid'),
  t.Literal('internal'),
  t.Literal('nfc'),
  t.Literal('smart-card'),
  t.Literal('usb'),
])
const clientExtensionResults = t.Object({}, { additionalProperties: true })
const providerCallbackQuery = t.Object({}, { additionalProperties: true })

const registrationResponse = t.Object({
  id: base64UrlString,
  rawId: base64UrlString,
  type: credentialType,
  authenticatorAttachment: t.Optional(authenticatorAttachment),
  clientExtensionResults,
  response: t.Object({
    clientDataJSON: base64UrlString,
    attestationObject: base64UrlString,
    authenticatorData: t.Optional(base64UrlString),
    transports: t.Optional(t.Array(authenticatorTransport)),
    publicKeyAlgorithm: t.Optional(t.Number()),
    publicKey: t.Optional(base64UrlString),
  }),
})

const authenticationResponse = t.Object({
  id: base64UrlString,
  rawId: base64UrlString,
  type: credentialType,
  authenticatorAttachment: t.Optional(authenticatorAttachment),
  clientExtensionResults,
  response: t.Object({
    clientDataJSON: base64UrlString,
    authenticatorData: base64UrlString,
    signature: base64UrlString,
    userHandle: t.Optional(base64UrlString),
  }),
})

export interface AuthRoutesContext {
  readonly db: DB
  readonly env: Env
  readonly logger: StructuredLogger
  readonly enforceAuthLimit: (
    request: Request,
    server: RequestIpServer | null | undefined,
    scope: string,
  ) => void
  readonly enforceCredentialLimit: (
    request: Request,
    server: RequestIpServer | null | undefined,
    scope: string,
    principal?: Principal | null,
  ) => void
  readonly publishAutomation: (event: AutomationEvent) => Promise<void>
}

export const createAuthRoutes = ({
  db,
  env,
  logger,
  enforceAuthLimit,
  enforceCredentialLimit,
  publishAutomation,
}: AuthRoutesContext) => {
	  const signAuthToken = (jwt: JwtSigner, user: Pick<User, 'id' | 'role'>): Promise<string> => {
	    const now = Date.now()
	    return jwt.sign({
	      sub: user.id,
      role: user.role,
      iatMs: now,
	      exp: Math.floor(now / 1000) + env.auth.tokenTtlSeconds,
	    })
	  }

  const signMfaSetupToken = (jwt: JwtSigner, user: Pick<User, 'id' | 'role'>): Promise<string> => {
    const now = Date.now()
    return jwt.sign({
      sub: user.id,
      role: user.role,
      mfaSetup: true,
      iatMs: now,
      exp: Math.floor(now / 1000) + MFA_SETUP_TOKEN_TTL_SECONDS,
    })
  }

  const userForMfaSetupToken = async (
    jwt: JwtSigner,
    token: string | null | undefined,
    services: Services,
  ): Promise<User | null> => {
    if (!token) return null
    try {
      const payload = await jwt.verify(token)
      const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null
      if (!data || data.mfaSetup !== true || typeof data.sub !== 'string') return null
      const user = services.users.findById(data.sub)
      return isUserActive(user) ? user : null
    } catch {
      return null
    }
  }

  const userForTotpEnrollment = async (
    jwt: JwtSigner,
    principal: Principal | null,
    services: Services,
    setupToken?: string,
  ): Promise<User | null> => {
    if (principal) {
      const user = services.users.findById(principal.id)
      return isUserActive(user) ? user : null
    }
    return userForMfaSetupToken(jwt, setupToken, services)
  }

  const authProviderCallbackParams = (query: Record<string, unknown>): AuthProviderCallbackParams => {
    const params: Record<string, string | undefined> = {}
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === 'string') params[key] = value
    }
    return params
  }

  const completeAuthProviderLogin = async (
    providerId: string,
    params: AuthProviderCallbackParams,
    services: Services,
    jwt: JwtSigner,
  ): Promise<Response> => {
    const result = unwrap(await services.authProviders.callback(providerId, params))
    const token = await signAuthToken(jwt, result.user)
    audit(logger, `auth.${result.identity.providerKind}.login`, {
      userId: result.user.id,
      provider: result.identity.providerId,
      isNewUser: result.isNewUser,
    })
    if (result.isNewUser) {
      await publishAutomation({
        type: 'user.created',
        actorId: result.user.id,
        data: { user: publicUser(result.user) },
      })
    }
    return Response.redirect(`/_login#token=${encodeURIComponent(token)}`, 302)
  }

  return (app: BaseApp) =>
	    app
	      .post(
	        '/api/auth/register',
	        async ({ body, services, jwt, request, server, set }) => {
	          enforceAuthLimit(request, server, 'register')
	          const role: Role = services.users.count() === 0 ? 'admin' : 'viewer'
	          if (role !== 'admin' && env.auth.registration === 'off') {
	            throw new HttpError(forbidden('Registration is disabled'))
	          }
	          const verificationRequired = env.auth.requireEmailVerification
	          if (verificationRequired && !services.recovery.mailConfigured()) {
	            throw new HttpError(forbidden('Email verification is not configured'))
	          }
	          const user = unwrap(await services.users.create({
	            ...body,
	            role,
	            emailVerifiedAt: verificationRequired ? null : undefined,
	          }))
	          services.authz.syncRoleGroup(user.id, user.role)
	          audit(logger, 'auth.register', { userId: user.id, role: user.role })
	          await publishAutomation({ type: 'user.created', actorId: user.id, data: { user: publicUser(user) } })
	          if (verificationRequired) {
	            await services.recovery.sendEmailVerification(user)
	            set.status = 202
	            return { verificationRequired: true as const }
	          }
	          const token = await signAuthToken(jwt, user)
	          return { token, user: publicUser(user) }
	        },
        {
          body: t.Object({
            email: t.String({ minLength: 3 }),
            name: t.String({ minLength: 1 }),
            password: t.String({ minLength: 6 }),
          }),
        },
      )
      .post(
        '/api/auth/login',
	        async ({ body, services, jwt, request, server, set }) => {
	          enforceAuthLimit(request, server, 'login')
	          const user = services.users.findByEmail(body.email)
	          if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
	            throw new HttpError(unauthorized('Invalid email or password'))
	          }
	          if (!isUserActive(user)) throw new HttpError(unauthorized('Account is deactivated'))
	          if (env.auth.requireEmailVerification && user.emailVerifiedAt === null) {
	            throw new HttpError(unauthorized('Email verification required'))
	          }
	          if (env.auth.requireTwoFactor && !user.totpEnabled && !services.passkeys.hasForUser(user.id)) {
	            audit(logger, 'auth.2fa.enforce', { userId: user.id })
	            set.status = 202
	            return {
	              twoFactorSetupRequired: true as const,
	              setupToken: await signMfaSetupToken(jwt, user),
	              user: publicUser(user),
	            }
	          }
	          if (user.totpEnabled) {
            if (!body.totpCode || !user.totpSecret || !verifyTotpCode(user.totpSecret, body.totpCode)) {
              throw new HttpError(unauthorized('Two-factor code required or invalid'))
            }
          }
          const token = await signAuthToken(jwt, user)
          audit(logger, 'auth.login', { userId: user.id, role: user.role })
          return { token, user: publicUser(user) }
        },
        { body: t.Object({ email: t.String(), password: t.String(), totpCode: t.Optional(t.String()) }) },
      )
      .get('/api/auth/me', ({ principal, services }) => {
        if (!principal) throw new HttpError(unauthorized())
        const user = services.users.findById(principal.id)
        if (!user) throw new HttpError(unauthorized())
        return { user: publicUser(user) }
      })
      .put(
        '/api/auth/profile',
        async ({ body, principal, services }) => {
          const user = unwrap(services.users.updateProfile(principal, body))
          audit(logger, 'auth.profile.update', { userId: user.id })
          return { user: publicUser(user) }
        },
        { body: t.Object({ name: t.Optional(t.String({ minLength: 1 })) }) },
      )
	      .put(
	        '/api/auth/password',
        async ({ body, principal, services, request, server }) => {
          enforceCredentialLimit(request, server, 'password-change', principal)
          const user = unwrap(await services.users.changePassword(principal, body))
          audit(logger, 'auth.password.change', { userId: user.id })
          return { user: publicUser(user) }
        },
	        { body: t.Object({ currentPassword: t.String(), newPassword: t.String({ minLength: 6 }) }) },
	      )
	      .post(
	        '/api/auth/forgot',
	        async ({ body, services, request, server }) => {
	          enforceCredentialLimit(request, server, 'password-forgot')
	          return unwrap(await services.recovery.requestPasswordReset(body.email))
	        },
	        { body: t.Object({ email: t.String({ minLength: 3 }) }) },
	      )
	      .post(
	        '/api/auth/reset',
	        async ({ body, services, request, server }) => {
	          enforceCredentialLimit(request, server, 'password-reset')
	          return unwrap(await services.recovery.resetPassword(body.token, body.password))
	        },
	        { body: t.Object({ token: t.String({ minLength: 20 }), password: t.String({ minLength: 6 }) }) },
	      )
	      .post(
	        '/api/auth/email/verify',
	        ({ body, services }) => unwrap(services.recovery.verifyEmail(body.token)),
	        { body: t.Object({ token: t.String({ minLength: 20 }) }) },
	      )
	      .post('/api/auth/email/verification', async ({ principal, services, request, server }) => {
	        enforceCredentialLimit(request, server, 'email-verification', principal)
	        if (!principal) throw new HttpError(unauthorized())
	        const user = services.users.findById(principal.id)
	        if (!user || !isUserActive(user)) throw new HttpError(unauthorized())
	        return unwrap(await services.recovery.sendEmailVerification(user))
	      })
	      .get('/api/auth/providers', ({ services }) => ({ providers: services.authProviders.publicProviders() }))
	      .post('/api/auth/totp/setup', async ({ body, principal, services, jwt, request, server }) => {
	        enforceCredentialLimit(request, server, 'totp-setup', principal)
	        const user = await userForTotpEnrollment(jwt, principal, services, body?.setupToken)
	        if (!user) throw new HttpError(unauthorized())
	        const secret = user.totpSecret || randomBase32Secret()
	        db.update(users)
	          .set({ totpSecret: secret, totpEnabled: user.totpEnabled })
	          .where(eq(users.id, user.id))
	          .run()
	        return { secret, otpauthUrl: otpauthUrl(env.auth.siteName, user.email, secret) }
	      }, { body: t.Optional(t.Object({ setupToken: t.Optional(t.String()) })) })
	      .post(
	        '/api/auth/totp/enable',
	        async ({ body, principal, services, jwt, request, server }) => {
	          enforceCredentialLimit(request, server, 'totp-enable', principal)
	          const user = await userForTotpEnrollment(jwt, principal, services, body.setupToken)
	          if (!user) throw new HttpError(unauthorized())
	          if (!user?.totpSecret || !verifyTotpCode(user.totpSecret, body.code)) {
	            throw new HttpError(unauthorized('Invalid two-factor code'))
	          }
	          db.update(users).set({ totpEnabled: 1 }).where(eq(users.id, user.id)).run()
	          const publicUpdated = publicUser({ ...user, totpEnabled: 1 })
	          if (!principal) {
	            return { token: await signAuthToken(jwt, user), user: publicUpdated }
	          }
	          return { user: publicUpdated }
	        },
	        { body: t.Object({ code: t.String(), setupToken: t.Optional(t.String()) }) },
	      )
      .post(
        '/api/auth/totp/disable',
        ({ body, principal, services, request, server }) => {
          enforceCredentialLimit(request, server, 'totp-disable', principal)
          if (!principal) throw new HttpError(unauthorized())
          const user = services.users.findById(principal.id)
          if (!user) throw new HttpError(unauthorized())
          if (user.totpEnabled && (!user.totpSecret || !body.code || !verifyTotpCode(user.totpSecret, body.code))) {
            throw new HttpError(unauthorized('Invalid two-factor code'))
          }
          db.update(users).set({ totpSecret: null, totpEnabled: 0 }).where(eq(users.id, user.id)).run()
          return { user: publicUser({ ...user, totpSecret: null, totpEnabled: 0 }) }
        },
        { body: t.Object({ code: t.Optional(t.String()) }) },
      )
      .get('/api/auth/passkeys', ({ principal, services }) => ({
        passkeys: unwrap(services.passkeys.list(principal)),
      }))
      .post('/api/auth/passkeys/register/options', async ({ principal, services, request, server }) => {
        enforceCredentialLimit(request, server, 'passkey-register-options', principal)
        return unwrap(await services.passkeys.registrationOptions(principal))
      })
      .post(
        '/api/auth/passkeys/register/verify',
        async ({ body, principal, services, request, server }) => {
          enforceCredentialLimit(request, server, 'passkey-register-verify', principal)
          return {
            passkey: unwrap(await services.passkeys.verifyRegistration(principal, body as {
              response: RegistrationResponseJSON
              name?: string
            })),
          }
        },
        {
          body: t.Object({
            name: t.Optional(t.String()),
            response: registrationResponse,
          }),
        },
      )
      .delete(
        '/api/auth/passkeys/:id',
        ({ params, principal, services, request, server }) => {
          enforceCredentialLimit(request, server, 'passkey-delete', principal)
          return unwrap(services.passkeys.delete(principal, params.id))
        },
        { params: t.Object({ id: t.String() }) },
      )
      .post(
        '/api/auth/passkeys/login/options',
        async ({ body, services, request, server }) => {
          enforceCredentialLimit(request, server, 'passkey-login-options')
          return unwrap(await services.passkeys.authenticationOptions(body))
        },
        { body: t.Object({ email: t.Optional(t.String()) }) },
      )
      .post(
        '/api/auth/passkeys/login/verify',
        async ({ body, services, jwt, request, server }) => {
          enforceCredentialLimit(request, server, 'passkey-login-verify')
	          const result = unwrap(await services.passkeys.verifyAuthentication(body as {
	            response: AuthenticationResponseJSON
	          }))
	          if (env.auth.requireEmailVerification && result.user.emailVerifiedAt === null) {
	            throw new HttpError(unauthorized('Email verification required'))
	          }
	          const token = await signAuthToken(jwt, result.user)
          audit(logger, 'auth.passkey.login', {
            userId: result.user.id,
            passkeyId: result.passkey.id,
          })
          return { token, user: publicUser(result.user), passkey: result.passkey }
        },
        { body: t.Object({ response: authenticationResponse }) },
      )
      .get(
        '/api/auth/:provider/start',
        async ({ params, query, services, request, server }) => {
          enforceCredentialLimit(request, server, `auth-provider-start:${params.provider}`)
          const started = unwrap(await services.authProviders.start(params.provider, query.redirect))
          return Response.redirect(started.url, 302)
        },
        { params: t.Object({ provider: t.String() }), query: t.Object({ redirect: t.Optional(t.String()) }) },
      )
      .get(
        '/api/auth/:provider/callback',
        async ({ params, query, services, jwt, request, server }) => {
          enforceCredentialLimit(request, server, `auth-provider-callback:${params.provider}`)
          return completeAuthProviderLogin(params.provider, authProviderCallbackParams(query), services, jwt)
        },
        { params: t.Object({ provider: t.String() }), query: providerCallbackQuery },
      )
      .get(
        '/api/auth/oidc/:provider/start',
        async ({ params, query, services, request, server }) => {
          enforceCredentialLimit(request, server, `oidc-start:${params.provider}`)
          const started = unwrap(await services.authProviders.start(params.provider, query.redirect))
          return Response.redirect(started.url, 302)
        },
        { params: t.Object({ provider: t.String() }), query: t.Object({ redirect: t.Optional(t.String()) }) },
      )
      .get(
        '/api/auth/oidc/:provider/callback',
        async ({ params, query, services, jwt, request, server }) => {
          enforceCredentialLimit(request, server, `oidc-callback:${params.provider}`)
          return completeAuthProviderLogin(params.provider, query, services, jwt)
        },
        {
          params: t.Object({ provider: t.String() }),
          query: t.Object({ code: t.String(), state: t.String() }),
        },
      )
}
