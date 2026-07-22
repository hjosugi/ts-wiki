import { and, asc, eq, gte, lt, lte, sql } from 'drizzle-orm'
import type { MysqlDb } from '../client.ts'
import { searchOutbox } from '../schema.ts'
import type { SearchOutboxRepository } from '../../../repositories/search-outbox.ts'

/** MySQL implementation of the driver-neutral search-outbox contract. */
export const createMysqlSearchOutboxRepository = (db: MysqlDb): SearchOutboxRepository => ({
  async enqueue(record) {
    await db.insert(searchOutbox).values({ ...record, attempts: 0, lastError: null })
  },

  async claimDue(now, limit, maxAttempts) {
    return db
      .select()
      .from(searchOutbox)
      .where(and(lte(searchOutbox.nextAttemptAt, now), lt(searchOutbox.attempts, maxAttempts)))
      .orderBy(asc(searchOutbox.id))
      .limit(limit)
  },

  async complete(id) {
    await db.delete(searchOutbox).where(eq(searchOutbox.id, id))
  },

  async fail(id, error, nextAttemptAt) {
    await db
      .update(searchOutbox)
      .set({ attempts: sql`${searchOutbox.attempts} + 1`, lastError: error, nextAttemptAt })
      .where(eq(searchOutbox.id, id))
  },

  async pendingCount(now, maxAttempts) {
    const [row] = await db
      .select({ count: sql<number>`count(*)` })
      .from(searchOutbox)
      .where(and(lte(searchOutbox.nextAttemptAt, now), lt(searchOutbox.attempts, maxAttempts)))
    return Number(row?.count ?? 0)
  },

  async deadLetterCount(maxAttempts) {
    const [row] = await db
      .select({ count: sql<number>`count(*)` })
      .from(searchOutbox)
      .where(gte(searchOutbox.attempts, maxAttempts))
    return Number(row?.count ?? 0)
  },
})
