import { t } from 'elysia'
import type { Principal } from '@kawaii-wiki/core'
import { audit, type StructuredLogger } from '../../observability/logging.ts'
import type { AutomationEvent } from '../../services/webhooks.ts'
import type { DatabaseDriver } from '../../db/config.ts'
import type { AssetStorageType } from '../../storage/assets.ts'
import { unwrap } from '../errors.ts'
import { requireHttpPermission } from '../permissions.ts'
import { describeSystemBackends } from '../system-backends.ts'
import type { RequestIpServer } from '../rate-limit.ts'
import { publicUser } from '../representations.ts'
import type { BaseApp } from '../base.ts'

const navLinkSchema = t.Object({
  label: t.String(),
  url: t.String(),
  icon: t.Optional(t.String()),
  children: t.Optional(t.Array(t.Object({
    label: t.String(),
    url: t.String(),
    icon: t.Optional(t.String()),
    children: t.Optional(t.Array(t.Object({
      label: t.String(),
      url: t.String(),
      icon: t.Optional(t.String()),
    }))),
  }))),
})

const pageStatusSchema = t.Union([
  t.Literal('draft'),
  t.Literal('in-review'),
  t.Literal('verified'),
  t.Literal('outdated'),
])

const automationTriggerSchema = t.Union([
  t.Literal('page.created'),
  t.Literal('page.updated'),
  t.Literal('page.deleted'),
  t.Literal('page.moved'),
  t.Literal('comment.created'),
])

const automationConditionsSchema = t.Object({
  pathPrefix: t.Optional(t.String()),
  label: t.Optional(t.String()),
  status: t.Optional(pageStatusSchema),
  authorId: t.Optional(t.String()),
  locale: t.Optional(t.String()),
  spaceKey: t.Optional(t.String()),
})

const automationActionsSchema = t.Object({
  addLabel: t.Optional(t.String()),
  setStatus: t.Optional(pageStatusSchema),
  setReviewAt: t.Optional(t.Union([t.Number(), t.Null()])),
  moveToPath: t.Optional(t.String()),
  fireWebhookEvent: t.Optional(t.String()),
})

const eventAutomationConfigSchema = t.Object({
  trigger: automationTriggerSchema,
  conditions: t.Optional(automationConditionsSchema),
  actions: automationActionsSchema,
})

const legacyAutomationConfigSchema = t.Object({
  pathPrefix: t.String(),
  label: t.Optional(t.String()),
  status: t.Optional(pageStatusSchema),
})

const automationConfigSchema = t.Union([eventAutomationConfigSchema, legacyAutomationConfigSchema])

export interface AdminRoutesContext {
  readonly logger: StructuredLogger
  readonly enforceCredentialLimit: (
    request: Request,
    server: RequestIpServer | null | undefined,
    scope: string,
    principal?: Principal | null,
  ) => void
  readonly publishAutomation: (event: AutomationEvent) => Promise<void>
  /** Active database driver, for the read-only storage & search backend report. */
  readonly databaseDriver: DatabaseDriver
  /** Active asset-storage backend, for the same report. */
  readonly assetBackend: AssetStorageType
}

