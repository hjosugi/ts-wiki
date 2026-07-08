/**
 * Markdown rendering pipeline — isomorphic (runs in Bun on the server for
 * render-on-save, and in the browser for the live editor preview).
 *
 * Ported in spirit from Wiki.js's `ux/src/renderers/markdown.js`, but as a
 * single pure function returning both the HTML and a structured table of
 * contents, instead of mutating shared renderer state.
 */
/// <reference path="./markdown-plugins.d.ts" />
import MarkdownIt from 'markdown-it'
import anchor from 'markdown-it-anchor'
import footnote from 'markdown-it-footnote'
import taskLists from 'markdown-it-task-lists'
import imsize from 'markdown-it-imsize'
import katexPlugin from 'markdown-it-katex'
import { full as emojiPlugin } from 'markdown-it-emoji'
import hljs from 'highlight.js'
import { slugifyHeading } from './slug.ts'
import { parseMarkdownFrontmatter } from './frontmatter.ts'

export interface TocEntry {
  readonly id: string
  readonly text: string
  readonly level: number
}

export interface RenderResult {
  readonly html: string
  readonly toc: TocEntry[]
}

export interface MarkdownRenderer {
  readonly markdown: MarkdownIt
  renderMarkdown(content: string): RenderResult
  extractPageLinks(content: string): PageLink[]
  toPlainText(content: string): string
}

export type MarkdownPlugin = (md: MarkdownIt) => void
export type FenceRenderer = (content: string, info: string, md: MarkdownIt) => string | null

export interface MarkdownFeatureOptions {
  readonly math?: boolean
  readonly emoji?: boolean
}

export type DateFormatStyle = 'short' | 'medium' | 'long'

export interface MarkdownDateTimeOptions {
  readonly locale?: string
  readonly timezone?: string
  readonly dateFormat?: DateFormatStyle
}

export interface MarkdownRendererOptions {
  readonly features?: MarkdownFeatureOptions
  readonly dateTime?: MarkdownDateTimeOptions
  readonly plugins?: readonly MarkdownPlugin[]
  readonly fences?: Record<string, FenceRenderer>
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

export interface ExtractedCalendarEvent extends CalendarEvent {
  readonly id: string
  readonly sourcePath: string
  readonly block: number
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const escapeAttr = (s: string): string => escapeHtml(s).replace(/'/g, '&#39;')

const EVENT_KEYS = new Set(['title', 'start', 'end', 'timezone', 'location', 'url', 'description'])
const CALLOUT_KEYS = new Set(['type', 'title'])
const EMBED_KEYS = new Set(['url', 'title', 'description'])

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

const formatDateParts = (
  date: string,
  time: string | undefined,
  options: MarkdownDateTimeOptions = {},
): string => {
  const locale = options.locale && options.locale !== 'und' ? options.locale : 'en'
  const dateStyle = options.dateFormat ?? 'medium'
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(4, 6))
  const day = Number(date.slice(6, 8))
  const hour = Number(time?.slice(0, 2) ?? '0')
  const minute = Number(time?.slice(2, 4) ?? '0')
  const instant = new Date(Date.UTC(year, month - 1, day, hour, minute))
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle,
      ...(time ? { timeStyle: 'short' as const } : {}),
      timeZone: 'UTC',
    }).format(instant)
  } catch {
    const yyyy = date.slice(0, 4)
    const mm = date.slice(4, 6)
    const dd = date.slice(6, 8)
    return time ? `${yyyy}-${mm}-${dd} ${time.slice(0, 2)}:${time.slice(2, 4)}` : `${yyyy}-${mm}-${dd}`
  }
}

const formatDisplayDate = (value: string, options: MarkdownDateTimeOptions = {}): string => {
  const parsed = parseDateParts(value)
  if (!parsed) return value
  const formatted = formatDateParts(parsed.date, parsed.time, options)
  return parsed.time && options.timezone ? `${formatted} ${options.timezone}` : formatted
}

