/**
 * The retryable worker that drains the search outbox into Elasticsearch.
 *
 * `processOutboxBatch` claims a batch of due entries, applies each as an index
 * or delete against the write alias, and either completes it or reschedules it
 * with exponential backoff — entries that exhaust their attempts are left for
 * dead-letter visibility. Because the outbox is written in the page transaction,
 * a page save is never lost when Elasticsearch is unavailable; the worker simply
 * catches up when it recovers.
 */
import { ElasticsearchError, type ElasticsearchClient } from './client.ts'
import { pageAlias } from './index-management.ts'
import { buildPageDocument, type PageIndexSource } from './document.ts'
import type { SearchOutboxRepository } from '../../repositories/search-outbox.ts'
import { unrefTimer } from '../../utils/timers.ts'

const DEFAULT_BATCH_SIZE = 50
const DEFAULT_MAX_ATTEMPTS = 5

const defaultBackoffMs = (attempts: number): number => Math.min(1000 * 2 ** attempts, 60_000)

export interface OutboxWorkerDeps {
  readonly outbox: SearchOutboxRepository
  readonly client: ElasticsearchClient
  readonly indexPrefix: string
  /** Load a page's indexable source, or null if the page no longer exists. */
  readonly loadPageSource: (pageId: string) => Promise<PageIndexSource | null>
  readonly batchSize?: number
  readonly maxAttempts?: number
  readonly backoffMs?: (attempts: number) => number
}

const docPath = (prefix: string, pageId: string): string => `/${pageAlias(prefix)}/_doc/${encodeURIComponent(pageId)}`

const indexDocument = async (client: ElasticsearchClient, prefix: string, pageId: string, source: PageIndexSource): Promise<void> => {
  await client.request('PUT', docPath(prefix, pageId), buildPageDocument(source))
}

const removeDocument = async (client: ElasticsearchClient, prefix: string, pageId: string): Promise<void> => {
  try {
    await client.request('DELETE', docPath(prefix, pageId))
  } catch (error) {
    if (error instanceof ElasticsearchError && error.status === 404) return // already absent
    throw error
  }
}

export interface OutboxBatchResult {
  readonly processed: number
  readonly failed: number
}

/** Drain one batch of due outbox entries into Elasticsearch. */
export const processOutboxBatch = async (deps: OutboxWorkerDeps, now: number): Promise<OutboxBatchResult> => {
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const backoffMs = deps.backoffMs ?? defaultBackoffMs
  const entries = await deps.outbox.claimDue(now, batchSize, maxAttempts)
  let processed = 0
  let failed = 0
  for (const entry of entries) {
    try {
      if (entry.operation === 'delete') {
        await removeDocument(deps.client, deps.indexPrefix, entry.pageId)
      } else {
        const source = await deps.loadPageSource(entry.pageId)
        // A vanished page is removed from the index rather than reindexed.
        if (source) await indexDocument(deps.client, deps.indexPrefix, entry.pageId, source)
        else await removeDocument(deps.client, deps.indexPrefix, entry.pageId)
      }
      await deps.outbox.complete(entry.id)
      processed += 1
    } catch (error) {
      await deps.outbox.fail(entry.id, error instanceof Error ? error.message : String(error), now + backoffMs(entry.attempts))
      failed += 1
    }
  }
  return { processed, failed }
}

export interface OutboxWorker {
  stop(): void
}

/** Start a background loop that drains the outbox on an interval. Non-overlapping. */
export const startOutboxWorker = (deps: OutboxWorkerDeps, intervalMs = 1000): OutboxWorker => {
  let running = false
  const tick = (): void => {
    if (running) return
    running = true
    Promise.resolve(processOutboxBatch(deps, Date.now()))
      .catch(() => {
        /* best-effort: failures are already recorded per entry via outbox.fail */
      })
      .finally(() => {
        running = false
      })
  }
  const timer = setInterval(tick, Math.max(100, intervalMs))
  unrefTimer(timer)
  return {
    stop: () => clearInterval(timer),
  }
}
