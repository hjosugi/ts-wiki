/**
 * Versioned Elasticsearch index management: a mapping, a stable read/write alias,
 * and atomic alias swaps for zero-downtime rebuilds.
 *
 * Text fields use the built-in `cjk` analyzer so CJK queries tokenize into
 * overlapping bigrams (matching the FTS5 / MySQL ngram behavior) while latin
 * stays whole words. ACL is applied at query time through the keyword `path` /
 * `spaceKey` fields — nothing here decides visibility.
 */
import { ElasticsearchError, type ElasticsearchClient } from './client.ts'

export const pageAlias = (prefix: string): string => `${prefix}-pages`
export const pageIndexName = (prefix: string, version: number): string => `${prefix}-pages-v${version}`

/** Mapping for the page search index. `index:false` fields are stored for hit shaping only. */
export const PAGE_INDEX_BODY = {
  mappings: {
    properties: {
      path: { type: 'keyword' },
      title: { type: 'text', analyzer: 'cjk' },
      description: { type: 'text', analyzer: 'cjk' },
      content: { type: 'text', analyzer: 'cjk' },
      comments: { type: 'text', analyzer: 'cjk' },
      assets: { type: 'text', analyzer: 'cjk' },
      spaceKey: { type: 'keyword' },
      status: { type: 'keyword' },
      locale: { type: 'keyword' },
      authorId: { type: 'keyword' },
      authorName: { type: 'text', analyzer: 'cjk' },
      labels: { type: 'keyword' },
      updatedAt: { type: 'long' },
      icon: { type: 'keyword', index: false },
      coverUrl: { type: 'keyword', index: false },
      coverPosition: { type: 'keyword', index: false },
    },
  },
} as const

const isAlreadyExists = (error: ElasticsearchError): boolean =>
  (error.body as { error?: { type?: string } } | undefined)?.error?.type === 'resource_already_exists_exception'

/** Create the versioned index if it does not already exist. Idempotent. */
export const ensurePageIndex = async (client: ElasticsearchClient, prefix: string, version: number): Promise<void> => {
  try {
    await client.request('PUT', `/${pageIndexName(prefix, version)}`, PAGE_INDEX_BODY)
  } catch (error) {
    if (error instanceof ElasticsearchError && isAlreadyExists(error)) return
    throw error
  }
}

/** The index the read/write alias currently points at, or null if it is unset. */
export const currentPageIndex = async (client: ElasticsearchClient, prefix: string): Promise<string | null> => {
  try {
    const response = await client.request<Record<string, unknown>>('GET', `/_alias/${pageAlias(prefix)}`)
    return Object.keys(response)[0] ?? null
  } catch (error) {
    if (error instanceof ElasticsearchError && error.status === 404) return null
    throw error
  }
}

/**
 * Atomically point the read/write alias at a specific version. The alias is
 * removed from its current index (if any) and added to the target in one
 * `_aliases` request, so readers never see a missing alias.
 */
export const pointPageAlias = async (client: ElasticsearchClient, prefix: string, version: number): Promise<void> => {
  const alias = pageAlias(prefix)
  const target = pageIndexName(prefix, version)
  const current = await currentPageIndex(client, prefix)
  const actions: unknown[] = []
  if (current && current !== target) actions.push({ remove: { index: current, alias } })
  actions.push({ add: { index: target, alias } })
  await client.request('POST', '/_aliases', { actions })
}

/** Delete every versioned page index except the one currently behind the alias. */
export const pruneOldPageIndices = async (client: ElasticsearchClient, prefix: string): Promise<void> => {
  const keep = await currentPageIndex(client, prefix)
  const all = await client
    .request<Record<string, unknown>>('GET', `/${prefix}-pages-v*/_alias`)
    .catch((error: unknown) => {
      if (error instanceof ElasticsearchError && error.status === 404) return {} as Record<string, unknown>
      throw error
    })
  for (const index of Object.keys(all)) {
    if (index !== keep) await client.request('DELETE', `/${index}`)
  }
}
