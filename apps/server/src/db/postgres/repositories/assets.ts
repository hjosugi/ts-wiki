import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import type { PostgresDb } from '../client.ts'
import { assets, pageAssetRefs, pages } from '../schema.ts'
import type { AssetRepository } from '../../../repositories/assets.ts'

/** PostgreSQL implementation of the driver-neutral asset contract. */
export const createPostgresAssetRepository = (db: PostgresDb): AssetRepository => ({
  async listActive(folder) {
    const where = folder === undefined
      ? isNull(assets.deletedAt)
      : and(isNull(assets.deletedAt), eq(assets.folder, folder))
    return db.select().from(assets).where(where).orderBy(desc(assets.createdAt))
  },
  async listDeleted() {
    return db.select().from(assets).where(isNotNull(assets.deletedAt)).orderBy(desc(assets.deletedAt))
  },
  async findActive(id) {
    const [row] = await db.select().from(assets).where(and(eq(assets.id, id), isNull(assets.deletedAt))).limit(1)
    return row
  },
  async findDeleted(id) {
    const [row] = await db.select().from(assets).where(and(eq(assets.id, id), isNotNull(assets.deletedAt))).limit(1)
    return row
  },
  async listActivePages() {
    return db
      .select({ id: pages.id, path: pages.path, title: pages.title, content: pages.content })
      .from(pages)
      .where(eq(pages.lifecycle, 'active'))
      .orderBy(asc(pages.path))
  },
  async listReferences(pageIds) {
    if (!pageIds.length) return []
    return db.select().from(pageAssetRefs).where(inArray(pageAssetRefs.pageId, [...pageIds]))
  },
  async insertReferences(pageIds, assetId) {
    if (!pageIds.length) return
    await db.insert(pageAssetRefs).values(pageIds.map((pageId) => ({ pageId, assetId }))).onConflictDoNothing()
  },
  async listAffectedPageIds(assetId) {
    const rows = await db.select({ id: pageAssetRefs.pageId }).from(pageAssetRefs).where(eq(pageAssetRefs.assetId, assetId))
    return rows.map((row) => row.id)
  },
  async listAccessPaths(storageName) {
    const rows = await db
      .select({ path: pages.path })
      .from(assets)
      .innerJoin(pageAssetRefs, eq(pageAssetRefs.assetId, assets.id))
      .innerJoin(pages, eq(pages.id, pageAssetRefs.pageId))
      .where(and(eq(assets.storageName, storageName), eq(pages.lifecycle, 'active')))
    return rows.map((row) => row.path)
  },
  async insert(record) {
    await db.insert(assets).values(record)
  },
  async update(id, changes) {
    await db.update(assets).set(changes).where(eq(assets.id, id))
  },
  async delete(id) {
    await db.delete(assets).where(eq(assets.id, id))
  },
})
