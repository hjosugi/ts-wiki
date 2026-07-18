import { desc, lte, notInArray } from 'drizzle-orm'
import type { DB } from '../client.ts'
import { auditLog } from '../schema.ts'
import type { AuditLogRepository } from '../../repositories/audit-log.ts'

/** SQLite/libSQL implementation of the driver-neutral audit-log contract. */
export const createSqliteAuditLogRepository = (db: DB): AuditLogRepository => ({
  async record(entry, policy) {
    db.insert(auditLog).values(entry).run()
    db.delete(auditLog).where(lte(auditLog.createdAt, entry.createdAt - policy.retentionMs)).run()
    const keep = db
      .select({ id: auditLog.id })
      .from(auditLog)
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(policy.maxRows)
    db.delete(auditLog).where(notInArray(auditLog.id, keep)).run()
  },
})
