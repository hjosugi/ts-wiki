import type { Directive } from 'vue'
import { createRenderer, type MarkdownRenderer } from '@ts-wiki/core'
import { Api, type PageSummary, type PopularPage, type PublicSettings, type RecentChange, type YoutubeLatestVideo } from './api'
import { enhanceCodeBlocks } from './codeCopy'

export type MarkdownFeatureSettings = Pick<
  PublicSettings,
  'enableMath' | 'enableEmoji' | 'enableMermaid' | 'defaultLocale' | 'timezone' | 'dateFormat'
>

export const defaultMarkdownFeatureSettings: MarkdownFeatureSettings = {
  enableMath: false,
  enableEmoji: true,
  enableMermaid: false,
  defaultLocale: 'und',
  timezone: 'UTC',
  dateFormat: 'medium',
}

let cachedSettings: MarkdownFeatureSettings | null = null
let pendingSettings: Promise<MarkdownFeatureSettings> | null = null
const rendererCache = new Map<string, MarkdownRenderer>()
let mermaidCounter = 0

interface MermaidApi {
  initialize(config: { startOnLoad: boolean; securityLevel: 'strict' }): void
  render(id: string, source: string): Promise<{ svg: string }>
}

let mermaidPromise: Promise<MermaidApi> | null = null
let highlightCssPromise: Promise<unknown> | null = null

export const markdownFeaturesFromSettings = (settings: PublicSettings): MarkdownFeatureSettings => ({
  enableMath: settings.enableMath,
  enableEmoji: settings.enableEmoji,
  enableMermaid: settings.enableMermaid,
  defaultLocale: settings.defaultLocale,
  timezone: settings.timezone,
  dateFormat: settings.dateFormat,
})

export const setMarkdownFeatureSettings = (settings: PublicSettings | MarkdownFeatureSettings): MarkdownFeatureSettings => {
  cachedSettings = {
    enableMath: settings.enableMath,
    enableEmoji: settings.enableEmoji,
    enableMermaid: settings.enableMermaid,
    defaultLocale: settings.defaultLocale,
    timezone: settings.timezone,
    dateFormat: settings.dateFormat,
  }
  pendingSettings = null
  return cachedSettings
}

export const loadMarkdownFeatureSettings = async (): Promise<MarkdownFeatureSettings> => {
  if (cachedSettings) return cachedSettings
  if (import.meta.env.MODE === 'test') return defaultMarkdownFeatureSettings
  pendingSettings ??= Api.publicSettings().then(setMarkdownFeatureSettings).catch(() => defaultMarkdownFeatureSettings)
  return pendingSettings
}

export const rendererForMarkdownFeatures = (settings: MarkdownFeatureSettings): MarkdownRenderer => {
  const key = [
    settings.enableMath ? 'math' : 'no-math',
    settings.enableEmoji ? 'emoji' : 'no-emoji',
    settings.defaultLocale,
    settings.timezone,
    settings.dateFormat,
  ].join(':')
  const cached = rendererCache.get(key)
  if (cached) return cached
  const renderer = createRenderer({
    features: {
      math: settings.enableMath,
      emoji: settings.enableEmoji,
    },
    dateTime: {
      locale: settings.defaultLocale,
      timezone: settings.timezone,
      dateFormat: settings.dateFormat,
    },
  })
  rendererCache.set(key, renderer)
  return renderer
}

const ensureKatexCss = async (): Promise<void> => {
  await import('katex/dist/katex.min.css')
}

const ensureHighlightCss = async (): Promise<void> => {
  highlightCssPromise ??= import('highlight.js/styles/github.css')
  await highlightCssPromise
}

const loadMermaid = async (): Promise<MermaidApi> => {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => {
      const mermaid = mod.default as MermaidApi
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
      return mermaid
    })
  }
  return mermaidPromise
}

