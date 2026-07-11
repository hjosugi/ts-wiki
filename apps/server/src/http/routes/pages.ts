import { t } from 'elysia'
import { createHash } from 'node:crypto'
import {
  can,
  notFound,
  parseJsonStringArray,
  type Principal,
} from '@kawaii-wiki/core'
import { isUserActive } from '../../services/users.ts'
import type { AutomationEvent } from '../../services/webhooks.ts'
import { audit, type StructuredLogger } from '../../observability/logging.ts'
import { HttpError, unwrap } from '../errors.ts'
import { requireHttpPermission } from '../permissions.ts'
import {
  removedPagePayload,
  runPageWrite,
  valueIfOk,
  type PageChangedAction,
  type PageWriteEffectsInput,
} from '../page-write.ts'
import { commentSnapshot } from '../representations.ts'
import { publicUserProfile } from '../representations.ts'
import type { BaseApp } from '../base.ts'
import type { RequestIpServer } from '../rate-limit.ts'

const pageOf = <T>(items: T[], limit = 100, offset = 0) => {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 1_000)
  const safeOffset = Math.max(Math.trunc(offset), 0)
  return { items: items.slice(safeOffset, safeOffset + safeLimit), total: items.length, limit: safeLimit, offset: safeOffset }
}

const filterAsync = async <T>(items: readonly T[], predicate: (item: T) => Promise<boolean>): Promise<T[]> => {
  const allowed = await Promise.all(items.map(predicate))
  return items.filter((_, index) => allowed[index])
}

const isPublished = (page: { status: string; publishAt: number | null }): boolean =>
  page.status !== 'draft' && (page.publishAt === null || page.publishAt <= Date.now())

const canSeePage = (principal: Principal | null, page: { path: string; status: string; publishAt: number | null }): boolean =>
  isPublished(page) || can(principal, 'page:update', { path: page.path })

const shareTokenAuditId = (token: string): string =>
  createHash('sha256').update(token).digest('hex').slice(0, 12)

export interface PageRoutesContext {
  readonly logger: StructuredLogger
  readonly requirePageRead: (principal: Principal | null, path?: string) => Promise<void>
  readonly canReadPage: (principal: Principal | null, path?: string) => Promise<boolean>
  readonly emitPageChanged: (action: PageChangedAction, path: string, from?: string) => void
  readonly pageWriteEffects: (input: PageWriteEffectsInput) => Promise<void>
  readonly publishAutomation: (event: AutomationEvent) => Promise<void>
  readonly enforceCommentLimit: (request: Request, server: RequestIpServer | null | undefined, principal: Principal | null) => void
}

