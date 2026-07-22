/**
 * PostgreSQL search indexer — the tsvector analogue of the SQLite FTS5 adapter.
 *
 * Each active page is materialized into `page_search` (see migrate.ts) with a
 * weighted `tsvector` (title A, description B, content C, comments/assets D) for
 * word matching and a lowercased `searchable` column indexed with `pg_trgm` for
 * CJK and substring matching. Candidate rows are retrieved in SQL; the ranking,
 * highlighting, ACL filtering, and hit shaping reuse the dialect-neutral helpers
 * in `services/search-support.ts` — the same code the SQLite trigram path uses.
 */
import { eq, inArray } from 'drizzle-orm'
import { toPlainText } from '@kawaii-wiki/core'
import { containsCjk, parseSearchQuery } from '../../../services/search-query.ts'
import {
  countSearchCharacters,
  emptyResponse,
  escapeLike,
  indexedText,
  likeRank,
  likeSnippet,
  sortHits,
  tokenizerHint,
} from '../../../services/search-support.ts'
import {
  canReadSearchPath,
  type SearchAccess,
  type SearchHit,
  type SearchIndexer,
  type SearchIndexStatus,
  type SearchRequest,
  type SearchResponse,
  type SearchTokenizer,
} from '../../../services/search.ts'
import type { PostgresClient, PostgresDb } from '../client.ts'
import { assets, pageAssetRefs, pageComments, pages } from '../schema.ts'
import { syncPostgresPageAssetReferences } from './asset-references.ts'

type PageRow = typeof pages.$inferSelect

const commentTextForPage = async (db: PostgresDb, pageId: string): Promise<string> => {
  const rows = await db.select({ body: pageComments.body }).from(pageComments).where(eq(pageComments.pageId, pageId))
  return rows.map((row) => toPlainText(row.body)).join('\n')
}

const assetTextForPage = async (db: PostgresDb, pageId: string): Promise<string> => {
  const rows = await db
    .select({ filename: assets.filename, folder: assets.folder })
    .from(pageAssetRefs)
    .innerJoin(assets, eq(assets.id, pageAssetRefs.assetId))
    .where(eq(pageAssetRefs.pageId, pageId))
  return rows.map((asset) => `${asset.filename} ${asset.folder}`.trim()).join('\n')
}

const clampCandidate = (offset: number, limit: number): number =>
  Math.min(Math.max((offset + limit) * 4, 100), 2_000)

interface CandidateRow {
  readonly path: string
  readonly title: string
  readonly icon: string
  readonly coverUrl: string
  readonly coverPosition: string
  readonly description: string
  readonly updatedAt: number
  readonly sTitle: string
  readonly sDescription: string
  readonly sContent: string
  readonly sComments: string
  readonly sAssets: string
  readonly searchable: string
}

