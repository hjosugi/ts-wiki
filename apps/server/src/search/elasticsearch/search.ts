/**
 * ACL-safe Elasticsearch implementation of the driver-neutral SearchIndexer.
 *
 * Authorization is deliberately expressed as an Elasticsearch filter before
 * the engine computes totals, highlights, sorting, or pagination. Denied
 * documents therefore cannot influence any observable part of the response.
 */
import type { PageRecord } from '../../repositories/pages.ts'
import type { SearchOutboxRepository } from '../../repositories/search-outbox.ts'
import { parseSearchQuery } from '../../services/search-query.ts'
import {
  countSearchCharacters,
  emptyResponse,
  escapeHtml,
  indexedText,
} from '../../services/search-support.ts'
import {
  canReadSearchPath,
  type SearchAccess,
  type SearchHit,
  type SearchHitKind,
  type SearchIndexer,
  type SearchIndexStatus,
  type SearchRequest,
  type SearchResponse,
  type SearchTokenizer,
} from '../../services/search.ts'
import type { ElasticsearchClient } from './client.ts'
import { buildPageDocument, type PageIndexSource, type PageDocument } from './document.ts'
import {
  currentPageIndex,
  ensurePageIndex,
  pageAlias,
  pageIndexName,
  pointPageAlias,
  pruneOldPageIndices,
} from './index-management.ts'

const SEARCH_FIELDS = ['title^4', 'description^2', 'content', 'comments', 'assets', 'assets.filename'] as const
const HIGHLIGHT_FIELDS = ['title', 'description', 'content', 'comments', 'assets'] as const
const MAX_PREDICATE_CANDIDATES = 10_000
const ACL_TERMS_CHUNK_SIZE = 2_000
const MAX_OUTBOX_ATTEMPTS = 5

export interface PageIndexRecord {
  readonly pageId: string
  readonly source: PageIndexSource
}

export interface ElasticsearchSearchDataSource {
  readonly outbox: SearchOutboxRepository
  loadPageSource(pageId: string): Promise<PageIndexSource | null>
  loadAllPageSources(): Promise<PageIndexRecord[]>
}

export interface ElasticsearchSearchIndexerDeps extends ElasticsearchSearchDataSource {
  readonly client: ElasticsearchClient
  readonly indexPrefix: string
  readonly now?: () => number
}

export interface ElasticsearchHealth {
  readonly healthy: boolean
  readonly index: string | null
  readonly pending: number
  readonly deadLettered: number
}

export interface ElasticsearchSearchIndexer extends SearchIndexer {
  /** Ensure the stable alias exists, rebuilding existing database pages if not. */
  initialize(): Promise<void>
  health(): Promise<ElasticsearchHealth>
}

interface ElasticsearchHit {
  readonly _score: number | null
  readonly _source: PageDocument
  readonly highlight?: Partial<Record<(typeof HIGHLIGHT_FIELDS)[number], string[]>>
}

interface ElasticsearchSearchResult {
  readonly hits: {
    readonly total: number | { readonly value: number; readonly relation: 'eq' | 'gte' }
    readonly hits: ElasticsearchHit[]
  }
}

const totalValue = (total: ElasticsearchSearchResult['hits']['total']): number =>
  typeof total === 'number' ? total : total.value

const chunks = <T>(values: readonly T[], size: number): T[][] => {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}

/** Split large ACL allow-lists so each terms query stays comfortably below ES limits. */
const readablePathsFilter = (paths: readonly string[]): unknown => {
  const unique = [...new Set(paths)]
  const groups = chunks(unique, ACL_TERMS_CHUNK_SIZE)
  if (groups.length === 1) return { terms: { path: groups[0] } }
  return {
    bool: {
      should: groups.map((group) => ({ terms: { path: group } })),
      minimum_should_match: 1,
    },
  }
}

const textMatch = (query: string, fields: readonly string[], phrase: boolean): unknown => ({
  multi_match: {
    query,
    fields,
    type: phrase ? 'phrase' : 'best_fields',
    ...(phrase ? {} : { operator: 'and' }),
  },
})

const escapeWildcard = (value: string): string => value.replace(/[\\*?]/g, (character) => `\\${character}`)

