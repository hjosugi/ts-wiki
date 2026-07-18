import { eq, lte } from 'drizzle-orm'
import type { PostgresDb } from '../client.ts'
import { realtimeTickets } from '../schema.ts'
import type { RealtimeTicketRepository } from '../../../repositories/realtime-tickets.ts'

/** PostgreSQL implementation of the driver-neutral realtime-ticket contract. */
export const createPostgresRealtimeTicketRepository = (db: PostgresDb): RealtimeTicketRepository => ({
  async cleanupExpired(now) {
    await db.delete(realtimeTickets).where(lte(realtimeTickets.expiresAt, now))
  },

  async insert(record) {
    await db.insert(realtimeTickets).values(record)
  },

  async consume(ticket) {
    const [row] = await db
      .delete(realtimeTickets)
      .where(eq(realtimeTickets.ticket, ticket))
      .returning({ userId: realtimeTickets.userId, expiresAt: realtimeTickets.expiresAt })
    return row
  },
})
