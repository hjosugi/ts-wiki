import { and, asc, desc, eq, lt, lte, ne } from 'drizzle-orm'
import type { MysqlDb } from '../client.ts'
import { webhookDeliveries } from '../schema.ts'
import type { WebhookDeliveryRepository } from '../../../repositories/webhooks.ts'

/** MySQL implementation of the driver-neutral webhook-delivery contract. */
export const createMysqlWebhookDeliveryRepository = (db: MysqlDb): WebhookDeliveryRepository => ({
  async findById(id) {
    const [row] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id)).limit(1)
    return row
  },
  async insert(record) {
    await db.insert(webhookDeliveries).values(record)
  },
  async update(id, changes) {
    await db.update(webhookDeliveries).set(changes).where(eq(webhookDeliveries.id, id))
  },
  async list(status, limit) {
    const base = db.select().from(webhookDeliveries)
    const filtered = status ? base.where(eq(webhookDeliveries.status, status)) : base
    return filtered.orderBy(desc(webhookDeliveries.createdAt)).limit(limit)
  },
  async listDue(dueAt, limit, maxAttempts) {
    return db
      .select()
      .from(webhookDeliveries)
      .where(and(
        lte(webhookDeliveries.nextAttemptAt, dueAt),
        ne(webhookDeliveries.status, 'succeeded'),
        lt(webhookDeliveries.attempts, maxAttempts),
      ))
      .orderBy(asc(webhookDeliveries.nextAttemptAt))
      .limit(limit)
  },
})
