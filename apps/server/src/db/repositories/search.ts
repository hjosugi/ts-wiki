/** SQLite FTS5 adapter for the driver-neutral search boundary. */
import { eq, inArray } from 'drizzle-orm'
import { toPlainText } from '@kawaii-wiki/core'
import type { DB } from '../client.ts'
import { assets, pageAssetRefs, pageComments, pages } from '../schema.ts'
import { FTS_TOKENIZER_SQL, type FtsTokenizer } from '../migrate.ts'
import { syncPageAssetReferences } from './asset-references.ts'
import { buildMatchQuery, containsCjk, parseSearchQuery } from '../../services/search-query.ts'
import type {
  SearchFilters,
  SearchHit,
  SearchHitKind,
  SearchIndexer,
  SearchIndexStatus,
  SearchRequest,
  SearchResponse,
  SearchShortQueryHint,
  SearchSort,
  SearchTokenizerHint,
} from '../../services/search.ts'

const SNIPPET_START = '\u0001'
const SNIPPET_END = '\u0002'

const indexedText = (page: { title: string; description: string; content: string }, extra = ''): string =>
  `${page.title}\n${page.description}\n${toPlainText(page.content)}\n${extra}`

const countSearchCharacters = (value: string): { total: number; cjk: number } => {
  let total = 0
  let cjk = 0
  for (const char of value) {
    if (/\s/u.test(char)) continue
    total += 1
    if (containsCjk(char)) cjk += 1
  }
  return { total, cjk }
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (char) => `\\${char}`)

const readFtsTokenizer = (db: DB, fallback: FtsTokenizer): FtsTokenizer => {
  const row = db.$client
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'pages_fts'")
    .get() as { sql?: unknown } | null
  const sql = typeof row?.sql === 'string' ? row.sql.toLowerCase() : ''
  if (sql.includes('trigram')) return 'trigram'
  if (sql.includes('unicode61')) return 'unicode61'
  return fallback
}

const tokenizerHint = (query: string, tokenizer: FtsTokenizer): SearchTokenizerHint | undefined =>
  tokenizer === 'unicode61' && containsCjk(query)
    ? {
        kind: 'cjk-tokenizer',
        tokenizer,
        recommendedTokenizer: 'trigram',
        message: 'This query contains CJK characters. Rebuild the search index with the trigram tokenizer for better Japanese/CJK matching.',
      }
    : undefined

const codePointLength = (value: string): number => Array.from(value).length

const trigramShortTerms = (terms: readonly string[], tokenizer: FtsTokenizer): string[] =>
  tokenizer === 'trigram' ? terms.filter((term) => codePointLength(term) < 3) : []

const shortQueryHint = (terms: readonly string[]): SearchShortQueryHint | undefined =>
  terms.length > 0
    ? {
        kind: 'trigram-short-query',
        tokenizer: 'trigram',
        terms,
        message: 'Short trigram queries use a bounded substring scan, so ranking may be less precise.',
      }
    : undefined

const markedSnippet = (value: string): string =>
  escapeHtml(value).replaceAll(SNIPPET_START, '<mark>').replaceAll(SNIPPET_END, '</mark>')

const hasMark = (value: string): boolean => value.includes(SNIPPET_START)

const highlightedText = (value: string, terms: readonly string[]): string => {
  let snippet = escapeHtml(value)
  for (const term of [...terms].sort((a, b) => b.length - a.length)) {
    const safeTerm = escapeHtml(term)
    snippet = snippet.replace(new RegExp(escapeRegex(safeTerm), 'giu'), '<mark>$&</mark>')
  }
  return snippet
}

const bestTextWindow = (value: string, terms: readonly string[]): string => {
  const lower = value.toLowerCase()
  const first = terms
    .map((term) => lower.indexOf(term))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0] ?? 0
  const start = Math.max(first - 48, 0)
  const end = Math.min(start + 160, value.length)
  return `${start > 0 ? '…' : ''}${highlightedText(value.slice(start, end), terms)}${end < value.length ? '…' : ''}`
}

