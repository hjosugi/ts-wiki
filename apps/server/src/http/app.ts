/**
 * HTTP composition root. One chained Elysia instance so its type flows cleanly
 * into the Eden Treaty client (zero codegen). Cross-cutting concerns —
 * principal resolution, error mapping — are declared once here; handlers stay
 * thin and delegate to services.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Elysia, t } from 'elysia'
import { cors } from '@elysiajs/cors'
import { jwt } from '@elysiajs/jwt'
import { eq } from 'drizzle-orm'
import {
  type Principal,
  type Role,
  can,
  forbidden,
  unauthorized,
  validationError,
  serializePageFile,
  parsePageFile,
} from '@ts-wiki/core'
import type { Env } from '../env.ts'
import type { DB } from '../db/client.ts'
import { createServices } from '../services/index.ts'
import { createCollabRuntime, createPresenceRuntime, createRealtimeBus } from '../realtime/runtime.ts'
import { createAssetStorage, type AssetObject, type AssetStorage } from '../storage/assets.ts'
import { createGitStorage, type GitConfig } from '../storage/git.ts'
import { createGitSyncHandlers, startGitSyncScheduler } from '../storage/git-sync.ts'
import type { CollabSeed } from '../realtime/collab.ts'
import { otpauthUrl, randomBase32Secret, verifyPassword, verifyTotpCode } from '../services/auth.ts'
import { isUserActive } from '../services/users.ts'
import {
  audit,
  consoleStructuredLogger,
  requestLog,
  type StructuredLogger,
} from '../observability/logging.ts'
import {
  ALLOWED_ASSET_MIME_TYPES,
  ASSET_HARD_MAX_SIZE,
  assetExtensionForMime,
  type AssetView,
} from '../services/assets.ts'
import type { CommentView } from '../services/comments.ts'
import type { AutomationEvent, WebhookFetcher } from '../services/webhooks.ts'
import { users, type Page, type User } from '../db/schema.ts'
import { HttpError, unwrap, toErrorResponse } from './errors.ts'
import { authRateLimitError, clientIp, createRateLimiter, type RequestIpServer } from './rate-limit.ts'

export interface AppDeps {
  readonly db: DB
  readonly env: Env
  readonly logger?: StructuredLogger
  readonly assetStorage?: AssetStorage
  readonly webhookFetcher?: WebhookFetcher
}

const publicUser = (
  user: Pick<User, 'id' | 'email' | 'name' | 'role'> & {
    readonly totpEnabled?: boolean | number | null
    readonly totpSecret?: string | null
  },
) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  totpEnabled: Boolean(user.totpEnabled),
})

interface JwtVerifier {
  verify(token: string): Promise<unknown>
}

interface JwtSigner {
  sign(payload: Record<string, unknown>): Promise<string>
}

interface TokenPrincipal {
  readonly id: string
  readonly issuedAtMs: number
}

const tokenPrincipalFromPayload = (payload: unknown): TokenPrincipal | null => {
  const data = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null
  if (!data) return null
  const id = data?.sub
  if (typeof id !== 'string') {
    return null
  }
  const issuedAtMs =
    typeof data.iatMs === 'number'
      ? data.iatMs
      : typeof data.iat === 'number'
        ? data.iat * 1000
        : 0
  return { id, issuedAtMs }
}

const bearerToken = (authorization: string | undefined): string | null =>
  authorization?.startsWith('Bearer ') ? authorization.slice(7) : null

const verifyTokenPrincipal = async (jwt: JwtVerifier, token: string | null | undefined): Promise<TokenPrincipal | null> => {
  if (!token) return null
  try {
    return tokenPrincipalFromPayload(await jwt.verify(token))
  } catch {
    return null
  }
}

const ASSET_RESPONSE_HEADER_ALLOWLIST = [
  'cache-control',
  'content-length',
  'content-type',
  'etag',
  'last-modified',
] as const

const assetResponse = (asset: AssetObject): Response => {
  const headers = new Headers()
  for (const header of ASSET_RESPONSE_HEADER_ALLOWLIST) {
    const value = asset.headers.get(header)
    if (value) headers.set(header, value)
  }
  headers.set('x-content-type-options', 'nosniff')
  const contentType = headers.get('content-type') ?? ''
  headers.set('content-disposition', contentType.startsWith('image/') ? 'inline' : 'attachment')
  return new Response(asset.body, { headers })
}

const formatBytes = (bytes: number): string => {
  if (bytes % (1024 * 1024) === 0) return `${bytes / (1024 * 1024)}MB`
  if (bytes % 1024 === 0) return `${bytes / 1024}KB`
  return `${bytes}B`
}

const safeAssetRequestPath = (rawPath: string): string | null => {
  let decoded: string
  try {
    decoded = decodeURIComponent(rawPath)
  } catch {
    return null
  }
  if (!decoded || decoded.startsWith('/') || decoded.includes('\\') || decoded.includes('\0')) return null
  if (decoded.split('/').some((part) => part === '.' || part === '..' || part.length === 0)) return null
  return decoded
}

const parsePageLabels = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

const pageSnapshot = (page: Page) => ({
  id: page.id,
  path: page.path,
  title: page.title,
  lifecycle: page.lifecycle,
  status: page.status,
  labels: parsePageLabels(page.labels),
  ownerId: page.ownerId,
  reviewAt: page.reviewAt,
  spaceKey: page.spaceKey,
  locale: page.locale,
  createdAt: page.createdAt,
  updatedAt: page.updatedAt,
})

const commentSnapshot = (comment: CommentView) => ({
  id: comment.id,
  path: comment.path,
  authorId: comment.authorId,
  mentions: comment.mentions,
  resolvedAt: comment.resolvedAt,
  createdAt: comment.createdAt,
  updatedAt: comment.updatedAt,
})

const assetSnapshot = (asset: AssetView) => ({
  id: asset.id,
  filename: asset.filename,
  storageName: asset.storageName,
  mime: asset.mime,
  size: asset.size,
  url: asset.url,
  authorId: asset.authorId,
  createdAt: asset.createdAt,
})

export const createApp = ({
  db,
  env,
  logger = consoleStructuredLogger,
  assetStorage: suppliedAssetStorage,
  webhookFetcher,
}: AppDeps) => {
  const assetStorage = suppliedAssetStorage ?? createAssetStorage(env.assetStorage)
  const services = createServices(db, { assetUrl: assetStorage.url, auth: env.auth, webhookFetcher })
  const corsOrigin = env.cors.origins === null ? true : [...env.cors.origins]
  const authLimiter = createRateLimiter(10, 60_000)
  const webIndex = join(env.webDistDir, 'index.html')
  const hasWebDist = existsSync(webIndex)
  const requestStartedAt = new WeakMap<Request, number>()
  const logRequest = (
    request: Request,
    server: RequestIpServer | null | undefined,
    status: number,
    principal: Principal | null = null,
    error?: string,
  ): void => {
    const startedAt = requestStartedAt.get(request) ?? Date.now()
    const url = new URL(request.url)
    requestLog(logger, {
      method: request.method,
      path: url.pathname,
      status,
      durationMs: Date.now() - startedAt,
      ip: clientIp(request, server, env.trustProxyHeaders),
      userId: principal?.id ?? null,
      ...(error ? { error } : {}),
    })
  }
  const bus = createRealtimeBus(db, env.realtime)
  const presenceRuntime = createPresenceRuntime()
  const signAuthToken = (jwt: JwtSigner, user: Pick<User, 'id' | 'role'>): Promise<string> => {
    const now = Date.now()
    return jwt.sign({
      sub: user.id,
      role: user.role,
      iatMs: now,
      exp: Math.floor(now / 1000) + env.auth.tokenTtlSeconds,
    })
  }
  const publicSettings = () => ({
    ...services.settings.public(),
    privateWiki: env.auth.privateWiki,
    registration: env.auth.registration,
  })
  const principalForToken = async (jwt: JwtVerifier, token: string | null | undefined): Promise<Principal | null> => {
    const tokenPrincipal = await verifyTokenPrincipal(jwt, token)
    if (!tokenPrincipal) return null
    const user = services.users.findById(tokenPrincipal.id)
    if (!isUserActive(user)) return null
    if (user.tokenInvalidBefore > tokenPrincipal.issuedAtMs) return null
    return services.authz.principalForUser(user)
  }
  const requirePageRead = (principal: Principal | null, path?: string): void => {
    if (env.auth.privateWiki && !principal) throw new HttpError(unauthorized())
    if (!can(principal, 'page:read', { path })) throw new HttpError(forbidden())
  }
  const requireSearchRead = (principal: Principal | null): void => {
    if (env.auth.privateWiki && !principal) throw new HttpError(unauthorized())
    if (!can(principal, 'search:read')) throw new HttpError(forbidden())
  }
  const requireAssetRead = (principal: Principal | null): void => {
    if (env.auth.privateWiki && !principal) throw new HttpError(unauthorized())
    if (!can(principal, 'asset:read')) throw new HttpError(forbidden())
  }

  // ── Git storage (DB stays canonical; Git is a mirror + import source) ──────
  const gitConfig: GitConfig = { ...env.git, markerFile: join(env.dataDir, 'git-sync.json') }
  const git = createGitStorage(gitConfig)
  if (git.enabled) {
    void git.init().catch((error) => logger.warn({ type: 'git', action: 'init_failed', error }))
  }

  const gitAuthor = (id: string | undefined): { name: string; email: string } | null => {
    if (!id) return null
    const u = services.users.findById(id)
    return u ? { name: u.name, email: u.email } : null
  }

  const enforceAuthLimit = (
    request: Request,
    server: RequestIpServer | null | undefined,
    scope: string,
  ): void => {
    if (!authLimiter.check(`${scope}:${clientIp(request, server, env.trustProxyHeaders)}`)) {
      throw new HttpError(authRateLimitError())
    }
  }

  const publishAutomation = async (event: AutomationEvent): Promise<void> => {
    try {
      await services.webhooks.publish(event)
    } catch (error) {
      logger.warn({
        type: 'webhook',
        action: 'publish_failed',
        eventType: event.type,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  const webhookRetryTimer = setInterval(() => {
    void services.webhooks.processDueDeliveries().catch((error) => {
      logger.warn({
        type: 'webhook',
        action: 'retry_failed',
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }, 60_000)
  ;(webhookRetryTimer as unknown as { unref?: () => void }).unref?.()

  type PageChangedAction = 'created' | 'updated' | 'deleted' | 'moved'
  const emitPageChanged = (action: PageChangedAction, path: string, from?: string): void => {
    bus.emit({ type: 'page:changed', action, path, ...(from ? { from } : {}) })
  }

  const pageWriteEffects = async ({
    action,
    page,
    path,
    from,
    principal,
    auditAction,
    auditData = {},
    automation,
    mirror = action === 'deleted' ? 'delete' : action === 'moved' ? 'move' : 'save',
  }: {
    action: PageChangedAction
    page?: Page
    path?: string
    from?: string
    principal: Principal | null
    auditAction: string
    auditData?: Record<string, unknown>
    automation?: AutomationEvent
    mirror?: 'save' | 'delete' | 'move' | 'none'
  }): Promise<void> => {
    const targetPath = path ?? page?.path
    if (!targetPath) return
    emitPageChanged(action, targetPath, from)
    if (mirror === 'save' && page) void git.savePage(page, gitAuthor(principal?.id))
    else if (mirror === 'delete') void git.deletePage(targetPath, gitAuthor(principal?.id))
    else if (mirror === 'move' && page && from) void git.movePage(from, page, gitAuthor(principal?.id))
    audit(logger, auditAction, { userId: principal?.id ?? null, path: targetPath, ...auditData })
    if (automation) await publishAutomation(automation)
  }

  const gitSyncHandlers = createGitSyncHandlers({
    services,
    bus,
    onPageWrite: (write) => {
      void pageWriteEffects({
        action: write.action,
        page: write.page,
        path: write.path,
        principal: write.principal,
        auditAction: `git_sync.page.${write.action}`,
        auditData: { source: 'git-sync' },
        automation: write.page
          ? {
              type: write.action === 'created' ? 'page.created' : 'page.updated',
              actorId: write.principal.id,
              data: { page: pageSnapshot(write.page), source: 'git-sync' },
            }
          : undefined,
        mirror: 'none',
      })
    },
  })
  startGitSyncScheduler(git, env.git, gitSyncHandlers, (error) =>
    logger.warn({ type: 'git', action: 'auto_sync_failed', error }),
  )

  const collab = createCollabRuntime({
    // Debounced autosave: persist the live doc WITHOUT a revision (an explicit
    // Save still snapshots history + commits to Git). Readers get page:changed.
    persist: (room, text, expectedUpdatedAt, principal) => {
      const result = services.pages.saveContent(room, text, principal, expectedUpdatedAt)
      if (result.ok) {
        void pageWriteEffects({
          action: 'updated',
          page: result.value,
          principal,
          auditAction: 'collab.autosave',
          automation: {
            type: 'page.updated',
            actorId: principal?.id ?? null,
            data: { page: pageSnapshot(result.value) },
          },
        })
        return result.value.updatedAt
      }
      if (result.error.kind === 'conflict') {
        logger.warn({ type: 'collab', action: 'stale_autosave_skipped', room, error: result.error.message })
      }
      return null
    },
  })
  return (
    new Elysia()
      .use(cors({ origin: corsOrigin }))
      .use(jwt({ name: 'jwt', secret: env.jwtSecret }))
      .decorate('services', services)
      .onRequest(({ request }) => {
        requestStartedAt.set(request, Date.now())
      })
      // Resolve the current principal from a Bearer token on every request.
      .resolve(async ({ jwt, headers }): Promise<{ principal: Principal | null }> => {
        return { principal: await principalForToken(jwt, bearerToken(headers.authorization)) }
      })
      .onAfterHandle(({ request, server, set, principal }) => {
        const status = typeof set.status === 'number' ? set.status : 200
        logRequest(request, server, status, principal)
      })
      .onError(({ error, set, request, server }) => {
        const { status, body } = toErrorResponse(error)
        set.status = status
        if (status >= 500) {
          logger.error({
            type: 'error',
            action: 'http.unhandled',
            error: error instanceof Error ? error.message : String(error),
          })
        }
        logRequest(request, server, status, null, body.error.kind)
        return body
      })

      // ── Health ────────────────────────────────────────────────────────────
      .get('/api/health', () => ({ ok: true as const, name: 'ts-wiki', version: '0.3.2' }))
      .get('/api/settings/public', () => publicSettings())

      // ── Auth ──────────────────────────────────────────────────────────────
      .post(
        '/api/auth/register',
        async ({ body, services, jwt, request, server }) => {
          enforceAuthLimit(request, server, 'register')
          // Bootstrap: the very first account becomes the admin.
          const role: Role = services.users.count() === 0 ? 'admin' : 'viewer'
          if (role !== 'admin' && env.auth.registration === 'off') {
            throw new HttpError(forbidden('Registration is disabled'))
          }
          const user = unwrap(await services.users.create({ ...body, role }))
          services.authz.syncRoleGroup(user.id, user.role)
          const token = await signAuthToken(jwt, user)
          audit(logger, 'auth.register', { userId: user.id, role: user.role })
          await publishAutomation({ type: 'user.created', actorId: user.id, data: { user: publicUser(user) } })
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
        async ({ body, services, jwt, request, server }) => {
          enforceAuthLimit(request, server, 'login')
          const user = services.users.findByEmail(body.email)
          if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
            throw new HttpError(unauthorized('Invalid email or password'))
          }
          if (!isUserActive(user)) throw new HttpError(unauthorized('Account is deactivated'))
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
        async ({ body, principal, services }) => {
          const user = unwrap(await services.users.changePassword(principal, body))
          audit(logger, 'auth.password.change', { userId: user.id })
          return { user: publicUser(user) }
        },
        { body: t.Object({ currentPassword: t.String(), newPassword: t.String({ minLength: 6 }) }) },
      )
      .get('/api/auth/providers', ({ services }) => ({ providers: services.oidc.publicProviders() }))
      .post('/api/auth/totp/setup', ({ principal, services }) => {
        if (!principal) throw new HttpError(unauthorized())
        const user = services.users.findById(principal.id)
        if (!user) throw new HttpError(unauthorized())
        const secret = user.totpSecret || randomBase32Secret()
        db.update(users)
          .set({ totpSecret: secret, totpEnabled: user.totpEnabled })
          .where(eq(users.id, user.id))
          .run()
        return { secret, otpauthUrl: otpauthUrl(env.auth.siteName, user.email, secret) }
      })
      .post(
        '/api/auth/totp/enable',
        ({ body, principal, services }) => {
          if (!principal) throw new HttpError(unauthorized())
          const user = services.users.findById(principal.id)
          if (!user?.totpSecret || !verifyTotpCode(user.totpSecret, body.code)) {
            throw new HttpError(unauthorized('Invalid two-factor code'))
          }
          db.update(users).set({ totpEnabled: 1 }).where(eq(users.id, user.id)).run()
          return { user: publicUser({ ...user, totpEnabled: 1 }) }
        },
        { body: t.Object({ code: t.String() }) },
      )
      .post(
        '/api/auth/totp/disable',
        ({ body, principal, services }) => {
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
      .post('/api/auth/passkeys/register/options', async ({ principal, services }) =>
        unwrap(await services.passkeys.registrationOptions(principal)),
      )
      .post(
        '/api/auth/passkeys/register/verify',
        async ({ body, principal, services }) => ({
          passkey: unwrap(await services.passkeys.verifyRegistration(principal, body)),
        }),
        {
          body: t.Object({
            name: t.Optional(t.String()),
            response: t.Any(),
          }),
        },
      )
      .delete(
        '/api/auth/passkeys/:id',
        ({ params, principal, services }) => unwrap(services.passkeys.delete(principal, params.id)),
        { params: t.Object({ id: t.String() }) },
      )
      .post(
        '/api/auth/passkeys/login/options',
        async ({ body, services }) => unwrap(await services.passkeys.authenticationOptions(body)),
        { body: t.Object({ email: t.Optional(t.String()) }) },
      )
      .post(
        '/api/auth/passkeys/login/verify',
        async ({ body, services, jwt }) => {
          const result = unwrap(await services.passkeys.verifyAuthentication(body))
          const token = await signAuthToken(jwt, result.user)
          audit(logger, 'auth.passkey.login', {
            userId: result.user.id,
            passkeyId: result.passkey.id,
          })
          return { token, user: publicUser(result.user), passkey: result.passkey }
        },
        { body: t.Object({ response: t.Any() }) },
      )
      .get(
        '/api/auth/oidc/:provider/start',
        async ({ params, query, services }) => {
          const started = unwrap(await services.oidc.start(params.provider, query.redirect))
          return Response.redirect(started.url, 302)
        },
        { params: t.Object({ provider: t.String() }), query: t.Object({ redirect: t.Optional(t.String()) }) },
      )
      .get(
        '/api/auth/oidc/:provider/callback',
        async ({ params, query, services, jwt }) => {
          const result = unwrap(await services.oidc.callback(params.provider, query.code, query.state))
          const token = await signAuthToken(jwt, result.user)
          audit(logger, 'auth.oidc.login', {
            userId: result.user.id,
            provider: params.provider,
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
        },
        {
          params: t.Object({ provider: t.String() }),
          query: t.Object({ code: t.String(), state: t.String() }),
        },
      )

      // ── Pages: collection ─────────────────────────────────────────────────
      .get('/api/pages', ({ services, principal }) => {
        requirePageRead(principal)
        return { pages: services.pages.list() }
      })
      .get('/api/spaces', ({ services, principal }) => {
        requirePageRead(principal)
        return { spaces: services.pages.spaces() }
      })
      .get('/api/pages/trash', ({ services, principal }) => {
        if (!can(principal, 'page:delete')) throw new HttpError(forbidden())
        return { pages: services.pages.trash() }
      })
      .get('/api/graph', ({ services, principal }) => {
        requirePageRead(principal)
        return services.pages.graph()
      })
      .get('/api/events/index', ({ services, principal }) => {
        requirePageRead(principal)
        return { events: services.pages.events() }
      })
      .get('/api/labels', ({ services, principal }) => {
        requirePageRead(principal)
        return { labels: services.pages.labels() }
      })
      .get('/api/links/broken', ({ services, principal }) => {
        requirePageRead(principal)
        return { links: services.pages.brokenLinks() }
      })
      .get('/api/changes', ({ query, services, principal }) => {
        requirePageRead(principal)
        return { changes: services.pages.recentChanges(query.limit) }
      }, {
        query: t.Object({ limit: t.Optional(t.Numeric()) }),
      })
      .post(
        '/api/pages',
        async ({ body, services, principal }) => {
          const page = unwrap(services.pages.create(body, principal))
          await pageWriteEffects({
            action: 'created',
            page,
            principal,
            auditAction: 'page.create',
            automation: {
              type: 'page.created',
              actorId: principal?.id ?? null,
              data: { page: pageSnapshot(page) },
            },
          })
          return { page }
        },
        {
          body: t.Object({
            path: t.String(),
            title: t.String(),
            content: t.String(),
            description: t.Optional(t.String()),
            labels: t.Optional(t.Array(t.String())),
            status: t.Optional(t.Union([
              t.Literal('draft'),
              t.Literal('in-review'),
              t.Literal('verified'),
              t.Literal('outdated'),
            ])),
            ownerId: t.Optional(t.Union([t.String(), t.Null()])),
            reviewAt: t.Optional(t.Union([t.Number(), t.Null()])),
            locale: t.Optional(t.Union([t.String(), t.Null()])),
            expectedUpdatedAt: t.Optional(t.Union([t.Number(), t.Null()])),
          }),
        },
      )

      // ── Pages: single (path is a query param so it may contain slashes) ───
      .get(
        '/api/page',
        ({ query, services, principal }) => {
          requirePageRead(principal, query.path)
          const resolved = unwrap(services.pages.resolveByPath(query.path))
          const page = resolved.page
          unwrap(services.analytics.recordPageView(page.path, principal))
          return { page, redirectedFrom: resolved.redirectedFrom }
        },
        { query: t.Object({ path: t.String() }) },
      )
      .get(
        '/api/page/backlinks',
        ({ query, services, principal }) => {
          requirePageRead(principal, query.path)
          return { backlinks: services.pages.backlinks(query.path) }
        },
        { query: t.Object({ path: t.String() }) },
      )
      .get(
        '/api/page/history',
        ({ query, services, principal }) => {
          requirePageRead(principal, query.path)
          return { revisions: unwrap(services.pages.history(query.path)) }
        },
        { query: t.Object({ path: t.String() }) },
      )
      .get(
        '/api/page/comments',
        ({ query, services, principal }) => {
          requirePageRead(principal, query.path)
          return { comments: unwrap(services.comments.list(query.path)) }
        },
        { query: t.Object({ path: t.String() }) },
      )
      .post(
        '/api/page/comments',
        async ({ body, services, principal }) => {
          const comment = unwrap(services.comments.create(body.path, body.body, principal))
          emitPageChanged('updated', comment.path)
          audit(logger, 'comment.create', {
            userId: principal?.id ?? null,
            path: comment.path,
            commentId: comment.id,
            mentions: comment.mentions,
          })
          await publishAutomation({
            type: 'comment.created',
            actorId: principal?.id ?? null,
            data: { comment: commentSnapshot(comment) },
          })
          return { comment }
        },
        { body: t.Object({ path: t.String(), body: t.String() }) },
      )
      .put(
        '/api/page/comments/:id',
        async ({ params, body, services, principal }) => {
          const comment = unwrap(services.comments.update(params.id, body.body, principal))
          emitPageChanged('updated', comment.path)
          audit(logger, 'comment.update', {
            userId: principal?.id ?? null,
            path: comment.path,
            commentId: comment.id,
            mentions: comment.mentions,
          })
          await publishAutomation({
            type: 'comment.updated',
            actorId: principal?.id ?? null,
            data: { comment: commentSnapshot(comment) },
          })
          return { comment }
        },
        {
          params: t.Object({ id: t.String() }),
          body: t.Object({ body: t.String() }),
        },
      )
      .post(
        '/api/page/comments/:id/resolve',
        async ({ params, services, principal }) => {
          const comment = unwrap(services.comments.resolve(params.id, principal))
          emitPageChanged('updated', comment.path)
          audit(logger, 'comment.resolve', {
            userId: principal?.id ?? null,
            path: comment.path,
            commentId: comment.id,
          })
          await publishAutomation({
            type: 'comment.resolved',
            actorId: principal?.id ?? null,
            data: { comment: commentSnapshot(comment) },
          })
          return { comment }
        },
        { params: t.Object({ id: t.String() }) },
      )
      .delete(
        '/api/page/comments/:id',
        async ({ params, services, principal }) => {
          const result = unwrap(services.comments.remove(params.id, principal))
          audit(logger, 'comment.delete', { userId: principal?.id ?? null, commentId: result.id })
          await publishAutomation({
            type: 'comment.deleted',
            actorId: principal?.id ?? null,
            data: { comment: result },
          })
          return result
        },
        { params: t.Object({ id: t.String() }) },
      )
      .put(
        '/api/page',
        async ({ query, body, services, principal }) => {
          const previous = services.pages.getByPath(query.path)
          const page = unwrap(services.pages.update(query.path, body, principal))
          await pageWriteEffects({
            action: 'updated',
            page,
            principal,
            auditAction: 'page.update',
            automation: {
              type: 'page.updated',
              actorId: principal?.id ?? null,
              data: {
                page: pageSnapshot(page),
                ...(previous.ok ? { previous: pageSnapshot(previous.value) } : {}),
              },
            },
          })
          return { page }
        },
        {
          query: t.Object({ path: t.String() }),
          body: t.Object({
            title: t.Optional(t.String()),
            content: t.Optional(t.String()),
            description: t.Optional(t.String()),
            labels: t.Optional(t.Array(t.String())),
            status: t.Optional(t.Union([
              t.Literal('draft'),
              t.Literal('in-review'),
              t.Literal('verified'),
              t.Literal('outdated'),
            ])),
            ownerId: t.Optional(t.Union([t.String(), t.Null()])),
            reviewAt: t.Optional(t.Union([t.Number(), t.Null()])),
            locale: t.Optional(t.Union([t.String(), t.Null()])),
          }),
        },
      )
      .post(
        '/api/page/restore-revision',
        async ({ body, services, principal }) => {
          const previous = services.pages.getByPath(body.path)
          const page = unwrap(services.pages.restoreRevision(body.path, body.revisionId, principal))
          await pageWriteEffects({
            action: 'updated',
            page,
            principal,
            auditAction: 'page.revision.restore',
            auditData: { revisionId: body.revisionId },
            automation: {
              type: 'page.updated',
              actorId: principal?.id ?? null,
              data: {
                page: pageSnapshot(page),
                revisionId: body.revisionId,
                ...(previous.ok ? { previous: pageSnapshot(previous.value) } : {}),
              },
            },
          })
          return { page }
        },
        { body: t.Object({ path: t.String(), revisionId: t.String() }) },
      )
      .post(
        '/api/page/archive',
        async ({ body, services, principal }) => {
          const page = unwrap(services.pages.archive(body.path, principal))
          await pageWriteEffects({
            action: 'deleted',
            page,
            principal,
            auditAction: 'page.archive',
            automation: {
              type: 'page.archived',
              actorId: principal?.id ?? null,
              data: { page: pageSnapshot(page) },
            },
          })
          return { page }
        },
        { body: t.Object({ path: t.String() }) },
      )
      .post(
        '/api/page/restore',
        async ({ body, services, principal }) => {
          const page = unwrap(services.pages.restore(body.path, principal))
          await pageWriteEffects({
            action: 'created',
            page,
            principal,
            auditAction: 'page.restore',
            automation: {
              type: 'page.restored',
              actorId: principal?.id ?? null,
              data: { page: pageSnapshot(page) },
            },
          })
          return { page }
        },
        { body: t.Object({ path: t.String() }) },
      )
      .post(
        '/api/page/move',
        async ({ body, services, principal }) => {
          const previous = services.pages.getByPath(body.oldPath)
          const page = unwrap(services.pages.move(body.oldPath, body.newPath, principal))
          await pageWriteEffects({
            action: 'moved',
            page,
            from: body.oldPath,
            principal,
            auditAction: 'page.move',
            auditData: { from: body.oldPath },
            automation: {
              type: 'page.moved',
              actorId: principal?.id ?? null,
              data: {
                page: pageSnapshot(page),
                previousPath: body.oldPath,
                ...(previous.ok ? { previous: pageSnapshot(previous.value) } : {}),
              },
            },
          })
          return { page }
        },
        {
          body: t.Object({
            oldPath: t.String(),
            newPath: t.String(),
          }),
        },
      )
      .delete(
        '/api/page',
        async ({ query, services, principal }) => {
          const previous = services.pages.getByPath(query.path)
          const result = unwrap(services.pages.remove(query.path, principal))
          await pageWriteEffects({
            action: 'deleted',
            path: result.path,
            principal,
            auditAction: 'page.delete',
            automation: {
              type: 'page.deleted',
              actorId: principal?.id ?? null,
              data: {
                path: result.path,
                ...(previous.ok ? { page: pageSnapshot(previous.value) } : {}),
              },
            },
          })
          return result
        },
        { query: t.Object({ path: t.String() }) },
      )
      .delete(
        '/api/page/purge',
        async ({ query, services, principal }) => {
          const previous = services.pages.getByPath(query.path)
          const result = unwrap(services.pages.purge(query.path, principal))
          await pageWriteEffects({
            action: 'deleted',
            path: result.path,
            principal,
            auditAction: 'page.purge',
            automation: {
              type: 'page.purged',
              actorId: principal?.id ?? null,
              data: {
                path: result.path,
                ...(previous.ok ? { page: pageSnapshot(previous.value) } : {}),
              },
            },
          })
          return result
        },
        { query: t.Object({ path: t.String() }) },
      )

      // ── Export / Import ──────────────────────────────────────────────────
      .get(
        '/api/export/page',
        ({ query, services, principal }) => {
          requirePageRead(principal, query.path)
          const page = unwrap(services.pages.getByPath(query.path))
          const filename = `${page.path.split('/').at(-1) || 'page'}.${query.format === 'html' ? 'html' : 'md'}`
          if (query.format === 'html') {
            return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>${page.title}</title></head><body>${page.renderedHtml}</body></html>`, {
              headers: {
                'content-type': 'text/html; charset=utf-8',
                'content-disposition': `attachment; filename="${filename}"`,
              },
            })
          }
          return new Response(
            serializePageFile({
              title: page.title,
              description: page.description,
              content: page.content,
            }),
            {
              headers: {
                'content-type': 'text/markdown; charset=utf-8',
                'content-disposition': `attachment; filename="${filename}"`,
              },
            },
          )
        },
        {
          query: t.Object({
            path: t.String(),
            format: t.Optional(t.Union([t.Literal('markdown'), t.Literal('html')])),
          }),
        },
      )
      .get('/api/export/site', ({ services, principal }) => {
        if (!can(principal, 'admin:access')) throw new HttpError(forbidden())
        const exportedAt = new Date().toISOString()
        const exportedPages = services.pages.list().map((summary) => {
          const page = unwrap(services.pages.getByPath(summary.path))
          return {
            path: page.path,
            title: page.title,
            description: page.description,
            content: page.content,
            labels: page.labels,
            status: page.status,
            ownerId: page.ownerId,
            reviewAt: page.reviewAt,
            spaceKey: page.spaceKey,
            locale: page.locale,
            createdAt: page.createdAt,
            updatedAt: page.updatedAt,
          }
        })
        return {
          manifestVersion: 1,
          exportedAt,
          pages: exportedPages,
          assets: unwrap(services.assets.list(principal)),
        }
      })
      .post(
        '/api/import/markdown',
        async ({ body, services, principal }) => {
          if (!can(principal, 'page:write')) throw new HttpError(forbidden())
          const parsed = parsePageFile(body.content)
          const result = unwrap(services.pages.upsertFromFile(body.path, parsed, {
            title: body.title,
            description: body.description,
            labels: body.labels,
            status: body.status,
            locale: body.locale,
          }, principal))
          const page = result.page
          await pageWriteEffects({
            action: result.created ? 'created' : 'updated',
            page,
            principal,
            auditAction: 'page.import_markdown',
            automation: {
              type: result.created ? 'page.created' : 'page.updated',
              actorId: principal?.id ?? null,
              data: {
                page: pageSnapshot(page),
                source: 'markdown-import',
                ...(result.previous ? { previous: pageSnapshot(result.previous) } : {}),
              },
            },
          })
          return { page }
        },
        {
          body: t.Object({
            path: t.String(),
            title: t.Optional(t.String()),
            description: t.Optional(t.String()),
            content: t.String(),
            labels: t.Optional(t.Array(t.String())),
            status: t.Optional(t.Union([
              t.Literal('draft'),
              t.Literal('in-review'),
              t.Literal('verified'),
              t.Literal('outdated'),
            ])),
            locale: t.Optional(t.Union([t.String(), t.Null()])),
          }),
        },
      )

      // ── Search ────────────────────────────────────────────────────────────
      .get('/api/search', ({ query, services, principal }) => {
        requireSearchRead(principal)
        return services.search.search(
          query.q ?? '',
          query.limit,
          {
            pathPrefix: query.pathPrefix,
            label: query.label,
            status: query.status,
            spaceKey: query.spaceKey,
            locale: query.locale,
          },
          // Enforce per-page read ACLs: never surface a page the principal
          // cannot read (page rules), even if it matches the query.
          (path) => can(principal, 'page:read', { path }),
        )
      }, {
        query: t.Object({
          q: t.Optional(t.String()),
          limit: t.Optional(t.Numeric()),
          pathPrefix: t.Optional(t.String()),
          label: t.Optional(t.String()),
          status: t.Optional(t.String()),
          spaceKey: t.Optional(t.String()),
          locale: t.Optional(t.String()),
        }),
      })

      // ── Realtime (Server-Sent Events; any transport subscribes to the bus) ─
      .get('/api/events', async ({ request, query, jwt }) => {
        const principal = await principalForToken(jwt, query.token)
        if (!principal) throw new HttpError(unauthorized())
        if (!can(principal, 'page:read')) throw new HttpError(forbidden())

        const encoder = new TextEncoder()
        let unsubscribe: (() => void) | null = null
        let heartbeat: ReturnType<typeof setInterval> | null = null
        const cleanup = () => {
          unsubscribe?.()
          unsubscribe = null
          if (heartbeat) clearInterval(heartbeat)
          heartbeat = null
        }
        const stream = new ReadableStream({
          start(controller) {
            const sse = (text: string) => {
              try {
                controller.enqueue(encoder.encode(text))
              } catch {
                cleanup()
              }
            }
            sse(': connected\n\n')
            unsubscribe = bus.subscribe((event) => sse(`data: ${JSON.stringify(event)}\n\n`))
            heartbeat = setInterval(() => sse(': ping\n\n'), 25000)
            request.signal.addEventListener('abort', () => {
              cleanup()
              try {
                controller.close()
              } catch {
                /* already closed */
              }
            })
          },
          cancel: cleanup,
        })
        return new Response(stream, {
          headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
          },
        })
      }, { query: t.Object({ token: t.Optional(t.String()) }) })

      // ── Presence (WebSocket; one connection per open page) ────────────────
      // Identity (name/userId) comes from the query for v0 — presence is
      // cosmetic, so we don't verify a token over the socket here.
      .ws('/api/presence', {
        query: t.Object({
          path: t.String(),
          token: t.Optional(t.String()),
          name: t.Optional(t.String()),
          userId: t.Optional(t.String()),
          mode: t.Optional(t.Union([t.Literal('viewing'), t.Literal('editing')])),
        }),
        open(ws) {
          void (async () => {
            const { path, token, name, userId, mode } = ws.data.query
            const principal = await principalForToken(ws.data.jwt, token)
            if (env.auth.privateWiki && !principal) {
              ws.close(1008, 'Authentication required')
              return
            }
            if (!can(principal, 'page:read', { path })) {
              ws.close(1008, 'Read access required')
              return
            }
            presenceRuntime.open(ws.id, ws, path, { name, userId: userId ?? principal?.id, mode })
          })().catch(() => ws.close(1011, 'Presence authentication failed'))
        },
        close(ws) {
          presenceRuntime.close(ws.id)
        },
      })

      // ── Collaborative editing (Yjs over WebSocket; room = page path) ───────
      .ws('/api/collab/:room', {
        query: t.Object({
          token: t.Optional(t.String()),
        }),
        open(ws) {
          void (async () => {
            const principal = await principalForToken(ws.data.jwt, ws.data.query.token)
            const room = decodeURIComponent(ws.data.params.room)
            if (!principal || !can(principal, 'page:write', { path: room })) {
              ws.close(1008, 'Authentication required')
              return
            }
            const current = services.pages.getByPath(room)
            const seed = (): CollabSeed => ({
              text: current.ok ? current.value.content : '',
              updatedAt: current.ok ? current.value.updatedAt : null,
            })
            // ws.raw is the Bun socket; Elysia's ws.send() coerces binary to text.
            collab.open(ws.id, room, (data) => ws.raw.send(data), seed, principal)
          })().catch(() => ws.close(1011, 'Collab authentication failed'))
        },
        message(ws, message) {
          collab.message(ws.id, message)
        },
        close(ws) {
          collab.close(ws.id)
        },
      })

      // ── Admin (each method gates on admin:access inside the service) ───────
      .get('/api/admin/stats', ({ services, principal }) => unwrap(services.admin.stats(principal)))
      .get('/api/admin/analytics', ({ services, principal }) => unwrap(services.analytics.summary(principal)))
      .put(
        '/api/admin/settings',
        ({ body, services, principal }) => ({ settings: unwrap(services.settings.update(principal, body)) }),
        {
          body: t.Object({
            siteTitle: t.Optional(t.String()),
            accentColor: t.Optional(t.String()),
            theme: t.Optional(t.Union([t.Literal('system'), t.Literal('light'), t.Literal('dark')])),
            navLinks: t.Optional(t.Array(t.Object({
              label: t.String(),
              url: t.String(),
            }))),
          }),
        },
      )
      .get('/api/admin/users', ({ services, principal }) => ({
        users: unwrap(services.admin.listUsers(principal)),
      }))
      .put(
        '/api/admin/users/password',
        async ({ body, services, principal }) => {
          const user = unwrap(await services.admin.setUserPassword(principal, body.userId, body.password))
          audit(logger, 'admin.user.password.reset', { userId: principal?.id ?? null, targetUserId: user.id })
          return { user }
        },
        { body: t.Object({ userId: t.String(), password: t.String({ minLength: 6 }) }) },
      )
      .post(
        '/api/admin/users/deactivate',
        ({ body, services, principal }) => {
          const user = unwrap(services.admin.deactivateUser(principal, body.userId))
          audit(logger, 'admin.user.deactivate', { userId: principal?.id ?? null, targetUserId: user.id })
          return { user }
        },
        { body: t.Object({ userId: t.String() }) },
      )
      .get('/api/admin/groups', ({ services, principal }) => ({
        groups: unwrap(services.authz.listGroups(principal)),
      }))
      .post(
        '/api/admin/groups',
        ({ body, services, principal }) => ({ group: unwrap(services.authz.createGroup(principal, body)) }),
        {
          body: t.Object({
            key: t.String(),
            name: t.String(),
            description: t.Optional(t.String()),
          }),
        },
      )
      .post(
        '/api/admin/groups/members',
        ({ body, services, principal }) => unwrap(services.authz.addUserToGroup(principal, body.userId, body.groupKey)),
        { body: t.Object({ userId: t.String(), groupKey: t.String() }) },
      )
      .delete(
        '/api/admin/groups/members',
        ({ query, services, principal }) => unwrap(services.authz.removeUserFromGroup(principal, query.userId, query.groupKey)),
        { query: t.Object({ userId: t.String(), groupKey: t.String() }) },
      )
      .get('/api/admin/page-rules', ({ services, principal }) => ({
        rules: unwrap(services.authz.listPageRules(principal)),
      }))
      .post(
        '/api/admin/page-rules',
        ({ body, services, principal }) => ({ rule: unwrap(services.authz.createPageRule(principal, body)) }),
        {
          body: t.Object({
            subjectType: t.Union([t.Literal('user'), t.Literal('group'), t.Literal('anonymous')]),
            subjectId: t.Optional(t.Union([t.String(), t.Null()])),
            action: t.Union([
              t.Literal('page:read'),
              t.Literal('page:create'),
              t.Literal('page:update'),
              t.Literal('page:write'),
              t.Literal('page:delete'),
              t.Literal('page:move'),
              t.Literal('asset:read'),
              t.Literal('asset:write'),
              t.Literal('asset:delete'),
              t.Literal('comment:read'),
              t.Literal('comment:write'),
              t.Literal('search:read'),
              t.Literal('git:sync'),
              t.Literal('automation:manage'),
              t.Literal('admin:access'),
            ]),
            effect: t.Union([t.Literal('allow'), t.Literal('deny')]),
            matcher: t.Union([t.Literal('exact'), t.Literal('prefix'), t.Literal('suffix'), t.Literal('regex')]),
            pattern: t.String(),
          }),
        },
      )
      .delete(
        '/api/admin/page-rules/:id',
        ({ params, services, principal }) => unwrap(services.authz.deletePageRule(principal, params.id)),
        { params: t.Object({ id: t.String() }) },
      )
      .get(
        '/api/admin/webhooks/deliveries',
        ({ query, services, principal }) => ({
          deliveries: unwrap(services.webhooks.listDeliveries(principal, {
            status: query.status,
            limit: query.limit,
          })),
        }),
        {
          query: t.Object({
            status: t.Optional(t.Union([t.Literal('pending'), t.Literal('succeeded'), t.Literal('failed')])),
            limit: t.Optional(t.Numeric()),
          }),
        },
      )
      .post(
        '/api/admin/webhooks/deliveries/:id/retry',
        async ({ params, services, principal }) => ({
          delivery: unwrap(await services.webhooks.retryDelivery(principal, params.id)),
        }),
        { params: t.Object({ id: t.String() }) },
      )
      .get('/api/admin/webhooks', ({ services, principal }) => ({
        webhooks: unwrap(services.webhooks.listSubscriptions(principal)),
      }))
      .post(
        '/api/admin/webhooks',
        ({ body, services, principal }) => ({
          webhook: unwrap(services.webhooks.createSubscription(principal, body)),
        }),
        {
          body: t.Object({
            name: t.Optional(t.String()),
            targetUrl: t.String(),
            secret: t.String(),
            eventTypes: t.Array(t.String()),
            enabled: t.Optional(t.Boolean()),
          }),
        },
      )
      .put(
        '/api/admin/webhooks/:id',
        ({ params, body, services, principal }) => ({
          webhook: unwrap(services.webhooks.updateSubscription(principal, params.id, body)),
        }),
        {
          params: t.Object({ id: t.String() }),
          body: t.Object({
            name: t.Optional(t.String()),
            targetUrl: t.Optional(t.String()),
            secret: t.Optional(t.String()),
            eventTypes: t.Optional(t.Array(t.String())),
            enabled: t.Optional(t.Boolean()),
          }),
        },
      )
      .delete(
        '/api/admin/webhooks/:id',
        ({ params, services, principal }) => unwrap(services.webhooks.deleteSubscription(principal, params.id)),
        { params: t.Object({ id: t.String() }) },
      )
      .get('/api/admin/automation-rules', ({ services, principal }) => ({
        rules: unwrap(services.webhooks.listAutomationRules(principal)),
      }))
      .post(
        '/api/admin/automation-rules',
        ({ body, services, principal }) => ({
          rule: unwrap(services.webhooks.createAutomationRule(principal, body)),
        }),
        {
          body: t.Object({
            name: t.Optional(t.String()),
            type: t.Literal('page-updated-metadata'),
            enabled: t.Optional(t.Boolean()),
            config: t.Object({
              pathPrefix: t.String(),
              label: t.Optional(t.String()),
              status: t.Optional(t.Union([
                t.Literal('draft'),
                t.Literal('in-review'),
                t.Literal('verified'),
                t.Literal('outdated'),
              ])),
            }),
          }),
        },
      )
      .put(
        '/api/admin/automation-rules/:id',
        ({ params, body, services, principal }) => ({
          rule: unwrap(services.webhooks.updateAutomationRule(principal, params.id, body)),
        }),
        {
          params: t.Object({ id: t.String() }),
          body: t.Object({
            name: t.Optional(t.String()),
            enabled: t.Optional(t.Boolean()),
            config: t.Optional(t.Object({
              pathPrefix: t.String(),
              label: t.Optional(t.String()),
              status: t.Optional(t.Union([
                t.Literal('draft'),
                t.Literal('in-review'),
                t.Literal('verified'),
                t.Literal('outdated'),
              ])),
            })),
          }),
        },
      )
      .delete(
        '/api/admin/automation-rules/:id',
        ({ params, services, principal }) => unwrap(services.webhooks.deleteAutomationRule(principal, params.id)),
        { params: t.Object({ id: t.String() }) },
      )
      .put(
        '/api/admin/users/role',
        async ({ body, services, principal }) => {
          const user = unwrap(services.admin.setUserRole(principal, body.userId, body.role))
          audit(logger, 'admin.user_role.update', {
            userId: principal?.id ?? null,
            targetUserId: body.userId,
            role: body.role,
          })
          await publishAutomation({
            type: 'user.role_updated',
            actorId: principal?.id ?? null,
            data: { user: publicUser(user) },
          })
          return { user }
        },
        {
          body: t.Object({
            userId: t.String(),
            role: t.Union([t.Literal('admin'), t.Literal('editor'), t.Literal('viewer')]),
          }),
        },
      )

      // ── Git storage (admin) ───────────────────────────────────────────────
      .get('/api/git/status', ({ principal }) => {
        if (!can(principal, 'admin:access')) throw new HttpError(forbidden())
        return git.status()
      })
      .post('/api/git/sync', async ({ principal }) => {
        if (!can(principal, 'admin:access')) throw new HttpError(forbidden())
        const result = await git.sync(gitSyncHandlers)
        audit(logger, 'git.sync', {
          userId: principal?.id ?? null,
          upserted: result.upserted.length,
          deleted: result.deleted.length,
          pushed: result.pushed,
        })
        return result
      })

      // ── Assets ────────────────────────────────────────────────────────────
      .get('/api/assets', ({ services, principal }) => {
        if (!can(principal, 'asset:read')) throw new HttpError(forbidden())
        return { assets: unwrap(services.assets.list(principal)) }
      })
      .post(
        '/api/assets',
        async ({ body, services, principal }) => {
          if (!can(principal, 'asset:write')) throw new HttpError(forbidden())
          const file = body.file
          if (!assetExtensionForMime(file.type)) {
            throw new HttpError(validationError('Unsupported asset type', 'file'))
          }
          if (file.size > env.assetUpload.maxBytes) {
            throw new HttpError(validationError(`Asset must be ${formatBytes(env.assetUpload.maxBytes)} or smaller`, 'file'))
          }
          const id = crypto.randomUUID()
          const storageName = assetStorage.storageNameForUpload(id, file)
          await assetStorage.put({ storageName, file })
          const asset = unwrap(services.assets.record({
            id,
            filename: file.name,
            storageName,
            mime: file.type,
            size: file.size,
            authorId: principal?.id ?? null,
          }, principal))
          audit(logger, 'asset.upload', {
            userId: principal?.id ?? null,
            assetId: asset.id,
            filename: asset.filename,
            size: asset.size,
          })
          await publishAutomation({
            type: 'asset.uploaded',
            actorId: principal?.id ?? null,
            data: { asset: assetSnapshot(asset) },
          })
          return { id: asset.id, filename: asset.filename, url: asset.url }
        },
        {
          body: t.Object({
            file: t.File({ maxSize: ASSET_HARD_MAX_SIZE }),
          }),
        },
      )
      .delete(
        '/api/assets/:id',
        async ({ params, services, principal }) => {
          if (!can(principal, 'asset:delete')) throw new HttpError(forbidden())
          const asset = unwrap(services.assets.findById(params.id, principal))
          if (!asset) throw new HttpError(validationError('Asset not found', 'id'))
          await assetStorage.delete(asset.storageName)
          const removed = unwrap(services.assets.remove(params.id, principal)) ?? asset
          audit(logger, 'asset.delete', {
            userId: principal?.id ?? null,
            assetId: removed.id,
            filename: removed.filename,
          })
          await publishAutomation({
            type: 'asset.deleted',
            actorId: principal?.id ?? null,
            data: { asset: assetSnapshot(removed) },
          })
          return { asset: removed }
        },
        { params: t.Object({ id: t.String() }) },
      )
      .put(
        '/api/assets/:id',
        async ({ params, body, services, principal }) => {
          if (!can(principal, 'asset:write')) throw new HttpError(forbidden())
          const asset = unwrap(services.assets.rename(params.id, body.filename, principal))
          if (!asset) throw new HttpError(validationError('Asset not found or filename is empty', 'filename'))
          audit(logger, 'asset.rename', {
            userId: principal?.id ?? null,
            assetId: asset.id,
            filename: asset.filename,
          })
          await publishAutomation({
            type: 'asset.renamed',
            actorId: principal?.id ?? null,
            data: { asset: assetSnapshot(asset) },
          })
          return { asset }
        },
        {
          params: t.Object({ id: t.String() }),
          body: t.Object({ filename: t.String({ minLength: 1 }) }),
        },
      )
      .get('/assets/*', async ({ params }) => {
        const storageName = safeAssetRequestPath(params['*'])
        if (!storageName) return new Response('Not found', { status: 404 })
        const asset = await assetStorage.get(storageName)
        return asset ? assetResponse(asset) : new Response('Not found', { status: 404 })
      })
      .get('/ui', () => {
        if (!hasWebDist) return new Response('Not found', { status: 404 })
        return Bun.file(webIndex)
      })
      .get('/ui/*', ({ params }) => {
        if (!hasWebDist) return new Response('Not found', { status: 404 })
        const rel = params['*']
        if (!rel || rel === '/') return Bun.file(webIndex)
        if (rel.includes('..') || rel.includes('\\')) return new Response('Not found', { status: 404 })
        const file = join(env.webDistDir, rel)
        if (!existsSync(file)) return new Response('Not found', { status: 404 })
        return new Response(Bun.file(file), {
          headers: { 'x-content-type-options': 'nosniff' },
        })
      })
      .get('*', ({ request }) => {
        if (!hasWebDist) return new Response('Not found', { status: 404 })
        const pathname = new URL(request.url).pathname
        if (pathname.startsWith('/api') || pathname.startsWith('/assets')) {
          return new Response('Not found', { status: 404 })
        }
        return Bun.file(webIndex)
      })
  )
}

export type App = ReturnType<typeof createApp>
