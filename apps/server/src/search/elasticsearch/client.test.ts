/**
 * Elasticsearch client contract — integration. Env-gated on
 * KAWAII_WIKI_TEST_ELASTICSEARCH_URL; skipped otherwise.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { ElasticsearchError } from './client.ts'
import { createElasticsearchTestClient, testElasticsearchUrl, waitForElasticsearch } from './test-support.ts'

describe.skipIf(!testElasticsearchUrl)('elasticsearch client', () => {
  const client = createElasticsearchTestClient()
  beforeAll(async () => { await waitForElasticsearch(client) }, 30_000)

  test('ping resolves against a reachable cluster', async () => {
    await expect(client.ping()).resolves.toBeUndefined()
  })

  test('request returns parsed JSON for a successful call', async () => {
    const health = await client.request<{ status: string }>('GET', '/_cluster/health')
    expect(['green', 'yellow', 'red']).toContain(health.status)
  })

  test('a non-2xx response rejects with an ElasticsearchError carrying the status', async () => {
    try {
      await client.request('GET', '/kw-no-such-index-xyz/_search')
      throw new Error('expected a rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(ElasticsearchError)
      expect((error as ElasticsearchError).status).toBe(404)
    }
  })
})
