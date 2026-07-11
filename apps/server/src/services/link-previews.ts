import { eq } from 'drizzle-orm'
import {
  err,
  forbidden,
  type AppError,
  type Principal,
  type Result,
  ok,
  requirePermission,
  validationError,
} from '@kawaii-wiki/core'
import type { DB } from '../db/client.ts'
import { linkPreviews, type LinkPreviewRow } from '../db/schema.ts'
import type { WebhookFetcher, WebhookHostnameResolver } from './webhooks.ts'
import {
  defaultFetcher,
  defaultResolver,
  ensurePublicLiteralTarget,
  hostnameForValidation,
  isPrivateOrReservedAddress,
} from './webhooks/shared.ts'

export interface LinkPreviewView {
  readonly url: string
  readonly provider: string
  readonly title: string
  readonly description: string
  readonly image: string | null
  readonly author: string | null
  readonly siteName: string | null
  readonly contentType: string | null
  readonly fetchedAt: number
  readonly expiresAt: number
}

export interface YoutubeLatestVideo {
  readonly id: string
  readonly title: string
  readonly url: string
  readonly author: string
  readonly publishedAt: string
  readonly thumbnail: string | null
}

export interface YoutubeLatestView {
  readonly channelId: string
  readonly videos: YoutubeLatestVideo[]
  readonly fetchedAt: number
  readonly expiresAt: number
}

export interface LinkPreviewService {
  unfurl(principal: Principal | null, url: string): Promise<Result<LinkPreviewView, AppError>>
  youtubeLatest(
    principal: Principal | null,
    channelId: string,
    limit?: number,
  ): Promise<Result<YoutubeLatestView, AppError>>
}

export interface LinkPreviewOptions {
  readonly fetcher?: WebhookFetcher
  readonly resolver?: WebhookHostnameResolver
  readonly now?: () => number
}

interface FetchedText {
  readonly url: string
  readonly contentType: string | null
  readonly text: string
}

const MAX_REDIRECTS = 5
const MAX_PREVIEW_BYTES = 512 * 1024
const MAX_RSS_BYTES = 1024 * 1024
const UNFURL_TTL_MS = 24 * 60 * 60 * 1000
const YOUTUBE_LATEST_TTL_MS = 30 * 60 * 1000
const TRACKING_PARAMS = new Set(['fbclid', 'gclid', 'igshid', 'mc_cid', 'mc_eid'])

const canUsePreview = (principal: Principal | null): Result<true, AppError> =>
  requirePermission(principal, 'page:write')

const decodeEntities = (value: string): string =>
  value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')

const truncate = (value: string, limit: number): string =>
  value.trim().replace(/\s+/g, ' ').slice(0, limit)

const cleanHttpUrl = (value: string, field = 'url'): Result<string, AppError> => {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return err(validationError('URL must use http or https', field))
    }
    for (const key of url.searchParams.keys()) {
      if (key.toLowerCase().startsWith('utm_') || TRACKING_PARAMS.has(key.toLowerCase())) {
        url.searchParams.delete(key)
      }
    }
    url.hash = ''
    return ok(url.toString())
  } catch {
    return err(validationError('URL is invalid', field))
  }
}

const resolveSafeUrl = (value: string, baseUrl: string): string | null => {
  try {
    const url = new URL(value, baseUrl)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

const providerForUrl = (value: string): string => {
  try {
    const host = new URL(value).hostname.replace(/^www\./, '').toLowerCase()
    if (host === 'youtu.be' || host.endsWith('youtube.com')) return 'youtube'
    if (host.endsWith('twitch.tv')) return 'twitch'
    if (host === 'x.com' || host.endsWith('twitter.com')) return 'x'
    if (host.endsWith('pixiv.net')) return 'pixiv'
    if (host.endsWith('booth.pm')) return 'booth'
    return host
  } catch {
    return ''
  }
}

const attrValue = (tag: string, name: string): string | null => {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  return decodeEntities((match?.[2] ?? match?.[3] ?? match?.[4] ?? '').trim()) || null
}

const metaContent = (html: string): Map<string, string> => {
  const out = new Map<string, string>()
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0] ?? ''
    const key = attrValue(tag, 'property') ?? attrValue(tag, 'name')
    const content = attrValue(tag, 'content')
    if (key && content && !out.has(key.toLowerCase())) out.set(key.toLowerCase(), content)
  }
  return out
}