export const parseCalendarEventBlock = (content: string): CalendarEvent | null => {
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

const flattenFenceValue = (value: string): string => value.replace(/\r?\n/g, ' ').trim()

export const calendarEventToFence = (event: CalendarEvent): string => {
  const lines = [
    '```event',
    `title: ${flattenFenceValue(event.title)}`,
    `start: ${flattenFenceValue(event.start)}`,
    event.end ? `end: ${flattenFenceValue(event.end)}` : '',
    event.timezone ? `timezone: ${flattenFenceValue(event.timezone)}` : '',
    event.location ? `location: ${flattenFenceValue(event.location)}` : '',
    event.url ? `url: ${flattenFenceValue(event.url)}` : '',
    event.description ? `description: ${flattenFenceValue(event.description)}` : '',
    '```',
  ].filter(Boolean)
  return `${lines.join('\n')}\n`
}

const EVENT_FENCE = /(?:^|\n)```event[^\n]*\n([\s\S]*?)\n```/gi

export const extractCalendarEvents = (content: string, sourcePath = ''): ExtractedCalendarEvent[] => {
  const events: ExtractedCalendarEvent[] = []
  let match: RegExpExecArray | null = null
  let block = 0
  while ((match = EVENT_FENCE.exec(content ?? ''))) {
    const event = parseCalendarEventBlock(match[1] ?? '')
    if (event) {
      const slug = slugifyHeading(event.title) || 'event'
      events.push({
        ...event,
        id: `${sourcePath || 'page'}:${block}:${slug}`,
        sourcePath,
        block,
      })
    }
    block += 1
  }
  return events
}

const googleCalendarUrl = (event: CalendarEvent, dateTime: MarkdownDateTimeOptions = {}): string => {
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
  const timezone = event.timezone ?? dateTime.timezone
  if (timezone && !allDay) params.set('ctz', timezone)
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

export const calendarEventToIcs = (event: CalendarEvent): string => {
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
  return `${lines.join('\r\n')}\r\n`
}

const icsDataUrl = (event: CalendarEvent): string => {
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(calendarEventToIcs(event))}`
}

const unfoldIcsLines = (input: string): string[] => {
  const out: string[] = []
  for (const line of (input ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
    if (/^[ \t]/.test(line) && out.length) {
      out[out.length - 1] += line.slice(1)
    } else {
      out.push(line)
    }
  }
  return out
}

const unescapeIcsText = (value: string): string =>
  value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')

interface IcsProperty {
  readonly name: string
  readonly params: Record<string, string>
  readonly value: string
}

const parseIcsProperty = (line: string): IcsProperty | null => {
  const index = line.indexOf(':')
  if (index === -1) return null
  const head = line.slice(0, index)
  const value = line.slice(index + 1)
  const [name = '', ...paramParts] = head.split(';')
  const params: Record<string, string> = {}
  for (const part of paramParts) {
    const [key = '', raw = ''] = part.split('=')
    if (key) params[key.toUpperCase()] = raw.replace(/^"|"$/g, '')
  }
  return { name: name.toUpperCase(), params, value }
}

const icsDateToEventDate = (value: string): string => {
  const clean = value.trim()
  const date = clean.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (date) return `${date[1]}-${date[2]}-${date[3]}`
  const dateTime = clean.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(?:(\d{2}))?Z?$/)
  if (dateTime) return `${dateTime[1]}-${dateTime[2]}-${dateTime[3]} ${dateTime[4]}:${dateTime[5]}`
  return clean
}

const eventFromIcsProps = (props: IcsProperty[]): CalendarEvent | null => {
  const first = (name: string): IcsProperty | undefined => props.find((prop) => prop.name === name)
  const summary = first('SUMMARY')
  const start = first('DTSTART')
  if (!summary || !start) return null
  const end = first('DTEND')
  const description = first('DESCRIPTION')
  const location = first('LOCATION')
  const url = first('URL')
  const timezone = start.params.TZID ?? end?.params.TZID

  return {
    title: unescapeIcsText(summary.value),
    start: icsDateToEventDate(start.value),
    end: end ? icsDateToEventDate(end.value) : undefined,
    timezone,
    location: location ? unescapeIcsText(location.value) : undefined,
    url: url ? unescapeIcsText(url.value) : undefined,
    description: description ? unescapeIcsText(description.value) : undefined,
  }
}

export const parseIcsEvents = (input: string): CalendarEvent[] => {
  const events: CalendarEvent[] = []
  let current: IcsProperty[] | null = null

  for (const line of unfoldIcsLines(input)) {
    const normalized = line.trim().toUpperCase()
    if (normalized === 'BEGIN:VEVENT') {
      current = []
      continue
    }
    if (normalized === 'END:VEVENT') {
      if (current) {
        const event = eventFromIcsProps(current)
        if (event) events.push(event)
      }
      current = null
      continue
    }
    if (!current) continue
    const prop = parseIcsProperty(line)
    if (prop) current.push(prop)
  }

  return events
}

const renderEventCard = (content: string, dateTime: MarkdownDateTimeOptions = {}): string | null => {
  const event = parseCalendarEventBlock(content)
  if (!event) return null
  const timezone = event.timezone ?? dateTime.timezone
  const start = formatDisplayDate(event.start, { ...dateTime, timezone })
  const end = event.end ? formatDisplayDate(event.end, { ...dateTime, timezone }) : null
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
      <a href="${escapeAttr(googleCalendarUrl(event, dateTime))}" target="_blank" rel="noopener noreferrer">Google Calendar</a>
      <a href="${escapeAttr(icsDataUrl(event))}" download="${escapeAttr(slugifyHeading(event.title) || 'event')}.ics">Download .ics</a>
    </div>
  </section>`
}

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

const renderCalloutBlock = (content: string, renderer: MarkdownIt = md): string => {
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
const INFOBOX_FIELD = /^([A-Za-z][\w \-]{0,39}):(?:[ \t]+(.*))?$/

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
const renderInfoboxBlock = (content: string, renderer: MarkdownIt = md): string => {
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

  return `<a class="wiki-embed" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">
    <span class="wiki-embed-title">${escapeHtml(title)}</span>
    ${description ? `<span class="wiki-embed-description">${escapeHtml(description)}</span>` : ''}
    <span class="wiki-embed-url">${escapeHtml(url)}</span>
  </a>`
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

const renderTabsBlock = (content: string, renderer: MarkdownIt = md): string | null => {
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

const headingLevel = (tag: string): number => Number.parseInt(tag.slice(1), 10) || 0

const WIKI_LINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g

const wikiLinkPath = (rawPath: string): string =>
  rawPath
    .trim()
    .split('/')
    .map((segment) => slugifyHeading(segment))
    .filter(Boolean)
    .join('/')

const builtinFenceRenderers = new Map<string, FenceRenderer>([
  ['callout', (content, _info, renderer) => renderCalloutBlock(content, renderer)],
  ['infobox', (content, _info, renderer) => renderInfoboxBlock(content, renderer)],
  ['profile', (content, _info, renderer) => renderInfoboxBlock(content, renderer)],
  ['links', (content) => renderLinksBlock(content)],
  ['social', (content) => renderLinksBlock(content)],
  ['embed', (content) => renderEmbedBlock(content)],
  ['mermaid', (content) => renderMermaidBlock(content)],
  ['tabs', (content, _info, renderer) => renderTabsBlock(content, renderer)],
])

const registeredFenceRenderers = new Map<string, FenceRenderer>()

export const registerFenceRenderer = (info: string, render: FenceRenderer): void => {
  const key = info.trim().toLowerCase()
  if (key) registeredFenceRenderers.set(key, render)
}

const installWikiLinkRule = (renderer: MarkdownIt): void => {
  renderer.inline.ruler.before('emphasis', 'wikilink', (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x5b || state.src.charCodeAt(state.pos + 1) !== 0x5b) {
      return false
    }
    const end = state.src.indexOf(']]', state.pos + 2)
    if (end === -1) return false
    const raw = state.src.slice(state.pos + 2, end)
    const [rawPath = '', rawLabel = ''] = raw.split('|')
    const path = wikiLinkPath(rawPath)
    if (!path) return false

    if (!silent) {
      const open = state.push('link_open', 'a', 1)
      open.attrs = [
        ['href', `/${path}`],
        ['data-wiki-link', path],
      ]
      const text = state.push('text', '', 0)
      text.content = rawLabel.trim() || rawPath.trim()
      state.push('link_close', 'a', -1)
    }
    state.pos = end + 2
    return true
  })
}

const createMarkdownIt = (rendererOptions: MarkdownRendererOptions = {}): MarkdownIt => {
  const renderer = new MarkdownIt({
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
  })
    .use(anchor, {
      slugify: slugifyHeading,
      level: [1, 2, 3],
      tabIndex: false,
    })
    .use(footnote)
    .use(taskLists, { label: true })
    .use(imsize)

  if (rendererOptions.features?.emoji) renderer.use(emojiPlugin)
  if (rendererOptions.features?.math) renderer.use(katexPlugin, { throwOnError: false, strict: false })

  for (const plugin of rendererOptions.plugins ?? []) plugin(renderer)

  const optionFences = new Map<string, FenceRenderer>(
    Object.entries(rendererOptions.fences ?? {}).map(([key, value]) => [key.trim().toLowerCase(), value]),
  )
  const instanceFenceRenderers = new Map<string, FenceRenderer>(builtinFenceRenderers)
  instanceFenceRenderers.set('event', (content) => renderEventCard(content, rendererOptions.dateTime))
  const defaultFence = renderer.renderer.rules.fence
  renderer.renderer.rules.fence = (tokens, idx, options, env, self): string => {
    const token = tokens[idx]
    if (!token) return ''
    const info = token.info.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
    const render = optionFences.get(info) ?? registeredFenceRenderers.get(info) ?? instanceFenceRenderers.get(info)
    const rendered = render?.(token.content, info, renderer)
    if (rendered) return rendered
    return defaultFence ? defaultFence(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options)
  }

  installWikiLinkRule(renderer)
  return renderer
}

const md: MarkdownIt = createMarkdownIt()

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

const normalizeMarkdownLinkPath = (path: string): string =>
  path
    .split('/')
    .map((segment) => slugifyHeading(segment))
    .filter(Boolean)
    .join('/')

const addUniqueLink = (links: PageLink[], seen: Set<string>, link: PageLink): void => {
  if (!link.path || seen.has(`${link.kind}:${link.path}`)) return
  seen.add(`${link.kind}:${link.path}`)
  links.push(link)
}

/**
 * Render Markdown to sanitized HTML and extract a configurable table of
 * contents in a single parse pass.
 */
const renderMarkdownWith = (renderer: MarkdownIt, content: string): RenderResult => {
  const frontmatter = parseMarkdownFrontmatter(content ?? '')
  const env: Record<string, unknown> = {}
  const tokens = renderer.parse(frontmatter.content, env)
  const toc: TocEntry[] = []
  const tocEnabled = frontmatter.toc !== false
  const tocDepth = frontmatter.tocDepth ?? 3

  if (tocEnabled) {
    for (let i = 0; i < tokens.length; i++) {
      const open = tokens[i]
      if (open && open.type === 'heading_open') {
        const level = headingLevel(open.tag)
        if (level >= 1 && level <= tocDepth) {
          const inline = tokens[i + 1]
          toc.push({
            id: open.attrGet('id') ?? '',
            text: inline?.content ?? '',
            level,
          })
        }
      }
    }
  }

  const html = renderer.renderer.render(tokens, renderer.options, env)
  return { html, toc }
}

export const renderMarkdown = (content: string): RenderResult => renderMarkdownWith(md, content)

/** Extract internal page links for graph/backlinks features. */
const extractPageLinksWith = (renderer: MarkdownIt, content: string): PageLink[] => {
  const links: PageLink[] = []
  const seen = new Set<string>()

  for (const match of (content ?? '').matchAll(WIKI_LINK)) {
    const rawPath = match[1]?.trim() ?? ''
    const label = (match[2]?.trim() || rawPath).trim()
    const path = wikiLinkPath(rawPath)
    addUniqueLink(links, seen, { path, label, kind: 'wikilink' })
  }

  const tokens = renderer.parse(content ?? '', {})
  const visit = (items: readonly LinkToken[]): void => {
    for (const token of items) {
      if (token.type === 'link_open') {
        if (token.attrGet('data-wiki-link')) continue
        const href = token.attrGet('href')
        const path = href ? hrefToPagePath(href) : null
        if (path) {
          const normalized = normalizeMarkdownLinkPath(path)
          addUniqueLink(links, seen, { path: normalized, label: path, kind: 'markdown' })
        }
      }
      if (token.children?.length) visit(token.children)
    }
  }
  visit(tokens as LinkToken[])

  return links
}

export const extractPageLinks = (content: string): PageLink[] => extractPageLinksWith(md, content)

const MARKDOWN_LINK = /(!?)\[([^\]\n]+)\]\(([^)\s]+)\)/g

const splitHrefSuffix = (href: string): { base: string; suffix: string } => {
  const hashIndex = href.indexOf('#')
  const queryIndex = href.indexOf('?')
  const suffixIndex = [hashIndex, queryIndex].filter((index) => index >= 0).sort((a, b) => a - b)[0]
  return suffixIndex === undefined
    ? { base: href, suffix: '' }
    : { base: href.slice(0, suffixIndex), suffix: href.slice(suffixIndex) }
}

/** Rewrite internal page links after a page move, preserving link labels and anchors. */
export const rewritePageLinks = (content: string, fromPath: string, toPath: string): string => {
  const from = wikiLinkPath(fromPath)
  const to = wikiLinkPath(toPath)
  if (!from || !to || from === to) return content

  const withWikiLinks = (content ?? '').replace(WIKI_LINK, (match, rawPath: string, rawLabel?: string) => {
    if (wikiLinkPath(rawPath) !== from) return match
    const label = rawLabel === undefined ? '' : `|${rawLabel}`
    return `[[${to}${label}]]`
  })

  return withWikiLinks.replace(MARKDOWN_LINK, (match, bang: string, label: string, href: string) => {
    if (bang) return match
    const pagePath = hrefToPagePath(href)
    if (!pagePath || normalizeMarkdownLinkPath(pagePath) !== from) return match
    const { base, suffix } = splitHrefSuffix(href)
    const prefix = base.startsWith('/') ? '/' : ''
    return `[${label}](${prefix}${to}${suffix})`
  })
}

/** Strip Markdown/HTML to plain text — used for search indexing & descriptions. */
export const toPlainText = (content: string): string =>
  renderMarkdown(content)
    .html.replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export const createRenderer = (options: MarkdownRendererOptions = {}): MarkdownRenderer => {
  const renderer = createMarkdownIt(options)
  const render = (content: string): RenderResult => renderMarkdownWith(renderer, content)
  return {
    markdown: renderer,
    renderMarkdown: render,
    extractPageLinks: (content: string): PageLink[] => extractPageLinksWith(renderer, content),
    toPlainText: (content: string): string =>
      render(content)
        .html.replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
  }
}

/** Build a short plain-text summary (auto-description when none is provided). */
export const summarize = (content: string, maxLength = 200): string => {
  const text = toPlainText(content)
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength).replace(/\s+\S*$/, '') + '…'
}
