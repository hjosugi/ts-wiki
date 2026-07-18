/**
 * Driver-neutral persistence for short-lived realtime (SSE) auth tickets.
 *
 * Kept out of the SQLite app layer so a Postgres-backed deployment can mint and
 * consume tickets through the same contract. All methods are async even on the
 * synchronous SQLite adapter.
 */
export interface RealtimeTicketRecord {
  readonly ticket: string
  readonly userId: string
  readonly expiresAt: number
  readonly createdAt: number
}

export interface ConsumedRealtimeTicket {
  readonly userId: string
  readonly expiresAt: number
}

export interface RealtimeTicketRepository {
  cleanupExpired(now: number): Promise<void>
  insert(record: RealtimeTicketRecord): Promise<void>
  /** Atomically remove and return the ticket, or undefined if it was absent. */
  consume(ticket: string): Promise<ConsumedRealtimeTicket | undefined>
}
