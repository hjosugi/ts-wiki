/** End-to-end SQLite + outbox + real Elasticsearch runtime contract. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Principal } from '@kawaii-wiki/core'
import { createDb, type DB } from '../../db/client.ts'
import { createSqliteElasticsearchDataSource } from '../../db/repositories/elasticsearch.ts'
import { createServices } from '../../db/services.ts'
import type { ElasticsearchClient } from './client.ts'
import { currentPageIndex, pageAlias } from './index-management.ts'
import { createElasticsearchSearchIndexer } from './search.ts'
import { createElasticsearchTestClient, testElasticsearchUrl, waitForElasticsearch } from './test-support.ts'
import { processOutboxBatch } from './worker.ts'

const PREFIX = 'kw-runtime-test'
const admin: Principal = { id: 'admin', role: 'admin' }
const request = { limit: 20, offset: 0, filters: {}, scope: 'all', sort: 'relevance' } as const

describe.skipIf(!testElasticsearchUrl)('Elasticsearch composed runtime', () => {
  const client = createElasticsearchTestClient()
  const databases: DB[] = []

  const cleanup = async () => {
    const index = await currentPageIndex(client, PREFIX).catch(() => null)
    if (index) await client.request('DELETE', `/${index}`).catch(() => {})
  }

  beforeAll(async () => {
    await waitForElasticsearch(client)
    await cleanup()
  }, 30_000)
  afterAll(async () => {
    await cleanup()
    for (const db of databases) db.$client.close()
  }, 30_000)

  test('save, outage recovery, move, import, and delete flow through the transactional outbox', async () => {
    const db = createDb(':memory:')
    databases.push(db)
    const data = createSqliteElasticsearchDataSource(db)
    const indexer = createElasticsearchSearchIndexer({ client, indexPrefix: PREFIX, ...data })
    await indexer.initialize()
    const services = createServices(db, {
      search: { backend: 'elasticsearch', elasticsearch: null, ftsTokenizer: 'unicode61' },
      searchIndexer: indexer,
    })
    const worker = { client, indexPrefix: PREFIX, ...data }
    const refresh = () => client.request('POST', `/${pageAlias(PREFIX)}/_refresh`)
    const access = (path: string) => ({ readablePaths: [path] })

    const created = await services.pages.create({
      path: 'docs/outbox', title: 'Outbox', content: 'initial-search-token', status: 'verified',
    }, admin)
    expect(created.ok).toBe(true)
    expect(await data.outbox.pendingCount(Date.now() + 1_000, 5)).toBe(1)
    await processOutboxBatch(worker, Date.now() + 1_000)
    await refresh()
    expect((await indexer.search('initial-search-token', request, access('docs/outbox'))).hits[0]?.path).toBe('docs/outbox')

    // Simulate an Elasticsearch outage. The page transaction still commits and
    // the failed outbox entry remains retryable until the real client recovers.
    const unavailableClient: ElasticsearchClient = {
      request: async () => { throw new Error('simulated Elasticsearch outage') },
      ping: async () => { throw new Error('simulated Elasticsearch outage') },
      close: () => {},
    }
    const updated = await services.pages.update('docs/outbox', { content: 'recovered-search-token' }, admin)
    expect(updated.ok).toBe(true)
    const failed = await processOutboxBatch({ ...worker, client: unavailableClient }, Date.now() + 2_000)
    expect(failed).toEqual({ processed: 0, failed: 1 })
    expect((await services.pages.getByPath('docs/outbox')).ok).toBe(true)

    await processOutboxBatch(worker, Date.now() + 10_000)
    await refresh()
    expect((await indexer.search('recovered-search-token', request, access('docs/outbox'))).hits[0]?.path).toBe('docs/outbox')

    const moved = await services.pages.move('docs/outbox', 'guides/outbox', admin)
    expect(moved.ok).toBe(true)
    await processOutboxBatch(worker, Date.now() + 11_000)
    await refresh()
    expect((await indexer.search('recovered-search-token', request, access('guides/outbox'))).hits[0]?.path).toBe('guides/outbox')

    const imported = await services.pages.upsertFromFile('docs/imported', {
      title: 'Imported', description: '', content: 'imported-search-token',
    }, { status: 'verified' }, admin)
    expect(imported.ok).toBe(true)
    await processOutboxBatch(worker, Date.now() + 12_000)
    await refresh()
    expect((await indexer.search('imported-search-token', request, access('docs/imported'))).hits[0]?.path).toBe('docs/imported')

    expect((await services.pages.remove('guides/outbox', admin)).ok).toBe(true)
    await processOutboxBatch(worker, Date.now() + 13_000)
    await refresh()
    expect(await indexer.search('recovered-search-token', request, access('guides/outbox'))).toMatchObject({ hits: [], total: 0 })
  }, 30_000)
})
