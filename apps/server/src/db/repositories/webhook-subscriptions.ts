import { asc, eq } from 'drizzle-orm'
import type { DB } from '../client.ts'
import { webhookSubscriptions } from '../schema.ts'
import type { WebhookSubscriptionRepository } from '../../repositories/webhooks.ts'

export const createSqliteWebhookSubscriptionRepository = (db: DB): WebhookSubscriptionRepository => ({
  async findById(id) {
    return db.select().from(webhookSubscriptions).where(eq(webhookSubscriptions.id, id)).get()
  },
  async list() {
    return db.select().from(webhookSubscriptions).orderBy(asc(webhookSubscriptions.createdAt)).all()
  },
  async listEnabled() {
    return db.select().from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.enabled, true))
      .orderBy(asc(webhookSubscriptions.createdAt))
      .all()
  },
  async insert(record) {
    db.insert(webhookSubscriptions).values(record).run()
  },
  async update(id, changes) {
    db.update(webhookSubscriptions).set(changes).where(eq(webhookSubscriptions.id, id)).run()
  },
  async delete(id) {
    db.delete(webhookSubscriptions).where(eq(webhookSubscriptions.id, id)).run()
  },
})