const filterClauses = (request: Required<SearchRequest>, access?: SearchAccess): unknown[] => {
  const filters: unknown[] = []
  const values = request.filters
  if (typeof access === 'object') filters.push(readablePathsFilter(access.readablePaths))
  if (values.pathPrefix) filters.push({ prefix: { path: values.pathPrefix } })
  if (values.label) filters.push({ term: { labels: values.label } })
  if (values.status) filters.push({ term: { status: values.status } })
  if (values.spaceKey) filters.push({ term: { spaceKey: values.spaceKey } })
  if (values.locale) filters.push({ term: { locale: values.locale } })
  if (values.author) {
    filters.push({
      bool: {
        should: [
          { term: { authorId: values.author } },
          { match_phrase: { authorName: values.author } },
          { wildcard: { authorEmail: { value: `*${escapeWildcard(values.author.toLowerCase())}*`, case_insensitive: true } } },
        ],
        minimum_should_match: 1,
      },
    })
  }
  if (values.updatedAfter !== undefined || values.updatedBefore !== undefined) {
    filters.push({
      range: {
        updatedAt: {
          ...(values.updatedAfter !== undefined ? { gte: values.updatedAfter } : {}),
          ...(values.updatedBefore !== undefined ? { lte: values.updatedBefore } : {}),
        },
      },
    })
  }
  return filters
}

const snippetForHit = (hit: ElasticsearchHit): { snippet: string; kind: SearchHitKind; anchor?: string } => {
  const highlights = hit.highlight ?? {}
  for (const field of HIGHLIGHT_FIELDS) {
    const snippet = highlights[field]?.[0]
    if (!snippet) continue
    if (field === 'comments') return { snippet, kind: 'comment', anchor: 'comments' }
    if (field === 'assets') return { snippet, kind: 'asset', anchor: 'attachments' }
    return { snippet, kind: 'page' }
  }
  return { snippet: escapeHtml(hit._source.description || hit._source.title), kind: 'page' }
}

const toSearchHit = (hit: ElasticsearchHit): SearchHit => {
  const chosen = snippetForHit(hit)
  return {
    path: hit._source.path,
    title: hit._source.title,
    icon: hit._source.icon,
    coverUrl: hit._source.coverUrl,
    coverPosition: hit._source.coverPosition,
    snippet: chosen.snippet,
    // SearchHit ranks sort ascending in the built-in implementations; negate
    // Elasticsearch's descending score to preserve that convention.
    rank: -(hit._score ?? 0),
    kind: chosen.kind,
    updatedAt: hit._source.updatedAt,
    ...(chosen.anchor ? { anchor: chosen.anchor } : {}),
  }
}

const nextIndexVersion = (current: string | null, now: number): number => {
  const parsed = current?.match(/-pages-v(\d+)$/)?.[1]
  const currentVersion = parsed ? Number(parsed) : 0
  return Math.max(now, currentVersion + 1)
}

const enqueue = (
  outbox: SearchOutboxRepository,
  pageId: string,
  operation: 'index' | 'delete',
  now: number,
): Promise<void> => outbox.enqueue({ pageId, operation, enqueuedAt: now, nextAttemptAt: now })

