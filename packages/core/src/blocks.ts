/** Safe renderer implementations for typed Markdown fence blocks. */
import type MarkdownIt from 'markdown-it'
import { slugifyHeading } from './slug.ts'

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const escapeAttr = (value: string): string => escapeHtml(value).replace(/'/g, '&#39;')

const CALLOUT_KEYS = new Set(['type', 'title'])
const EMBED_KEYS = new Set(['url', 'title', 'description', 'image', 'site', 'author', 'provider'])
const YOUTUBE_KEYS = new Set(['url', 'id', 'title'])
const TWITCH_KEYS = new Set(['url', 'channel', 'video', 'clip', 'title'])
const YOUTUBE_LATEST_KEYS = new Set(['channel', 'channelid', 'limit', 'title'])
const HERO_KEYS = new Set(['title', 'subtitle', 'eyebrow', 'image', 'align'])
const PAGES_KEYS = new Set(['title', 'paths', 'limit'])
const RECENT_KEYS = new Set(['title', 'limit'])
const POPULAR_KEYS = new Set(['title', 'limit', 'days'])

const parseKeyedBlock = (
  content: string,
  keys: ReadonlySet<string>,
): { fields: Map<string, string>; body: string } => {
  const fields = new Map<string, string>()
  const body: string[] = []
  let inBody = false

  for (const line of content.split(/\r?\n/)) {
    const match = !inBody ? line.match(/^([A-Za-z][A-Za-z_-]*):\s*(.*)$/) : null
    const key = match?.[1]?.toLowerCase().replace(/-/g, '')
    if (match && key && keys.has(key)) {
      fields.set(key, match[2]!.trim())
      continue
    }
    inBody = true
    body.push(line)
  }

  return { fields, body: body.join('\n').trim() }
}

/** Slugify a callout type to a safe CSS-class suffix (`info`, `note`, `my-tip`). */
const calloutType = (raw: string | undefined): string => {
  const slug = (raw ?? 'info')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'info'
}

const renderCalloutBlock = (content: string, renderer: MarkdownIt): string => {
  const { fields, body } = parseKeyedBlock(content, CALLOUT_KEYS)
  // Callout types are open-ended: the four built-ins have styles, and any other
  // name emits `wiki-callout-<name>` for custom theming (unknown → neutral base
  // style, not silently coerced to info).
  const type = calloutType(fields.get('type'))
  const title = fields.get('title') ?? type
  const renderedBody = body ? renderer.render(body) : ''

  return `<aside class="wiki-callout wiki-callout-${escapeAttr(type)}">
    <div class="wiki-callout-title">${escapeHtml(title)}</div>
    ${renderedBody ? `<div class="wiki-callout-body">${renderedBody}</div>` : ''}
  </aside>`
}

const isSafeMediaUrl = (url: string): boolean => /^https?:\/\//i.test(url) || url.startsWith('/')

interface InfoboxField {
  readonly label: string
  readonly value: string
}

// `Label: value` where the label is a short word/phrase (letters first). The
// required whitespace after the colon keeps bare URLs (`https://…`) out.
const INFOBOX_FIELD = /^([A-Za-z][\w -]{0,39}):(?:[ \t]+(.*))?$/

interface InfoboxData {
  readonly title?: string
  readonly image?: string
  readonly caption?: string
  readonly fields: InfoboxField[]
  readonly body: string
}

/**
 * Parse a generic infobox: a few special keys (`title`, `image`,
 * `caption`/`subtitle`) plus arbitrary `Label: value` fields in source order,
 * then an optional free-form body after a blank or non-field line.
 */
const parseInfobox = (content: string): InfoboxData => {
  let title: string | undefined
  let image: string | undefined
  let caption: string | undefined
  const fields: InfoboxField[] = []
  const body: string[] = []
  let inBody = false
  let started = false

  for (const line of content.split(/\r?\n/)) {
    if (inBody) {
      body.push(line)
      continue
    }
    if (line.trim() === '') {
      if (started) inBody = true
      continue
    }
    const match = line.match(INFOBOX_FIELD)
    if (!match) {
      inBody = true
      body.push(line)
      continue
    }
    started = true
    const label = match[1]!.trim()
    const value = (match[2] ?? '').trim()
    const key = label.toLowerCase().replace(/\s+/g, '')
    if (key === 'title') title = value
    else if (key === 'image') image = value
    else if (key === 'caption' || key === 'subtitle') caption = value
    else fields.push({ label, value })
  }

  return { title, image, caption, fields, body: body.join('\n').trim() }
}

/**
 * A reusable infobox/profile card (Wikipedia-style). Generic key/value fields
 * make it work for talent profiles, game characters, projects, etc. Field
 * values and title/caption render as inline Markdown so links and emphasis work.
 */
const renderInfoboxBlock = (content: string, renderer: MarkdownIt): string => {
  const { title, image, caption, fields, body } = parseInfobox(content)
  const parts: string[] = []
  if (image && isSafeMediaUrl(image)) {
    parts.push(
      `<div class="wiki-infobox-media"><img src="${escapeAttr(image)}" alt="${escapeAttr(title ?? '')}" loading="lazy" /></div>`,
    )
  }
  if (title) parts.push(`<div class="wiki-infobox-title">${renderer.renderInline(title)}</div>`)
  if (caption) parts.push(`<div class="wiki-infobox-caption">${renderer.renderInline(caption)}</div>`)
  if (fields.length) {
    const rows = fields
      .map((f) => `<div class="wiki-infobox-row"><dt>${escapeHtml(f.label)}</dt><dd>${renderer.renderInline(f.value)}</dd></div>`)
      .join('')
    parts.push(`<dl class="wiki-infobox-fields">${rows}</dl>`)
  }
  if (body) parts.push(`<div class="wiki-infobox-body">${renderer.render(body)}</div>`)
  return `<aside class="wiki-infobox">${parts.join('')}</aside>`
}

interface SocialProvider {
  readonly name: string
  readonly cls: string
}

// Host → provider mapping for the links/social block. Order doesn't matter; each
// pattern anchors to the registrable domain so subdomains (www., m.) still match.
const SOCIAL_PROVIDERS: ReadonlyArray<readonly [RegExp, SocialProvider]> = [
  [/(?:^|\.)youtube\.com$|(?:^|\.)youtu\.be$/, { name: 'YouTube', cls: 'youtube' }],
  [/(?:^|\.)twitch\.tv$/, { name: 'Twitch', cls: 'twitch' }],
  [/(?:^|\.)(?:x|twitter)\.com$/, { name: 'X', cls: 'x' }],
  [/(?:^|\.)pixiv\.net$/, { name: 'pixiv', cls: 'pixiv' }],
  [/(?:^|\.)booth\.pm$/, { name: 'BOOTH', cls: 'booth' }],
  [/(?:^|\.)nicovideo\.jp$|(?:^|\.)nico\.ms$/, { name: 'niconico', cls: 'niconico' }],
  [/(?:^|\.)twitcasting\.tv$/, { name: 'TwitCasting', cls: 'twitcasting' }],
  [/(?:^|\.)discord\.(?:gg|com)$/, { name: 'Discord', cls: 'discord' }],
  [/(?:^|\.)instagram\.com$/, { name: 'Instagram', cls: 'instagram' }],
  [/(?:^|\.)tiktok\.com$/, { name: 'TikTok', cls: 'tiktok' }],
  [/(?:^|\.)note\.com$/, { name: 'note', cls: 'note' }],
  [/(?:^|\.)github\.com$/, { name: 'GitHub', cls: 'github' }],
]

const hostnameOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

const detectProvider = (url: string): SocialProvider | null => {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
  for (const [pattern, provider] of SOCIAL_PROVIDERS) {
    if (pattern.test(host)) return provider
  }
  return null
}

const LINKS_MD_LINK = /^\[([^\]]+)\]\(([^)]+)\)$/

