import { t } from 'elysia'
import {
  parsePageFile,
  serializePageFile,
  type Principal,
} from '@ts-wiki/core'
import { unwrap } from '../errors.ts'
import { requireHttpPermission } from '../permissions.ts'
import { runPageWrite, type PageWriteEffectsInput } from '../page-write.ts'
import type { BaseApp } from '../base.ts'

export interface ExportImportRoutesContext {
  readonly requirePageRead: (principal: Principal | null, path?: string) => void
  readonly pageWriteEffects: (input: PageWriteEffectsInput) => Promise<void>
}

export const createExportImportRoutes = ({
  requirePageRead,
  pageWriteEffects,
}: ExportImportRoutesContext) => (app: BaseApp) =>
  app
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
      requireHttpPermission(principal, 'admin:access')
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
          navOrder: page.navOrder,
          pinned: page.pinned,
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
        requireHttpPermission(principal, 'page:write', { path: body.path })
        const parsed = parsePageFile(body.content)
        const result = unwrap(services.pages.upsertFromFile(body.path, parsed, {
          title: body.title,
          description: body.description,
          labels: body.labels,
          status: body.status,
          locale: body.locale,
          navOrder: body.navOrder,
          pinned: body.pinned,
        }, principal))
        const page = result.page
        return runPageWrite(pageWriteEffects, {
          action: result.created ? 'created' : 'updated',
          page,
          principal,
          auditAction: 'page.import_markdown',
          automationType: result.created ? 'page.created' : 'page.updated',
          automationData: { source: 'markdown-import' },
          previous: result.previous ?? null,
        })
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
          navOrder: t.Optional(t.Union([t.Number(), t.Null()])),
          pinned: t.Optional(t.Boolean()),
        }),
      },
    )