export const createElasticsearchSearchIndexer = (deps: ElasticsearchSearchIndexerDeps): ElasticsearchSearchIndexer => {
  const now = deps.now ?? Date.now

  const indexer: ElasticsearchSearchIndexer = {
    indexPage(page: PageRecord) {
      return enqueue(deps.outbox, page.id, 'index', now())
    },

    indexPageById(pageId: string) {
      return enqueue(deps.outbox, pageId, 'index', now())
    },

    removePage(pageId: string) {
      return enqueue(deps.outbox, pageId, 'delete', now())
    },

    async search(query: string, request: Required<SearchRequest>, access?: SearchAccess): Promise<SearchResponse> {
      const parsed = parseSearchQuery(query)
      if (parsed.positive.length === 0 && parsed.phrases.length === 0) return emptyResponse(query, request)
      if (typeof access === 'object' && access.readablePaths.length === 0) return emptyResponse(query, request)

      const fields = request.scope === 'title' ? ['title^4'] : SEARCH_FIELDS
      const must = [
        ...parsed.positive.map((term) => textMatch(term, fields, false)),
        ...parsed.phrases.map((phrase) => textMatch(phrase, fields, true)),
      ]
      const mustNot = parsed.negative.map((term) => textMatch(term, fields, term.includes(' ')))
      const predicateOnly = typeof access === 'function'
      const response = await deps.client.request<ElasticsearchSearchResult>('POST', `/${pageAlias(deps.indexPrefix)}/_search`, {
        from: predicateOnly ? 0 : request.offset,
        size: predicateOnly ? MAX_PREDICATE_CANDIDATES : request.limit,
        track_total_hits: true,
        _source: true,
        query: {
          bool: {
            must,
            must_not: mustNot,
            filter: filterClauses(request, access),
          },
        },
        sort: request.sort === 'recent'
          ? [{ updatedAt: 'desc' }, { _score: 'desc' }, { path: 'asc' }]
          : [{ _score: 'desc' }, { updatedAt: 'desc' }, { path: 'asc' }],
        highlight: {
          fields: Object.fromEntries(HIGHLIGHT_FIELDS.map((field) => [
            field,
            field === 'assets' ? { matched_fields: ['assets', 'assets.filename'] } : {},
          ])),
          pre_tags: ['<mark>'],
          post_tags: ['</mark>'],
          encoder: 'html',
          fragment_size: 160,
          number_of_fragments: 1,
        },
      })

      const allHits = response.hits.hits.map(toSearchHit).filter((hit) => canReadSearchPath(access, hit.path))
      const hits = predicateOnly
        ? allHits.slice(request.offset, request.offset + request.limit)
        : allHits
      const total = predicateOnly ? allHits.length : totalValue(response.hits.total)
      return {
        query,
        hits,
        total,
        limit: request.limit,
        offset: request.offset,
        hasMore: request.offset + request.limit < total,
      }
    },

    async rebuild(_tokenizer: SearchTokenizer): Promise<void> {
      const current = await currentPageIndex(deps.client, deps.indexPrefix)
      const version = nextIndexVersion(current, now())
      const target = pageIndexName(deps.indexPrefix, version)
      await ensurePageIndex(deps.client, deps.indexPrefix, version)
      const records = await deps.loadAllPageSources()
      for (const record of records) {
        await deps.client.request('PUT', `/${target}/_doc/${encodeURIComponent(record.pageId)}`, buildPageDocument(record.source))
      }
      await deps.client.request('POST', `/${target}/_refresh`)
      await pointPageAlias(deps.client, deps.indexPrefix, version)
      await pruneOldPageIndices(deps.client, deps.indexPrefix)
    },

    async status(): Promise<SearchIndexStatus> {
      const records = await deps.loadAllPageSources()
      let cjkPages = 0
      let indexedCharacters = 0
      let cjkCharacters = 0
      for (const record of records) {
        const source = record.source
        const text = indexedText(source, `${source.comments}\n${source.assets}`)
        const counts = countSearchCharacters(text)
        if (counts.cjk > 0) cjkPages += 1
        indexedCharacters += counts.total
        cjkCharacters += counts.cjk
      }
      return {
        tokenizer: 'trigram',
        configuredTokenizer: 'trigram',
        totalPages: records.length,
        cjkPages,
        cjkPageRatio: records.length === 0 ? 0 : cjkPages / records.length,
        indexedCharacters,
        cjkCharacters,
        cjkCharacterRatio: indexedCharacters === 0 ? 0 : cjkCharacters / indexedCharacters,
        recommendedTokenizer: 'trigram',
        needsTrigram: false,
      }
    },

    async initialize(): Promise<void> {
      await deps.client.ping()
      if (await currentPageIndex(deps.client, deps.indexPrefix)) return
      await indexer.rebuild('trigram')
    },

    async health(): Promise<ElasticsearchHealth> {
      const currentTime = now()
      try {
        await deps.client.ping()
        const [index, pending, deadLettered] = await Promise.all([
          currentPageIndex(deps.client, deps.indexPrefix),
          deps.outbox.pendingCount(currentTime, MAX_OUTBOX_ATTEMPTS),
          deps.outbox.deadLetterCount(MAX_OUTBOX_ATTEMPTS),
        ])
        return { healthy: index !== null && deadLettered === 0, index, pending, deadLettered }
      } catch {
        const [pending, deadLettered] = await Promise.all([
          deps.outbox.pendingCount(currentTime, MAX_OUTBOX_ATTEMPTS),
          deps.outbox.deadLetterCount(MAX_OUTBOX_ATTEMPTS),
        ])
        return { healthy: false, index: null, pending, deadLettered }
      }
    },
  }

  return indexer
}