/**
 * A row of link buttons (lit.link-style). Each line is a Markdown link
 * `[Label](url)` or a bare `url`; known social hosts get a branded style and a
 * default label. Only http(s) URLs render. Used for `links` and `social` fences.
 */
const renderLinksBlock = (content: string): string | null => {
  const items: string[] = []
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const match = line.match(LINKS_MD_LINK)
    const label = match ? match[1]!.trim() : undefined
    const url = (match ? match[2]! : line).trim()
    if (!/^https?:\/\//i.test(url)) continue
    const provider = detectProvider(url)
    const text = label || provider?.name || hostnameOf(url)
    const cls = provider ? ` wiki-links-${provider.cls}` : ''
    items.push(
      `<a class="wiki-links-item${cls}" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`,
    )
  }
  return items.length ? `<div class="wiki-links">${items.join('')}</div>` : null
}

const renderEmbedBlock = (content: string): string | null => {
  const { fields } = parseKeyedBlock(content, EMBED_KEYS)
  const url = fields.get('url')
  if (!url || !/^https?:\/\//i.test(url)) return null
  const title = fields.get('title') || url
  const description = fields.get('description')
  const image = fields.get('image')
  const site = fields.get('site')
  const author = fields.get('author')
  const detected = detectProvider(url)
  const provider = (fields.get('provider') || detected?.cls || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const classes = ['wiki-embed', provider ? `wiki-embed-${provider}` : ''].filter(Boolean).join(' ')
  const safeImage = image && (/^https?:\/\//i.test(image) || image.startsWith('/')) ? image : null
  const meta = [site || detected?.name, author].filter(Boolean).join(' · ')

  return `<a class="${escapeAttr(classes)}" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">
    ${safeImage ? `<span class="wiki-embed-media"><img src="${escapeAttr(safeImage)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>` : ''}
    <span class="wiki-embed-body">
      ${meta ? `<span class="wiki-embed-meta">${escapeHtml(meta)}</span>` : ''}
      <span class="wiki-embed-title">${escapeHtml(title)}</span>
      ${description ? `<span class="wiki-embed-description">${escapeHtml(description)}</span>` : ''}
      <span class="wiki-embed-url">${escapeHtml(url)}</span>
    </span>
  </a>`
}

const youtubeIdFromUrl = (url: string): string | null => {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    if (host === 'youtu.be') return cleanYoutubeId(parsed.pathname.slice(1).split('/')[0] ?? '')
    if (!/(^|\.)youtube\.com$/.test(host)) return null
    const path = parsed.pathname.split('/').filter(Boolean)
    if (parsed.pathname === '/watch') return cleanYoutubeId(parsed.searchParams.get('v') ?? '')
    if (path[0] === 'shorts' || path[0] === 'embed' || path[0] === 'live') return cleanYoutubeId(path[1] ?? '')
    return null
  } catch {
    return null
  }
}

const cleanYoutubeId = (value: string): string | null => {
  const trimmed = value.trim()
  return /^[A-Za-z0-9_-]{11}$/.test(trimmed) ? trimmed : null
}

const renderMediaCard = (
  provider: 'youtube' | 'twitch',
  title: string,
  label: string,
  href: string,
  attrs: Record<string, string>,
): string => {
  const dataAttrs = Object.entries(attrs)
    .map(([key, value]) => ` data-${key}="${escapeAttr(value)}"`)
    .join('')
  return `<section class="wiki-media-card wiki-media-${provider}" data-wiki-media="${provider}"${dataAttrs}>
    <div class="wiki-media-preview" aria-hidden="true">
      <span>${escapeHtml(provider === 'youtube' ? 'YouTube' : 'Twitch')}</span>
    </div>
    <div class="wiki-media-body">
      <p class="wiki-media-kicker">${escapeHtml(provider === 'youtube' ? 'YouTube embed' : 'Twitch embed')}</p>
      <h3>${escapeHtml(title)}</h3>
      <p class="wiki-media-note">External player loads only after activation.</p>
      <div class="wiki-media-actions">
        <button type="button" data-wiki-media-load="${provider}">Load ${escapeHtml(label)}</button>
        <a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">Open on ${escapeHtml(provider === 'youtube' ? 'YouTube' : 'Twitch')}</a>
      </div>
    </div>
  </section>`
}

const renderYoutubeBlock = (content: string): string | null => {
  const { fields, body } = parseKeyedBlock(content, YOUTUBE_KEYS)
  const candidate = fields.get('url') ?? fields.get('id') ?? body.split(/\s+/).find(Boolean) ?? ''
  const id = /^https?:\/\//i.test(candidate) ? youtubeIdFromUrl(candidate) : cleanYoutubeId(candidate)
  if (!id) return null
  const href = `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`
  const embedSrc = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`
  const title = fields.get('title') || `YouTube video ${id}`
  return renderMediaCard('youtube', title, 'video', href, {
    provider: 'youtube',
    'video-id': id,
    'source-url': embedSrc,
    'embed-host': 'www.youtube-nocookie.com',
  })
}

const renderYoutubeLatestBlock = (content: string): string | null => {
  const { fields, body } = parseKeyedBlock(content, YOUTUBE_LATEST_KEYS)
  const channelId = (fields.get('channelid') ?? fields.get('channel') ?? body.split(/\s+/).find(Boolean) ?? '').trim()
  if (!/^UC[A-Za-z0-9_-]{10,}$/.test(channelId)) return null
  const rawLimit = Number.parseInt(fields.get('limit') ?? '', 10)
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 12)) : 6
  const title = fields.get('title') || 'Latest YouTube videos'
  return `<section class="wiki-youtube-latest" data-youtube-latest data-channel-id="${escapeAttr(channelId)}" data-limit="${String(limit)}">
    <div class="wiki-youtube-latest-header">
      <p class="wiki-media-kicker">YouTube RSS</p>
      <h3>${escapeHtml(title)}</h3>
    </div>
    <div class="wiki-youtube-latest-items" data-youtube-latest-items>
      <p class="wiki-media-note">Loading latest videos...</p>
    </div>
  </section>`
}

interface TwitchSource {
  readonly kind: 'channel' | 'video' | 'clip'
  readonly value: string
  readonly href: string
}

const cleanTwitchValue = (value: string): string | null => {
  const trimmed = value.trim().replace(/^@/, '')
  return /^[A-Za-z0-9_-]{1,80}$/.test(trimmed) ? trimmed : null
}

const twitchSourceFromUrl = (url: string): TwitchSource | null => {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    if (!/(^|\.)twitch\.tv$/.test(host)) return null
    const path = parsed.pathname.split('/').filter(Boolean)
    if (host === 'clips.twitch.tv') {
      const value = cleanTwitchValue(path[0] ?? '')
      return value ? { kind: 'clip', value, href: `https://clips.twitch.tv/${value}` } : null
    }
    if (path[0] === 'videos') {
      const value = cleanTwitchValue(path[1] ?? '')
      return value ? { kind: 'video', value, href: `https://www.twitch.tv/videos/${value}` } : null
    }
    if (path[1] === 'clip') {
      const value = cleanTwitchValue(path[2] ?? '')
      return value ? { kind: 'clip', value, href: `https://www.twitch.tv/${path[0]}/clip/${value}` } : null
    }
    const value = cleanTwitchValue(path[0] ?? '')
    return value ? { kind: 'channel', value, href: `https://www.twitch.tv/${value}` } : null
  } catch {
    return null
  }
}