interface SnippetChoice {
  readonly snippet: string
  readonly kind: SearchHitKind
  readonly anchor?: string
}

const chooseFtsSnippet = (row: {
  titleSnippet: string
  descriptionSnippet: string
  contentSnippet: string
  commentsSnippet: string
  assetsSnippet: string
  title: string
  description: string
}): SnippetChoice => {
  const candidates: Array<{ raw: string; kind: SearchHitKind; anchor?: string }> = [
    { raw: row.titleSnippet, kind: 'page' },
    { raw: row.descriptionSnippet, kind: 'page' },
    { raw: row.contentSnippet, kind: 'page' },
    { raw: row.commentsSnippet, kind: 'comment', anchor: 'comments' },
    { raw: row.assetsSnippet, kind: 'asset', anchor: 'attachments' },
  ]
  const choice = candidates.find((candidate) => hasMark(candidate.raw)) ?? candidates[0]!
  return {
    snippet: markedSnippet(choice.raw || row.description || row.title),
    kind: choice.kind,
    ...(choice.anchor ? { anchor: choice.anchor } : {}),
  }
}

const titleNeedle = (query: string): string => {
  const parsed = parseSearchQuery(query)
  return parsed.phrases[0] ?? parsed.positive.join(' ')
}

const finalScore = (
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

const emptyResponse = (
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

const labelsPattern = (label: string | undefined): string | null => {
  const clean = label?.trim().replace(/[%_"]/g, '')
  return clean ? `%"${clean}"%` : null
}

const filterArgs = (filters: SearchFilters): unknown[] => {
  const pathPrefix = filters.pathPrefix?.trim()
  const label = labelsPattern(filters.label)
  const status = filters.status?.trim()
  const spaceKey = filters.spaceKey?.trim()
  const locale = filters.locale?.trim()
  const author = filters.author?.trim().toLowerCase()
  const authorLike = author ? `%${escapeLike(author)}%` : null
  const updatedAfter = filters.updatedAfter ?? null
  const updatedBefore = filters.updatedBefore ?? null
  return [
    pathPrefix || null,
    pathPrefix ? `${escapeLike(pathPrefix)}%` : null,
    label,
    label,
    status || null,
    status || null,
    spaceKey || null,
    spaceKey || null,
    locale || null,
    locale || null,
    author || null,
    author || null,
    authorLike,
    authorLike,
    updatedAfter,
    updatedAfter,
    updatedBefore,
    updatedBefore,
  ]
}

const filterSql = `
  AND (? IS NULL OR p.path LIKE ? ESCAPE '\\')
  AND (? IS NULL OR p.labels LIKE ?)
  AND (? IS NULL OR p.status = ?)
  AND (? IS NULL OR p.space_key = ?)
  AND (? IS NULL OR p.locale = ?)
  AND (
    ? IS NULL
    OR p.author_id = ?
    OR lower(coalesce(u.name, '')) LIKE ? ESCAPE '\\'
    OR lower(coalesce(u.email, '')) LIKE ? ESCAPE '\\'
  )
  AND (? IS NULL OR p.updated_at >= ?)
  AND (? IS NULL OR p.updated_at <= ?)
`

const assetTextForPage = (db: DB, pageId: string): string =>
  db
    .select({
      filename: assets.filename,
      folder: assets.folder,
    })
    .from(pageAssetRefs)
    .innerJoin(assets, eq(assets.id, pageAssetRefs.assetId))
    .where(eq(pageAssetRefs.pageId, pageId))
    .all()
    .map((asset) => `${asset.filename} ${asset.folder}`.trim())
    .join('\n')

const commentTextForPage = (db: DB, pageId: string): string =>
  db
    .select({ body: pageComments.body })
    .from(pageComments)
    .where(eq(pageComments.pageId, pageId))
    .all()
    .map((comment) => toPlainText(comment.body))
    .join('\n')

const supplementalTextForPages = (db: DB, pageIds: readonly string[]) => {
  const comments = new Map<string, string[]>()
  const assetText = new Map<string, string[]>()
  if (!pageIds.length) return { comments, assetText }
  for (const row of db.select({ pageId: pageComments.pageId, body: pageComments.body })
    .from(pageComments).where(inArray(pageComments.pageId, [...pageIds])).all()) {
    const values = comments.get(row.pageId) ?? []
    values.push(toPlainText(row.body))
    comments.set(row.pageId, values)
  }
  for (const row of db.select({ pageId: pageAssetRefs.pageId, filename: assets.filename, folder: assets.folder })
    .from(pageAssetRefs).innerJoin(assets, eq(assets.id, pageAssetRefs.assetId))
    .where(inArray(pageAssetRefs.pageId, [...pageIds])).all()) {
    const values = assetText.get(row.pageId) ?? []
    values.push(`${row.filename} ${row.folder}`.trim())
    assetText.set(row.pageId, values)
  }
  return { comments, assetText }
}

export const rebuildSearchIndex = (db: DB, tokenizer: FtsTokenizer): void => {
  db.transaction(() => {
    db.$client.prepare('DROP TABLE IF EXISTS pages_fts').run()
    db.$client.exec(`CREATE VIRTUAL TABLE pages_fts USING fts5(
      page_id UNINDEXED, title, description, content, comments, assets,
      tokenize = '${FTS_TOKENIZER_SQL[tokenizer]}'
    );`)
    const indexer = createFtsSearchIndexer(db, { configuredTokenizer: tokenizer })
    for (const page of db.select({ id: pages.id }).from(pages).where(eq(pages.lifecycle, 'active')).all()) {
      indexer.indexPageById(page.id)
    }
  })
}

// Returns the concrete (synchronous) FTS indexer rather than the widened
// `SearchIndexer` interface: SQLite resolves every call synchronously, so
// direct callers keep sync ergonomics while still satisfying `SearchIndexer`
// (a sync value is a valid `Awaitable`). Async drivers return promises.
export const createFtsSearchIndexer = (
  db: DB,
  options: { configuredTokenizer?: FtsTokenizer } = {},
) => {
  const configuredTokenizer = options.configuredTokenizer ?? 'unicode61'
  const ftsInsert = db.$client.prepare(
    'INSERT INTO pages_fts(rowid, page_id, title, description, content, comments, assets) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  const ftsDelete = db.$client.prepare('DELETE FROM pages_fts WHERE page_id = ?')

  const prepareSearchStatement = () => db.$client.prepare(`
    SELECT
      p.path AS path,
      p.title AS title,
      p.icon AS icon,
      p.cover_url AS coverUrl,
      p.cover_position AS coverPosition,
      p.description AS description,
      p.updated_at AS updatedAt,
      snippet(pages_fts, 1, '${SNIPPET_START}', '${SNIPPET_END}', '…', 12) AS titleSnippet,
      snippet(pages_fts, 2, '${SNIPPET_START}', '${SNIPPET_END}', '…', 12) AS descriptionSnippet,
      snippet(pages_fts, 3, '${SNIPPET_START}', '${SNIPPET_END}', '…', 18) AS contentSnippet,
      snippet(pages_fts, 4, '${SNIPPET_START}', '${SNIPPET_END}', '…', 18) AS commentsSnippet,
      snippet(pages_fts, 5, '${SNIPPET_START}', '${SNIPPET_END}', '…', 18) AS assetsSnippet,
      bm25(pages_fts, 0.0, 10.0, 5.0, 1.0, 0.5, 0.5) AS rank
    FROM pages_fts
    JOIN pages p ON p.id = pages_fts.page_id
    LEFT JOIN users u ON u.id = p.author_id
    WHERE pages_fts MATCH ?
      AND p.lifecycle = 'active'
      ${filterSql}
    ORDER BY rank
    LIMIT ?
  `)
  let stmt = prepareSearchStatement()

  const prepareLikeStatement = () => db.$client.prepare(`
    SELECT
      p.id AS id,
      p.path AS path,
      p.title AS title,
      p.icon AS icon,
      p.cover_url AS coverUrl,
      p.cover_position AS coverPosition,
      p.description AS description,
      p.content AS content,
      p.updated_at AS updatedAt
    FROM pages p
    LEFT JOIN users u ON u.id = p.author_id
    WHERE p.lifecycle = 'active'
      AND (? IS NULL OR (
        lower(p.title) LIKE ? ESCAPE '\\'
        OR lower(p.description) LIKE ? ESCAPE '\\'
        OR lower(p.content) LIKE ? ESCAPE '\\'
        OR lower(coalesce((SELECT group_concat(pc.body, char(10)) FROM page_comments pc WHERE pc.page_id = p.id), '')) LIKE ? ESCAPE '\\'
      ))
      ${filterSql}
    ORDER BY p.updated_at DESC, p.path
    LIMIT ?
  `)
  let likeStmt = prepareLikeStatement()

  const status = (): SearchIndexStatus => {
    const activePages = db.select().from(pages).where(eq(pages.lifecycle, 'active')).all()
    let cjkPages = 0
    let indexedCharacters = 0
    let cjkCharacters = 0
    for (const page of activePages) {
      const text = indexedText(page, `${commentTextForPage(db, page.id)}\n${assetTextForPage(db, page.id)}`)
      if (containsCjk(text)) cjkPages += 1
      const counts = countSearchCharacters(text)
      indexedCharacters += counts.total
      cjkCharacters += counts.cjk
    }
    const tokenizer = readFtsTokenizer(db, configuredTokenizer)
    const cjkPageRatio = activePages.length === 0 ? 0 : cjkPages / activePages.length
    const cjkCharacterRatio = indexedCharacters === 0 ? 0 : cjkCharacters / indexedCharacters
    const needsTrigram = tokenizer === 'unicode61' && cjkCharacters > 0
    return {
      tokenizer,
      configuredTokenizer,
      totalPages: activePages.length,
      cjkPages,
      cjkPageRatio,
      indexedCharacters,
      cjkCharacters,
      cjkCharacterRatio,
      recommendedTokenizer: needsTrigram ? 'trigram' : tokenizer,
      needsTrigram,
    }
  }

  const toHit = (
    row: {
      path: string
      title: string
      icon: string
      coverUrl: string
      coverPosition: string
      description: string
      updatedAt: number
      titleSnippet: string
      descriptionSnippet: string
      contentSnippet: string
      commentsSnippet: string
      assetsSnippet: string
      rank: number
    },
    query: string,
    now: number,
  ): SearchHit => {
    const chosen = chooseFtsSnippet(row)
    return {
      path: row.path,
      title: row.title,
      icon: row.icon,
      coverUrl: row.coverUrl,
      coverPosition: row.coverPosition,
      snippet: chosen.snippet,
      rank: finalScore(row, query, now),
      kind: chosen.kind,
      updatedAt: row.updatedAt,
      ...(chosen.anchor ? { anchor: chosen.anchor } : {}),
    }
  }

  const likeRank = (
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

  const likeSnippet = (
    row: { id: string; title: string; description: string; content: string },
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

  const sortHits = (hits: SearchHit[], sort: SearchSort): SearchHit[] =>
    [...hits].sort((a, b) => {
      if (sort === 'recent') return b.updatedAt - a.updatedAt || a.rank - b.rank || a.path.localeCompare(b.path)
      return a.rank - b.rank || b.updatedAt - a.updatedAt || a.path.localeCompare(b.path)
    })

  const indexPage = (page: typeof pages.$inferSelect): void => {
      ftsDelete.run(page.id)
      if (page.lifecycle !== 'active') {
        db.delete(pageAssetRefs).where(eq(pageAssetRefs.pageId, page.id)).run()
        return
      }
      syncPageAssetReferences(db, page.id, page.content)
      ftsInsert.run(
        Math.floor(Math.random() * 2 ** 48) + 2 ** 32,
        page.id,
        page.title,
        page.description,
        toPlainText(page.content),
        commentTextForPage(db, page.id),
        assetTextForPage(db, page.id),
      )
  }

  const page = {
    indexPage,

    indexPageById(pageId: string) {
      const record = db.select().from(pages).where(eq(pages.id, pageId)).get()
      if (!record) {
        ftsDelete.run(pageId)
        db.delete(pageAssetRefs).where(eq(pageAssetRefs.pageId, pageId)).run()
        return
      }
      indexPage(record)
    },

    removePage(pageId: string) {
      ftsDelete.run(pageId)
    },

    search(query: string, request: Required<SearchRequest>, canRead?: (path: string) => boolean): SearchResponse {
      const tokenizer = readFtsTokenizer(db, configuredTokenizer)
      const hint = tokenizerHint(query, tokenizer)
      const parsed = parseSearchQuery(query)
      const shortTerms = trigramShortTerms(parsed.terms, tokenizer)
      const now = Date.now()
      if (parsed.terms.length > 0 && shortTerms.length > 0) {
        const terms = parsed.terms
        const firstTerm = terms[0]
        const like = firstTerm ? `%${escapeLike(firstTerm.toLowerCase())}%` : null
        const candidateLimit = Math.min(Math.max((request.offset + request.limit) * 4, 100), 2_000)
        const rows = likeStmt.all(
          like,
          like,
          like,
          like,
          like,
          ...filterArgs(request.filters),
          candidateLimit,
        ) as Array<{
          id: string
          path: string
          title: string
          icon: string
          coverUrl: string
          coverPosition: string
          description: string
          content: string
          updatedAt: number
        }>
        const supplemental = supplementalTextForPages(db, rows.map((row) => row.id))
        const hits = sortHits(
          rows
            .filter((row) => !canRead || canRead(row.path))
            .filter((row) => {
              const commentText = (supplemental.comments.get(row.id) ?? []).join('\n')
              const assetText = (supplemental.assetText.get(row.id) ?? []).join('\n')
              const searchable = `${row.title}\n${row.description}\n${row.content}\n${commentText}\n${assetText}`.toLowerCase()
              return terms.every((term) => searchable.includes(term.toLowerCase()))
            })
            .map((row) => {
              const chosen = likeSnippet(
                row,
                terms,
                (supplemental.comments.get(row.id) ?? []).join('\n'),
                (supplemental.assetText.get(row.id) ?? []).join('\n'),
              )
              return {
                path: row.path,
                title: row.title,
                icon: row.icon,
                coverUrl: row.coverUrl,
                coverPosition: row.coverPosition,
                snippet: chosen.snippet,
                rank: likeRank(row, parsed.terms, query, now),
                kind: chosen.kind,
                updatedAt: row.updatedAt,
                ...(chosen.anchor ? { anchor: chosen.anchor } : {}),
              }
            }),
          request.sort,
        )
        const total = hits.length
        const pageHits = hits.slice(request.offset, request.offset + request.limit)
        const short = shortQueryHint(shortTerms)
        return {
          query,
          hits: pageHits,
          total,
          limit: request.limit,
          offset: request.offset,
          hasMore: request.offset + request.limit < total,
          ...(hint ? { tokenizerHint: hint } : {}),
          ...(short ? { shortQueryHint: short, truncatedTerms: short.terms } : {}),
        }
      }

      const match = buildMatchQuery(query, request.scope)
      if (!match) return emptyResponse(query, request, hint)
      try {
        const candidateLimit = Math.min(Math.max((request.offset + request.limit) * 4, 100), 2_000)
        const rows = stmt.all(match, ...filterArgs(request.filters), candidateLimit) as Array<{
          path: string
          title: string
          icon: string
          coverUrl: string
          coverPosition: string
          description: string
          updatedAt: number
          titleSnippet: string
          descriptionSnippet: string
          contentSnippet: string
          commentsSnippet: string
          assetsSnippet: string
          rank: number
        }>
        const hits = sortHits(
          rows
            .filter((row) => !canRead || canRead(row.path))
            .map((row) => toHit(row, query, now)),
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

    rebuild(tokenizer: FtsTokenizer) {
      rebuildSearchIndex(db, tokenizer)
      stmt = prepareSearchStatement()
      likeStmt = prepareLikeStatement()
    },

    status,
  } satisfies SearchIndexer

  return page
}
