/**
 * Markdown rendering pipeline — isomorphic (runs in Bun on the server for
 * render-on-save, and in the browser for the live editor preview).
 *
 * Ported in spirit from Wiki.js's `ux/src/renderers/markdown.js`, but as a
 * single pure function returning both the HTML and a structured table of
 * contents, instead of mutating shared renderer state.
 */
import MarkdownIt from 'markdown-it'
import anchor from 'markdown-it-anchor'
import hljs from 'highlight.js'
import { slugifyHeading } from './slug.ts'

export interface TocEntry {
  readonly id: string
  readonly text: string
  readonly level: number
}

export interface RenderResult {
  readonly html: string
  readonly toc: TocEntry[]
}

export interface PageLink {
  readonly path: string
  readonly label: string
  readonly kind: 'wikilink' | 'markdown'
}

export interface CalendarEvent {
  readonly title: string
  readonly start: string
  readonly end?: string
  readonly timezone?: string
  readonly location?: string
  readonly url?: string
  readonly description?: string
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const escapeAttr = (s: string): string => escapeHtml(s).replace(/'/g, '&#39;')

const EVENT_KEYS = new Set(['title', 'start', 'end', 'timezone', 'location', 'url', 'description'])

const parseDateParts = (value: string): { date: string; time?: string } | null => {
  const trimmed = value.trim()
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/)
  if (!match) return null
  const date = `${match[1]}${match[2]}${match[3]}`
  const time = match[4] ? `${match[4]}${match[5]}${match[6] ?? '00'}` : undefined
  return { date, time }
}

const addDays = (yyyymmdd: string, days: number): string => {
  const year = Number(yyyymmdd.slice(0, 4))
  const month = Number(yyyymmdd.slice(4, 6))
  const day = Number(yyyymmdd.slice(6, 8))
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('')
}

const formatDisplayDate = (value: string, timezone?: string): string => {
  const parsed = parseDateParts(value)
  if (!parsed) return value
  const year = parsed.date.slice(0, 4)
  const month = parsed.date.slice(4, 6)
  const day = parsed.date.slice(6, 8)
  if (!parsed.time) return `${year}-${month}-${day}`
  const hour = parsed.time.slice(0, 2)
  const minute = parsed.time.slice(2, 4)
  return `${year}-${month}-${day} ${hour}:${minute}${timezone ? ` ${timezone}` : ''}`
}

const parseEventBlock = (content: string): CalendarEvent | null => {
  const data = new Map<string, string>()
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z][A-Za-z_-]*):\s*(.*)$/)
    if (!match) continue
    const key = match[1]!.toLowerCase().replace(/-/g, '')
    const normalized = key === 'timeZone'.toLowerCase() ? 'timezone' : key
    if (EVENT_KEYS.has(normalized)) data.set(normalized, match[2]!.trim())
  }

  const title = data.get('title')
  const start = data.get('start')
  if (!title || !start) return null

  return {
    title,
    start,
    end: data.get('end'),
    timezone: data.get('timezone'),
    location: data.get('location'),
    url: data.get('url'),
    description: data.get('description'),
  }
}