/** PostgreSQL implementation of the driver-neutral search indexer. */
export const createPostgresSearchIndexer = (
  client: PostgresClient,
  options: { configuredTokenizer?: SearchTokenizer } = {},
): SearchIndexer => {
  const { sql, db } = client
  let configuredTokenizer: SearchTokenizer = options.configuredTokenizer ?? 'unicode61'

  const writePage = async (page: PageRow): Promise<void> => {
    await sql`DELETE FROM page_search WHERE page_id = ${page.id}`
    if (page.lifecycle !== 'active') {
      await db.delete(pageAssetRefs).where(eq(pageAssetRefs.pageId, page.id))
      return
    }
    await syncPostgresPageAssetReferences(db, page.id, page.content)
    const content = toPlainText(page.content)
    const comments = await commentTextForPage(db, page.id)
    const assetText = await assetTextForPage(db, page.id)
    const searchable = `${page.title}\n${page.description}\n${content}\n${comments}\n${assetText}`.toLowerCase()
    await sql`
      INSERT INTO page_search (page_id, title, description, content, comments, assets, tsv, searchable)
      VALUES (
        ${page.id}, ${page.title}, ${page.description}, ${content}, ${comments}, ${assetText},
        setweight(to_tsvector('simple', ${page.title}), 'A')
          || setweight(to_tsvector('simple', ${page.description}), 'B')
          || setweight(to_tsvector('simple', ${content}), 'C')
          || setweight(to_tsvector('simple', ${comments}), 'D')
          || setweight(to_tsvector('simple', ${assetText}), 'D'),
        ${searchable}
      )
    `
  }

  const fetchCandidates = async (
    tsquery: string,
    like: string,
    request: Required<SearchRequest>,
    limit: number,
  ): Promise<CandidateRow[]> => {
    const f = request.filters
    const pathPrefix = f.pathPrefix?.trim() || null
    const label = f.label?.trim() ? `%"${f.label.trim().replace(/[%_"]/g, '')}"%` : null
    const status = f.status?.trim() || null
    const spaceKey = f.spaceKey?.trim() || null
    const locale = f.locale?.trim() || null
    const author = f.author?.trim().toLowerCase() || null
    const authorLike = author ? `%${escapeLike(author)}%` : null
    const updatedAfter = f.updatedAfter ?? null
    const updatedBefore = f.updatedBefore ?? null
    return (await sql`
      SELECT p.path AS "path", p.title AS "title", p.icon AS "icon", p.cover_url AS "coverUrl",
             p.cover_position AS "coverPosition", p.description AS "description", p.updated_at AS "updatedAt",
             ps.title AS "sTitle", ps.description AS "sDescription", ps.content AS "sContent",
             ps.comments AS "sComments", ps.assets AS "sAssets", ps.searchable AS "searchable"
      FROM page_search ps
      JOIN pages p ON p.id = ps.page_id
      LEFT JOIN users u ON u.id = p.author_id
      WHERE (ps.tsv @@ websearch_to_tsquery('simple', ${tsquery}) OR ps.searchable LIKE ${like})
        AND p.lifecycle = 'active'
        AND (${pathPrefix}::text IS NULL OR p.path LIKE ${pathPrefix ? `${escapeLike(pathPrefix)}%` : null})
        AND (${label}::text IS NULL OR p.labels LIKE ${label})
        AND (${status}::text IS NULL OR p.status = ${status})
        AND (${spaceKey}::text IS NULL OR p.space_key = ${spaceKey})
        AND (${locale}::text IS NULL OR p.locale = ${locale})
        AND (${author}::text IS NULL OR p.author_id = ${author}
             OR lower(coalesce(u.name, '')) LIKE ${authorLike} OR lower(coalesce(u.email, '')) LIKE ${authorLike})
        AND (${updatedAfter}::bigint IS NULL OR p.updated_at >= ${updatedAfter})
        AND (${updatedBefore}::bigint IS NULL OR p.updated_at <= ${updatedBefore})
      LIMIT ${limit}
    `) as CandidateRow[]
  }

  const toHit = (row: CandidateRow, matchTerms: readonly string[], query: string, now: number): SearchHit => {
    const chosen = likeSnippet(
      { title: row.sTitle, description: row.sDescription, content: row.sContent },
      matchTerms,
      row.sComments,
      row.sAssets,
    )
    return {
      path: row.path,
      title: row.title,
      icon: row.icon,
      coverUrl: row.coverUrl,
      coverPosition: row.coverPosition,
      snippet: chosen.snippet,
      rank: likeRank({ title: row.sTitle, description: row.sDescription, content: row.sContent, updatedAt: Number(row.updatedAt) }, matchTerms, query, now),
      kind: chosen.kind,
      updatedAt: Number(row.updatedAt),
      ...(chosen.anchor ? { anchor: chosen.anchor } : {}),
    }
  }

  const indexer = {
    indexPage: (page: PageRow) => writePage(page),

    async indexPageById(pageId: string) {
      const [record] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1)
      if (!record) {
        await sql`DELETE FROM page_search WHERE page_id = ${pageId}`
        await db.delete(pageAssetRefs).where(eq(pageAssetRefs.pageId, pageId))
        return
      }
      await writePage(record)
    },

    async removePage(pageId: string) {
      await sql`DELETE FROM page_search WHERE page_id = ${pageId}`
    },

    async search(query: string, request: Required<SearchRequest>, access?: SearchAccess): Promise<SearchResponse> {
      const hint = tokenizerHint(query, containsCjk(query) ? 'unicode61' : 'trigram')
      const parsed = parseSearchQuery(query)
      const matchTerms = [...parsed.positive, ...parsed.phrases].map((term) => term.toLowerCase())
      const excludeTerms = parsed.negative.map((term) => term.toLowerCase())
      if (matchTerms.length === 0) return emptyResponse(query, request, hint)

      const now = Date.now()
      const tsquery = matchTerms.join(' ')
      const like = `%${escapeLike(matchTerms[0] ?? '')}%`
      try {
        const rows = await fetchCandidates(tsquery, like, request, clampCandidate(request.offset, request.limit))
        const hits = sortHits(
          rows
            .filter((row) => canReadSearchPath(access, row.path))
            .filter((row) => {
              const haystack = request.scope === 'title' ? row.sTitle.toLowerCase() : row.searchable
              return matchTerms.every((term) => haystack.includes(term)) && !excludeTerms.some((term) => haystack.includes(term))
            })
            .map((row) => toHit(row, matchTerms, query, now)),
          request.sort,
        )
        const total = hits.length
        return {
          query,
          hits: hits.slice(request.offset, request.offset + request.limit),
          total,
          limit: request.limit,
          offset: request.offset,
          hasMore: request.offset + request.limit < total,
          ...(hint ? { tokenizerHint: hint } : {}),
        }
      } catch {
        return emptyResponse(query, request, hint)
      }
    },

    async rebuild(tokenizer: SearchTokenizer) {
      configuredTokenizer = tokenizer
      await sql`DELETE FROM page_search`
      const active = await db.select({ id: pages.id }).from(pages).where(eq(pages.lifecycle, 'active'))
      for (const { id } of active) await indexer.indexPageById(id)
    },

    async status(): Promise<SearchIndexStatus> {
      const active = await db.select().from(pages).where(eq(pages.lifecycle, 'active'))
      const ids = active.map((page) => page.id)
      const commentsByPage = new Map<string, string[]>()
      const assetsByPage = new Map<string, string[]>()
      if (ids.length) {
        for (const row of await db.select({ pageId: pageComments.pageId, body: pageComments.body }).from(pageComments).where(inArray(pageComments.pageId, ids))) {
          commentsByPage.set(row.pageId, [...(commentsByPage.get(row.pageId) ?? []), toPlainText(row.body)])
        }
        for (const row of await db.select({ pageId: pageAssetRefs.pageId, filename: assets.filename, folder: assets.folder }).from(pageAssetRefs).innerJoin(assets, eq(assets.id, pageAssetRefs.assetId)).where(inArray(pageAssetRefs.pageId, ids))) {
          assetsByPage.set(row.pageId, [...(assetsByPage.get(row.pageId) ?? []), `${row.filename} ${row.folder}`.trim()])
        }
      }
      let cjkPages = 0
      let indexedCharacters = 0
      let cjkCharacters = 0
      for (const page of active) {
        const extra = `${(commentsByPage.get(page.id) ?? []).join('\n')}\n${(assetsByPage.get(page.id) ?? []).join('\n')}`
        const text = indexedText(page, extra)
        if (containsCjk(text)) cjkPages += 1
        const counts = countSearchCharacters(text)
        indexedCharacters += counts.total
        cjkCharacters += counts.cjk
      }
      // Postgres always matches CJK through the pg_trgm index, so it never needs
      // a tokenizer switch the way SQLite FTS5 does.
      return {
        tokenizer: configuredTokenizer,
        configuredTokenizer,
        totalPages: active.length,
        cjkPages,
        cjkPageRatio: active.length === 0 ? 0 : cjkPages / active.length,
        indexedCharacters,
        cjkCharacters,
        cjkCharacterRatio: indexedCharacters === 0 ? 0 : cjkCharacters / indexedCharacters,
        recommendedTokenizer: configuredTokenizer,
        needsTrigram: false,
      }
    },
  } satisfies SearchIndexer

  return indexer
}
