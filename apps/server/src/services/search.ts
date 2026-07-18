import {
  type AppError,
  type Principal,
  type Result,
  ok,
  requirePermission,
} from '@kawaii-wiki/core'
import type { PageRecord } from '../repositories/pages.ts'
export { buildMatchQuery, containsCjk } from './search-query.ts'

export type SearchHitKind = 'page' | 'comment' | 'asset'
export type SearchScope = 'all' | 'title'
export type SearchSort = 'relevance' | 'recent'
export type SearchTokenizer = 'unicode61' | 'trigram'

export interface SearchHit {
  readonly path: string
  readonly title: string
  readonly icon: string
  readonly coverUrl: string
  readonly coverPosition: string
  readonly snippet: string
  readonly rank: number
  readonly kind: SearchHitKind
  readonly anchor?: string
  readonly updatedAt: number
}

export interface SearchFilters {
  readonly pathPrefix?: string
  readonly label?: string
  readonly status?: string
  readonly spaceKey?: string
  readonly locale?: string
  readonly author?: string
  readonly updatedAfter?: number
  readonly updatedBefore?: number
}

export interface SearchRequest {
  readonly limit?: number
  readonly offset?: number
  readonly filters?: SearchFilters
  readonly scope?: SearchScope
  readonly sort?: SearchSort
}

export interface SearchTokenizerHint {
  readonly kind: 'cjk-tokenizer'
  readonly tokenizer: SearchTokenizer
  readonly recommendedTokenizer: 'trigram'
  readonly message: string
}

export interface SearchShortQueryHint {
  readonly kind: 'trigram-short-query'
  readonly tokenizer: 'trigram'
  readonly terms: readonly string[]
  readonly message: string
}

export interface SearchResponse {
  readonly query: string
  readonly hits: SearchHit[]
  readonly total: number
  readonly limit: number
  readonly offset: number
  readonly hasMore: boolean
  readonly tokenizerHint?: SearchTokenizerHint
  readonly shortQueryHint?: SearchShortQueryHint
  readonly truncatedTerms?: readonly string[]
}

export interface SearchIndexStatus {
  readonly tokenizer: SearchTokenizer
  readonly configuredTokenizer: SearchTokenizer
  readonly totalPages: number
  readonly cjkPages: number
  readonly cjkPageRatio: number
  readonly indexedCharacters: number
  readonly cjkCharacters: number
  readonly cjkCharacterRatio: number
  readonly recommendedTokenizer: SearchTokenizer
  readonly needsTrigram: boolean
}

export interface SearchIndexRebuildInput {
  readonly tokenizer?: SearchTokenizer
}

/**
 * A synchronous value or a promise of one. The SQLite/FTS5 indexer resolves
 * these synchronously; async drivers (Postgres) return promises, and callers
 * simply await — awaiting a plain value is transparent.
 */
export type Awaitable<T> = T | Promise<T>

export interface SearchIndexer {
  indexPage(page: PageRecord): Awaitable<void>
  indexPageById(pageId: string): Awaitable<void>
  removePage(pageId: string): Awaitable<void>
  search(query: string, request: Required<SearchRequest>, canRead?: (path: string) => boolean): Awaitable<SearchResponse>
  rebuild(tokenizer: SearchTokenizer): Awaitable<void>
  status(): Awaitable<SearchIndexStatus>
}

export interface SearchService {
  search(query: string, options?: SearchRequest, canRead?: (path: string) => boolean): Promise<SearchResponse>
  search(query: string, limit?: number, filters?: SearchFilters, canRead?: (path: string) => boolean): Promise<SearchResponse>
  indexStatus(principal: Principal | null): Promise<Result<SearchIndexStatus, AppError>>
  rebuildIndex(principal: Principal | null, input?: SearchIndexRebuildInput): Promise<Result<SearchIndexStatus, AppError>>
}

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const asLimit = (value: number | undefined): number =>
  Math.min(Math.max(Math.trunc(value ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
const asOffset = (value: number | undefined): number => Math.max(Math.trunc(value ?? 0), 0)
const isScope = (value: unknown): value is SearchScope => value === 'all' || value === 'title'
const isSort = (value: unknown): value is SearchSort => value === 'relevance' || value === 'recent'

const normalizeRequest = (limitOrOptions?: number | SearchRequest, filters: SearchFilters = {}): Required<SearchRequest> => {
  const options = typeof limitOrOptions === 'number' ? { limit: limitOrOptions, filters } : limitOrOptions ?? {}
  return {
    limit: asLimit(options.limit),
    offset: asOffset(options.offset),
    filters: options.filters ?? {},
    scope: isScope(options.scope) ? options.scope : 'all',
    sort: isSort(options.sort) ? options.sort : 'relevance',
  }
}

export const createSearchService = (indexer: SearchIndexer): SearchService => ({
  async search(query, limitOrOptions?: number | SearchRequest, filtersOrCanRead?: SearchFilters | ((path: string) => boolean), maybeCanRead?: (path: string) => boolean) {
    const request = normalizeRequest(limitOrOptions, typeof filtersOrCanRead === 'function' ? {} : filtersOrCanRead ?? {})
    const canRead = typeof filtersOrCanRead === 'function' ? filtersOrCanRead : maybeCanRead
    return indexer.search(query, request, canRead)
  },
  async indexStatus(principal) {
    const allowed = requirePermission(principal, 'admin:access')
    if (!allowed.ok) return allowed
    return ok(await indexer.status())
  },
  async rebuildIndex(principal, input = {}) {
    const allowed = requirePermission(principal, 'admin:access')
    if (!allowed.ok) return allowed
    const tokenizer = input.tokenizer ?? (await indexer.status()).tokenizer
    await indexer.rebuild(tokenizer)
    return ok(await indexer.status())
  },
})
