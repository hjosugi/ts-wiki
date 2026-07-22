import { and, asc, eq, gte, lt, lte, sql } from 'drizzle-orm'
import type { DB } from '../client.ts'
import { searchOutbox } from '../schema.ts'
import type { SearchOutboxRepository } from '../../repositories/search-outbox.ts'

/** SQLite/libSQL implementation of the driver-neutral search-outbox contract. */
export const createSqliteSearchOutboxRepository = (db: DB): SearchOutboxRepository => ({
  async enqueue(record) {
    db.insert(searchOutbox).values({ ...record, attempts: 0, lastError: null }).run()
  },

  async claimDue(now, limit, maxAttempts) {
    return db
      .select()
      .from(searchOutbox)
      .where(and(lte(searchOutbox.nextAttemptAt, now), lt(searchOutbox.attempts, maxAttempts)))
      .orderBy(asc(searchOutbox.id))
      .limit(limit)
      .all()
  },

  async complete(id) {
    db.delete(searchOutbox).where(eq(searchOutbox.id, id)).run()
  },

  async fail(id, error, nextAttemptAt) {
    db.update(searchOutbox)
      .set({ attempts: sql`${searchOutbox.attempts} + 1`, lastError: error, nextAttemptAt })
      .where(eq(searchOutbox.id, id))
      .run()
  },

  async pendingCount(now, maxAttempts) {
    const [row] = db
      .select({ count: sql<number>`count(*)` })
      .from(searchOutbox)
      .where(and(lte(searchOutbox.nextAttemptAt, now), lt(searchOutbox.attempts, maxAttempts)))
      .all()
    return row?.count ?? 0
  },

  async deadLetterCount(maxAttempts) {
    const [row] = db
      .select({ count: sql<number>`count(*)` })
      .from(searchOutbox)
      .where(gte(searchOutbox.attempts, maxAttempts))
      .all()
    return row?.count ?? 0
  },
})
