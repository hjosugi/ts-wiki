import { eq, lte } from 'drizzle-orm'
import type { DB } from '../client.ts'
import { realtimeTickets } from '../schema.ts'
import type { RealtimeTicketRepository } from '../../repositories/realtime-tickets.ts'

/** SQLite/libSQL implementation of the driver-neutral realtime-ticket contract. */
export const createSqliteRealtimeTicketRepository = (db: DB): RealtimeTicketRepository => ({
  async cleanupExpired(now) {
    db.delete(realtimeTickets).where(lte(realtimeTickets.expiresAt, now)).run()
  },

  async insert(record) {
    db.insert(realtimeTickets).values(record).run()
  },

  async consume(ticket) {
    return db
      .delete(realtimeTickets)
      .where(eq(realtimeTickets.ticket, ticket))
      .returning({ userId: realtimeTickets.userId, expiresAt: realtimeTickets.expiresAt })
      .get()
  },
})
