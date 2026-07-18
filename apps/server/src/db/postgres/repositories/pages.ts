import { asc, desc, eq, lt, ne, sql } from 'drizzle-orm'
import { isUniqueConstraintError } from '../../errors.ts'
import type { SearchIndexer } from '../../../services/search.ts'
import type { PostgresDb } from '../client.ts'
import { pageAnalytics, pageAssetRefs, pageComments, pageRedirects, pageRevisions, pages, users } from '../schema.ts'
import {
  DuplicatePagePathError,
  type PageReadRepository,
  type PageRecord,
  type PageRevisionRecord,
  type PageWriteRepository,
} from '../../../repositories/pages.ts'

type PgTx = Parameters<Parameters<PostgresDb['transaction']>[0]>[0]

const insertRevision = (tx: PgTx, revision: PageRevisionRecord): Promise<unknown> =>
  tx.insert(pageRevisions).values(revision)

// SQLite tie-broke revision order on rowid; Postgres has none, so fall back to
// the revision id for a stable, deterministic secondary order.
const revisionOrder = [desc(pageRevisions.createdAt), desc(pageRevisions.id)] as const

/** PostgreSQL implementation of the driver-neutral page-read contract. */
export const createPostgresPageReadRepository = (db: PostgresDb): PageReadRepository => ({
  async listActive() {
    return db.select().from(pages).where(eq(pages.lifecycle, 'active')).orderBy(asc(pages.path))
  },

  async listInactive() {
    return db.select().from(pages).where(ne(pages.lifecycle, 'active')).orderBy(desc(pages.updatedAt))
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
    const base = db.select(selection).from(pageRevisions).leftJoin(users, eq(users.id, pageRevisions.authorId))
    const filtered = before === null ? base : base.where(lt(pageRevisions.createdAt, before))
    const rows = await filtered.orderBy(...revisionOrder).limit(limit)
    return rows.map((row) => ({ ...row, authorName: row.authorName ?? null }))
  },

  async listRedirects() {
    return db.select().from(pageRedirects).orderBy(asc(pageRedirects.fromPath))
  },

  async listRevisions(pageId) {
    const rows = await db
      .select({
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
      })
      .from(pageRevisions)
      .leftJoin(users, eq(users.id, pageRevisions.authorId))
      .where(eq(pageRevisions.pageId, pageId))
      .orderBy(...revisionOrder)
    return rows.map((row) => ({ ...row, authorName: row.authorName ?? null }))
  },

  async revisionContributors(pageId) {
    const lastContributionAt = sql<number>`max(${pageRevisions.createdAt})`
    const rows = await db
      .select({
        authorId: pageRevisions.authorId,
        authorName: users.name,
        revisions: sql<number>`count(*)`,
        lastContributionAt,
      })
      .from(pageRevisions)
      .leftJoin(users, eq(users.id, pageRevisions.authorId))
      .where(eq(pageRevisions.pageId, pageId))
      .groupBy(pageRevisions.authorId, users.name)
      .orderBy(desc(lastContributionAt), asc(users.name))
    return rows.map((row) => ({
      ...row,
      revisions: Number(row.revisions),
      lastContributionAt: Number(row.lastContributionAt),
    }))
  },
})

/**
 * PostgreSQL implementation of the driver-neutral page-write contract.
 *
 * Unlike the libSQL embedded replica, Postgres writes are immediately visible,
 * so there is no `$syncAfterWrite` dance: each mutation runs in a transaction
 * and the search index is updated once, after the transaction commits.
 */
