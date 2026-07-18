import { desc, lte, notInArray } from 'drizzle-orm'
import type { PostgresDb } from '../client.ts'
import { auditLog } from '../schema.ts'
import type { AuditLogRepository } from '../../../repositories/audit-log.ts'

/** PostgreSQL implementation of the driver-neutral audit-log contract. */
export const createPostgresAuditLogRepository = (db: PostgresDb): AuditLogRepository => ({
  async record(entry, policy) {
    await db.insert(auditLog).values(entry)
    await db.delete(auditLog).where(lte(auditLog.createdAt, entry.createdAt - policy.retentionMs))
    const keep = db
      .select({ id: auditLog.id })
      .from(auditLog)
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(policy.maxRows)
    await db.delete(auditLog).where(notInArray(auditLog.id, keep))
  },
})
