import { asc, desc, eq, lt, ne, sql } from 'drizzle-orm'
import type { DB } from '../client.ts'
import { pageRedirects, pageRevisions, pages, users } from '../schema.ts'
import type { PageReadRepository } from '../../repositories/pages.ts'

export const createSqlitePageReadRepository = (db: DB): PageReadRepository => ({
  async listActive() {
    return db.select().from(pages).where(eq(pages.lifecycle, 'active')).orderBy(asc(pages.path)).all()
  },
  async listInactive() {
    return db.select().from(pages).where(ne(pages.lifecycle, 'active')).orderBy(desc(pages.updatedAt)).all()
  },
  async listRecentRevisions(before, limit) {
    const selection = {
      id: pageRevisions.id,
      path: pageRevisions.path,
      title: pageRevisions.title,
      authorId: pageRevisions.authorId,
      authorName: users.name,
      action: pageRevisions.action,
      createdAt: pageRevisions.createdAt,
    }
    const query = db.select(selection).from(pageRevisions).leftJoin(users, eq(users.id, pageRevisions.authorId))
    const rows = before === null
      ? query.orderBy(desc(pageRevisions.createdAt), sql`page_revisions.rowid desc`).limit(limit).all()
      : query.where(lt(pageRevisions.createdAt, before)).orderBy(desc(pageRevisions.createdAt), sql`page_revisions.rowid desc`).limit(limit).all()
    return rows.map((row) => ({ ...row, authorName: row.authorName ?? null }))
  },
  async listRedirects() {
    return db.select().from(pageRedirects).orderBy(asc(pageRedirects.fromPath)).all()
  },
  async listRevisions(pageId) {
    return db.select({
      id: pageRevisions.id,
      pageId: pageRevisions.pageId,
      path: pageRevisions.path,
      title: pageRevisions.title,
      description: pageRevisions.description,
      content: pageRevisions.content,
      authorId: pageRevisions.authorId,
      authorName: users.name,
      action: pageRevisions.action,
      createdAt: pageRevisions.createdAt,
    }).from(pageRevisions)
      .leftJoin(users, eq(users.id, pageRevisions.authorId))
      .where(eq(pageRevisions.pageId, pageId))
      .orderBy(desc(pageRevisions.createdAt), sql`page_revisions.rowid desc`)
      .all()
      .map((row) => ({ ...row, authorName: row.authorName ?? null }))
  },
  async revisionContributors(pageId) {
    const lastContributionAt = sql<number>`max(${pageRevisions.createdAt})`
    return db.select({
      authorId: pageRevisions.authorId,
      authorName: users.name,
      revisions: sql<number>`count(*)`,
      lastContributionAt,
    }).from(pageRevisions)
      .leftJoin(users, eq(users.id, pageRevisions.authorId))
      .where(eq(pageRevisions.pageId, pageId))
      .groupBy(pageRevisions.authorId, users.name)
      .orderBy(desc(lastContributionAt), asc(users.name))
      .all()
      .map((row) => ({
        ...row,
        revisions: Number(row.revisions),
        lastContributionAt: Number(row.lastContributionAt),
      }))
  },
})
