import { asc, desc, eq } from 'drizzle-orm'
import type { PostgresDb } from '../client.ts'
import { pageTemplates } from '../schema.ts'
import type {
  PageTemplateRepository,
  PageTemplateUpdate,
  StoredPageTemplate,
} from '../../../repositories/page-templates.ts'

/** PostgreSQL implementation of the driver-neutral page-template contract. */
export const createPostgresPageTemplateRepository = (db: PostgresDb): PageTemplateRepository => ({
  async list() {
    return db.select().from(pageTemplates).orderBy(asc(pageTemplates.name), desc(pageTemplates.updatedAt))
  },

  async findById(id) {
    const [row] = await db.select().from(pageTemplates).where(eq(pageTemplates.id, id)).limit(1)
    return row
  },

  async insert(template: StoredPageTemplate) {
    await db.insert(pageTemplates).values(template)
  },

  async update(id: string, patch: PageTemplateUpdate) {
    await db.update(pageTemplates).set(patch).where(eq(pageTemplates.id, id))
  },

  async delete(id) {
    await db.delete(pageTemplates).where(eq(pageTemplates.id, id))
  },
})
