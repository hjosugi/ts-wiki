import { emptyResponse } from '../../../services/search-support.ts'
import type { SearchIndexStatus, SearchIndexer, SearchResponse, SearchTokenizer } from '../../../services/search.ts'
import type { MysqlClient } from '../client.ts'

/**
 * Placeholder MySQL search indexer.
 *
 * MySQL's real search backend — FULLTEXT with an ngram parser for CJK, the
 * analogue of the Postgres tsvector adapter — lands in its own slice. Until
 * then this stand-in lets the composition root wire up and quietly absorbs the
 * index/remove calls page writes make, without pretending to search: every
 * query returns an empty result set and status reports an empty index. The
 * composed-service contract test excludes search for exactly this reason, and
 * MySQL is not offered as a selectable driver until the real indexer lands.
 */
export const createMysqlSearchIndexer = (
  _client: MysqlClient,
  options: { configuredTokenizer?: SearchTokenizer } = {},
): SearchIndexer => {
  let configuredTokenizer: SearchTokenizer = options.configuredTokenizer ?? 'unicode61'
  return {
    indexPage() {},
    indexPageById() {},
    removePage() {},
    search(query, request): SearchResponse {
      return emptyResponse(query, request)
    },
    rebuild(tokenizer) {
      configuredTokenizer = tokenizer
    },
    status(): SearchIndexStatus {
      return {
        tokenizer: configuredTokenizer,
        configuredTokenizer,
        totalPages: 0,
        cjkPages: 0,
        cjkPageRatio: 0,
        indexedCharacters: 0,
        cjkCharacters: 0,
        cjkCharacterRatio: 0,
        recommendedTokenizer: configuredTokenizer,
        needsTrigram: false,
      }
    },
  } satisfies SearchIndexer
}