export const createPageRoutes = ({
  logger,
  requirePageRead,
  canReadPage,
  emitPageChanged,
  pageWriteEffects,
  publishAutomation,
  enforceCommentLimit,
}: PageRoutesContext) => (app: BaseApp) =>
  app
    .get('/api/pages', async ({ query, services, principal }) => {
      await requirePageRead(principal)
      const visiblePages = await filterAsync(await services.pages.list(), async (page) => await canReadPage(principal, page.path) && canSeePage(principal, page))
      const result = pageOf(visiblePages, query.limit, query.offset)
      return { pages: result.items, total: result.total, limit: result.limit, offset: result.offset }
    }, { query: t.Object({ limit: t.Optional(t.Numeric()), offset: t.Optional(t.Numeric()) }) })
    .get('/api/pages/popular', async ({ query, services, principal }) => {
      await requirePageRead(principal)
      const readable = new Map(
        (await filterAsync(await services.pages.list(), async (page) => await canReadPage(principal, page.path) && canSeePage(principal, page)))
          .map((page) => [page.path, page]),
      )
      return {
        pages: (await services.analytics.popular(query.days, query.limit)).flatMap((insight) => {
          const page = readable.get(insight.path)
          return page ? [{ ...page, views: insight.views, lastViewedAt: insight.lastViewedAt }] : []
        }),
      }
    }, {
      query: t.Object({
        days: t.Optional(t.Numeric()),
        limit: t.Optional(t.Numeric()),
      }),
    })
    .get('/api/users/:id/profile', async ({ params, services, principal }) => {
      await requirePageRead(principal)
      const user = await services.users.findById(params.id)
      if (!isUserActive(user)) throw new HttpError(notFound('User profile not found'))
      const readablePages = await filterAsync(await services.pages.list(), async (page) => await canReadPage(principal, page.path) && canSeePage(principal, page))
      const byPath = new Map(readablePages.map((page) => [page.path, page]))
      const profile = publicUserProfile(user)
      const favoritePages = profile.profileFavoritePages.flatMap((path) => {
        const page = byPath.get(path)
        return page ? [page] : []
      })
      const authoredPages = readablePages
        .filter((page) => page.authorId === user.id)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 8)
      return {
        profile,
        favoritePages,
        authoredPages,
      }
    }, {
      params: t.Object({ id: t.String() }),
    })
    .get('/api/spaces', async ({ query, services, principal }) => {
      await requirePageRead(principal)
      const visiblePages = await filterAsync(await services.pages.list(), async (page) => await canReadPage(principal, page.path) && canSeePage(principal, page))
      const spaces = [...visiblePages.reduce((map, page) => {
        const current = map.get(page.spaceKey)
        map.set(page.spaceKey, { key: page.spaceKey, pages: (current?.pages ?? 0) + 1, updatedAt: Math.max(current?.updatedAt ?? 0, page.updatedAt) })
        return map
      }, new Map<string, { key: string; pages: number; updatedAt: number }>()).values()].sort((a, b) => a.key.localeCompare(b.key))
      const result = pageOf(spaces, query.limit, query.offset)
      return { spaces: result.items, total: result.total, limit: result.limit, offset: result.offset }
    }, { query: t.Object({ limit: t.Optional(t.Numeric()), offset: t.Optional(t.Numeric()) }) })
    .get('/api/pages/trash', async ({ query, services, principal }) => {
      requireHttpPermission(principal, 'page:delete')
      const result = pageOf(await services.pages.trash(), query.limit, query.offset)
      return { pages: result.items, total: result.total, limit: result.limit, offset: result.offset }
    }, { query: t.Object({ limit: t.Optional(t.Numeric()), offset: t.Optional(t.Numeric()) }) })
    .get('/api/graph', async ({ services, principal }) => {
      await requirePageRead(principal)
      const visible = new Set((await filterAsync(await services.pages.list(), async (page) => await canReadPage(principal, page.path) && canSeePage(principal, page))).map((page) => page.path))
      const graph = await services.pages.graph()
      const kindByPath = new Map(graph.nodes.map((node) => [node.path, node.kind]))
      return {
        nodes: graph.nodes.filter((node) => visible.has(node.path) || (node.kind === 'missing' && graph.edges.some((edge) => edge.target === node.path && visible.has(edge.source)))),
        edges: graph.edges.filter((edge) => visible.has(edge.source) && (kindByPath.get(edge.target) === 'missing' || visible.has(edge.target))),
      }
    })
    .get('/api/events/index', async ({ services, principal }) => {
      await requirePageRead(principal)
      const visible = new Set((await filterAsync(await services.pages.list(), async (page) => await canReadPage(principal, page.path) && canSeePage(principal, page))).map((page) => page.path))
      return { events: (await services.pages.events()).filter((event) => visible.has(event.sourcePath)) }
    })
    .get('/api/labels', async ({ services, principal }) => {
      await requirePageRead(principal)
      const counts = new Map<string, number>()
      for (const page of await filterAsync(await services.pages.list(), async (item) => await canReadPage(principal, item.path) && canSeePage(principal, item))) {
        for (const label of parseJsonStringArray(page.labels)) counts.set(label, (counts.get(label) ?? 0) + 1)
      }
      return { labels: [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)) }
    })
    .get('/api/links/broken', async ({ services, principal }) => {
      await requirePageRead(principal)
      const readable = new Set((await filterAsync(await services.pages.list(), async (page) => await canReadPage(principal, page.path) && canSeePage(principal, page))).map((page) => page.path))
      return { links: (await services.pages.brokenLinks()).filter((link) => readable.has(link.path)) }
    })
    .get('/api/changes', async ({ query, services, principal }) => {
      await requirePageRead(principal)
      const changes = await services.pages.recentChanges(query.limit, query.before)
      return {
        changes: await filterAsync(changes, (change) => canReadPage(principal, change.path)),
      }
    }, {
      query: t.Object({
        limit: t.Optional(t.Numeric()),
        before: t.Optional(t.Numeric()),
      }),
    })
    .get('/api/redirects', async ({ services, principal }) => ({
      redirects: unwrap(await services.pages.redirects(principal)),
    }))
    .post('/api/redirects', ({ body, services, principal }) => {
      const redirect = unwrap(services.pages.createRedirect(body.fromPath, body.toPath, principal))
      audit(logger, 'page.redirect.create', {
        userId: principal?.id ?? null,
        fromPath: redirect.fromPath,
        toPath: redirect.toPath,
      })
      return { redirect }
    }, {
      body: t.Object({
        fromPath: t.String(),
        toPath: t.String(),
      }),
    })
    .delete('/api/redirects', ({ query, services, principal }) => {
      const result = unwrap(services.pages.deleteRedirect(query.fromPath, principal))
      audit(logger, 'page.redirect.delete', {
        userId: principal?.id ?? null,
        fromPath: result.fromPath,
      })
      return result
    }, {
      query: t.Object({ fromPath: t.String() }),
    })
    .post(
      '/api/pages',
      async ({ body, services, principal }) => {
        const page = unwrap(services.pages.create(body, principal))
        return runPageWrite(pageWriteEffects, {
          action: 'created',
          page,
          principal,
          auditAction: 'page.create',
          automationType: 'page.created',
        })
      },
      {
        body: t.Object({
          path: t.String(),
          title: t.String(),
          content: t.String(),
          description: t.Optional(t.String()),
          icon: t.Optional(t.String()),
          coverUrl: t.Optional(t.String()),
          coverPosition: t.Optional(t.String()),
          labels: t.Optional(t.Array(t.String())),
          status: t.Optional(t.Union([
            t.Literal('draft'),
            t.Literal('in-review'),
            t.Literal('verified'),
            t.Literal('outdated'),
          ])),
          ownerId: t.Optional(t.Union([t.String(), t.Null()])),
          reviewAt: t.Optional(t.Union([t.Number(), t.Null()])),
          publishAt: t.Optional(t.Union([t.Number(), t.Null()])),
          locale: t.Optional(t.Union([t.String(), t.Null()])),
          navOrder: t.Optional(t.Union([t.Number(), t.Null()])),
          pinned: t.Optional(t.Boolean()),
          expectedUpdatedAt: t.Optional(t.Union([t.Number(), t.Null()])),
        }),
      },
    )
    .post('/api/page/copy', async ({ body, services, principal }) => {
      const page = unwrap(services.pages.copy(body.fromPath, body.newPath, principal, body.keepStatus))
      return runPageWrite(pageWriteEffects, {
        action: 'created',
        page,
        principal,
        auditAction: 'page.copy',
        auditData: { fromPath: body.fromPath },
        automationType: 'page.created',
      })
    }, {
      body: t.Object({ fromPath: t.String(), newPath: t.String(), keepStatus: t.Optional(t.Boolean()) }),
    })
    .get(
      '/api/page',
      async ({ query, services, principal }) => {
        await requirePageRead(principal, query.path)
        const resolved = unwrap(services.pages.resolveByPath(query.path))
        const page = resolved.page
        if (!canSeePage(principal, page)) throw new HttpError(notFound(`No page at "${query.path}"`))
        unwrap(services.analytics.recordPageView(page.path, principal))
        return { page, redirectedFrom: resolved.redirectedFrom }
      },
      { query: t.Object({ path: t.String() }) },
    )
    .get(
      '/api/page/insights',
      async ({ query, services, principal }) => {
        await requirePageRead(principal, query.path)
        const page = unwrap(services.pages.getByPath(query.path))
        return {
          ...await services.analytics.page(page.path),
          ...unwrap(await services.pages.revisionInsights(page.path)),
        }
      },
      { query: t.Object({ path: t.String() }) },
    )
    .get(
      '/api/page/share',
      async ({ query, services, principal }) => ({
        share: unwrap(await services.shares.activeForPath(query.path, principal)),
      }),
      { query: t.Object({ path: t.String() }) },
    )
    .post(
      '/api/page/share',
      async ({ body, services, principal }) => {
        const share = unwrap(await services.shares.create(body, principal))
        audit(logger, 'page.share.create', { userId: principal?.id ?? null, path: share.path, shareId: shareTokenAuditId(share.token) })
        return { share }
      },
      {
        body: t.Object({
          path: t.String(),
          expiresAt: t.Optional(t.Union([t.Number(), t.Null()])),
        }),
      },
    )
    .delete(
      '/api/page/share/:token',
      async ({ params, services, principal }) => {
        const share = unwrap(await services.shares.revoke(params.token, principal))
        audit(logger, 'page.share.revoke', { userId: principal?.id ?? null, path: share.path, shareId: shareTokenAuditId(share.token) })
        return { share }
      },
      { params: t.Object({ token: t.String({ minLength: 16 }) }) },
    )
    .get(
      '/api/shared/:token',
      async ({ params, services }) => unwrap(await services.shares.resolve(params.token)),
      { params: t.Object({ token: t.String({ minLength: 16 }) }) },
    )
    .get(
      '/api/page/backlinks',
      async ({ query, services, principal }) => {
        await requirePageRead(principal, query.path)
        const visible = new Set((await filterAsync(await services.pages.list(), async (page) => await canReadPage(principal, page.path) && canSeePage(principal, page))).map((page) => page.path))
        return { backlinks: (await services.pages.backlinks(query.path)).filter((link) => visible.has(link.path)) }
      },
      { query: t.Object({ path: t.String() }) },
    )
    .get(
      '/api/page/history',
      async ({ query, services, principal }) => {
        await requirePageRead(principal, query.path)
        return { revisions: unwrap(await services.pages.history(query.path)) }
      },
      { query: t.Object({ path: t.String() }) },
    )
    .get(
      '/api/page/comments',
      async ({ query, services, principal }) => {
        await requirePageRead(principal, query.path)
        const policy = unwrap(await services.comments.policy(query.path, principal))
        return { comments: policy.visible ? unwrap(await services.comments.list(query.path)) : [], policy }
      },
      { query: t.Object({ path: t.String() }) },
    )
    .post(
      '/api/page/comments',
      async ({ body, services, principal, request, server }) => {
        enforceCommentLimit(request, server, principal)
        const comment = unwrap(await services.comments.create(body.path, body.body, principal))
        await services.notifications.notifyComment(comment)
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
        const comment = unwrap(await services.comments.update(params.id, body.body, principal))
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
        const comment = unwrap(await services.comments.resolve(params.id, principal))
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
        const result = unwrap(await services.comments.remove(params.id, principal))
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
        const previous = valueIfOk(services.pages.getByPath(query.path))
        const page = unwrap(services.pages.update(query.path, body, principal))
        return runPageWrite(pageWriteEffects, {
          action: 'updated',
          page,
          principal,
          auditAction: 'page.update',
          automationType: 'page.updated',
          previous,
        })
      },
      {
        query: t.Object({ path: t.String() }),
        body: t.Object({
          title: t.Optional(t.String()),
          content: t.Optional(t.String()),
          description: t.Optional(t.String()),
          icon: t.Optional(t.String()),
          coverUrl: t.Optional(t.String()),
          coverPosition: t.Optional(t.String()),
          labels: t.Optional(t.Array(t.String())),
          status: t.Optional(t.Union([
            t.Literal('draft'),
            t.Literal('in-review'),
            t.Literal('verified'),
            t.Literal('outdated'),
          ])),
          ownerId: t.Optional(t.Union([t.String(), t.Null()])),
          reviewAt: t.Optional(t.Union([t.Number(), t.Null()])),
          publishAt: t.Optional(t.Union([t.Number(), t.Null()])),
          locale: t.Optional(t.Union([t.String(), t.Null()])),
          navOrder: t.Optional(t.Union([t.Number(), t.Null()])),
          pinned: t.Optional(t.Boolean()),
        }),
      },
    )
    .post(
      '/api/page/restore-revision',
      async ({ body, services, principal }) => {
        const previous = valueIfOk(services.pages.getByPath(body.path))
        const page = unwrap(services.pages.restoreRevision(body.path, body.revisionId, principal))
        return runPageWrite(pageWriteEffects, {
          action: 'updated',
          page,
          principal,
          auditAction: 'page.revision.restore',
          auditData: { revisionId: body.revisionId },
          automationType: 'page.updated',
          automationData: { revisionId: body.revisionId },
          previous,
        })
      },
      { body: t.Object({ path: t.String(), revisionId: t.String() }) },
    )
    .post(
      '/api/page/archive',
      async ({ body, services, principal }) => {
        const page = unwrap(services.pages.archive(body.path, principal))
        return runPageWrite(pageWriteEffects, {
          action: 'deleted',
          page,
          principal,
          auditAction: 'page.archive',
          automationType: 'page.archived',
        })
      },
      { body: t.Object({ path: t.String() }) },
    )
    .post(
      '/api/page/restore',
      async ({ body, services, principal }) => {
        const page = unwrap(services.pages.restore(body.path, principal))
        return runPageWrite(pageWriteEffects, {
          action: 'created',
          page,
          principal,
          auditAction: 'page.restore',
          automationType: 'page.restored',
        })
      },
      { body: t.Object({ path: t.String() }) },
    )
    .post(
      '/api/page/move',
      async ({ body, services, principal }) => {
        const previous = valueIfOk(services.pages.getByPath(body.oldPath))
        const page = unwrap(services.pages.move(body.oldPath, body.newPath, principal))
        return runPageWrite(pageWriteEffects, {
          action: 'moved',
          page,
          from: body.oldPath,
          principal,
          auditAction: 'page.move',
          auditData: { from: body.oldPath },
          automationType: 'page.moved',
          automationData: { previousPath: body.oldPath },
          previous,
        })
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
        const previous = valueIfOk(services.pages.getByPath(query.path))
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
              ...removedPagePayload(previous),
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
        const previous = valueIfOk(services.pages.getByPath(query.path))
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
              ...removedPagePayload(previous),
            },
          },
        })
        return result
      },
      { query: t.Object({ path: t.String() }) },
    )
