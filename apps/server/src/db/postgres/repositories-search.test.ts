/**
 * PostgreSQL search indexer contract test — integration.
 * Mirrors the SQLite FTS contract (index page/comment/asset text, ACL filtering,
 * CJK matching, status, rebuild, remove) against a real Postgres database.
 * Runs only when KAWAII_WIKI_TEST_POSTGRES_URL is set; own isolated schema.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { assets, pageComments, pages } from './schema.ts'
import { createPostgresContractDb, testPostgresUrl, type PostgresContractDb } from './test-support.ts'
import { createPostgresSearchIndexer } from './repositories/search.ts'
import type { SearchRequest } from '../../services/search.ts'

const request: Required<SearchRequest> = { limit: 20, offset: 0, filters: {}, scope: 'all', sort: 'relevance' }

describe.skipIf(!testPostgresUrl)('postgres search indexer contract', () => {
  let harness: PostgresContractDb
  beforeAll(async () => { harness = await createPostgresContractDb('kw_search_contract') })
  beforeEach(async () => { await harness.reset() })
  afterAll(async () => { await harness?.close() })

  const seed = async () => {
    await harness.db.insert(pages).values({
      id: 'page-1', path: 'docs/search', title: 'Search Guide', description: 'Japanese 検索',
      content: 'Bodyterm ![diagram](/assets/uploads/diagram.png)', status: 'verified',
      spaceKey: 'docs', locale: 'ja', createdAt: 1, updatedAt: 1,
    })
    await harness.db.insert(pageComments).values({
      id: 'comment-1', pageId: 'page-1', path: 'docs/search', body: 'Decisionterm', createdAt: 1, updatedAt: 1,
    })
    await harness.db.insert(assets).values({
      id: 'asset-1', filename: 'diagram.png', storageName: 'uploads/diagram.png', folder: 'art',
      mime: 'image/png', size: 10, createdAt: 1,
    })
  }

  test('indexes page, comment, and asset text with ACL filtering, status, rebuild, and removal', async () => {
    await seed()
    const indexer = createPostgresSearchIndexer(harness.client, { configuredTokenizer: 'unicode61' })
    await indexer.indexPageById('page-1')

    expect((await indexer.search('bodyterm', request)).hits[0]?.path).toBe('docs/search')
    expect((await indexer.search('decisionterm', request)).hits[0]).toMatchObject({ kind: 'comment', anchor: 'comments' })
    expect((await indexer.search('diagram', request)).hits[0]).toMatchObject({ kind: 'asset', anchor: 'attachments' })
    expect((await indexer.search('検索', request)).hits[0]?.path).toBe('docs/search')

    // ACL: a predicate that denies everything leaks no hit, title, or snippet.
    expect((await indexer.search('bodyterm', request, () => false)).hits).toEqual([])

    // Snippets highlight and never carry live markup.
    const snippet = (await indexer.search('bodyterm', request)).hits[0]?.snippet ?? ''
    expect(snippet).toContain('<mark>')

    expect(await indexer.status()).toMatchObject({ totalPages: 1, cjkPages: 1 })

    // Rebuild reindexes every active page from scratch.
    await indexer.rebuild('trigram')
    expect(await indexer.status()).toMatchObject({ tokenizer: 'trigram' })
    expect((await indexer.search('検索', request)).hits[0]?.path).toBe('docs/search')

    await indexer.removePage('page-1')
    expect((await indexer.search('bodyterm', request)).hits).toEqual([])
  })

  test('filters, exclusion terms, and title scope', async () => {
    await harness.db.insert(pages).values([
      { id: 'p1', path: 'docs/alpha', title: 'Alpha kiwiterm', description: '', content: 'kiwiterm body', status: 'verified', spaceKey: 'docs', createdAt: 1, updatedAt: 30 },
      { id: 'p2', path: 'blog/beta', title: 'Beta', description: '', content: 'kiwiterm splitword', status: 'draft', spaceKey: 'blog', createdAt: 1, updatedAt: 20 },
    ])
    const indexer = createPostgresSearchIndexer(harness.client)
    await indexer.indexPageById('p1')
    await indexer.indexPageById('p2')

    expect((await indexer.search('kiwiterm', request)).hits.map((h) => h.path).sort()).toEqual(['blog/beta', 'docs/alpha'])
    // path-prefix filter
    expect((await indexer.search('kiwiterm', { ...request, filters: { pathPrefix: 'docs/' } })).hits.map((h) => h.path)).toEqual(['docs/alpha'])
    // status filter
    expect((await indexer.search('kiwiterm', { ...request, filters: { status: 'draft' } })).hits.map((h) => h.path)).toEqual(['blog/beta'])
    // exclusion term
    expect((await indexer.search('kiwiterm -splitword', request)).hits.map((h) => h.path)).toEqual(['docs/alpha'])
    // title scope: only p1 has the term in its title
    expect((await indexer.search('kiwiterm', { ...request, scope: 'title' })).hits.map((h) => h.path)).toEqual(['docs/alpha'])
  })
})
