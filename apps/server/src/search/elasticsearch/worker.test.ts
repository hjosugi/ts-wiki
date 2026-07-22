/**
 * Elasticsearch outbox worker contract — integration. Env-gated.
 * Drives the real worker against a real Elasticsearch index with an in-memory
 * SQLite outbox and a stub page loader: index, delete, vanished-page removal,
 * and failure/backoff.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createDb } from '../../db/client.ts'
import { createSqliteSearchOutboxRepository } from '../../db/repositories/search-outbox.ts'
import type { SearchOutboxRepository } from '../../repositories/search-outbox.ts'
import { createElasticsearchTestClient, testElasticsearchUrl, waitForElasticsearch } from './test-support.ts'
import { ensurePageIndex, pageAlias, pageIndexName, pointPageAlias } from './index-management.ts'
import { processOutboxBatch } from './worker.ts'
import type { PageIndexSource } from './document.ts'

const PREFIX = 'kw-worker'

const makeSource = (over: Partial<PageIndexSource> = {}): PageIndexSource => ({
  path: 'docs/x', title: 'Findme', description: '', content: 'uniquebody', spaceKey: 'main',
  status: 'verified', locale: 'en', authorId: null, authorName: null, labels: '[]', icon: '',
  coverUrl: '', coverPosition: 'center', updatedAt: 1, comments: '', assets: '', ...over,
})

const freshOutbox = (): SearchOutboxRepository =>
  createSqliteSearchOutboxRepository(createDb(':memory:', { ftsTokenizer: 'unicode61' }))

describe.skipIf(!testElasticsearchUrl)('elasticsearch outbox worker', () => {
  const client = createElasticsearchTestClient()
  const dropIndex = () => client.request('DELETE', `/${pageIndexName(PREFIX, 1)}`).catch(() => {})
  beforeAll(async () => {
    await waitForElasticsearch(client)
    await dropIndex()
    await ensurePageIndex(client, PREFIX, 1)
    await pointPageAlias(client, PREFIX, 1)
  }, 30_000)
  afterAll(dropIndex)

  test('indexes a page and completes the outbox entry', async () => {
    const outbox = freshOutbox()
    await outbox.enqueue({ pageId: 'p1', operation: 'index', enqueuedAt: 1, nextAttemptAt: 1 })

    const result = await processOutboxBatch(
      { outbox, client, indexPrefix: PREFIX, loadPageSource: async () => makeSource({ path: 'docs/p1' }) },
      10,
    )
    expect(result).toEqual({ processed: 1, failed: 0 })

    const doc = await client.request<{ _source: { path: string } }>('GET', `/${pageAlias(PREFIX)}/_doc/p1`)
    expect(doc._source.path).toBe('docs/p1')
    expect(await outbox.claimDue(1000, 10, 5)).toEqual([]) // entry completed
  })

  test('a delete entry and a vanished page both remove the document', async () => {
    const outbox = freshOutbox()
    await outbox.enqueue({ pageId: 'p2', operation: 'index', enqueuedAt: 1, nextAttemptAt: 1 })
    await processOutboxBatch({ outbox, client, indexPrefix: PREFIX, loadPageSource: async () => makeSource({ path: 'docs/p2' }) }, 10)

    await outbox.enqueue({ pageId: 'p2', operation: 'delete', enqueuedAt: 2, nextAttemptAt: 2 })
    const result = await processOutboxBatch({ outbox, client, indexPrefix: PREFIX, loadPageSource: async () => null }, 20)
    expect(result).toEqual({ processed: 1, failed: 0 })
    await expect(client.request('GET', `/${pageAlias(PREFIX)}/_doc/p2`)).rejects.toThrow() // 404

    // An index op for a page that no longer loads also removes it (no-op when already gone).
    await outbox.enqueue({ pageId: 'p2', operation: 'index', enqueuedAt: 3, nextAttemptAt: 3 })
    const vanished = await processOutboxBatch({ outbox, client, indexPrefix: PREFIX, loadPageSource: async () => null }, 30)
    expect(vanished).toEqual({ processed: 1, failed: 0 })
  })

  test('a load failure records the error and reschedules with backoff', async () => {
    const outbox = freshOutbox()
    await outbox.enqueue({ pageId: 'p3', operation: 'index', enqueuedAt: 1, nextAttemptAt: 1 })

    const result = await processOutboxBatch(
      {
        outbox,
        client,
        indexPrefix: PREFIX,
        loadPageSource: async () => { throw new Error('db down') },
        backoffMs: () => 50,
      },
      10,
    )
    expect(result).toEqual({ processed: 0, failed: 1 })
    expect(await outbox.claimDue(10, 10, 5)).toEqual([]) // rescheduled to 60, not due at 10
    const [retry] = await outbox.claimDue(60, 10, 5)
    expect(retry).toMatchObject({ attempts: 1, lastError: 'db down' })
  })
})