const twitchSourceFromFields = (fields: Map<string, string>, body: string): TwitchSource | null => {
  const url = fields.get('url')
  if (url) return twitchSourceFromUrl(url)
  const video = cleanTwitchValue(fields.get('video') ?? '')
  if (video) return { kind: 'video', value: video, href: `https://www.twitch.tv/videos/${video}` }
  const clip = cleanTwitchValue(fields.get('clip') ?? '')
  if (clip) return { kind: 'clip', value: clip, href: `https://clips.twitch.tv/${clip}` }
  const channel = cleanTwitchValue(fields.get('channel') ?? body.split(/\s+/).find(Boolean) ?? '')
  return channel ? { kind: 'channel', value: channel, href: `https://www.twitch.tv/${channel}` } : null
}

const renderTwitchBlock = (content: string): string | null => {
  const { fields, body } = parseKeyedBlock(content, TWITCH_KEYS)
  const source = twitchSourceFromFields(fields, body)
  if (!source) return null
  const title = fields.get('title') || `Twitch ${source.kind} ${source.value}`
  return renderMediaCard('twitch', title, source.kind, source.href, {
    provider: 'twitch',
    'source-type': source.kind,
    'source-id': source.value,
    'source-url': source.href,
    'parent-policy': 'current-host',
  })
}

