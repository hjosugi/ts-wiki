import { asc, desc, eq, lt, ne, sql } from 'drizzle-orm'
import type { DB } from '../client.ts'
import { pageAnalytics, pageAssetRefs, pageComments, pageRedirects, pageRevisions, pages, searchOutbox, users } from '../schema.ts'
import { isUniqueConstraintError } from '../errors.ts'
import type { SearchIndexer } from '../../services/search.ts'
import {
  DuplicatePagePathError,
  type PageReadRepository,
  type PageRevisionRecord,
  type PageWriteRepository,
} from '../../repositories/pages.ts'

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

const insertRevision = (tx: { insert: DB['insert'] }, revision: PageRevisionRecord): void => {
  tx.insert(pageRevisions).values(revision).run()
}

export interface SqlitePageWriteOptions {
  readonly searchBackend?: 'fts5' | 'elasticsearch'
}

const enqueueSearchOutbox = (
  tx: { insert: DB['insert'] },
  pageId: string,
  operation: 'index' | 'delete',
): void => {
  const now = Date.now()
  tx.insert(searchOutbox).values({ pageId, operation, enqueuedAt: now, attempts: 0, nextAttemptAt: now, lastError: null }).run()
}

export const createSqlitePageWriteRepository = (
  db: DB,
  searchIndexer: SearchIndexer,
  options: SqlitePageWriteOptions = {},
): PageWriteRepository => {
  const externalSearch = options.searchBackend === 'elasticsearch'
  return ({
  async findByPath(path) {
    return db.select().from(pages).where(eq(pages.path, path)).get()
  },
  async findById(id) {
    return db.select().from(pages).where(eq(pages.id, id)).get()
  },
  async findRevision(id) {
    return db.select().from(pageRevisions).where(eq(pageRevisions.id, id)).get()
  },
  async findRedirect(path) {
    return db.select().from(pageRedirects).where(eq(pageRedirects.fromPath, path)).get()?.toPath ?? null
  },
  async writeExisting(input) {
    const page = db.transaction((tx) => {
      if (input.revision) insertRevision(tx, input.revision)
      tx.update(pages).set(input.changes).where(eq(pages.id, input.pageId)).run()
      const updated = tx.select().from(pages).where(eq(pages.id, input.pageId)).get()
      if (updated && externalSearch) enqueueSearchOutbox(tx, updated.id, 'index')
      else if (updated && !db.$syncAfterWrite) searchIndexer.indexPage(updated)
      return updated
    })
    if (page && db.$syncAfterWrite && !externalSearch) searchIndexer.indexPage(page)
    await db.$syncAfterWrite?.()
    return page
  },
  async create(page, revision) {
    try {
      const created = db.transaction((tx) => {
        tx.delete(pageRedirects).where(eq(pageRedirects.fromPath, page.path)).run()
        tx.insert(pages).values(page).run()
        insertRevision(tx, revision)
        if (externalSearch) enqueueSearchOutbox(tx, page.id, 'index')
        else if (!db.$syncAfterWrite) searchIndexer.indexPage(page)
        return tx.select().from(pages).where(eq(pages.id, page.id)).get()
      })
      if (created && db.$syncAfterWrite && !externalSearch) searchIndexer.indexPage(created)
      await db.$syncAfterWrite?.()
      return created
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new DuplicatePagePathError()
      throw error
    }
  },
  async createRedirect(record) {
    db.insert(pageRedirects).values(record).run()
    await db.$syncAfterWrite?.()
  },
  async deleteRedirect(fromPath) {
    db.delete(pageRedirects).where(eq(pageRedirects.fromPath, fromPath)).run()
    await db.$syncAfterWrite?.()
  },
  async setLifecycle(input) {
    const page = db.transaction((tx) => {
      insertRevision(tx, input.revision)
      tx.update(pages).set({ lifecycle: input.lifecycle, updatedAt: input.updatedAt })
        .where(eq(pages.id, input.pageId)).run()
      const updated = tx.select().from(pages).where(eq(pages.id, input.pageId)).get()
      if (externalSearch) {
        enqueueSearchOutbox(tx, input.pageId, input.index ? 'index' : 'delete')
      } else if (!db.$syncAfterWrite) {
        if (input.index && updated) searchIndexer.indexPage(updated)
        else searchIndexer.removePage(input.pageId)
      }
      return updated
    })
    if (db.$syncAfterWrite && !externalSearch) {
      if (input.index && page) searchIndexer.indexPage(page)
      else searchIndexer.removePage(input.pageId)
    }
    await db.$syncAfterWrite?.()
    return page
  },
  async move(input) {
    const pagesToIndex: Array<typeof pages.$inferSelect> = []
    const page = db.transaction((tx) => {
      insertRevision(tx, input.revision)
      tx.update(pages).set({ path: input.newPath, spaceKey: input.spaceKey, updatedAt: input.updatedAt })
        .where(eq(pages.id, input.pageId)).run()
      tx.update(pageComments).set({ path: input.newPath, updatedAt: input.updatedAt })
        .where(eq(pageComments.pageId, input.pageId)).run()
      tx.delete(pageRedirects).where(eq(pageRedirects.fromPath, input.newPath)).run()
      tx.update(pageRedirects).set({ toPath: input.newPath }).where(eq(pageRedirects.toPath, input.oldPath)).run()
      tx.insert(pageRedirects).values({ fromPath: input.oldPath, toPath: input.newPath, createdAt: input.updatedAt })
        .onConflictDoUpdate({
          target: pageRedirects.fromPath,
          set: { toPath: input.newPath, createdAt: input.updatedAt },
        }).run()
      for (const rewritten of input.rewrittenPages) {
        insertRevision(tx, rewritten.revision)
        tx.update(pages).set({
          content: rewritten.content,
          renderedHtml: rewritten.renderedHtml,
          toc: rewritten.toc,
          updatedAt: rewritten.updatedAt,
        }).where(eq(pages.id, rewritten.pageId)).run()
        const updated = tx.select().from(pages).where(eq(pages.id, rewritten.pageId)).get()
        if (updated && externalSearch) {
          enqueueSearchOutbox(tx, updated.id, 'index')
        } else if (updated) {
          if (db.$syncAfterWrite) pagesToIndex.push(updated)
          else searchIndexer.indexPage(updated)
        }
      }
      const moved = tx.select().from(pages).where(eq(pages.id, input.pageId)).get()
      if (moved && externalSearch) {
        enqueueSearchOutbox(tx, moved.id, 'index')
      } else if (moved) {
        if (db.$syncAfterWrite) pagesToIndex.push(moved)
        else searchIndexer.indexPage(moved)
      }
      return moved
    })
    if (!externalSearch) for (const indexedPage of pagesToIndex) searchIndexer.indexPage(indexedPage)
    await db.$syncAfterWrite?.()
    return page
  },
  async remove(input) {
    const page = db.transaction((tx) => {
      insertRevision(tx, input.revision)
      tx.update(pages).set({ lifecycle: 'deleted', updatedAt: input.updatedAt })
        .where(eq(pages.id, input.pageId)).run()
      tx.delete(pageRedirects).where(eq(pageRedirects.fromPath, input.path)).run()
      tx.delete(pageRedirects).where(eq(pageRedirects.toPath, input.path)).run()
      if (externalSearch) enqueueSearchOutbox(tx, input.pageId, 'delete')
      else if (!db.$syncAfterWrite) searchIndexer.removePage(input.pageId)
      return tx.select().from(pages).where(eq(pages.id, input.pageId)).get()
    })
    if (db.$syncAfterWrite && !externalSearch) searchIndexer.removePage(input.pageId)
    await db.$syncAfterWrite?.()
    return page
  },
  async purge(pageId, path) {
    db.transaction((tx) => {
      const paths = new Set<string>([path])
      for (const row of tx.select({ path: pageRevisions.path }).from(pageRevisions).where(eq(pageRevisions.pageId, pageId)).all()) {
        paths.add(row.path)
      }
      for (const row of tx.select({ path: pageComments.path }).from(pageComments).where(eq(pageComments.pageId, pageId)).all()) {
        paths.add(row.path)
      }
      for (const pagePath of paths) {
        tx.delete(pageAnalytics).where(eq(pageAnalytics.path, pagePath)).run()
        tx.delete(pageRedirects).where(eq(pageRedirects.fromPath, pagePath)).run()
        tx.delete(pageRedirects).where(eq(pageRedirects.toPath, pagePath)).run()
      }
      tx.delete(pageAssetRefs).where(eq(pageAssetRefs.pageId, pageId)).run()
      tx.delete(pageComments).where(eq(pageComments.pageId, pageId)).run()
      tx.delete(pageRevisions).where(eq(pageRevisions.pageId, pageId)).run()
      tx.delete(pages).where(eq(pages.id, pageId)).run()
      if (externalSearch) enqueueSearchOutbox(tx, pageId, 'delete')
      else if (!db.$syncAfterWrite) searchIndexer.removePage(pageId)
    })
    if (db.$syncAfterWrite && !externalSearch) searchIndexer.removePage(pageId)
    await db.$syncAfterWrite?.()
  },
  })
}
