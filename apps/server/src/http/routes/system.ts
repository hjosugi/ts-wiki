import { t } from 'elysia'
import type { Principal, PublicSettings } from '@ts-wiki/core'
import type { Env } from '../../env.ts'
import type { Services } from '../../services/index.ts'
import type { PageSummary, RecentChange } from '../../services/pages.ts'
import type { BaseApp } from '../base.ts'
import { unwrap } from '../errors.ts'

const FEED_CACHE_TTL_MS = 60_000

const xmlEscape = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const atomDate = (ms: number): string => new Date(ms).toISOString()

const absolutePageUrl = (origin: string, path: string): string =>
  `${origin.replace(/\/+$/, '')}/${path.split('/').map(encodeURIComponent).join('/')}`

const atomFeedXml = ({
  changes,
  origin,
  siteName,
}: {
  readonly changes: RecentChange[]
  readonly origin: string
  readonly siteName: string
}): string => {
  const base = origin.replace(/\/+$/, '')
  const feedUrl = `${base}/feed.xml`
  const updated = atomDate(changes[0]?.createdAt ?? Date.now())
  const entries = changes.map((change) => {
    const pageUrl = absolutePageUrl(base, change.path)
    const title = `${change.title || change.path} ${change.action}`
    const summary = `${change.action} /${change.path}${change.authorName ? ` by ${change.authorName}` : ''}`
    return [
      '  <entry>',
      `    <title>${xmlEscape(title)}</title>`,
      `    <link href="${xmlEscape(pageUrl)}" />`,
      `    <id>${xmlEscape(`${pageUrl}#revision-${change.id}`)}</id>`,
      `    <updated>${atomDate(change.createdAt)}</updated>`,
      `    <author><name>${xmlEscape(change.authorName ?? siteName)}</name></author>`,
      `    <summary>${xmlEscape(summary)}</summary>`,
      '  </entry>',
    ].join('\n')
  }).join('\n')

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <title>${xmlEscape(`${siteName} recent changes`)}</title>`,
    `  <id>${xmlEscape(feedUrl)}</id>`,
    `  <link rel="self" href="${xmlEscape(feedUrl)}" />`,
    `  <link href="${xmlEscape(base)}" />`,
    `  <updated>${updated}</updated>`,
    `  <author><name>${xmlEscape(siteName)}</name></author>`,
    entries,
    '</feed>',
  ].filter(Boolean).join('\n')
}

const sitemapXml = (pages: PageSummary[], origin: string): string => {
  const base = origin.replace(/\/+$/, '')
  const urls = pages.map((page) => [
    '  <url>',
    `    <loc>${xmlEscape(absolutePageUrl(base, page.path))}</loc>`,
    `    <lastmod>${atomDate(page.updatedAt)}</lastmod>`,
    '  </url>',
  ].join('\n')).join('\n')
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    '</urlset>',
  ].filter(Boolean).join('\n')
}

const robotsTxt = (origin: string, privateWiki: boolean): string =>
  privateWiki
    ? 'User-agent: *\nDisallow: /\n'
    : `User-agent: *\nAllow: /\nSitemap: ${origin.replace(/\/+$/, '')}/sitemap.xml\n`

export interface SystemRoutesContext {
  readonly env: Env
  readonly services: Services
  readonly publicSettings: () => PublicSettings
  readonly feedCache: Map<string, { createdAt: number; xml: string }>
  readonly requirePageRead: (principal: Principal | null, path?: string) => void
  readonly canReadPage: (principal: Principal | null, path?: string) => boolean
}

export const createSystemRoutes = ({
  env,
  services,
  publicSettings,
  feedCache,
  requirePageRead,
  canReadPage,
}: SystemRoutesContext) => (app: BaseApp) => {
  const feedResponse = (principal: Principal | null): Response => {
    requirePageRead(principal)
    const cacheKey = principal ? `user:${principal.id}` : 'anonymous'
    const cached = feedCache.get(cacheKey)
    const now = Date.now()
    if (cached && now - cached.createdAt < FEED_CACHE_TTL_MS) {
      return new Response(cached.xml, {
        headers: {
          'content-type': 'application/atom+xml; charset=utf-8',
          'cache-control': `${principal ? 'private' : 'public'}, max-age=60`,
        },
      })
    }

    const changes = services.pages
      .recentChanges(50)
      .filter((change) => canReadPage(principal, change.path))
    const xml = atomFeedXml({
      changes,
      origin: env.auth.publicOrigin,
      siteName: env.auth.siteName,
    })
    feedCache.set(cacheKey, { createdAt: now, xml })
    return new Response(xml, {
      headers: {
        'content-type': 'application/atom+xml; charset=utf-8',
        'cache-control': `${principal ? 'private' : 'public'}, max-age=60`,
      },
    })
  }

  const sitemapResponse = (): Response => {
    if (publicSettings().privateWiki) return new Response('Not found', { status: 404 })
    const publicPages = services.pages
      .list()
      .filter((page) => canReadPage(null, page.path))
    return new Response(sitemapXml(publicPages, env.auth.publicOrigin), {
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        'cache-control': 'public, max-age=300',
      },
    })
  }

  const robotsResponse = (): Response =>
    new Response(robotsTxt(env.auth.publicOrigin, publicSettings().privateWiki), {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'public, max-age=300',
      },
    })

  return app
    .get('/api/health', () => ({ ok: true as const, name: 'ts-wiki', version: '0.4.20' }))
    .get('/api/settings/public', () => publicSettings())
    .get(
      '/api/unfurl',
      async ({ query, services, principal }) => ({
        preview: unwrap(await services.linkPreviews.unfurl(principal, query.url)),
      }),
      { query: t.Object({ url: t.String() }) },
    )
    .get(
      '/api/youtube/latest',
      async ({ query, services, principal }) => {
        requirePageRead(principal)
        return {
          channel: unwrap(await services.linkPreviews.youtubeLatest(principal, query.channelId, query.limit)),
        }
      },
      {
        query: t.Object({
          channelId: t.String(),
          limit: t.Optional(t.Numeric()),
        }),
      },
    )
    .get('/feed.xml', ({ principal }) => feedResponse(principal))
    .get('/sitemap.xml', () => sitemapResponse())
    .get('/robots.txt', () => robotsResponse())
}
