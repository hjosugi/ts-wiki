import { t } from 'elysia'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import {
  normalizePath,
  parseJsonStringArray,
  parsePageFile,
  serializePageFile,
  type Principal,
} from '@kawaii-wiki/core'
import { unwrap } from '../errors.ts'
import { requireHttpPermission } from '../permissions.ts'
import { runPageWrite, type PageWriteEffectsInput } from '../page-write.ts'
import type { BaseApp } from '../base.ts'
import type { AssetStorage } from '../../storage/assets.ts'
import { OFFICIAL_DOCS_VERSION, officialDocumentationPages } from '../../official-docs.ts'

const htmlText = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export interface ExportImportRoutesContext {
  readonly requirePageRead: (principal: Principal | null, path?: string) => Promise<void>
  readonly pageWriteEffects: (input: PageWriteEffectsInput) => Promise<void>
  readonly assetStorage: AssetStorage
}

export const createExportImportRoutes = ({
  requirePageRead,
  pageWriteEffects,
  assetStorage,
}: ExportImportRoutesContext) => (app: BaseApp) =>
  app
    .get(
      '/api/export/page',
      async ({ query, services, principal }) => {
        await requirePageRead(principal, query.path)
        const page = unwrap(services.pages.getByPath(query.path))
        const htmlFormat = query.format === 'html' || query.format === 'print'
        const filename = `${page.path.split('/').at(-1) || 'page'}.${htmlFormat ? 'html' : 'md'}`
        if (htmlFormat) {
          const printCss = query.format === 'print' ? `<style>
            @page{margin:18mm}body{font:16px/1.6 system-ui,sans-serif;max-width:75ch;margin:auto;color:#111}h1,h2,h3{break-after:avoid}pre,table,blockquote{break-inside:avoid}pre{white-space:pre-wrap;border:1px solid #ddd;padding:1rem}img{max-width:100%}a{color:inherit}header{border-bottom:1px solid #ddd;margin-bottom:2rem}footer{border-top:1px solid #ddd;margin-top:3rem;font-size:.8rem;color:#555}
          </style>` : ''
          return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${htmlText(page.title)}</title>${printCss}</head><body><header><h1>${htmlText(page.title)}</h1><p>/${htmlText(page.path)}</p></header>${page.renderedHtml}<footer>/${htmlText(page.path)}</footer></body></html>`, {
            headers: {
              'content-type': 'text/html; charset=utf-8',
              'content-disposition': `${query.format === 'print' ? 'inline' : 'attachment'}; filename="${filename}"`,
            },
          })
        }
        return new Response(
          serializePageFile({
            title: page.title,
            description: page.description,
            icon: page.icon,
            coverUrl: page.coverUrl,
            coverPosition: page.coverPosition,
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
          format: t.Optional(t.Union([t.Literal('markdown'), t.Literal('html'), t.Literal('print')])),
        }),
      },
    )
    .get('/api/export/site', async ({ query, services, principal }) => {
      requireHttpPermission(principal, 'admin:access')
      const exportedAt = new Date().toISOString()
      const exportedPages = (await services.pages.allActive()).map((page) => ({
          path: page.path,
          title: page.title,
          description: page.description,
          icon: page.icon,
          coverUrl: page.coverUrl,
          coverPosition: page.coverPosition,
          content: page.content,
          labels: page.labels,
          status: page.status,
          ownerId: page.ownerId,
          reviewAt: page.reviewAt,
          publishAt: page.publishAt,
          navOrder: page.navOrder,
          pinned: page.pinned,
          spaceKey: page.spaceKey,
          locale: page.locale,
          createdAt: page.createdAt,
          updatedAt: page.updatedAt,
      }))
      const exportedAssets = unwrap(await services.assets.list(principal)).map((asset) => ({
        ...asset,
        archivePath: `assets/${asset.storageName}`,
      }))
      const manifest = {
        manifestVersion: 1,
        exportedAt,
        pages: exportedPages,
        assets: exportedAssets,
      }
      if (query.format !== 'zip') return manifest
      const entries: Record<string, Uint8Array> = {
        'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
      }
      for (const page of exportedPages) {
        entries[`content/${page.path}.md`] = strToU8(serializePageFile(page))
      }
      for (const asset of exportedAssets) {
        const object = await assetStorage.get(asset.storageName)
        if (!object?.body) continue
        entries[asset.archivePath] = new Uint8Array(await new Response(object.body, { headers: object.headers }).arrayBuffer())
      }
      return new Response(zipSync(entries, { level: 6 }), {
        headers: {
          'content-type': 'application/zip',
          'content-disposition': `attachment; filename="kawaii-wiki.ts-${exportedAt.slice(0, 10)}.zip"`,
        },
      })
    }, { query: t.Object({ format: t.Optional(t.Union([t.Literal('json'), t.Literal('zip')])) }) })
    .post('/api/import/site', async ({ body, services, principal }) => {
      requireHttpPermission(principal, 'admin:access')
      const results: Array<{ path: string; ok: boolean; error?: string }> = []
      for (const source of body.pages) {
        try {
          const existing = services.pages.getByPath(source.path)
          if (body.conflictPolicy === 'skip' && existing.ok) {
            results.push({ path: source.path, ok: true })
            continue
          }
          const result = unwrap(services.pages.upsertFromFile(source.path, parsePageFile(source.content), {
            title: source.title,
            description: source.description,
            icon: source.icon,
            coverUrl: source.coverUrl,
            coverPosition: source.coverPosition,
            labels: parseJsonStringArray(source.labels),
            status: source.status,
            locale: source.locale,
            navOrder: source.navOrder,
            pinned: source.pinned,
          }, principal))
          await runPageWrite(pageWriteEffects, {
            action: result.created ? 'created' : 'updated', page: result.page, principal,
            auditAction: 'page.import_site', automationType: result.created ? 'page.created' : 'page.updated',
            automationData: { source: 'site-import' }, previous: result.previous ?? null,
          })
          results.push({ path: result.page.path, ok: true })
        } catch (error) {
          results.push({ path: source.path, ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      }
      return { results }
    }, {
      body: t.Object({
        conflictPolicy: t.Optional(t.Union([t.Literal('upsert'), t.Literal('skip')])),
        pages: t.Array(t.Object({
          path: t.String(), title: t.String(), description: t.Optional(t.String()), icon: t.Optional(t.String()),
          coverUrl: t.Optional(t.String()), coverPosition: t.Optional(t.String()), content: t.String(), labels: t.String(),
          status: t.Optional(t.Union([t.Literal('draft'), t.Literal('in-review'), t.Literal('verified'), t.Literal('outdated')])),
          locale: t.Optional(t.String()), navOrder: t.Optional(t.Union([t.Number(), t.Null()])), pinned: t.Optional(t.Boolean()),
        })),
      }),
    })
    .post('/api/import/official-docs', async ({ services, principal }) => {
      requireHttpPermission(principal, 'admin:access')
      const results: Array<{ path: string; created: boolean }> = []
      for (const source of officialDocumentationPages) {
        const result = unwrap(services.pages.upsertFromFile(source.path, {
          title: source.title,
          description: source.description,
          content: source.content,
        }, {
          labels: source.labels,
          status: source.status,
          locale: source.locale,
          navOrder: source.navOrder,
          pinned: source.path === 'docs/home',
        }, principal))
        await runPageWrite(pageWriteEffects, {
          action: result.created ? 'created' : 'updated', page: result.page, principal,
          auditAction: 'page.import_official_docs', automationType: result.created ? 'page.created' : 'page.updated',
          automationData: { source: 'bundled-official-docs', version: OFFICIAL_DOCS_VERSION }, previous: result.previous ?? null,
        })
        results.push({ path: result.page.path, created: result.created })
      }
      return { version: OFFICIAL_DOCS_VERSION, results }
    })
    .post('/api/import/bulk', async ({ body, services, principal }) => {
      requireHttpPermission(principal, 'page:write')
      const sources: Array<{ name: string; content: string }> = []
      for (const file of body.files) {
        if (file.name.toLowerCase().endsWith('.zip')) {
          const entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
          for (const [name, bytes] of Object.entries(entries)) {
            if (name.toLowerCase().endsWith('.md') && !name.includes('__MACOSX/')) sources.push({ name, content: strFromU8(bytes) })
          }
        } else if (file.name.toLowerCase().endsWith('.md')) {
          sources.push({ name: file.name, content: await file.text() })
        }
      }
      const results: Array<{ file: string; path: string; ok: boolean; error?: string }> = []
      for (const source of sources) {
        const path = normalizePath(source.name.replace(/^content\//, '').replace(/\.md$/i, ''))
        try {
          const parsed = parsePageFile(source.content)
          const result = unwrap(services.pages.upsertFromFile(path, parsed, {}, principal))
          await runPageWrite(pageWriteEffects, {
            action: result.created ? 'created' : 'updated', page: result.page, principal,
            auditAction: 'page.import_bulk', automationType: result.created ? 'page.created' : 'page.updated',
            automationData: { source: source.name }, previous: result.previous ?? null,
          })
          results.push({ file: source.name, path: result.page.path, ok: true })
        } catch (error) {
          results.push({ file: source.name, path, ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      }
      return { results }
    }, { body: t.Object({ files: t.Files() }) })
    .post(
      '/api/import/markdown',
      async ({ body, services, principal }) => {
        requireHttpPermission(principal, 'page:write', { path: body.path })
        const parsed = parsePageFile(body.content)
        const result = unwrap(services.pages.upsertFromFile(body.path, parsed, {
          title: body.title,
          description: body.description,
          icon: body.icon,
          coverUrl: body.coverUrl,
          coverPosition: body.coverPosition,
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
          icon: t.Optional(t.String()),
          coverUrl: t.Optional(t.String()),
          coverPosition: t.Optional(t.String()),
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
