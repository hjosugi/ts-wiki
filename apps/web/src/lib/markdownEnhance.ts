import type { Directive } from 'vue'
import { createRenderer, type MarkdownRenderer } from '@ts-wiki/core'
import { Api, type PublicSettings } from './api'
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

export const enhanceRenderedMarkdown = (root: HTMLElement, settings: MarkdownFeatureSettings = defaultMarkdownFeatureSettings): void => {
  enhanceCodeBlocks(root)
  enhanceTabs(root)
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