const renderMermaidBlock = (content: string): string =>
  `<pre class="wiki-diagram wiki-mermaid"><code>${escapeHtml(content)}</code></pre>`

const hashString = (value: string): string => {
  let hash = 5381
  for (let i = 0; i < value.length; i += 1) hash = ((hash << 5) + hash) ^ value.charCodeAt(i)
  return (hash >>> 0).toString(36)
}

interface TabItem {
  readonly title: string
  readonly body: string
}

const TABS_HEADING = /^(#{1,6})\s+(.+?)\s*$/

const parseTabsBlock = (content: string): TabItem[] => {
  const tabs: Array<{ title: string; lines: string[] }> = []
  let current: { title: string; lines: string[] } | null = null

  for (const line of content.split(/\r?\n/)) {
    const heading = line.match(TABS_HEADING)
    if (heading) {
      if (current) tabs.push(current)
      current = { title: heading[2]!.trim(), lines: [] }
      continue
    }
    if (current) current.lines.push(line)
  }
  if (current) tabs.push(current)

  return tabs
    .map((tab) => ({ title: tab.title, body: tab.lines.join('\n').trim() }))
    .filter((tab) => tab.title)
}

const renderTabsBlock = (content: string, renderer: MarkdownIt): string | null => {
  const tabs = parseTabsBlock(content)
  if (!tabs.length) return null
  const baseId = `wiki-tabs-${hashString(content)}`
  const tabLinks = tabs.map((tab, index) => {
    const slug = slugifyHeading(tab.title) || `tab-${index + 1}`
    const tabId = `${baseId}-tab-${index}-${slug}`
    const panelId = `${baseId}-panel-${index}-${slug}`
    return `<a class="wiki-tab" id="${escapeAttr(tabId)}" href="#${escapeAttr(panelId)}" role="tab" aria-controls="${escapeAttr(panelId)}" aria-selected="${index === 0 ? 'true' : 'false'}">${renderer.renderInline(tab.title)}</a>`
  })
  const panels = tabs.map((tab, index) => {
    const slug = slugifyHeading(tab.title) || `tab-${index + 1}`
    const tabId = `${baseId}-tab-${index}-${slug}`
    const panelId = `${baseId}-panel-${index}-${slug}`
    const body = tab.body ? renderer.render(tab.body) : ''
    return `<section class="wiki-tab-panel" id="${escapeAttr(panelId)}" role="tabpanel" aria-labelledby="${escapeAttr(tabId)}">
      <h3>${renderer.renderInline(tab.title)}</h3>
      ${body}
    </section>`
  })
  return `<div class="wiki-tabs" data-wiki-tabs>
    <div class="wiki-tabs-list" role="tablist">${tabLinks.join('')}</div>
    <div class="wiki-tabs-panels">${panels.join('')}</div>
  </div>`
}

const cleanWidgetInt = (value: string | undefined, fallback: number, min: number, max: number): number => {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) ? Math.max(min, Math.min(parsed, max)) : fallback
}

