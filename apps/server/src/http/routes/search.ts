import { t } from 'elysia'
import { can, type Principal } from '@kawaii-wiki/core'
import type { BaseApp } from '../base.ts'

export interface SearchRoutesContext {
  readonly requireSearchRead: (principal: Principal | null) => void
  readonly canReadPage: (principal: Principal | null, path?: string) => Promise<boolean>
}

export const createSearchRoutes = ({ requireSearchRead, canReadPage }: SearchRoutesContext) => (app: BaseApp) =>
  app.get('/api/search', async ({ query, services, principal }) => {
    requireSearchRead(principal)
    const pages = await services.pages.list()
    const publicationByPath = new Map(pages.map((page) => [page.path, page]))
    const readablePaths = new Set((await Promise.all(pages.map(async (page) => {
      if (!await canReadPage(principal, page.path)) return null
      const published = page.status !== 'draft' && (page.publishAt === null || page.publishAt <= Date.now())
      return published || can(principal, 'page:update', { path: page.path }) ? page.path : null
    }))).filter((path): path is string => path !== null))
    return await services.search.search(
      query.q ?? '',
      {
        limit: query.limit,
        offset: query.offset,
        scope: query.scope,
        sort: query.sort,
        filters: {
          pathPrefix: query.pathPrefix,
          label: query.label,
          status: query.status,
          spaceKey: query.spaceKey,
          locale: query.locale,
          author: query.author,
          updatedAfter: query.updatedAfter,
          updatedBefore: query.updatedBefore,
        },
      },
      {
        readablePaths: [...readablePaths],
        canRead: (path) => {
          const page = publicationByPath.get(path)
          return readablePaths.has(path) && Boolean(page)
        },
      },
    )
  }, {
    query: t.Object({
      q: t.Optional(t.String()),
      limit: t.Optional(t.Numeric()),
      offset: t.Optional(t.Numeric()),
      scope: t.Optional(t.Union([t.Literal('all'), t.Literal('title')])),
      sort: t.Optional(t.Union([t.Literal('relevance'), t.Literal('recent')])),
      pathPrefix: t.Optional(t.String()),
      label: t.Optional(t.String()),
      status: t.Optional(t.String()),
      spaceKey: t.Optional(t.String()),
      locale: t.Optional(t.String()),
      author: t.Optional(t.String()),
      updatedAfter: t.Optional(t.Numeric()),
      updatedBefore: t.Optional(t.Numeric()),
    }),
  })