const enhanceTabs = (root: HTMLElement): void => {
  for (const tabset of Array.from(root.querySelectorAll<HTMLElement>('[data-wiki-tabs]'))) {
    if (tabset.dataset.tabsEnhanced === '1') continue
    const tabs = Array.from(tabset.querySelectorAll<HTMLAnchorElement>('[role="tab"]'))
    const panels = Array.from(tabset.querySelectorAll<HTMLElement>('[role="tabpanel"]'))
    if (!tabs.length || tabs.length !== panels.length) continue
    const activate = (index: number): void => {
      tabs.forEach((tab, i) => {
        tab.setAttribute('aria-selected', String(i === index))
        tab.tabIndex = i === index ? 0 : -1
      })
      panels.forEach((panel, i) => {
        panel.hidden = i !== index
      })
    }
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', (event) => {
        event.preventDefault()
        activate(index)
      })
      tab.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
        event.preventDefault()
        const next = event.key === 'ArrowRight'
          ? (index + 1) % tabs.length
          : (index - 1 + tabs.length) % tabs.length
        activate(next)
        tabs[next]?.focus()
      })
    })
    tabset.dataset.tabsEnhanced = '1'
    activate(0)
  }
}

const enhanceMermaid = async (root: HTMLElement): Promise<void> => {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('pre.wiki-mermaid:not([data-mermaid-rendered])'))
  if (!blocks.length) return
  const mermaid = await loadMermaid()
  for (const block of blocks) {
    block.dataset.mermaidRendered = '1'
    const source = block.querySelector('code')?.textContent ?? block.textContent ?? ''
    if (!source.trim()) continue
    try {
      const id = `ts-wiki-mermaid-${++mermaidCounter}`
      const { svg } = await mermaid.render(id, source)
      const rendered = document.createElement('div')
      rendered.className = 'wiki-diagram wiki-mermaid-rendered'
      rendered.setAttribute('role', 'img')
      rendered.innerHTML = svg
      block.replaceWith(rendered)
    } catch {
      block.dataset.mermaidError = 'true'
    }
  }
}

const iframeAttrs = {
  allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
  referrerPolicy: 'strict-origin-when-cross-origin',
} as const

const activateMediaCard = (card: HTMLElement): void => {
  if (card.dataset.mediaLoaded === '1') return
  const provider = card.dataset.wikiMedia
  let src = ''
  if (provider === 'youtube') {
    const sourceUrl = card.dataset.sourceUrl
    if (!sourceUrl) return
    const url = new URL(sourceUrl)
    url.searchParams.set('autoplay', '1')
    src = url.toString()
  } else if (provider === 'twitch') {
    const sourceType = card.dataset.sourceType
    const sourceId = card.dataset.sourceId
    if (!sourceType || !sourceId) return
    const parent = window.location.hostname || 'localhost'
    const params = new URLSearchParams({ parent })
    if (sourceType === 'channel') {
      params.set('channel', sourceId)
      src = `https://player.twitch.tv/?${params.toString()}`
    } else if (sourceType === 'video') {
      params.set('video', sourceId)
      src = `https://player.twitch.tv/?${params.toString()}`
    } else if (sourceType === 'clip') {
      params.set('clip', sourceId)
      src = `https://clips.twitch.tv/embed?${params.toString()}`
    }
  }
  if (!src) return
  const frame = document.createElement('iframe')
  frame.src = src
  frame.loading = 'lazy'
  frame.allow = iframeAttrs.allow
  frame.referrerPolicy = iframeAttrs.referrerPolicy
  frame.allowFullscreen = true
  frame.title = card.querySelector('h3')?.textContent || `${provider} embed`
  const preview = card.querySelector<HTMLElement>('.wiki-media-preview')
  if (!preview) return
  preview.replaceChildren(frame)
  preview.removeAttribute('aria-hidden')
  card.dataset.mediaLoaded = '1'
  card.classList.add('wiki-media-loaded')
}

const enhanceMediaCards = (root: HTMLElement): void => {
  for (const card of Array.from(root.querySelectorAll<HTMLElement>('[data-wiki-media]'))) {
    if (card.dataset.mediaEnhanced === '1') continue
    const button = card.querySelector<HTMLButtonElement>('[data-wiki-media-load]')
    button?.addEventListener('click', () => activateMediaCard(card))
    card.dataset.mediaEnhanced = '1'
  }
}

const formatVideoDate = (value: string): string => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

