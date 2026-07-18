/**
 * HTTP composition root. Cross-cutting concerns are declared once here; domain
 * routes live in focused Elysia callback plugins under `http/routes`.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { openapi } from '@elysia/openapi'
import {
  can,
  forbidden,
  type Principal,
  type PublicSettings,
  unauthorized,
} from '@kawaii-wiki/core'
import type { Env } from '../env.ts'
import type { DB } from '../db/client.ts'
import { createServices } from '../db/services.ts'
import type { MailSender } from '../services/index.ts'
import { createCollabRuntime, createPresenceRuntime, createRealtimeBus } from '../realtime/runtime.ts'
import { createAssetStorage, type AssetStorage } from '../storage/assets.ts'
import { createGitStorage, type GitConfig } from '../storage/git.ts'
import { createGitSyncHandlers, startGitSyncScheduler } from '../storage/git-sync.ts'
import { isUserActive } from '../services/users.ts'
import {
  audit,
  createAuditLogger,
  consoleStructuredLogger,
  requestLog,
  type StructuredLogger,
} from '../observability/logging.ts'
import type { AutomationEvent, WebhookFetcher, WebhookHostnameResolver } from '../services/webhooks.ts'
import { createSqliteRealtimeTicketRepository } from '../db/repositories/realtime-tickets.ts'
import { createSqliteAuditLogRepository } from '../db/repositories/audit-log.ts'
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
import { unrefTimer } from '../utils/timers.ts'
import { createAdminRoutes } from './routes/admin.ts'
import { createAssetRoutes } from './routes/assets.ts'
import { createAuthRoutes } from './routes/auth.ts'
import { createExportImportRoutes } from './routes/export-import.ts'
import { createGitRoutes } from './routes/git.ts'
import { createPageRoutes } from './routes/pages.ts'
import { createPreferenceRoutes } from './routes/preferences.ts'
import { createNotificationRoutes } from './routes/notifications.ts'
import { createRealtimeRoutes } from './routes/realtime.ts'
import { createSearchRoutes } from './routes/search.ts'
import { createSetupRoutes } from './routes/setup.ts'
import { createStaticRoutes } from './routes/static.ts'
import { createSystemRoutes } from './routes/system.ts'
import { APP_VERSION } from '../version.ts'
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
const UNFURL_RATE_LIMIT_ATTEMPTS = 30
const PRIVATE_ANON_READ_RATE_LIMIT_ATTEMPTS = 120
const COMMENT_RATE_LIMIT_ATTEMPTS = 10
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
  logger: suppliedLogger = consoleStructuredLogger,
  assetStorage: suppliedAssetStorage,
  mailSender,
  webhookFetcher,
  webhookResolver,
}: AppDeps) => {
  const logger = createAuditLogger(createSqliteAuditLogRepository(db), suppliedLogger, env.audit)
  const assetStorage = suppliedAssetStorage ?? createAssetStorage(env.assetStorage)
  const services = createServices(db, {
    assetUrl: assetStorage.url,
    auth: env.auth,
    assetUpload: env.assetUpload,
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
  const settingsReady = services.settings.initialize()
  const corsOrigin = env.cors.origins === null ? true : [...env.cors.origins]
  const createAppRateLimiter = (limit: number): RateLimiter =>
    env.realtime.eventBus === 'db'
      ? createDbRateLimiter(db.$client, limit, RATE_LIMIT_WINDOW_MS)
      : createRateLimiter(limit, RATE_LIMIT_WINDOW_MS)
  const authLimiter = createAppRateLimiter(AUTH_RATE_LIMIT_ATTEMPTS)
  const credentialLimiter = createAppRateLimiter(CREDENTIAL_RATE_LIMIT_ATTEMPTS)
  const assetUploadLimiter = createAppRateLimiter(ASSET_UPLOAD_RATE_LIMIT_ATTEMPTS)
  const unfurlLimiter = createAppRateLimiter(UNFURL_RATE_LIMIT_ATTEMPTS)
  const privateAnonReadLimiter = createAppRateLimiter(PRIVATE_ANON_READ_RATE_LIMIT_ATTEMPTS)
  const commentLimiter = createAppRateLimiter(COMMENT_RATE_LIMIT_ATTEMPTS)
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
    const safePath = url.pathname.replace(/^\/api\/shared\/[^/]+/, '/api/shared/[redacted]')
    requestLog(logger, {
      method: request.method,
      path: safePath,
      status,
      durationMs: Date.now() - startedAt,
      ip: clientIp(request, server, env.trustProxyHeaders),
      userId: principal?.id ?? null,
      ...(error ? { error } : {}),
    })
  }

  const publicSettings = (): PublicSettings => ({
    ...services.settings.public(),
    mailConfigured: services.recovery.mailConfigured(),
  })

  const privateWiki = (): boolean => services.settings.public().privateWiki
  const authPolicy = () => {
    const settings = services.settings.public()
    return {
      registration: settings.registration,
      requireEmailVerification: settings.requireEmailVerification,
      requireTwoFactor: settings.requireTwoFactor,
      tokenTtlSeconds: settings.tokenTtlSeconds,
    }
  }
  const assetPolicy = () => ({ maxBytes: services.settings.public().assetMaxBytes })

  const principalForUserId = async (userId: string): Promise<Principal | null> => {
    const user = await services.users.findById(userId)
    if (!isUserActive(user)) return null
    return services.authz.principalForUser(user)
  }

  const principalForToken = async (jwt: JwtVerifier, token: string | null | undefined): Promise<Principal | null> => {
    const apiKeyPrincipal = await services.apiKeys.resolve(token)
    if (apiKeyPrincipal) return apiKeyPrincipal

    const tokenPrincipal = await verifyTokenPrincipal(jwt, token)
    if (!tokenPrincipal) return null
    if (tokenPrincipal.mfaSetup) return null
    const user = await services.users.findById(tokenPrincipal.id)
    if (!isUserActive(user)) return null
    if (user.tokenInvalidBefore > tokenPrincipal.issuedAtMs) return null
    return services.authz.principalForUser(user)
  }

  const realtimeTicketRepo = createSqliteRealtimeTicketRepository(db)

  const mintRealtimeTicket = async (principal: Principal | null): Promise<{ ticket: string; expiresAt: number }> => {
    if (!principal) throw new HttpError(unauthorized())
    const createdAt = Date.now()
    const ticket = `${crypto.randomUUID()}-${crypto.randomUUID()}`
    const expiresAt = createdAt + REALTIME_TICKET_TTL_MS
    await realtimeTicketRepo.cleanupExpired(createdAt)
    await realtimeTicketRepo.insert({ ticket, userId: principal.id, expiresAt, createdAt })
    return { ticket, expiresAt }
  }

  const consumeRealtimeTicket = async (ticket: string | null | undefined): Promise<Principal | null> => {
    if (!ticket) return null
    const row = await realtimeTicketRepo.consume(ticket)
    if (!row || row.expiresAt <= Date.now()) return null
    return principalForUserId(row.userId)
  }

  const canReadPage = async (principal: Principal | null, path?: string): Promise<boolean> =>
    principal ? can(principal, 'page:read', { path }) : services.authz.canAnonymous('page:read', path)

  const requirePageRead = async (principal: Principal | null, path?: string): Promise<void> => {
    if (privateWiki() && !principal) throw new HttpError(unauthorized())
    if (!(await canReadPage(principal, path))) throw new HttpError(forbidden())
  }

  const requireSearchRead = (principal: Principal | null): void => {
    if (privateWiki() && !principal) throw new HttpError(unauthorized())
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

  const enforceUnfurlLimit = (
    request: Request,
    server: RequestIpServer | null | undefined,
    principal: Principal | null,
  ): void => {
    enforceRateLimit(
      unfurlLimiter,
      request,
      server,
      'link:unfurl',
      principal,
      'Too many link preview requests; try again later',
    )
  }

  const enforceCommentLimit = (
    request: Request,
    server: RequestIpServer | null | undefined,
    principal: Principal | null,
  ): void => {
    enforceRateLimit(commentLimiter, request, server, 'comment:create', principal, 'Too many comments; try again later')
  }

  const privateAnonymousReadPaths = new Set([
    '/api/pages',
    '/api/page',
    '/api/page/insights',
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
    if (!privateWiki() || principal || request.method !== 'GET') return
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
  unrefTimer(webhookRetryTimer)

  const bus = createRealtimeBus(db, env.realtime)
  const presenceRuntime = createPresenceRuntime()

  const gitConfig: GitConfig = {
    ...env.git,
    markerFile: join(env.dataDir, 'git-sync.json'),
    onError: (event) => {
      logger.warn({ type: 'git', action: event.operation, error: event.message })
      audit(logger, 'git.sync.error', { userId: null, ...event })
    },
  }
  const git = createGitStorage(gitConfig)

  const gitAuthor = async (id: string | undefined): Promise<{ name: string; email: string } | null> => {
    if (!id) return null
    const u = await services.users.findById(id)
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
    await services.notifications.pageChanged(action, targetPath, from, principal?.id ?? null)
    const author = await gitAuthor(principal?.id)
    const mirrorWrite = mirror === 'save' && page
      ? git.savePage(page, author)
      : mirror === 'delete'
        ? git.deletePage(targetPath, author)
        : mirror === 'move' && page && from
          ? git.movePage(from, page, author)
          : null
    if (mirrorWrite) {
      if (env.git.sourceOfTruth) {
        try {
          await mirrorWrite
          await git.sync(gitSyncHandlers)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          logger.warn({ type: 'git', action: 'mirror_failed', path: targetPath, error: message })
          audit(logger, 'git.sync.error', { userId: principal?.id ?? null, path: targetPath, operation: mirror, message })
          throw error
        }
      } else {
        void mirrorWrite.catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          logger.warn({ type: 'git', action: 'mirror_failed', path: targetPath, error: message })
          audit(logger, 'git.sync.error', { userId: principal?.id ?? null, path: targetPath, operation: mirror, message })
        })
      }
    }
    audit(logger, auditAction, { userId: principal?.id ?? null, path: targetPath, ...auditData })
    if (automation) await publishAutomation(automation)
  }

  const gitSyncHandlers = createGitSyncHandlers({
    services,
    bus,
    authoritative: env.git.sourceOfTruth,
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

  const gitReady = env.git.sourceOfTruth
    ? git.init()
      .then(() => git.sync(gitSyncHandlers))
      .then(() => undefined)
      .catch((error) => {
        logger.error({ type: 'git', action: 'source_of_truth_initialization_failed', error })
        throw error
      })
    : Promise.resolve()

  if (git.enabled && !env.git.sourceOfTruth) {
    void git.init().catch((error) => logger.warn({ type: 'git', action: 'init_failed', error }))
  }

  startGitSyncScheduler(git, env.git, gitSyncHandlers, (error) =>
    logger.warn({ type: 'git', action: 'auto_sync_failed', error }),
  )

  const collab = createCollabRuntime({
    persist: async (room, text, expectedUpdatedAt, principal) => {
      const result = await services.pages.saveContent(room, text, principal, expectedUpdatedAt)
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
    waitUntilReady: () => Promise.all([gitReady, settingsReady]).then(() => undefined),
  })
    .use(openapi({
      path: '/api/docs',
      specPath: '/api/openapi.json',
      documentation: {
        info: {
          title: 'kawaii-wiki.ts API',
          version: APP_VERSION,
          description: 'The stable HTTP API for kawaii-wiki.ts v1.',
        },
      },
      exclude: { paths: ['/assets/*', '/ui/*'] },
    }))
    .use(createSystemRoutes({
      db,
      env,
      services,
      publicSettings,
      feedCache,
      requirePageRead,
      canReadPage,
      enforceUnfurlLimit,
    }))
    .use(createSetupRoutes({
      db,
      logger,
      enforceAuthLimit,
      publishAutomation,
    }))
    .use(createAuthRoutes({
      authPolicy,
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
      enforceCommentLimit,
    }))
    .use(createPreferenceRoutes())
    .use(createNotificationRoutes())
    .use(createTemplateRoutes({ logger }))
    .use(createExportImportRoutes({
      requirePageRead,
      pageWriteEffects,
      assetStorage,
    }))
    .use(createSearchRoutes({ requireSearchRead, canReadPage }))
    .use(createRealtimeRoutes({
      services,
      bus,
      presenceRuntime,
      collab,
      privateWiki,
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
      logger,
      assetStorage,
      assetPolicy,
      privateWiki,
      canReadPage,
      enforceAssetUploadLimit,
      publishAutomation,
    }))
    .use(createStaticRoutes({
      env,
      services,
      hasWebDist,
      webIndex,
      privateWiki,
      canReadPage,
    }))
}

export type App = ReturnType<typeof createApp>
