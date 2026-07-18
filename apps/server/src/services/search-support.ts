/**
 * Dialect-neutral search presentation & ranking helpers.
 *
 * Pure functions shared by every SearchIndexer backend (SQLite FTS5, Postgres
 * tsvector). They turn raw matched rows into ranked, highlighted, ACL-shaped
 * hits — no database or dialect knowledge lives here, only string and score
 * math. The FTS5-only pieces (snippet() markers, bm25) stay in the SQLite
 * adapter; the substring/"LIKE"-style helpers below drive both the SQLite
 * trigram fallback and the Postgres query path.
 */
import { toPlainText } from '@kawaii-wiki/core'
import { containsCjk, parseSearchQuery } from './search-query.ts'
import type {
  SearchHit,
  SearchHitKind,
  SearchRequest,
  SearchResponse,
  SearchShortQueryHint,
  SearchSort,
  SearchTokenizer,
  SearchTokenizerHint,
} from './search.ts'

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

export const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (char) => `\\${char}`)

export const codePointLength = (value: string): number => Array.from(value).length

export const indexedText = (page: { title: string; description: string; content: string }, extra = ''): string =>
  `${page.title}\n${page.description}\n${toPlainText(page.content)}\n${extra}`

export const countSearchCharacters = (value: string): { total: number; cjk: number } => {
  let total = 0
  let cjk = 0
  for (const char of value) {
    if (/\s/u.test(char)) continue
    total += 1
    if (containsCjk(char)) cjk += 1
  }
  return { total, cjk }
}

export const tokenizerHint = (query: string, tokenizer: SearchTokenizer): SearchTokenizerHint | undefined =>
  tokenizer === 'unicode61' && containsCjk(query)
    ? {
        kind: 'cjk-tokenizer',
        tokenizer,
        recommendedTokenizer: 'trigram',
        message: 'This query contains CJK characters. Rebuild the search index with the trigram tokenizer for better Japanese/CJK matching.',
      }
    : undefined

export const trigramShortTerms = (terms: readonly string[], tokenizer: SearchTokenizer): string[] =>
  tokenizer === 'trigram' ? terms.filter((term) => codePointLength(term) < 3) : []

export const shortQueryHint = (terms: readonly string[]): SearchShortQueryHint | undefined =>
  terms.length > 0
    ? {
        kind: 'trigram-short-query',
        tokenizer: 'trigram',
        terms,
        message: 'Short trigram queries use a bounded substring scan, so ranking may be less precise.',
      }
    : undefined

export const highlightedText = (value: string, terms: readonly string[]): string => {
  let snippet = escapeHtml(value)
  for (const term of [...terms].sort((a, b) => b.length - a.length)) {
    const safeTerm = escapeHtml(term)
    snippet = snippet.replace(new RegExp(escapeRegex(safeTerm), 'giu'), '<mark>$&</mark>')
  }
  return snippet
}

export const bestTextWindow = (value: string, terms: readonly string[]): string => {
  const lower = value.toLowerCase()
  const first = terms
    .map((term) => lower.indexOf(term))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0] ?? 0
  const start = Math.max(first - 48, 0)
  const end = Math.min(start + 160, value.length)
  return `${start > 0 ? '…' : ''}${highlightedText(value.slice(start, end), terms)}${end < value.length ? '…' : ''}`
}

export interface SnippetChoice {
  readonly snippet: string
  readonly kind: SearchHitKind
  readonly anchor?: string
}

const titleNeedle = (query: string): string => {
  const parsed = parseSearchQuery(query)
  return parsed.phrases[0] ?? parsed.positive.join(' ')
}

export const finalScore = (
  row: { title: string; rank: number; updatedAt: number },
  query: string,
  now: number,
): number => {
  const needle = titleNeedle(query)
  const title = row.title.trim().toLowerCase()
  const exactTitle = needle && title === needle ? 1 : 0
  const prefixTitle = needle && title.startsWith(needle) ? 1 : 0
  const ageDays = Math.max((now - row.updatedAt) / 86_400_000, 0)
  const recencyBoost = 1 / (1 + ageDays / 30)
  return row.rank - exactTitle * 1_000 - prefixTitle * 100 - recencyBoost * 2
}

export const emptyResponse = (
  query: string,
  request: Required<SearchRequest>,
  hint?: SearchTokenizerHint,
): SearchResponse => ({
  query,
  hits: [],
  total: 0,
  limit: request.limit,
  offset: request.offset,
  hasMore: false,
  ...(hint ? { tokenizerHint: hint } : {}),
})

export const likeRank = (
  row: { title: string; description: string; content: string; updatedAt: number },
  terms: readonly string[],
  query: string,
  now: number,
): number => {
  const title = row.title.toLowerCase()
  const description = row.description.toLowerCase()
  const content = row.content.toLowerCase()
  const base = terms.reduce((rank, term) => {
    if (title.includes(term)) return rank - 10
    if (description.includes(term)) return rank - 5
    if (content.includes(term)) return rank - 1
    return rank
  }, 0)
  return finalScore({ title: row.title, rank: base, updatedAt: row.updatedAt }, query, now)
}

export const likeSnippet = (
  row: { title: string; description: string; content: string },
  terms: readonly string[],
  comments: string,
  assetText: string,
): SnippetChoice => {
  const sources: Array<{ value: string; kind: SearchHitKind; anchor?: string }> = [
    { value: row.title, kind: 'page' },
    { value: row.description, kind: 'page' },
    { value: toPlainText(row.content), kind: 'page' },
    { value: comments, kind: 'comment', anchor: 'comments' },
    { value: assetText, kind: 'asset', anchor: 'attachments' },
  ]
  const populatedSources = sources.filter((source) => source.value)
  const source = populatedSources.find((candidate) => terms.some((term) => candidate.value.toLowerCase().includes(term))) ?? populatedSources[0]
  if (!source) return { snippet: '', kind: 'page' }
  return {
    snippet: bestTextWindow(source.value, terms),
    kind: source.kind,
    ...(source.anchor ? { anchor: source.anchor } : {}),
  }
}

export const sortHits = (hits: SearchHit[], sort: SearchSort): SearchHit[] =>
  [...hits].sort((a, b) => {
    if (sort === 'recent') return b.updatedAt - a.updatedAt || a.rank - b.rank || a.path.localeCompare(b.path)
    return a.rank - b.rank || b.updatedAt - a.updatedAt || a.path.localeCompare(b.path)
  })
