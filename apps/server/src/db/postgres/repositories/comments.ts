import { and, asc, eq } from 'drizzle-orm'
import type { PostgresDb } from '../client.ts'
import { pageComments, pages, users } from '../schema.ts'
import type { CommentRepository } from '../../../repositories/comments.ts'

/** PostgreSQL implementation of the driver-neutral comment contract. */
export const createPostgresCommentRepository = (db: PostgresDb): CommentRepository => ({
  async findActivePage(path) {
    const [row] = await db
      .select({ id: pages.id, path: pages.path, labels: pages.labels })
      .from(pages)
      .where(and(eq(pages.path, path), eq(pages.lifecycle, 'active')))
      .limit(1)
    return row
  },

  async findById(id) {
    const [row] = await db.select().from(pageComments).where(eq(pageComments.id, id)).limit(1)
    return row
  },

  async listByPageId(pageId) {
    const rows = await db
      .select({ comment: pageComments, authorName: users.name })
      .from(pageComments)
      .leftJoin(users, eq(users.id, pageComments.authorId))
      .where(eq(pageComments.pageId, pageId))
      .orderBy(asc(pageComments.createdAt))
    return rows.map((row) => ({ comment: row.comment, authorName: row.authorName ?? null }))
  },

  async findAuthorName(userId) {
    const [row] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1)
    return row?.name ?? null
  },

  async insert(comment) {
    await db.insert(pageComments).values(comment)
  },

  async updateBody(id, body, updatedAt) {
    const updated = await db
      .update(pageComments)
      .set({ body, updatedAt })
      .where(eq(pageComments.id, id))
      .returning({ id: pageComments.id })
    return updated.length > 0
  },

  async resolve(id, resolvedAt, updatedAt) {
    const updated = await db
      .update(pageComments)
      .set({ resolvedAt, updatedAt })
      .where(eq(pageComments.id, id))
      .returning({ id: pageComments.id })
    return updated.length > 0
  },

  async delete(id) {
    const deleted = await db.delete(pageComments).where(eq(pageComments.id, id)).returning({ id: pageComments.id })
    return deleted.length > 0
  },
})
