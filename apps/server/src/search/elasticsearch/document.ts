/**
 * Builds the Elasticsearch document for a page from its indexable source. Kept
 * pure — the worker gathers the page, comment, and asset text from the database
 * and this shapes it into the `page_search` mapping. Markdown is reduced to plain
 * text and the labels JSON is parsed into the keyword array the mapping expects.
 */
import { toPlainText } from '@kawaii-wiki/core'

export interface PageIndexSource {
  readonly path: string
  readonly title: string
  readonly description: string
  /** Raw markdown; reduced to plain text for indexing. */
  readonly content: string
  readonly spaceKey: string
  readonly status: string
  readonly locale: string
  readonly authorId: string | null
  readonly authorName: string | null
  readonly authorEmail?: string | null
  /** JSON array string as stored on the page row. */
  readonly labels: string
  readonly icon: string
  readonly coverUrl: string
  readonly coverPosition: string
  readonly updatedAt: number
  /** Newline-joined plain-text comment bodies. */
  readonly comments: string
  /** Newline-joined "filename folder" strings for referenced assets. */
  readonly assets: string
}

export interface PageDocument {
  readonly path: string
  readonly title: string
  readonly description: string
  readonly content: string
  readonly comments: string
  readonly assets: string
  readonly spaceKey: string
  readonly status: string
  readonly locale: string
  readonly authorId: string | null
  readonly authorName: string | null
  readonly authorEmail: string | null
  readonly labels: string[]
  readonly icon: string
  readonly coverUrl: string
  readonly coverPosition: string
  readonly updatedAt: number
}

const parseLabels = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((label): label is string => typeof label === 'string') : []
  } catch {
    return []
  }
}

export const buildPageDocument = (source: PageIndexSource): PageDocument => ({
  path: source.path,
  title: source.title,
  description: source.description,
  content: toPlainText(source.content),
  comments: source.comments,
  assets: source.assets,
  spaceKey: source.spaceKey,
  status: source.status,
  locale: source.locale,
  authorId: source.authorId,
  authorName: source.authorName,
  authorEmail: source.authorEmail ?? null,
  labels: parseLabels(source.labels),
  icon: source.icon,
  coverUrl: source.coverUrl,
  coverPosition: source.coverPosition,
  updatedAt: source.updatedAt,
})
