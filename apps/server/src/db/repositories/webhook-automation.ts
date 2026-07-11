import { asc, eq } from 'drizzle-orm'
import type { DB } from '../client.ts'
import { automationRules, pages } from '../schema.ts'
import type { WebhookAutomationRepository } from '../../repositories/webhooks.ts'

export const createSqliteWebhookAutomationRepository = (db: DB): WebhookAutomationRepository => ({
  async findPageById(id) {
    return db.select().from(pages).where(eq(pages.id, id)).get()
  },
  async findPageByPath(path) {
    return db.select().from(pages).where(eq(pages.path, path)).get()
  },
  async listEnabledRules() {
    return db.select().from(automationRules)
      .where(eq(automationRules.enabled, true))
      .orderBy(asc(automationRules.priority), asc(automationRules.createdAt))
      .all()
  },
  async listRules() {
    return db.select().from(automationRules)
      .orderBy(asc(automationRules.priority), asc(automationRules.createdAt))
      .all()
  },
  async findRule(id) {
    return db.select().from(automationRules).where(eq(automationRules.id, id)).get()
  },
  async insertRule(record) {
    db.insert(automationRules).values(record).run()
  },
  async updateRule(id, changes) {
    db.update(automationRules).set(changes).where(eq(automationRules.id, id)).run()
  },
  async deleteRule(id) {
    db.delete(automationRules).where(eq(automationRules.id, id)).run()
  },
})
