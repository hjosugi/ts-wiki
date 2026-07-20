/**
 * Elasticsearch index-management contract — integration. Env-gated.
 * Exercises versioned index creation, the cjk mapping, atomic alias swaps, and
 * pruning against a real Elasticsearch server.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createElasticsearchTestClient, testElasticsearchUrl, waitForElasticsearch } from './test-support.ts'
import { currentPageIndex, ensurePageIndex, pageIndexName, pointPageAlias, pruneOldPageIndices } from './index-management.ts'

const PREFIX = 'kw-idxtest'

interface MappingResponse {
  [index: string]: { mappings: { properties: Record<string, { type?: string; analyzer?: string }> } }
}

describe.skipIf(!testElasticsearchUrl)('elasticsearch index management', () => {
  const client = createElasticsearchTestClient()
  // ES 8 blocks wildcard deletes, so drop the specific versions the tests use.
  const cleanup = async () => {
    for (const version of [1, 2, 3]) {
      await client.request('DELETE', `/${pageIndexName(PREFIX, version)}`).catch(() => {})
    }
  }
  beforeAll(async () => { await waitForElasticsearch(client) }, 30_000)
  beforeEach(cleanup)
  afterAll(cleanup)

  test('creates a versioned index with the cjk-analyzed mapping, idempotently', async () => {
    await ensurePageIndex(client, PREFIX, 1)
    await ensurePageIndex(client, PREFIX, 1) // second call must not throw
    const mapping = await client.request<MappingResponse>('GET', `/${pageIndexName(PREFIX, 1)}/_mapping`)
    const props = mapping[pageIndexName(PREFIX, 1)]!.mappings.properties
    expect(props.content?.analyzer).toBe('cjk')
    expect(props.path?.type).toBe('keyword')
  })

  test('points the alias at a version and swaps atomically', async () => {
    await ensurePageIndex(client, PREFIX, 1)
    expect(await currentPageIndex(client, PREFIX)).toBeNull() // unset before pointing

    await pointPageAlias(client, PREFIX, 1)
    expect(await currentPageIndex(client, PREFIX)).toBe(pageIndexName(PREFIX, 1))

    await ensurePageIndex(client, PREFIX, 2)
    await pointPageAlias(client, PREFIX, 2)
    expect(await currentPageIndex(client, PREFIX)).toBe(pageIndexName(PREFIX, 2))
  })

  test('prunes old versions but keeps the live one', async () => {
    await ensurePageIndex(client, PREFIX, 1)
    await ensurePageIndex(client, PREFIX, 2)
    await pointPageAlias(client, PREFIX, 2)
    await pruneOldPageIndices(client, PREFIX)

    await expect(client.request('GET', `/${pageIndexName(PREFIX, 1)}`)).rejects.toThrow() // v1 deleted
    expect(await currentPageIndex(client, PREFIX)).toBe(pageIndexName(PREFIX, 2)) // v2 kept
  })
})
