import { and, asc, desc, eq, lt, lte, ne } from 'drizzle-orm'
import type { DB } from '../client.ts'
import { webhookDeliveries } from '../schema.ts'
import type { WebhookDeliveryRepository } from '../../repositories/webhooks.ts'

export const createSqliteWebhookDeliveryRepository = (db: DB): WebhookDeliveryRepository => ({
  async findById(id) {
    return db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id)).get()
  },
  async insert(record) {
    db.insert(webhookDeliveries).values(record).run()
  },
  async update(id, changes) {
    db.update(webhookDeliveries).set(changes).where(eq(webhookDeliveries.id, id)).run()
  },
  async list(status, limit) {
    const query = db.select().from(webhookDeliveries)
    return (status ? query.where(eq(webhookDeliveries.status, status)) : query)
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(limit)
      .all()
  },
  async listDue(dueAt, limit, maxAttempts) {
    return db.select().from(webhookDeliveries)
      .where(and(
        lte(webhookDeliveries.nextAttemptAt, dueAt),
        ne(webhookDeliveries.status, 'succeeded'),
        lt(webhookDeliveries.attempts, maxAttempts),
      ))
      .orderBy(asc(webhookDeliveries.nextAttemptAt))
      .limit(limit)
      .all()
  },
})