const titleTag = (html: string): string =>
  decodeEntities(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, '') ?? '')

const oembedUrl = (html: string, baseUrl: string): string | null => {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0] ?? ''
    const type = attrValue(tag, 'type')?.toLowerCase()
    if (type !== 'application/json+oembed' && type !== 'text/json+oembed') continue
    const href = attrValue(tag, 'href')
    if (!href) continue
    const resolved = resolveSafeUrl(href, baseUrl)
    if (resolved) return resolved
  }
  return null
}

const parseJson = (value: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

const firstString = (...values: unknown[]): string =>
  values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim() ?? ''

const safeImage = (value: string, baseUrl: string): string | null => {
  if (!value) return null
  return resolveSafeUrl(value, baseUrl)
}

const RESTRICTED_META = /(?:^|\b)(r-?18|18\+|adult|explicit|mature|nsfw|restricted)(?:\b|$)/i

const hasRestrictedRating = (meta: Map<string, string>): boolean => {
  for (const [key, value] of meta) {
    const normalizedKey = key.toLowerCase()
    if (
      normalizedKey.includes('rating')
      || normalizedKey.includes('adult')
      || normalizedKey.includes('content_warning')
      || normalizedKey.includes('content-warning')
      || normalizedKey.includes('sensitive')
    ) {
      if (RESTRICTED_META.test(value)) return true
    }
  }
  return false
}

const readLimitedText = async (response: Response, maxBytes: number): Promise<Result<string, AppError>> => {
  if (!response.body) {
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      return err(validationError('URL response is too large', 'url'))
    }
    return ok(text)
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined)
      return err(validationError('URL response is too large', 'url'))
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return ok(new TextDecoder().decode(bytes))
}

const cachedUnfurl = (row: LinkPreviewRow, now: number): LinkPreviewView | null => {
  if (row.kind !== 'unfurl' || row.expiresAt <= now) return null
  return {
    url: row.url,
    provider: row.provider,
    title: row.title,
    description: row.description,
    image: row.image,
    author: row.author,
    siteName: row.siteName,
    contentType: row.contentType,
    fetchedAt: row.fetchedAt,
    expiresAt: row.expiresAt,
  }
}

const cachedYoutubeLatest = (row: LinkPreviewRow, channelId: string, limit: number, now: number): YoutubeLatestView | null => {
  if (row.kind !== 'youtube-latest' || row.expiresAt <= now) return null
  const data = parseJson(row.data)
  const videos = Array.isArray(data.videos) ? data.videos : []
  return {
    channelId,
    videos: videos
      .filter((video): video is YoutubeLatestVideo =>
        Boolean(
          video
          && typeof video === 'object'
          && typeof (video as YoutubeLatestVideo).id === 'string'
          && typeof (video as YoutubeLatestVideo).title === 'string',
        ),
      )
      .slice(0, limit),
    fetchedAt: row.fetchedAt,
    expiresAt: row.expiresAt,
  }
}

