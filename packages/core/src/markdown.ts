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
import { legacyImgSize } from '@mdit/plugin-img-size'
import { katex as katexPlugin } from '@mdit/plugin-katex'
import { full as emojiPlugin } from 'markdown-it-emoji'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import shell from 'highlight.js/lib/languages/shell'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import { slugifyHeading } from './slug.ts'
import { parseMarkdownFrontmatter } from './frontmatter.ts'
import { renderEventCard, type MarkdownDateTimeOptions } from './calendar.ts'
import { extractPageLinksWith, installWikiLinkRule, type PageLink } from './links.ts'
import { renderBuiltInBlock } from './blocks.ts'

export {
  calendarEventToFence,
  calendarEventToIcs,
  extractCalendarEvents,
  parseCalendarEventBlock,
  parseIcsEvents,
} from './calendar.ts'
export type { CalendarEvent, DateFormatStyle, ExtractedCalendarEvent, MarkdownDateTimeOptions } from './calendar.ts'
export { rewritePageLinks } from './links.ts'
export type { PageLink } from './links.ts'

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

export interface MarkdownRendererOptions {
  readonly features?: MarkdownFeatureOptions
  readonly dateTime?: MarkdownDateTimeOptions
  readonly plugins?: readonly MarkdownPlugin[]
  readonly fences?: Record<string, FenceRenderer>
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const commonHighlightLanguages = {
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  dockerfile,
  go,
  java,
  javascript,
  json,
  markdown,
  python,
  ruby,
  rust,
  shell,
  sql,
  typescript,
  xml,
  yaml,
} as const

for (const [name, language] of Object.entries(commonHighlightLanguages)) {
  hljs.registerLanguage(name, language)
}

const headingLevel = (tag: string): number => Number.parseInt(tag.slice(1), 10) || 0

const registeredFenceRenderers = new Map<string, FenceRenderer>()

export const registerFenceRenderer = (info: string, render: FenceRenderer): void => {
  const key = info.trim().toLowerCase()
  if (key) registeredFenceRenderers.set(key, render)
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
    .use(legacyImgSize)

  if (rendererOptions.features?.emoji) renderer.use(emojiPlugin)
  if (rendererOptions.features?.math) renderer.use(katexPlugin, { throwOnError: false, strict: false })

  for (const plugin of rendererOptions.plugins ?? []) plugin(renderer)

  const optionFences = new Map<string, FenceRenderer>(
    Object.entries(rendererOptions.fences ?? {}).map(([key, value]) => [key.trim().toLowerCase(), value]),
  )
  const defaultFence = renderer.renderer.rules.fence
  renderer.renderer.rules.fence = (tokens, idx, options, env, self): string => {
    const token = tokens[idx]
    if (!token) return ''
    const info = token.info.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
    const customRender = optionFences.get(info) ?? registeredFenceRenderers.get(info)
    const rendered = customRender
      ? customRender(token.content, info, renderer)
      : info === 'event'
        ? renderEventCard(token.content, rendererOptions.dateTime)
        : renderBuiltInBlock(info, token.content, renderer)
    if (rendered) return rendered
    return defaultFence ? defaultFence(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options)
  }

  installWikiLinkRule(renderer)
  return renderer
}

const md: MarkdownIt = createMarkdownIt()

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
export const extractPageLinks = (content: string): PageLink[] => extractPageLinksWith(md, content)

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
