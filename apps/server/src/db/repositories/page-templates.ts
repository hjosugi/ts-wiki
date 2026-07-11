import { asc, desc, eq } from 'drizzle-orm'
import type { DB } from '../client.ts'
import { pageTemplates } from '../schema.ts'
import type {
  PageTemplateRepository,
  PageTemplateUpdate,
  StoredPageTemplate,
} from '../../repositories/page-templates.ts'

export const createSqlitePageTemplateRepository = (db: DB): PageTemplateRepository => ({
  async list() {
    return db.select().from(pageTemplates).orderBy(asc(pageTemplates.name), desc(pageTemplates.updatedAt)).all()
  },

  async findById(id) {
    return db.select().from(pageTemplates).where(eq(pageTemplates.id, id)).get()
  },

  async insert(template: StoredPageTemplate) {
    db.insert(pageTemplates).values(template).run()
  },

  async update(id: string, patch: PageTemplateUpdate) {
    db.update(pageTemplates).set(patch).where(eq(pageTemplates.id, id)).run()
  },

  async delete(id) {
    db.delete(pageTemplates).where(eq(pageTemplates.id, id)).run()
  },
})
