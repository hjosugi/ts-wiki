/**
 * Placeholder PostgreSQL search indexer.
 *
 * The real tsvector-backed implementation (replacing SQLite FTS5) is a later
 * slice (#364.4 / #366). Until then the composition needs *some* SearchIndexer:
 * this one lets every non-search flow work — writes index into a no-op, and
 * searches return an empty result set — without pretending search is available.
 * PostgreSQL is not a selectable runtime driver yet, so this is only reachable
 * through tests and the (not-yet-wired) composition root.
 */
import type { SearchIndexer, SearchIndexStatus, SearchRequest, SearchResponse } from '../../services/search.ts'

const emptyResponse = (query: string, request: Required<SearchRequest>): SearchResponse => ({
  query,
  hits: [],
  total: 0,
  limit: request.limit,
  offset: request.offset,
  hasMore: false,
})

const emptyStatus = (): SearchIndexStatus => ({
  tokenizer: 'unicode61',
  configuredTokenizer: 'unicode61',
  totalPages: 0,
  cjkPages: 0,
  cjkPageRatio: 0,
  indexedCharacters: 0,
  cjkCharacters: 0,
  cjkCharacterRatio: 0,
  recommendedTokenizer: 'unicode61',
  needsTrigram: false,
})

/** A SearchIndexer whose writes are no-ops and whose searches are empty. */
export const createUnavailablePostgresSearchIndexer = (): SearchIndexer => ({
  indexPage() {},
  indexPageById() {},
  removePage() {},
  search: (query, request) => emptyResponse(query, request),
  rebuild() {},
  status: () => emptyStatus(),
})
