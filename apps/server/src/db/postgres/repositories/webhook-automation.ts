import { asc, eq } from 'drizzle-orm'
import type { PostgresDb } from '../client.ts'
import { automationRules, pages } from '../schema.ts'
import type { WebhookAutomationRepository } from '../../../repositories/webhooks.ts'

/** PostgreSQL implementation of the driver-neutral webhook-automation contract. */
export const createPostgresWebhookAutomationRepository = (db: PostgresDb): WebhookAutomationRepository => ({
  async findPageById(id) {
    const [row] = await db.select().from(pages).where(eq(pages.id, id)).limit(1)
    return row
  },
  async findPageByPath(path) {
    const [row] = await db.select().from(pages).where(eq(pages.path, path)).limit(1)
    return row
  },
  async listEnabledRules() {
    return db
      .select()
      .from(automationRules)
      .where(eq(automationRules.enabled, true))
      .orderBy(asc(automationRules.priority), asc(automationRules.createdAt))
  },
  async listRules() {
    return db.select().from(automationRules).orderBy(asc(automationRules.priority), asc(automationRules.createdAt))
  },
  async findRule(id) {
    const [row] = await db.select().from(automationRules).where(eq(automationRules.id, id)).limit(1)
    return row
  },
  async insertRule(record) {
    await db.insert(automationRules).values(record)
  },
  async updateRule(id, changes) {
    await db.update(automationRules).set(changes).where(eq(automationRules.id, id))
  },
  async deleteRule(id) {
    await db.delete(automationRules).where(eq(automationRules.id, id))
  },
})
