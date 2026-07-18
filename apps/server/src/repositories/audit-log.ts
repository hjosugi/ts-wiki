/**
 * Driver-neutral persistence for the admin audit trail.
 *
 * Kept out of the SQLite app layer so a Postgres-backed deployment records audit
 * events through the same contract. `record` is async even on the synchronous
 * SQLite adapter; the audit logger fires it and forgets so request handling never
 * blocks on the audit write.
 */
export interface AuditLogEntry {
  readonly action: string
  readonly userId: string | null
  readonly path: string | null
  /** Pre-serialised JSON payload of the remaining event fields. */
  readonly data: string
  readonly createdAt: number
}

export interface AuditRetentionPolicy {
  /** Drop rows older than this many milliseconds relative to the new entry. */
  readonly retentionMs: number
  /** Keep at most this many most-recent rows. */
  readonly maxRows: number
}

export interface AuditLogRepository {
  /** Append one audit entry, then enforce the retention policy in the same call. */
  record(entry: AuditLogEntry, policy: AuditRetentionPolicy): Promise<void>
}
