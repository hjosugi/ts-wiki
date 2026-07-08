/**
 * HTTP composition root. Cross-cutting concerns are declared once here; domain
 * routes live in focused Elysia callback plugins under `http/routes`.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { lte } from 'drizzle-orm'
import {
  can,
  forbidden,
  type Principal,
  type PublicSettings,
  unauthorized,
} from '@ts-wiki/core'
import type { Env } from '../env.ts'
import type { DB } from '../db/client.ts'
import { createServices, type MailSender } from '../services/index.ts'
import { createCollabRuntime, createPresenceRuntime, createRealtimeBus } from '../realtime/runtime.ts'
import { createAssetStorage, type AssetStorage } from '../storage/assets.ts'
import { createGitStorage, type GitConfig } from '../storage/git.ts'
import { createGitSyncHandlers, startGitSyncScheduler } from '../storage/git-sync.ts'
import { isUserActive } from '../services/users.ts'
import {
  audit,
  consoleStructuredLogger,
  requestLog,
  type StructuredLogger,
} from '../observability/logging.ts'
import type { AutomationEvent, WebhookFetcher, WebhookHostnameResolver } from '../services/webhooks.ts'
import { realtimeTickets, type Page } from '../db/schema.ts'
import { HttpError } from './errors.ts'
import { requireHttpPermission } from './permissions.ts'
import {
  authRateLimitError,
  clientIp,
  createDbRateLimiter,
  createRateLimiter,
  rateLimitError,
  type RateLimiter,
  type RequestIpServer,
} from './rate-limit.ts'
import { createBaseApp, type JwtVerifier } from './base.ts'
import { pageSnapshot } from './representations.ts'
import type { PageChangedAction, PageWriteEffectsInput } from './page-write.ts'
import { createAdminRoutes } from './routes/admin.ts'
import { createAssetRoutes } from './routes/assets.ts'
import { createAuthRoutes } from './routes/auth.ts'
import { createExportImportRoutes } from './routes/export-import.ts'
import { createGitRoutes } from './routes/git.ts'
import { createPageRoutes } from './routes/pages.ts'
import { createPreferenceRoutes } from './routes/preferences.ts'
import { createRealtimeRoutes } from './routes/realtime.ts'
import { createSearchRoutes } from './routes/search.ts'
import { createSetupRoutes } from './routes/setup.ts'
import { createStaticRoutes } from './routes/static.ts'
import { createSystemRoutes } from './routes/system.ts'
import { createTemplateRoutes } from './routes/templates.ts'

export interface AppDeps {
  readonly db: DB
  readonly env: Env
  readonly logger?: StructuredLogger
  readonly assetStorage?: AssetStorage
  readonly mailSender?: MailSender
  readonly webhookFetcher?: WebhookFetcher
  readonly webhookResolver?: WebhookHostnameResolver
}

interface TokenPrincipal {
  readonly id: string
  readonly issuedAtMs: number
  readonly mfaSetup: boolean
}

const AUTH_RATE_LIMIT_ATTEMPTS = 10
const CREDENTIAL_RATE_LIMIT_ATTEMPTS = 10
const ASSET_UPLOAD_RATE_LIMIT_ATTEMPTS = 20
const PRIVATE_ANON_READ_RATE_LIMIT_ATTEMPTS = 120
const RATE_LIMIT_WINDOW_MS = 60_000
const REALTIME_TICKET_TTL_MS = 30_000

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
  return { id, issuedAtMs, mfaSetup: data.mfaSetup === true }
}

const verifyTokenPrincipal = async (jwt: JwtVerifier, token: string | null | undefined): Promise<TokenPrincipal | null> => {
  if (!token) return null
  try {
    return tokenPrincipalFromPayload(await jwt.verify(token))
  } catch {
    return null
  }
}

export const createApp = ({
  db,
  env,
  logger = consoleStructuredLogger,
  assetStorage: suppliedAssetStorage,
  mailSender,
  webhookFetcher,
  webhookResolver,
}: AppDeps) => {
  const assetStorage = suppliedAssetStorage ?? createAssetStorage(env.assetStorage)
  const services = createServices(db, {
    assetUrl: assetStorage.url,
    auth: env.auth,
    search: env.search,
    branding: env.branding,
    localization: env.localization,
    mail: env.mail,
    mailSender,
    logger,
    webhookFetcher,
    webhookResolver,
    allowPrivateWebhookTargets: env.webhooks.allowPrivateTargets,
    webhookPolicy: {
      maxAttempts: env.webhooks.maxAttempts,
      backoffMs: env.webhooks.backoffMs,
      maxResponseBytes: env.webhooks.maxResponseBytes,
      maxErrorBytes: env.webhooks.maxErrorBytes,
    },
  })
  const corsOrigin = env.cors.origins === null ? true : [...env.cors.origins]
  const createAppRateLimiter = (limit: number): RateLimiter =>
    env.realtime.eventBus === 'db'
      ? createDbRateLimiter(db.$client, limit, RATE_LIMIT_WINDOW_MS)
      : createRateLimiter(limit, RATE_LIMIT_WINDOW_MS)
  const authLimiter = createAppRateLimiter(AUTH_RATE_LIMIT_ATTEMPTS)
  const credentialLimiter = createAppRateLimiter(CREDENTIAL_RATE_LIMIT_ATTEMPTS)
  const assetUploadLimiter = createAppRateLimiter(ASSET_UPLOAD_RATE_LIMIT_ATTEMPTS)
  const privateAnonReadLimiter = createAppRateLimiter(PRIVATE_ANON_READ_RATE_LIMIT_ATTEMPTS)
  const webIndex = join(env.webDistDir, 'index.html')
  const hasWebDist = existsSync(webIndex)
  const requestStartedAt = new WeakMap<Request, number>()
  const feedCache = new Map<string, { createdAt: number; xml: string }>()

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

  const publicSettings = (): PublicSettings => ({
    ...services.settings.public(),
    privateWiki: env.auth.privateWiki,
    registration: env.auth.registration,
    mailConfigured: services.recovery.mailConfigured(),
    requireEmailVerification: env.auth.requireEmailVerification,
    requireTwoFactor: env.auth.requireTwoFactor,
  })

  const principalForUserId = (userId: string): Principal | null => {
    const user = services.users.findById(userId)
    if (!isUserActive(user)) return null
    return services.authz.principalForUser(user)
  }

  const principalForToken = async (jwt: JwtVerifier, token: string | null | undefined): Promise<Principal | null> => {
    const apiKeyPrincipal = await services.apiKeys.resolve(token)
    if (apiKeyPrincipal) return apiKeyPrincipal

    const tokenPrincipal = await verifyTokenPrincipal(jwt, token)
    if (!tokenPrincipal) return null
    if (tokenPrincipal.mfaSetup) return null
    const user = services.users.findById(tokenPrincipal.id)
    if (!isUserActive(user)) return null
    if (user.tokenInvalidBefore > tokenPrincipal.issuedAtMs) return null
    return services.authz.principalForUser(user)
  }

  const cleanupRealtimeTickets = (): void => {
    db.delete(realtimeTickets).where(lte(realtimeTickets.expiresAt, Date.now())).run()
  }

  const mintRealtimeTicket = (principal: Principal | null): { ticket: string; expiresAt: number } => {
    if (!principal) throw new HttpError(unauthorized())
    cleanupRealtimeTickets()
    const createdAt = Date.now()
    const ticket = `${crypto.randomUUID()}-${crypto.randomUUID()}`
    const expiresAt = createdAt + REALTIME_TICKET_TTL_MS
    db.insert(realtimeTickets).values({ ticket, userId: principal.id, expiresAt, createdAt }).run()
    return { ticket, expiresAt }
  }

  const consumeRealtimeTicket = (ticket: string | null | undefined): Principal | null => {
    if (!ticket) return null
    const row = db.$client.prepare(`
      DELETE FROM realtime_tickets
      WHERE ticket = ?
      RETURNING user_id AS userId, expires_at AS expiresAt
    `).get(ticket) as { userId?: unknown; expiresAt?: unknown } | null
    const userId = typeof row?.userId === 'string' ? row.userId : null
    const expiresAt = typeof row?.expiresAt === 'number' ? row.expiresAt : Number(row?.expiresAt ?? 0)
    if (!userId || expiresAt <= Date.now()) return null
    return principalForUserId(userId)
  }

  const canReadPage = (principal: Principal | null, path?: string): boolean =>
    principal ? can(principal, 'page:read', { path }) : services.authz.canAnonymous('page:read', path)

  const requirePageRead = (principal: Principal | null, path?: string): void => {
    if (env.auth.privateWiki && !principal) throw new HttpError(unauthorized())
    if (!canReadPage(principal, path)) throw new HttpError(forbidden())
  }

  const requireSearchRead = (principal: Principal | null): void => {
    if (env.auth.privateWiki && !principal) throw new HttpError(unauthorized())
    requireHttpPermission(principal, 'search:read')
  }

  const isAdminRoute = (pathname: string): boolean =>
    pathname === '/api/admin' || pathname.startsWith('/api/admin/')

  const requireAdminRoute = (request: Request, principal: Principal | null): void => {
    if (!isAdminRoute(new URL(request.url).pathname)) return
    requireHttpPermission(principal, 'admin:access')
  }

  const rateLimitKey = (
    request: Request,
    server: RequestIpServer | null | undefined,
    scope: string,
    principal: Principal | null = null,
  ): string => {
    const subject = principal?.id ?? 'anonymous'
    return `${scope}:${subject}:${clientIp(request, server, env.trustProxyHeaders)}`
  }

  const enforceRateLimit = (
    limiter: RateLimiter,
    request: Request,
    server: RequestIpServer | null | undefined,
    scope: string,
    principal: Principal | null,
    message: string,
  ): void => {
    if (!limiter.check(rateLimitKey(request, server, scope, principal))) {
      throw new HttpError(rateLimitError(message))
    }
  }

  const enforceAuthLimit = (
    request: Request,
    server: RequestIpServer | null | undefined,
    scope: string,
  ): void => {
    if (!authLimiter.check(rateLimitKey(request, server, scope))) {
      throw new HttpError(authRateLimitError())
    }
  }

  const enforceCredentialLimit = (
    request: Request,
    server: RequestIpServer | null | undefined,
    scope: string,
    principal: Principal | null = null,
  ): void => {
    enforceRateLimit(
      credentialLimiter,
      request,
      server,
      `credential:${scope}`,
      principal,
      'Too many credential attempts; try again later',
    )
  }

  const enforceAssetUploadLimit = (
    request: Request,
    server: RequestIpServer | null | undefined,
    principal: Principal | null,
  ): void => {
    enforceRateLimit(
      assetUploadLimiter,
      request,
      server,
      'asset:upload',
      principal,
      'Too many asset uploads; try again later',
    )
  }

  const privateAnonymousReadPaths = new Set([
    '/api/pages',
    '/api/page',
    '/api/search',
    '/api/spaces',
    '/api/graph',
    '/api/events/index',
    '/api/assets',
    '/feed.xml',
  ])

  const isPrivateAnonymousReadPath = (pathname: string): boolean =>
    privateAnonymousReadPaths.has(pathname) || pathname.startsWith('/assets/') || pathname.startsWith('/api/shared/')

  const enforcePrivateAnonymousReadLimit = (
    request: Request,
    server: RequestIpServer | null | undefined,
    principal: Principal | null,
  ): void => {
    if (!env.auth.privateWiki || principal || request.method !== 'GET') return
    const pathname = new URL(request.url).pathname
    if (!isPrivateAnonymousReadPath(pathname)) return
    enforceRateLimit(
      privateAnonReadLimiter,
      request,
      server,
      'private:anonymous-read',
      null,
      'Too many anonymous read attempts; try again later',
    )
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

  const bus = createRealtimeBus(db, env.realtime)
  const presenceRuntime = createPresenceRuntime()

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
  }: PageWriteEffectsInput): Promise<void> => {
    const targetPath = path ?? page?.path
    if (!targetPath) return
    feedCache.clear()
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

  return createBaseApp({
    env,
    services,
    corsOrigin,
    principalForToken,
    enforcePrivateAnonymousReadLimit,
    requireAdminRoute,
    logRequest,
    logUnhandledError: (error) => {
      logger.error({
        type: 'error',
        action: 'http.unhandled',
        error: error instanceof Error ? error.message : String(error),
      })
    },
    markRequestStarted: (request) => {
      requestStartedAt.set(request, Date.now())
    },
  })
    .use(createSystemRoutes({
      env,
      services,
      publicSettings,
      feedCache,
      requirePageRead,
      canReadPage,
    }))
    .use(createSetupRoutes({
      db,
      env,
      logger,
      enforceAuthLimit,
      publishAutomation,
    }))
    .use(createAuthRoutes({
      db,
      env,
      logger,
      enforceAuthLimit,
      enforceCredentialLimit,
      publishAutomation,
    }))
    .use(createPageRoutes({
      logger,
      requirePageRead,
      canReadPage,
      emitPageChanged,
      pageWriteEffects,
      publishAutomation,
    }))
    .use(createPreferenceRoutes())
    .use(createTemplateRoutes({ logger }))
    .use(createExportImportRoutes({
      requirePageRead,
      pageWriteEffects,
    }))
    .use(createSearchRoutes({ requireSearchRead }))
    .use(createRealtimeRoutes({
      env,
      services,
      bus,
      presenceRuntime,
      collab,
      mintRealtimeTicket,
      consumeRealtimeTicket,
    }))
    .use(createAdminRoutes({
      logger,
      enforceCredentialLimit,
      publishAutomation,
    }))
    .use(createGitRoutes({
      git,
      gitSyncHandlers,
      logger,
    }))
    .use(createAssetRoutes({
      env,
      logger,
      assetStorage,
      enforceAssetUploadLimit,
      publishAutomation,
    }))
    .use(createStaticRoutes({
      env,
      services,
      hasWebDist,
      webIndex,
      canReadPage,
    }))
}

export type App = ReturnType<typeof createApp>