export const createPostgresPageWriteRepository = (db: PostgresDb, searchIndexer: SearchIndexer): PageWriteRepository => ({
  async findByPath(path) {
    const [row] = await db.select().from(pages).where(eq(pages.path, path)).limit(1)
    return row
  },

  async findById(id) {
    const [row] = await db.select().from(pages).where(eq(pages.id, id)).limit(1)
    return row
  },

  async findRevision(id) {
    const [row] = await db.select().from(pageRevisions).where(eq(pageRevisions.id, id)).limit(1)
    return row
  },

  async findRedirect(path) {
    const [row] = await db.select().from(pageRedirects).where(eq(pageRedirects.fromPath, path)).limit(1)
    return row?.toPath ?? null
  },

  async writeExisting(input) {
    const page = await db.transaction(async (tx) => {
      if (input.revision) await insertRevision(tx, input.revision)
      await tx.update(pages).set(input.changes).where(eq(pages.id, input.pageId))
      const [updated] = await tx.select().from(pages).where(eq(pages.id, input.pageId)).limit(1)
      return updated
    })
    if (page) searchIndexer.indexPage(page)
    return page
  },

  async create(page, revision) {
    try {
      const created = await db.transaction(async (tx) => {
        await tx.delete(pageRedirects).where(eq(pageRedirects.fromPath, page.path))
        await tx.insert(pages).values(page)
        await insertRevision(tx, revision)
        const [row] = await tx.select().from(pages).where(eq(pages.id, page.id)).limit(1)
        return row
      })
      if (created) searchIndexer.indexPage(created)
      return created
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new DuplicatePagePathError()
      throw error
    }
  },

  async createRedirect(record) {
    await db.insert(pageRedirects).values(record)
  },

  async deleteRedirect(fromPath) {
    await db.delete(pageRedirects).where(eq(pageRedirects.fromPath, fromPath))
  },

  async setLifecycle(input) {
    const page = await db.transaction(async (tx) => {
      await insertRevision(tx, input.revision)
      await tx.update(pages).set({ lifecycle: input.lifecycle, updatedAt: input.updatedAt }).where(eq(pages.id, input.pageId))
      const [updated] = await tx.select().from(pages).where(eq(pages.id, input.pageId)).limit(1)
      return updated
    })
    if (input.index && page) searchIndexer.indexPage(page)
    else searchIndexer.removePage(input.pageId)
    return page
  },

  async move(input) {
    const pagesToIndex: PageRecord[] = []
    const page = await db.transaction(async (tx) => {
      await insertRevision(tx, input.revision)
      await tx.update(pages)
        .set({ path: input.newPath, spaceKey: input.spaceKey, updatedAt: input.updatedAt })
        .where(eq(pages.id, input.pageId))
      await tx.update(pageComments)
        .set({ path: input.newPath, updatedAt: input.updatedAt })
        .where(eq(pageComments.pageId, input.pageId))
      await tx.delete(pageRedirects).where(eq(pageRedirects.fromPath, input.newPath))
      await tx.update(pageRedirects).set({ toPath: input.newPath }).where(eq(pageRedirects.toPath, input.oldPath))
      await tx.insert(pageRedirects)
        .values({ fromPath: input.oldPath, toPath: input.newPath, createdAt: input.updatedAt })
        .onConflictDoUpdate({
          target: pageRedirects.fromPath,
          set: { toPath: input.newPath, createdAt: input.updatedAt },
        })
      for (const rewritten of input.rewrittenPages) {
        await insertRevision(tx, rewritten.revision)
        await tx.update(pages)
          .set({
            content: rewritten.content,
            renderedHtml: rewritten.renderedHtml,
            toc: rewritten.toc,
            updatedAt: rewritten.updatedAt,
          })
          .where(eq(pages.id, rewritten.pageId))
        const [updated] = await tx.select().from(pages).where(eq(pages.id, rewritten.pageId)).limit(1)
        if (updated) pagesToIndex.push(updated)
      }
      const [moved] = await tx.select().from(pages).where(eq(pages.id, input.pageId)).limit(1)
      if (moved) pagesToIndex.push(moved)
      return moved
    })
    for (const indexedPage of pagesToIndex) searchIndexer.indexPage(indexedPage)
    return page
  },

  async remove(input) {
    const page = await db.transaction(async (tx) => {
      await insertRevision(tx, input.revision)
      await tx.update(pages).set({ lifecycle: 'deleted', updatedAt: input.updatedAt }).where(eq(pages.id, input.pageId))
      await tx.delete(pageRedirects).where(eq(pageRedirects.fromPath, input.path))
      await tx.delete(pageRedirects).where(eq(pageRedirects.toPath, input.path))
      const [updated] = await tx.select().from(pages).where(eq(pages.id, input.pageId)).limit(1)
      return updated
    })
    searchIndexer.removePage(input.pageId)
    return page
  },

  async purge(pageId, path) {
    await db.transaction(async (tx) => {
      const paths = new Set<string>([path])
      for (const row of await tx.select({ path: pageRevisions.path }).from(pageRevisions).where(eq(pageRevisions.pageId, pageId))) {
        paths.add(row.path)
      }
      for (const row of await tx.select({ path: pageComments.path }).from(pageComments).where(eq(pageComments.pageId, pageId))) {
        paths.add(row.path)
      }
      for (const pagePath of paths) {
        await tx.delete(pageAnalytics).where(eq(pageAnalytics.path, pagePath))
        await tx.delete(pageRedirects).where(eq(pageRedirects.fromPath, pagePath))
        await tx.delete(pageRedirects).where(eq(pageRedirects.toPath, pagePath))
      }
      await tx.delete(pageAssetRefs).where(eq(pageAssetRefs.pageId, pageId))
      await tx.delete(pageComments).where(eq(pageComments.pageId, pageId))
      await tx.delete(pageRevisions).where(eq(pageRevisions.pageId, pageId))
      await tx.delete(pages).where(eq(pages.id, pageId))
    })
    searchIndexer.removePage(pageId)
  },
})