const videoCard = (video: YoutubeLatestVideo): HTMLElement => {
  const link = document.createElement('a')
  link.className = 'wiki-youtube-latest-card'
  link.href = video.url
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  if (video.thumbnail) {
    const media = document.createElement('span')
    media.className = 'wiki-youtube-latest-thumb'
    const image = document.createElement('img')
    image.src = video.thumbnail
    image.alt = ''
    image.loading = 'lazy'
    image.referrerPolicy = 'no-referrer'
    media.append(image)
    link.append(media)
  }
  const body = document.createElement('span')
  body.className = 'wiki-youtube-latest-body'
  const title = document.createElement('span')
  title.className = 'wiki-youtube-latest-title'
  title.textContent = video.title
  body.append(title)
  const meta = [video.author, formatVideoDate(video.publishedAt)].filter(Boolean).join(' · ')
  if (meta) {
    const metaEl = document.createElement('span')
    metaEl.className = 'wiki-youtube-latest-meta'
    metaEl.textContent = meta
    body.append(metaEl)
  }
  link.append(body)
  return link
}

const enhanceYoutubeLatest = (root: HTMLElement): void => {
  for (const widget of Array.from(root.querySelectorAll<HTMLElement>('[data-youtube-latest]'))) {
    if (widget.dataset.youtubeLatestEnhanced === '1') continue
    widget.dataset.youtubeLatestEnhanced = '1'
    const channelId = widget.dataset.channelId
    const limit = Number.parseInt(widget.dataset.limit ?? '6', 10)
    const items = widget.querySelector<HTMLElement>('[data-youtube-latest-items]')
    if (!channelId || !items) continue
    void Api.youtubeLatest(channelId, Number.isFinite(limit) ? limit : 6)
      .then((channel) => {
        items.replaceChildren()
        if (!channel.videos.length) {
          const empty = document.createElement('p')
          empty.className = 'wiki-media-note'
          empty.textContent = 'No videos found.'
          items.append(empty)
          return
        }
        for (const video of channel.videos) items.append(videoCard(video))
      })
      .catch(() => {
        const error = document.createElement('p')
        error.className = 'wiki-media-note'
        error.textContent = 'Could not load latest videos.'
        items.replaceChildren(error)
      })
  }
}

const formatRelativeDate = (value: number | null): string => {
  if (!value) return ''
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
  } catch {
    return ''
  }
}

const pageCard = (page: PageSummary | PopularPage, note = ''): HTMLAnchorElement => {
  const link = document.createElement('a')
  link.className = 'wiki-page-card'
  link.href = `/${page.path}`
  const media = document.createElement('span')
  media.className = 'wiki-page-card-media'
  if (page.coverUrl) {
    media.style.backgroundImage = `url(${JSON.stringify(page.coverUrl)})`
    media.style.backgroundPosition = page.coverPosition || 'center'
  } else if (page.icon) {
    const icon = document.createElement('span')
    icon.className = 'wiki-page-card-icon'
    icon.textContent = page.icon
    media.append(icon)
  }
  const body = document.createElement('span')
  body.className = 'wiki-page-card-body'
  const title = document.createElement('span')
  title.className = 'wiki-page-card-title'
  title.textContent = page.title
  const path = document.createElement('span')
  path.className = 'wiki-page-card-path'
  path.textContent = `/${page.path}`
  body.append(title, path)
  const description = page.description.trim()
  if (description) {
    const desc = document.createElement('span')
    desc.className = 'wiki-page-card-description'
    desc.textContent = description
    body.append(desc)
  }
  if (note) {
    const meta = document.createElement('span')
    meta.className = 'wiki-page-card-meta'
    meta.textContent = note
    body.append(meta)
  }
  link.append(media, body)
  return link
}

const emptyNote = (message: string): HTMLParagraphElement => {
  const empty = document.createElement('p')
  empty.className = 'wiki-media-note'
  empty.textContent = message
  return empty
}

const enhancePageWidgets = (root: HTMLElement): void => {
  for (const widget of Array.from(root.querySelectorAll<HTMLElement>('[data-wiki-pages]'))) {
    if (widget.dataset.wikiPagesEnhanced === '1') continue
    widget.dataset.wikiPagesEnhanced = '1'
    const grid = widget.querySelector<HTMLElement>('[data-wiki-page-grid]')
    if (!grid) continue
    let paths: string[] = []
    try {
      const parsed = JSON.parse(widget.dataset.paths ?? '[]') as unknown
      paths = Array.isArray(parsed) ? parsed.filter((path): path is string => typeof path === 'string') : []
    } catch {
      paths = []
    }
    void Api.listPages()
      .then((pages) => {
        const byPath = new Map(pages.map((page) => [page.path, page]))
        const cards = paths.flatMap((path) => {
          const page = byPath.get(path)
          return page ? [pageCard(page)] : []
        })
        grid.replaceChildren(...(cards.length ? cards : [emptyNote('No matching pages found.')]))
      })
      .catch(() => grid.replaceChildren(emptyNote('Could not load pages.')))
  }
}

