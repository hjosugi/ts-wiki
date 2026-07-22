/**
 * Elasticsearch SearchIndexer contract — integration, enabled by
 * KAWAII_WIKI_TEST_ELASTICSEARCH_URL. The assertions intentionally put an ACL
 * allow-list in the ES query and verify denied paths do not affect totals,
 * pagination, titles, or highlights.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createDb, type DB } from '../../db/client.ts'
import { createSqliteSearchOutboxRepository } from '../../db/repositories/search-outbox.ts'
import type { SearchRequest } from '../../services/search.ts'
import type { PageIndexSource } from './document.ts'
import { pageIndexName } from './index-management.ts'
import { createElasticsearchSearchIndexer, type PageIndexRecord } from './search.ts'
import { createElasticsearchTestClient, testElasticsearchUrl, waitForElasticsearch } from './test-support.ts'

const PREFIX = 'kw-searchtest'
const request: Required<SearchRequest> = { limit: 20, offset: 0, filters: {}, scope: 'all', sort: 'relevance' }

const source = (over: Partial<PageIndexSource> = {}): PageIndexSource => ({
  path: 'docs/alpha',
  title: 'Alpha Kiwi Guide',
  description: 'public description',
  content: 'public body exact error code phrase',
  comments: 'decision comment',
  assets: 'diagram.png artwork',
  spaceKey: 'docs',
  status: 'verified',
  locale: 'en',
  authorId: 'user-1',
  authorName: 'Alice Example',
  authorEmail: 'alice@example.com',
  labels: '["guide"]',
  icon: '📘',
  coverUrl: '/cover.png',
  coverPosition: 'center',
  updatedAt: 100,
  ...over,
})

const records: PageIndexRecord[] = [
  { pageId: 'public-1', source: source() },
  {
    pageId: 'public-2',
    source: source({
      path: 'blog/beta',
      title: 'Beta',
      description: '',
      content: 'public body splitword',
      comments: '',
      assets: '',
      spaceKey: 'blog',
      status: 'draft',
      locale: 'ja',
      labels: '["news"]',
      authorId: 'user-2',
      authorName: 'Bob',
      authorEmail: 'bob@example.com',
      updatedAt: 200,
    }),
  },
  {
    pageId: 'secret-1',
    source: source({
      path: 'secret/roadmap',
      title: 'Classified public roadmap',
      description: 'denied-description-marker',
      content: 'public body denied-snippet-marker',
      comments: '',
      assets: '',
      spaceKey: 'secret',
      labels: '["secret"]',
      authorId: 'user-3',
      authorName: 'Carol',
      authorEmail: 'carol@example.com',
      updatedAt: 300,
    }),
  },
]

describe.skipIf(!testElasticsearchUrl)('elasticsearch ACL-safe search indexer', () => {
  const client = createElasticsearchTestClient()
  const databases: DB[] = []
  const prefixes: string[] = []

  const cleanup = async () => {
    for (const prefix of prefixes) {
      for (const candidate of [1, 2, 3, 4]) {
        await client.request('DELETE', `/${pageIndexName(prefix, candidate)}`).catch(() => {})
      }
    }
  }

  const createIndexer = () => {
    const db = createDb(':memory:')
    databases.push(db)
    const prefix = `${PREFIX}-${prefixes.length + 1}`
    prefixes.push(prefix)
    let version = 0
    const byId = new Map(records.map((record) => [record.pageId, record.source]))
    return createElasticsearchSearchIndexer({
      client,
      indexPrefix: prefix,
      outbox: createSqliteSearchOutboxRepository(db),
      loadPageSource: async (pageId) => byId.get(pageId) ?? null,
      loadAllPageSources: async () => records,
      now: () => ++version,
    })
  }

  beforeAll(async () => { await waitForElasticsearch(client) }, 30_000)
  afterAll(async () => {
    await cleanup()
    for (const db of databases) db.$client.close()
  }, 30_000)

  test('filters ACLs before totals, pagination, and highlighting', async () => {
    const indexer = createIndexer()
    await indexer.initialize()
    const access = { readablePaths: ['docs/alpha', 'blog/beta'] }

    const first = await indexer.search('public', { ...request, limit: 1 }, access)
    expect(first).toMatchObject({ total: 2, limit: 1, offset: 0, hasMore: true })
    expect(first.hits).toHaveLength(1)
    expect(JSON.stringify(first)).not.toContain('secret/roadmap')
    expect(JSON.stringify(first)).not.toContain('Classified')
    expect(JSON.stringify(first)).not.toContain('denied-')

    const second = await indexer.search('public', { ...request, limit: 1, offset: 1 }, access)
    expect(second).toMatchObject({ total: 2, hasMore: false })
    expect(second.hits).toHaveLength(1)

    const deniedOnly = await indexer.search('denied-snippet-marker', request, access)
    expect(deniedOnly).toMatchObject({ hits: [], total: 0, hasMore: false })
    expect(await indexer.search('public', request, { readablePaths: [] })).toMatchObject({ hits: [], total: 0 })
  })

  test('supports phrases, exclusions, title scope, filters, sorting, and highlights', async () => {
    const indexer = createIndexer()
    await indexer.initialize()
    const access = { readablePaths: records.map((record) => record.source.path) }

    expect((await indexer.search('"error code"', request, access)).hits.map((hit) => hit.path)).toEqual(['docs/alpha'])
    expect((await indexer.search('public -splitword', request, access)).hits.map((hit) => hit.path)).not.toContain('blog/beta')
    expect((await indexer.search('kiwi', { ...request, scope: 'title' }, access)).hits.map((hit) => hit.path)).toEqual(['docs/alpha'])
    expect((await indexer.search('public', { ...request, filters: { pathPrefix: 'docs/' } }, access)).hits.map((hit) => hit.path)).toEqual(['docs/alpha'])
    expect((await indexer.search('public', { ...request, filters: { label: 'news' } }, access)).hits.map((hit) => hit.path)).toEqual(['blog/beta'])
    expect((await indexer.search('public', { ...request, filters: { status: 'draft', spaceKey: 'blog', locale: 'ja' } }, access)).hits.map((hit) => hit.path)).toEqual(['blog/beta'])
    expect((await indexer.search('public', { ...request, filters: { author: 'alice@example' } }, access)).hits.map((hit) => hit.path)).toEqual(['docs/alpha'])
    expect((await indexer.search('public', { ...request, filters: { updatedAfter: 150 } }, access)).hits.map((hit) => hit.path)).toEqual(['secret/roadmap', 'blog/beta'])

    const recent = await indexer.search('public', { ...request, sort: 'recent' }, access)
    expect(recent.hits.map((hit) => hit.path)).toEqual(['secret/roadmap', 'blog/beta', 'docs/alpha'])
    expect((await indexer.search('decision', request, access)).hits[0]).toMatchObject({
      path: 'docs/alpha', kind: 'comment', anchor: 'comments',
    })
    expect((await indexer.search('diagram', request, access)).hits[0]).toMatchObject({
      path: 'docs/alpha', kind: 'asset', anchor: 'attachments',
    })
    expect((await indexer.search('public', request, access)).hits[0]?.snippet).toContain('<mark>')
  })

  test('rebuild swaps aliases and write methods enqueue instead of calling Elasticsearch', async () => {
    const indexer = createIndexer()
    await indexer.initialize()
    await indexer.rebuild('trigram')
    expect((await indexer.search('kiwi', request, { readablePaths: ['docs/alpha'] })).hits[0]?.path).toBe('docs/alpha')

    await indexer.indexPageById('public-1')
    await indexer.removePage('secret-1')
    const health = await indexer.health()
    expect(health).toMatchObject({ healthy: true, pending: 2, deadLettered: 0 })
    expect(await indexer.status()).toMatchObject({ tokenizer: 'trigram', totalPages: 3, needsTrigram: false })
  })
})
