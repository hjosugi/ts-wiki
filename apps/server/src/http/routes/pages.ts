import { t } from 'elysia'
import {
  notFound,
  type Principal,
} from '@ts-wiki/core'
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

export interface PageRoutesContext {
  readonly logger: StructuredLogger
  readonly requirePageRead: (principal: Principal | null, path?: string) => void
  readonly canReadPage: (principal: Principal | null, path?: string) => boolean
  readonly emitPageChanged: (action: PageChangedAction, path: string, from?: string) => void
  readonly pageWriteEffects: (input: PageWriteEffectsInput) => Promise<void>
  readonly publishAutomation: (event: AutomationEvent) => Promise<void>
}

export const createPageRoutes = ({
  logger,
  requirePageRead,
  canReadPage,
  emitPageChanged,
  pageWriteEffects,
  publishAutomation,
}: PageRoutesContext) => (app: BaseApp) =>
  app
    .get('/api/pages', ({ services, principal }) => {
      requirePageRead(principal)
      return { pages: services.pages.list() }
    })
    .get('/api/pages/popular', ({ query, services, principal }) => {
      requirePageRead(principal)
      const readable = new Map(
        services.pages
          .list()
          .filter((page) => canReadPage(principal, page.path))
          .map((page) => [page.path, page]),
      )
      return {
        pages: services.analytics.popular(query.days, query.limit).flatMap((insight) => {
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
    .get('/api/users/:id/profile', ({ params, services, principal }) => {
      requirePageRead(principal)
      const user = services.users.findById(params.id)
      if (!isUserActive(user)) throw new HttpError(notFound('User profile not found'))
      const readablePages = services.pages.list().filter((page) => canReadPage(principal, page.path))
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
    .get('/api/spaces', ({ services, principal }) => {
      requirePageRead(principal)
      return { spaces: services.pages.spaces() }
    })
    .get('/api/pages/trash', ({ services, principal }) => {
      requireHttpPermission(principal, 'page:delete')
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
      return {
        changes: services.pages
          .recentChanges(query.limit, query.before)
          .filter((change) => canReadPage(principal, change.path)),
      }
    }, {
      query: t.Object({
        limit: t.Optional(t.Numeric()),
        before: t.Optional(t.Numeric()),
      }),
    })
    .get('/api/redirects', ({ services, principal }) => ({
      redirects: unwrap(services.pages.redirects(principal)),
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
          locale: t.Optional(t.Union([t.String(), t.Null()])),
          navOrder: t.Optional(t.Union([t.Number(), t.Null()])),
          pinned: t.Optional(t.Boolean()),
          expectedUpdatedAt: t.Optional(t.Union([t.Number(), t.Null()])),
        }),
      },
    )
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
      '/api/page/insights',
      ({ query, services, principal }) => {
        requirePageRead(principal, query.path)
        const page = unwrap(services.pages.getByPath(query.path))
        return {
          ...services.analytics.page(page.path),
          ...unwrap(services.pages.revisionInsights(page.path)),
        }
      },
      { query: t.Object({ path: t.String() }) },
    )
    .get(
      '/api/page/share',
      ({ query, services, principal }) => ({
        share: unwrap(services.shares.activeForPath(query.path, principal)),
      }),
      { query: t.Object({ path: t.String() }) },
    )
    .post(
      '/api/page/share',
      ({ body, services, principal }) => {
        const share = unwrap(services.shares.create(body, principal))
        audit(logger, 'page.share.create', { userId: principal?.id ?? null, path: share.path, token: share.token })
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
      ({ params, services, principal }) => {
        const share = unwrap(services.shares.revoke(params.token, principal))
        audit(logger, 'page.share.revoke', { userId: principal?.id ?? null, path: share.path, token: share.token })
        return { share }
      },
      { params: t.Object({ token: t.String({ minLength: 16 }) }) },
    )
    .get(
      '/api/shared/:token',
      ({ params, services }) => unwrap(services.shares.resolve(params.token)),
      { params: t.Object({ token: t.String({ minLength: 16 }) }) },
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