const renderHeroBlock = (content: string, renderer: MarkdownIt): string | null => {
  const { fields, body } = parseKeyedBlock(content, HERO_KEYS)
  const title = fields.get('title')
  if (!title) return null
  const subtitle = fields.get('subtitle')
  const eyebrow = fields.get('eyebrow')
  const image = fields.get('image')
  const align = fields.get('align') === 'center' ? 'center' : 'left'
  const safeImage = image && isSafeMediaUrl(image) ? image : ''
  const renderedBody = body ? renderer.render(body) : ''
  return `<section class="wiki-landing-hero wiki-landing-hero-${escapeAttr(align)}">
    ${safeImage ? `<img class="wiki-landing-hero-image" src="${escapeAttr(safeImage)}" alt="" loading="lazy" />` : ''}
    <div class="wiki-landing-hero-body">
      ${eyebrow ? `<p class="wiki-landing-eyebrow">${escapeHtml(eyebrow)}</p>` : ''}
      <h2>${renderer.renderInline(title)}</h2>
      ${subtitle ? `<p class="wiki-landing-subtitle">${renderer.renderInline(subtitle)}</p>` : ''}
      ${renderedBody ? `<div class="wiki-landing-actions">${renderedBody}</div>` : ''}
    </div>
  </section>`
}