export const createLinkPreviewService = (db: DB, options: LinkPreviewOptions = {}): LinkPreviewService => {
  const fetcher = options.fetcher ?? defaultFetcher
  const resolver = options.resolver ?? defaultResolver
  const now = options.now ?? (() => Date.now())

  const assertPublicTarget = async (url: URL): Promise<Result<string, AppError>> => {
    const publicLiteral = ensurePublicLiteralTarget(url)
    if (!publicLiteral.ok) return publicLiteral
    const hostname = hostnameForValidation(url)
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(':')) return ok(hostname)
    const addresses = await resolver(hostname)
    if (!addresses.length) return err(validationError(`Hostname ${hostname} did not resolve`, 'url'))
    const blocked = addresses.find(isPrivateOrReservedAddress)
    if (blocked) return err(validationError(`Hostname ${hostname} resolved to blocked address`, 'url'))
    return ok(addresses[0]!)
  }

  const fetchText = async (urlValue: string, maxBytes: number): Promise<Result<FetchedText, AppError>> => {
    let url = new URL(urlValue)
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const publicTarget = await assertPublicTarget(url)
      if (!publicTarget.ok) return publicTarget
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)
      let response: Response
      try {
        response = await fetcher(url.toString(), {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            accept: 'text/html,application/xhtml+xml,application/xml,text/xml,application/json;q=0.9,*/*;q=0.1',
            'user-agent': 'kawaii-wiki.ts-link-preview/1',
          },
        }, { address: publicTarget.value })
      } catch (error) {
        return err(validationError(error instanceof Error ? error.message : 'Could not fetch URL', 'url'))
      } finally {
        clearTimeout(timeout)
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location')
        if (!location) return err(validationError('Redirect missing Location header', 'url'))
        if (redirects === MAX_REDIRECTS) return err(validationError('URL exceeded redirect limit', 'url'))
        try {
          url = new URL(location, url)
        } catch {
          return err(validationError('Redirect URL is invalid', 'url'))
        }
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          return err(validationError('Redirect URL must use http or https', 'url'))
        }
        continue
      }
      if (!response.ok) return err(validationError(`URL returned HTTP ${response.status}`, 'url'))
      const contentType = response.headers.get('content-type')
      const text = await readLimitedText(response, maxBytes)
      if (!text.ok) return text
      return ok({ url: url.toString(), contentType, text: text.value })
    }
    return err(validationError('URL exceeded redirect limit', 'url'))
  }

  const saveRow = (row: LinkPreviewRow): void => {
    db.insert(linkPreviews)
      .values(row)
      .onConflictDoUpdate({
        target: linkPreviews.url,
        set: {
          kind: row.kind,
          provider: row.provider,
          title: row.title,
          description: row.description,
          image: row.image,
          author: row.author,
          siteName: row.siteName,
          contentType: row.contentType,
          data: row.data,
          fetchedAt: row.fetchedAt,
          expiresAt: row.expiresAt,
        },
      })
      .run()
  }

  const fetchOembed = async (url: string): Promise<Record<string, unknown>> => {
    const fetched = await fetchText(url, MAX_PREVIEW_BYTES)
    if (!fetched.ok) return {}
    return parseJson(fetched.value.text)
  }

  const buildUnfurl = async (cleanUrl: string): Promise<Result<LinkPreviewView, AppError>> => {
    const fetched = await fetchText(cleanUrl, MAX_PREVIEW_BYTES)
    if (!fetched.ok) return fetched
    const meta = metaContent(fetched.value.text)
    const oembed = oembedUrl(fetched.value.text, fetched.value.url)
    const oembedData = oembed ? await fetchOembed(oembed) : {}
    const baseUrl = fetched.value.url
    const title = truncate(firstString(
      oembedData.title,
      meta.get('og:title'),
      meta.get('twitter:title'),
      titleTag(fetched.value.text),
      baseUrl,
    ), 240)
    const description = truncate(firstString(
      oembedData.description,
      meta.get('og:description'),
      meta.get('twitter:description'),
      meta.get('description'),
    ), 500)
    const provider = providerForUrl(baseUrl)
    const image = hasRestrictedRating(meta)
      ? null
      : safeImage(firstString(oembedData.thumbnail_url, meta.get('og:image'), meta.get('twitter:image')), baseUrl)
    const author = truncate(firstString(oembedData.author_name, meta.get('article:author'), meta.get('twitter:creator')), 160) || null
    const siteName = truncate(firstString(meta.get('og:site_name'), oembedData.provider_name), 160) || null
    const fetchedAt = now()
    const preview: LinkPreviewView = {
      url: cleanUrl,
      provider,
      title: title || cleanUrl,
      description,
      image,
      author,
      siteName,
      contentType: fetched.value.contentType,
      fetchedAt,
      expiresAt: fetchedAt + UNFURL_TTL_MS,
    }
    saveRow({
      ...preview,
      kind: 'unfurl',
      data: JSON.stringify({ oembed: Boolean(oembed), finalUrl: baseUrl }),
    })
    return ok(preview)
  }

  const parseYoutubeFeed = (xml: string, limit: number): YoutubeLatestVideo[] => {
    const videos: YoutubeLatestVideo[] = []
    for (const match of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
      const entry = match[1] ?? ''
      const id = decodeEntities(entry.match(/<yt:videoId>([\s\S]*?)<\/yt:videoId>/i)?.[1] ?? '').trim()
      const title = decodeEntities(entry.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim()
      const link = entry.match(/<link\b[^>]*href=(?:"([^"]+)"|'([^']+)')/i)
      const author = decodeEntities(entry.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/i)?.[1] ?? '').trim()
      const publishedAt = decodeEntities(entry.match(/<published>([\s\S]*?)<\/published>/i)?.[1] ?? '').trim()
      const thumbnail = entry.match(/<media:thumbnail\b[^>]*url=(?:"([^"]+)"|'([^']+)')/i)
      if (!id || !title) continue
      videos.push({
        id,
        title,
        url: decodeEntities((link?.[1] ?? link?.[2] ?? `https://www.youtube.com/watch?v=${id}`).trim()),
        author,
        publishedAt,
        thumbnail: thumbnail ? decodeEntities((thumbnail[1] ?? thumbnail[2] ?? '').trim()) : null,
      })
      if (videos.length >= limit) break
    }
    return videos
  }

  return {
    async unfurl(principal, url) {
      const allowed = canUsePreview(principal)
      if (!allowed.ok) return err(forbidden('Only editors can fetch link previews'))
      const clean = cleanHttpUrl(url)
      if (!clean.ok) return clean
      const row = db.select().from(linkPreviews).where(eq(linkPreviews.url, clean.value)).get()
      const cached = row ? cachedUnfurl(row, now()) : null
      if (cached) return ok(cached)
      return buildUnfurl(clean.value)
    },

    async youtubeLatest(_principal, channelId, inputLimit = 6) {
      const cleanChannelId = channelId.trim()
      if (!/^UC[A-Za-z0-9_-]{10,}$/.test(cleanChannelId)) {
        return err(validationError('YouTube channel ID must start with UC', 'channelId'))
      }
      const limit = Math.max(1, Math.min(Math.trunc(inputLimit), 12))
      const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(cleanChannelId)}`
      const row = db.select().from(linkPreviews).where(eq(linkPreviews.url, feedUrl)).get()
      const cached = row ? cachedYoutubeLatest(row, cleanChannelId, limit, now()) : null
      if (cached) return ok(cached)

      const fetched = await fetchText(feedUrl, MAX_RSS_BYTES)
      if (!fetched.ok) return fetched
      const videos = parseYoutubeFeed(fetched.value.text, 12)
      const fetchedAt = now()
      const view: YoutubeLatestView = {
        channelId: cleanChannelId,
        videos: videos.slice(0, limit),
        fetchedAt,
        expiresAt: fetchedAt + YOUTUBE_LATEST_TTL_MS,
      }
      saveRow({
        url: feedUrl,
        kind: 'youtube-latest',
        provider: 'youtube',
        title: `YouTube latest videos: ${cleanChannelId}`,
        description: '',
        image: videos[0]?.thumbnail ?? null,
        author: videos[0]?.author || null,
        siteName: 'YouTube',
        contentType: fetched.value.contentType,
        data: JSON.stringify({ channelId: cleanChannelId, videos }),
        fetchedAt: view.fetchedAt,
        expiresAt: view.expiresAt,
      })
      return ok(view)
    },
  }
}
