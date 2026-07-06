/**
 * Search service — SQLite FTS5 with BM25 ranking and highlighted snippets.
 *
 * Mirrors the *idea* of Wiki.js's weighted PostgreSQL `tsvector` (title ≫
 * description ≫ body) but with a single, zero-dependency backend. We build a
 * forgiving prefix query so search feels good as-you-type.
 */
import type { DB } from '../db/client.ts'

export interface SearchHit {
  readonly path: string
  readonly title: string
  readonly snippet: string
  /** BM25 score — lower (more negative) is more relevant. */
  readonly rank: number
}

export interface SearchFilters {
  readonly pathPrefix?: string
  readonly label?: string
  readonly status?: string
  readonly spaceKey?: string
  readonly locale?: string
}

export interface SearchResponse {
  readonly query: string
  readonly hits: SearchHit[]
}

export interface SearchService {
  /**
   * @param canRead Optional per-page read predicate. When supplied, hits the
   *   principal is not allowed to read (via page rules) are filtered out, so
   *   search never leaks titles/paths/snippets past `page:read` ACLs.
   */
  search(
    query: string,
    limit?: number,
    filters?: SearchFilters,
    canRead?: (path: string) => boolean,
  ): SearchResponse
}

/**
 * Turn raw user input into a safe FTS5 MATCH expression. We strip the FTS
 * operator characters and turn each term into a prefix query, AND-ed together.
 *   `"hello wor"` → `hello* wor*`
 */
export const buildMatchQuery = (raw: string): string | null => {
  const cleaned = (raw ?? '').toLowerCase().replace(/["()*:^]/g, ' ').trim()
  if (!cleaned) return null
  const terms = cleaned.split(/\s+/).filter(Boolean)
  if (terms.length === 0) return null
  return terms.map((t) => `"${t}"*`).join(' ')
}

export const createSearchService = (db: DB): SearchService => {
  // bm25 weights line up with the FTS columns: page_id, title, description, content.
  // Snippet markup is safe: the `content` column is stored via toPlainText(), which
  // renders Markdown with raw-HTML disabled and strips tags, so it is already
  // HTML-entity-encoded — the only live markup in a snippet is the <mark> we add.
  const stmt = db.$client.prepare(`
    SELECT
      p.path  AS path,
      p.title AS title,
      snippet(pages_fts, 3, '<mark>', '</mark>', '…', 12) AS snippet,
      bm25(pages_fts, 0.0, 10.0, 5.0, 1.0) AS rank
    FROM pages_fts
    JOIN pages p ON p.id = pages_fts.page_id
    WHERE pages_fts MATCH ?
      AND p.lifecycle = 'active'
      AND (? IS NULL OR p.path LIKE ?)
      AND (? IS NULL OR p.labels LIKE ?)
      AND (? IS NULL OR p.status = ?)
      AND (? IS NULL OR p.space_key = ?)
      AND (? IS NULL OR p.locale = ?)
    ORDER BY rank
    LIMIT ?
  `)

  return {
    search(query, limit = 20, filters = {}, canRead) {
      const match = buildMatchQuery(query)
      if (!match) return { query, hits: [] }
      const pathPrefix = filters.pathPrefix?.trim()
      const label = filters.label?.trim()
      const status = filters.status?.trim()
      const spaceKey = filters.spaceKey?.trim()
      const locale = filters.locale?.trim()
      // When we have to ACL-filter, over-fetch a bounded candidate window so a
      // few denied pages don't shrink the visible result set below `limit`.
      const fetchLimit = canRead ? Math.min(Math.max(limit * 8, 40), 400) : limit
      try {
        const rows = stmt.all(
          match,
          pathPrefix || null,
          pathPrefix ? `${pathPrefix.replace(/[%_]/g, '')}%` : null,
          label || null,
          label ? `%"${label.replace(/[%_"]/g, '')}"%` : null,
          status || null,
          status || null,
          spaceKey || null,
          spaceKey || null,
          locale || null,
          locale || null,
          fetchLimit,
        ) as SearchHit[]
        const visible = canRead ? rows.filter((row) => canRead(row.path)) : rows
        return { query, hits: visible.slice(0, limit) }
      } catch {
        // Malformed FTS expression — treat as no results rather than 500.
        return { query, hits: [] }
      }
    },
  }
}