const cleanLandingPath = (value: string): string => {
  const raw = value.trim().replace(/^\/+/, '').split(/[?#]/)[0] ?? ''
  if (!raw || raw.startsWith('_') || raw.startsWith('assets/')) return ''
  return raw
    .split('/')
    .map((segment) => slugifyHeading(segment))
    .filter(Boolean)
    .join('/')
}

const WIDGET_MD_LINK = /^\[([^\]]+)\]\(([^)]+)\)$/

const parseWidgetPaths = (content: string, fields: Map<string, string>): string[] => {
  const values = [
    ...(fields.get('paths') ?? '').split(/[\s,]+/),
    ...content.split(/\r?\n/).flatMap((line) => {
      const trimmed = line.trim()
      if (!trimmed) return []
      const match = trimmed.match(WIDGET_MD_LINK)
      return [match ? match[2]! : trimmed]
    }),
  ]
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const path = cleanLandingPath(value)
    if (!path || seen.has(path)) continue
    seen.add(path)
    out.push(path)
  }
  return out.slice(0, 24)
}

const renderPagesWidgetBlock = (content: string): string | null => {
  const { fields, body } = parseKeyedBlock(content, PAGES_KEYS)
  const paths = parseWidgetPaths(body, fields)
  if (!paths.length) return null
  const title = fields.get('title') || 'Pages'
  const limit = cleanWidgetInt(fields.get('limit'), paths.length, 1, 24)
  return `<section class="wiki-page-widget" data-wiki-pages data-title="${escapeAttr(title)}" data-paths="${escapeAttr(JSON.stringify(paths.slice(0, limit)))}">
    <div class="wiki-page-widget-header"><h3>${escapeHtml(title)}</h3></div>
    <div class="wiki-page-grid" data-wiki-page-grid><p class="wiki-media-note">Loading pages...</p></div>
  </section>`
}

const renderRecentWidgetBlock = (content: string): string | null => {
  const { fields } = parseKeyedBlock(content, RECENT_KEYS)
  const title = fields.get('title') || 'Recent changes'
  const limit = cleanWidgetInt(fields.get('limit'), 6, 1, 20)
  return `<section class="wiki-page-widget" data-wiki-recent data-title="${escapeAttr(title)}" data-limit="${String(limit)}">
    <div class="wiki-page-widget-header"><h3>${escapeHtml(title)}</h3></div>
    <div class="wiki-activity-list" data-wiki-recent-items><p class="wiki-media-note">Loading recent changes...</p></div>
  </section>`
}

const renderPopularWidgetBlock = (content: string): string | null => {
  const { fields } = parseKeyedBlock(content, POPULAR_KEYS)
  const title = fields.get('title') || 'Popular pages'
  const limit = cleanWidgetInt(fields.get('limit'), 6, 1, 20)
  const days = cleanWidgetInt(fields.get('days'), 7, 1, 365)
  return `<section class="wiki-page-widget" data-wiki-popular data-title="${escapeAttr(title)}" data-limit="${String(limit)}" data-days="${String(days)}">
    <div class="wiki-page-widget-header"><h3>${escapeHtml(title)}</h3><p>${days} days</p></div>
    <div class="wiki-page-grid" data-wiki-popular-items><p class="wiki-media-note">Loading popular pages...</p></div>
  </section>`
}

export const renderBuiltInBlock = (info: string, content: string, renderer: MarkdownIt): string | null => {
  switch (info) {
    case 'callout': return renderCalloutBlock(content, renderer)
    case 'infobox':
    case 'profile': return renderInfoboxBlock(content, renderer)
    case 'links':
    case 'social': return renderLinksBlock(content)
    case 'embed': return renderEmbedBlock(content)
    case 'youtube': return renderYoutubeBlock(content)
    case 'youtube-latest': return renderYoutubeLatestBlock(content)
    case 'twitch': return renderTwitchBlock(content)
    case 'mermaid': return renderMermaidBlock(content)
    case 'tabs': return renderTabsBlock(content, renderer)
    case 'hero': return renderHeroBlock(content, renderer)
    case 'pages': return renderPagesWidgetBlock(content)
    case 'recent': return renderRecentWidgetBlock(content)
    case 'popular': return renderPopularWidgetBlock(content)
    default: return null
  }
}