const googleCalendarUrl = (event: CalendarEvent): string => {
  const start = parseDateParts(event.start)
  const end = event.end ? parseDateParts(event.end) : null
  const allDay = Boolean(start && !start.time)
  const startValue = start ? (start.time ? `${start.date}T${start.time}` : start.date) : event.start
  const endValue = end
    ? end.time
      ? `${end.date}T${end.time}`
      : end.date
    : start && allDay
      ? addDays(start.date, 1)
      : startValue
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${startValue}/${endValue}`,
  })
  if (event.description || event.url) {
    params.set('details', [event.description, event.url].filter(Boolean).join('\n\n'))
  }
  if (event.location) params.set('location', event.location)
  if (event.timezone && !allDay) params.set('ctz', event.timezone)
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

const escapeIcsText = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

const icsDateLine = (field: string, value: string): string => {
  const parsed = parseDateParts(value)
  if (!parsed) return `${field}:${escapeIcsText(value)}`
  if (!parsed.time) return `${field};VALUE=DATE:${parsed.date}`
  return `${field}:${parsed.date}T${parsed.time}`
}

const icsDataUrl = (event: CalendarEvent): string => {
  const start = parseDateParts(event.start)
  const allDay = Boolean(start && !start.time)
  const end = event.end ?? (start && allDay ? `${start.date.slice(0, 4)}-${start.date.slice(4, 6)}-${start.date.slice(6, 8)}` : event.start)
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ts-wiki//event//EN',
    'BEGIN:VEVENT',
    `SUMMARY:${escapeIcsText(event.title)}`,
    icsDateLine('DTSTART', event.start),
    icsDateLine('DTEND', event.end ?? (start && allDay ? `${addDays(start.date, 1).slice(0, 4)}-${addDays(start.date, 1).slice(4, 6)}-${addDays(start.date, 1).slice(6, 8)}` : end)),
    event.location ? `LOCATION:${escapeIcsText(event.location)}` : '',
    event.description ? `DESCRIPTION:${escapeIcsText(event.description)}` : '',
    event.url ? `URL:${escapeIcsText(event.url)}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean)
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join('\r\n'))}`
}

const renderEventCard = (content: string): string | null => {
  const event = parseEventBlock(content)
  if (!event) return null
  const start = formatDisplayDate(event.start, event.timezone)
  const end = event.end ? formatDisplayDate(event.end, event.timezone) : null
  const when = end ? `${start} → ${end}` : start
  const details = [
    event.location ? `<div><span>Location</span><strong>${escapeHtml(event.location)}</strong></div>` : '',
    event.url
      ? `<div><span>Link</span><strong><a href="${escapeAttr(event.url)}" rel="noopener noreferrer">${escapeHtml(event.url)}</a></strong></div>`
      : '',
  ].filter(Boolean)

  return `<section class="wiki-event-card">
    <div class="wiki-event-main">
      <p class="wiki-event-kicker">Calendar event</p>
      <h3>${escapeHtml(event.title)}</h3>
      <p class="wiki-event-time">${escapeHtml(when)}</p>
      ${event.description ? `<p class="wiki-event-description">${escapeHtml(event.description)}</p>` : ''}
      ${details.length ? `<div class="wiki-event-details">${details.join('')}</div>` : ''}
    </div>
    <div class="wiki-event-actions">
      <a href="${escapeAttr(googleCalendarUrl(event))}" target="_blank" rel="noopener noreferrer">Google Calendar</a>
      <a href="${escapeAttr(icsDataUrl(event))}" download="${escapeAttr(slugifyHeading(event.title) || 'event')}.ics">Download .ics</a>
    </div>
  </section>`
}

const md: MarkdownIt = new MarkdownIt({
  html: false, // never trust raw HTML in wiki content
  linkify: true,
  typographer: true,
  breaks: false,
  highlight(code, lang): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        const out = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
        return `<pre class="hljs"><code class="language-${lang}">${out}</code></pre>`
      } catch {
        /* fall through to escaped output */
      }
    }
    return `<pre class="hljs"><code>${escapeHtml(code)}</code></pre>`
  },
}).use(anchor, {
  slugify: slugifyHeading,
  level: [1, 2, 3],
  tabIndex: false,
})

const defaultFence = md.renderer.rules.fence
md.renderer.rules.fence = (tokens, idx, options, env, self): string => {
  const token = tokens[idx]
  if (!token) return ''
  const info = token?.info.trim().split(/\s+/)[0]?.toLowerCase()
  if (info === 'event') {
    const rendered = renderEventCard(token.content)
    if (rendered) return rendered
  }
  return defaultFence ? defaultFence(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options)
}

const headingLevel = (tag: string): number => Number.parseInt(tag.slice(1), 10) || 0

const WIKI_LINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g

interface LinkToken {
  readonly type: string
  readonly content: string
  readonly children?: LinkToken[] | null
  attrGet(name: string): string | null
}

const isExternalHref = (href: string): boolean =>
  /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('#')

const hrefToPagePath = (href: string): string | null => {
  const clean = href.trim().split('#')[0]?.split('?')[0] ?? ''
  if (!clean || isExternalHref(clean)) return null
  const path = clean.startsWith('/') ? clean.slice(1) : clean.replace(/^\.\//, '')
  if (!path || path.startsWith('_') || path.startsWith('assets/')) return null
  return path
}

const addUniqueLink = (links: PageLink[], seen: Set<string>, link: PageLink): void => {
  if (!link.path || seen.has(`${link.kind}:${link.path}`)) return
  seen.add(`${link.kind}:${link.path}`)
  links.push(link)
}

/**
 * Render Markdown to sanitized HTML and extract a 3-level table of contents in
 * a single parse pass.
 */
export const renderMarkdown = (content: string): RenderResult => {
  const env: Record<string, unknown> = {}
  const tokens = md.parse(content ?? '', env)
  const toc: TocEntry[] = []

  for (let i = 0; i < tokens.length; i++) {
    const open = tokens[i]
    if (open && open.type === 'heading_open') {
      const level = headingLevel(open.tag)
      if (level >= 1 && level <= 3) {
        const inline = tokens[i + 1]
        toc.push({
          id: open.attrGet('id') ?? '',
          text: inline?.content ?? '',
          level,
        })
      }
    }
  }

  const html = md.renderer.render(tokens, md.options, env)
  return { html, toc }
}

/** Extract internal page links for graph/backlinks features. */
export const extractPageLinks = (content: string): PageLink[] => {
  const links: PageLink[] = []
  const seen = new Set<string>()

  for (const match of (content ?? '').matchAll(WIKI_LINK)) {
    const rawPath = match[1]?.trim() ?? ''
    const label = (match[2]?.trim() || rawPath).trim()
    const path = rawPath
      .split('/')
      .map((segment) => slugifyHeading(segment))
      .filter(Boolean)
      .join('/')
    addUniqueLink(links, seen, { path, label, kind: 'wikilink' })
  }

  const tokens = md.parse(content ?? '', {})
  const visit = (items: readonly LinkToken[]): void => {
    for (const token of items) {
      if (token.type === 'link_open') {
        const href = token.attrGet('href')
        const path = href ? hrefToPagePath(href) : null
        if (path) {
          const normalized = path
            .split('/')
            .map((segment) => slugifyHeading(segment))
            .filter(Boolean)
            .join('/')
          addUniqueLink(links, seen, { path: normalized, label: path, kind: 'markdown' })
        }
      }
      if (token.children?.length) visit(token.children)
    }
  }
  visit(tokens as LinkToken[])

  return links
}

/** Strip Markdown/HTML to plain text — used for search indexing & descriptions. */
export const toPlainText = (content: string): string =>
  renderMarkdown(content)
    .html.replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Build a short plain-text summary (auto-description when none is provided). */
export const summarize = (content: string, maxLength = 200): string => {
  const text = toPlainText(content)
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength).replace(/\s+\S*$/, '') + '…'
}
