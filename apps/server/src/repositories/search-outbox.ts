/**
 * Driver-neutral persistence for the Elasticsearch indexing outbox.
 *
 * Page writes enqueue index/delete operations in their own transaction; the
 * background worker claims due entries, applies them to Elasticsearch, then
 * completes or reschedules with backoff. Entries that exhaust their attempts
 * stay in the table for dead-letter visibility rather than being dropped. This
 * decouples page saves from search-backend availability — a save never fails or
 * is lost when Elasticsearch is down.
 */
export type SearchOutboxOperation = 'index' | 'delete'

export interface SearchOutboxEntry {
  readonly id: number
  readonly pageId: string
  readonly operation: SearchOutboxOperation
  readonly enqueuedAt: number
  readonly attempts: number
  readonly nextAttemptAt: number
  readonly lastError: string | null
}

export interface EnqueueSearchOutbox {
  readonly pageId: string
  readonly operation: SearchOutboxOperation
  readonly enqueuedAt: number
  readonly nextAttemptAt: number
}

export interface SearchOutboxRepository {
  enqueue(record: EnqueueSearchOutbox): Promise<void>
  /** Due, not-yet-dead-lettered entries in enqueue order (oldest first). */
  claimDue(now: number, limit: number, maxAttempts: number): Promise<SearchOutboxEntry[]>
  complete(id: number): Promise<void>
  /** Record a failed attempt and reschedule; the attempt count decides dead-lettering. */
  fail(id: number, error: string, nextAttemptAt: number): Promise<void>
  /** Entries still awaiting a first try or a retry. */
  pendingCount(now: number, maxAttempts: number): Promise<number>
  /** Entries that exhausted their attempts (dead-lettered), for admin visibility. */
  deadLetterCount(maxAttempts: number): Promise<number>
}
