import { asc, eq } from 'drizzle-orm'
import type { PostgresDb } from '../client.ts'
import { webhookSubscriptions } from '../schema.ts'
import type { WebhookSubscriptionRepository } from '../../../repositories/webhooks.ts'

/** PostgreSQL implementation of the driver-neutral webhook-subscription contract. */
export const createPostgresWebhookSubscriptionRepository = (db: PostgresDb): WebhookSubscriptionRepository => ({
  async findById(id) {
    const [row] = await db.select().from(webhookSubscriptions).where(eq(webhookSubscriptions.id, id)).limit(1)
    return row
  },
  async list() {
    return db.select().from(webhookSubscriptions).orderBy(asc(webhookSubscriptions.createdAt))
  },
  async listEnabled() {
    return db
      .select()
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.enabled, true))
      .orderBy(asc(webhookSubscriptions.createdAt))
  },
  async insert(record) {
    await db.insert(webhookSubscriptions).values(record)
  },
  async update(id, changes) {
    await db.update(webhookSubscriptions).set(changes).where(eq(webhookSubscriptions.id, id))
  },
  async delete(id) {
    await db.delete(webhookSubscriptions).where(eq(webhookSubscriptions.id, id))
  },
})