export const createAdminRoutes = ({
  logger,
  enforceCredentialLimit,
  publishAutomation,
  databaseDriver,
  assetBackend,
}: AdminRoutesContext) => (app: BaseApp) =>
  app
    .get('/api/admin/stats', async ({ services, principal }) => unwrap(await services.admin.stats(principal)))
    .get('/api/admin/system/backends', async ({ services, principal }) => {
      requireHttpPermission(principal, 'admin:access')
      let databaseHealthy = true
      try {
        await services.ping()
      } catch {
        databaseHealthy = false
      }
      return describeSystemBackends({ databaseDriver, assetBackend, databaseHealthy })
    })
    .get('/api/admin/history', async ({ services, principal }) => unwrap(await services.admin.historyStats(principal)))
    .post('/api/admin/history/purge', async ({ body, services, principal }) => {
      const result = unwrap(await services.admin.purgeHistory(principal, body))
      audit(logger, 'admin.history.purge', {
        userId: principal?.id ?? null,
        deleted: result.deleted,
        olderThan: result.olderThan,
        keepLatest: result.keepLatest,
      })
      return result
    }, {
      body: t.Object({
        olderThanDays: t.Numeric(),
        keepLatest: t.Numeric(),
      }),
    })
    .get('/api/admin/pages', async ({ query, services, principal }) => unwrap(await services.admin.listPages(principal, query)), {
      query: t.Object({
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
        status: t.Optional(t.String()),
        label: t.Optional(t.String()),
        spaceKey: t.Optional(t.String()),
        authorId: t.Optional(t.String()),
      }),
    })
    .get('/api/admin/audit', async ({ query, services, principal }) => unwrap(await services.admin.listAudit(principal, query)), {
      query: t.Object({
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
        action: t.Optional(t.String()),
        userId: t.Optional(t.String()),
        from: t.Optional(t.Numeric()),
        to: t.Optional(t.Numeric()),
      }),
    })
    .get('/api/admin/analytics', async ({ services, principal }) => unwrap(await services.analytics.summary(principal)))
    .put(
      '/api/admin/settings',
      async ({ body, services, principal }) => ({ settings: unwrap(await services.settings.update(principal, body)) }),
      {
        body: t.Object({
          siteTitle: t.Optional(t.String()),
          accentColor: t.Optional(t.String()),
          theme: t.Optional(t.Union([t.Literal('system'), t.Literal('light'), t.Literal('dark')])),
          themePreset: t.Optional(t.Union([
            t.Literal('classic'),
            t.Literal('kawaii'),
            t.Literal('pop'),
            t.Literal('minimal'),
            t.Literal('gamer'),
            t.Literal('custom'),
          ])),
          fontFamily: t.Optional(t.Union([
            t.Literal('system'),
            t.Literal('rounded'),
            t.Literal('maru'),
            t.Literal('sans-jp'),
            t.Literal('serif'),
          ])),
          background: t.Optional(t.Object({
            type: t.Union([
              t.Literal('none'),
              t.Literal('color'),
              t.Literal('gradient'),
              t.Literal('pattern'),
              t.Literal('image'),
            ]),
            value: t.String(),
            overlayOpacity: t.Number(),
          })),
          registration: t.Optional(t.Union([t.Literal('open'), t.Literal('off')])),
          privateWiki: t.Optional(t.Boolean()),
          requireEmailVerification: t.Optional(t.Boolean()),
          requireTwoFactor: t.Optional(t.Boolean()),
          tokenTtlSeconds: t.Optional(t.Numeric()),
          assetMaxBytes: t.Optional(t.Numeric()),
          defaultEditorMode: t.Optional(t.Union([t.Literal('markdown'), t.Literal('visual')])),
          homePath: t.Optional(t.String()),
          dailyNotesPath: t.Optional(t.String()),
          defaultLocale: t.Optional(t.String()),
          timezone: t.Optional(t.String()),
          dateFormat: t.Optional(t.Union([t.Literal('short'), t.Literal('medium'), t.Literal('long')])),
          navLinks: t.Optional(t.Array(navLinkSchema)),
          navItems: t.Optional(t.Array(t.Object({
            key: t.Union([
              t.Literal('changes'),
              t.Literal('events'),
              t.Literal('graph'),
              t.Literal('redirects'),
              t.Literal('templates'),
              t.Literal('new'),
            ]),
            visible: t.Boolean(),
          }))),
          logoUrl: t.Optional(t.String()),
          faviconUrl: t.Optional(t.String()),
          footerText: t.Optional(t.String()),
          footerLinks: t.Optional(t.Array(navLinkSchema)),
          customCss: t.Optional(t.String()),
          customHeadHtml: t.Optional(t.String()),
          enableMath: t.Optional(t.Boolean()),
          enableEmoji: t.Optional(t.Boolean()),
          enableMermaid: t.Optional(t.Boolean()),
        }),
      },
    )
    .get('/api/admin/users', async ({ query, services, principal }) => {
      const all = unwrap(await services.admin.listUsers(principal))
      const limit = Math.min(Math.max(Math.trunc(query.limit ?? 100), 1), 1_000)
      const offset = Math.max(Math.trunc(query.offset ?? 0), 0)
      return { users: all.slice(offset, offset + limit), total: all.length, limit, offset }
    }, { query: t.Object({ limit: t.Optional(t.Numeric()), offset: t.Optional(t.Numeric()) }) })
    .put(
      '/api/admin/users/password',
      async ({ body, services, principal, request, server }) => {
        enforceCredentialLimit(request, server, 'admin-password-reset', principal)
        const user = unwrap(await services.admin.setUserPassword(principal, body.userId, body.password))
        audit(logger, 'admin.user.password.reset', { userId: principal?.id ?? null, targetUserId: user.id })
        return { user }
      },
      { body: t.Object({ userId: t.String(), password: t.String({ minLength: 6 }) }) },
    )
    .post(
      '/api/admin/users/deactivate',
      async ({ body, services, principal }) => {
        const user = unwrap(await services.admin.deactivateUser(principal, body.userId))
        audit(logger, 'admin.user.deactivate', { userId: principal?.id ?? null, targetUserId: user.id })
        return { user }
      },
      { body: t.Object({ userId: t.String() }) },
    )
    .get('/api/admin/groups', async ({ services, principal }) => ({
      groups: unwrap(await services.authz.listGroups(principal)),
    }))
    .get('/api/admin/api-keys', async ({ services, principal }) => ({
      apiKeys: unwrap(await services.apiKeys.list(principal)),
    }))
    .post(
      '/api/admin/api-keys',
      async ({ body, services, principal }) => {
        const created = unwrap(await services.apiKeys.create(principal, body))
        audit(logger, 'api-key.create', {
          userId: principal?.id ?? null,
          apiKeyId: created.apiKey.id,
          role: created.apiKey.role,
          expiresAt: created.apiKey.expiresAt,
        })
        return created
      },
      {
        body: t.Object({
          name: t.String(),
          role: t.Optional(t.Union([t.Literal('admin'), t.Literal('editor'), t.Literal('viewer')])),
          expiresAt: t.Optional(t.Union([t.Number(), t.Null()])),
        }),
      },
    )
    .delete(
      '/api/admin/api-keys/:id',
      async ({ params, services, principal }) => {
        const apiKey = unwrap(await services.apiKeys.revoke(principal, params.id))
        audit(logger, 'api-key.revoke', {
          userId: principal?.id ?? null,
          apiKeyId: apiKey.id,
        })
        return { apiKey }
      },
      { params: t.Object({ id: t.String() }) },
    )
    .post(
      '/api/admin/groups',
      async ({ body, services, principal }) => ({ group: unwrap(await services.authz.createGroup(principal, body)) }),
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
      async ({ body, services, principal }) => unwrap(await services.authz.addUserToGroup(principal, body.userId, body.groupKey)),
      { body: t.Object({ userId: t.String(), groupKey: t.String() }) },
    )
    .delete(
      '/api/admin/groups/members',
      async ({ query, services, principal }) => unwrap(await services.authz.removeUserFromGroup(principal, query.userId, query.groupKey)),
      { query: t.Object({ userId: t.String(), groupKey: t.String() }) },
    )
    .get('/api/admin/page-rules', async ({ services, principal }) => ({
      rules: unwrap(await services.authz.listPageRules(principal)),
    }))
    .post(
      '/api/admin/page-rules',
      async ({ body, services, principal }) => ({ rule: unwrap(await services.authz.createPageRule(principal, body)) }),
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
      async ({ params, services, principal }) => unwrap(await services.authz.deletePageRule(principal, params.id)),
      { params: t.Object({ id: t.String() }) },
    )
    .get('/api/admin/search-index', async ({ services, principal }) => ({
      searchIndex: unwrap(await services.search.indexStatus(principal)),
    }))
    .post(
      '/api/admin/search-index/rebuild',
      async ({ body, services, principal }) => {
        const searchIndex = unwrap(await services.search.rebuildIndex(principal, body ?? undefined))
        audit(logger, 'search.index.rebuild', {
          userId: principal?.id ?? null,
          tokenizer: searchIndex.tokenizer,
          totalPages: searchIndex.totalPages,
        })
        return { searchIndex }
      },
      {
        body: t.Optional(t.Object({
          tokenizer: t.Optional(t.Union([t.Literal('unicode61'), t.Literal('trigram')])),
        })),
      },
    )
    .get(
      '/api/admin/webhooks/deliveries',
      async ({ query, services, principal }) => ({
        deliveries: unwrap(await services.webhooks.listDeliveries(principal, {
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
    .get('/api/admin/webhooks', async ({ services, principal }) => ({
      webhooks: unwrap(await services.webhooks.listSubscriptions(principal)),
    }))
    .post(
      '/api/admin/webhooks',
      async ({ body, services, principal }) => ({
        webhook: unwrap(await services.webhooks.createSubscription(principal, body)),
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
      async ({ params, body, services, principal }) => ({
        webhook: unwrap(await services.webhooks.updateSubscription(principal, params.id, body)),
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
      async ({ params, services, principal }) => unwrap(await services.webhooks.deleteSubscription(principal, params.id)),
      { params: t.Object({ id: t.String() }) },
    )
    .get('/api/admin/automation-rules', async ({ services, principal }) => ({
      rules: unwrap(await services.webhooks.listAutomationRules(principal)),
    }))
    .post(
      '/api/admin/automation-rules',
      async ({ body, services, principal }) => ({
        rule: unwrap(await services.webhooks.createAutomationRule(principal, body)),
      }),
      {
        body: t.Object({
          name: t.Optional(t.String()),
          type: t.Union([t.Literal('event-rule'), t.Literal('page-updated-metadata')]),
          enabled: t.Optional(t.Boolean()),
          priority: t.Optional(t.Number()),
          stopOnMatch: t.Optional(t.Boolean()),
          config: automationConfigSchema,
        }),
      },
    )
    .put(
      '/api/admin/automation-rules/:id',
      async ({ params, body, services, principal }) => ({
        rule: unwrap(await services.webhooks.updateAutomationRule(principal, params.id, body)),
      }),
      {
        params: t.Object({ id: t.String() }),
        body: t.Object({
          name: t.Optional(t.String()),
          enabled: t.Optional(t.Boolean()),
          priority: t.Optional(t.Number()),
          stopOnMatch: t.Optional(t.Boolean()),
          config: t.Optional(automationConfigSchema),
        }),
      },
    )
    .delete(
      '/api/admin/automation-rules/:id',
      async ({ params, services, principal }) => unwrap(await services.webhooks.deleteAutomationRule(principal, params.id)),
      { params: t.Object({ id: t.String() }) },
    )
    .put(
      '/api/admin/users/role',
      async ({ body, services, principal }) => {
        const user = unwrap(await services.admin.setUserRole(principal, body.userId, body.role))
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