const recentItem = (change: RecentChange, page?: PageSummary): HTMLAnchorElement => {
  const link = document.createElement('a')
  link.className = 'wiki-activity-item'
  link.href = `/${change.path}`
  const icon = document.createElement('span')
  icon.className = 'wiki-activity-icon'
  icon.textContent = page?.icon || (change.action === 'created' ? '+' : change.action === 'deleted' ? '-' : '*')
  const body = document.createElement('span')
  body.className = 'wiki-activity-body'
  const title = document.createElement('span')
  title.className = 'wiki-activity-title'
  title.textContent = change.title
  const meta = document.createElement('span')
  meta.className = 'wiki-activity-meta'
  meta.textContent = `${change.action} · ${formatRelativeDate(change.createdAt)}`
  body.append(title, meta)
  link.append(icon, body)
  return link
}

const enhanceRecentWidgets = (root: HTMLElement): void => {
  for (const widget of Array.from(root.querySelectorAll<HTMLElement>('[data-wiki-recent]'))) {
    if (widget.dataset.wikiRecentEnhanced === '1') continue
    widget.dataset.wikiRecentEnhanced = '1'
    const list = widget.querySelector<HTMLElement>('[data-wiki-recent-items]')
    if (!list) continue
    const limit = Number.parseInt(widget.dataset.limit ?? '6', 10)
    void Promise.all([Api.recentChanges(Number.isFinite(limit) ? limit : 6), Api.listPages()])
      .then(([changes, pages]) => {
        const byPath = new Map(pages.map((page) => [page.path, page]))
        const items = changes.map((change) => recentItem(change, byPath.get(change.path)))
        list.replaceChildren(...(items.length ? items : [emptyNote('No recent changes found.')]))
      })
      .catch(() => list.replaceChildren(emptyNote('Could not load recent changes.')))
  }
}

const enhancePopularWidgets = (root: HTMLElement): void => {
  for (const widget of Array.from(root.querySelectorAll<HTMLElement>('[data-wiki-popular]'))) {
    if (widget.dataset.wikiPopularEnhanced === '1') continue
    widget.dataset.wikiPopularEnhanced = '1'
    const grid = widget.querySelector<HTMLElement>('[data-wiki-popular-items]')
    if (!grid) continue
    const limit = Number.parseInt(widget.dataset.limit ?? '6', 10)
    const days = Number.parseInt(widget.dataset.days ?? '7', 10)
    void Api.popularPages(Number.isFinite(days) ? days : 7, Number.isFinite(limit) ? limit : 6)
      .then((pages) => {
        const cards = pages.map((page) => pageCard(page, `${page.views} view${page.views === 1 ? '' : 's'}`))
        grid.replaceChildren(...(cards.length ? cards : [emptyNote('No popular pages yet.')]))
      })
      .catch(() => grid.replaceChildren(emptyNote('Could not load popular pages.')))
  }
}

export const enhanceRenderedMarkdown = (root: HTMLElement, settings: MarkdownFeatureSettings = defaultMarkdownFeatureSettings): void => {
  enhanceCodeBlocks(root)
  enhanceTabs(root)
  enhanceMediaCards(root)
  enhanceYoutubeLatest(root)
  enhancePageWidgets(root)
  enhanceRecentWidgets(root)
  enhancePopularWidgets(root)
  if (root.querySelector('.hljs')) void ensureHighlightCss()
  if (settings.enableMath && root.querySelector('.katex')) void ensureKatexCss()
  if (settings.enableMermaid) void enhanceMermaid(root)
}

export const vMarkdownEnhance: Directive<HTMLElement, MarkdownFeatureSettings | undefined> = {
  mounted(el, binding) {
    enhanceRenderedMarkdown(el, binding.value ?? defaultMarkdownFeatureSettings)
  },
  updated(el, binding) {
    enhanceRenderedMarkdown(el, binding.value ?? defaultMarkdownFeatureSettings)
  },
}
