import { createElasticsearchClient, type ElasticsearchClient } from './client.ts'

/** Set to a reachable Elasticsearch URL to opt the ES contract tests in. */
export const testElasticsearchUrl = process.env.KAWAII_WIKI_TEST_ELASTICSEARCH_URL?.trim()

export const createElasticsearchTestClient = (): ElasticsearchClient =>
  createElasticsearchClient({ url: testElasticsearchUrl ?? '' })

/** Wait out Elasticsearch cold start so a still-booting cluster does not flake the suite. */
export const waitForElasticsearch = async (client: ElasticsearchClient, attempts = 60): Promise<void> => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await client.ping()
      return
    } catch {
      await Bun.sleep(500)
    }
  }
  await client.ping()
}
