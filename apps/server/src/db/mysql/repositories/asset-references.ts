import { and, eq, inArray, isNull } from 'drizzle-orm'
import { assetStorageNamesFromContent } from '../../../services/asset-references.ts'
import type { MysqlDb } from '../client.ts'
import { assets, pageAssetRefs } from '../schema.ts'

/** Keep `page_asset_refs` in sync with the assets a page's content references. */
export const syncMysqlPageAssetReferences = async (db: MysqlDb, pageId: string, content: string): Promise<void> => {
  const storageNames = assetStorageNamesFromContent(content)
  const referenced = storageNames.length
    ? await db
        .select({ id: assets.id })
        .from(assets)
        .where(and(inArray(assets.storageName, storageNames), isNull(assets.deletedAt)))
    : []
  await db.delete(pageAssetRefs).where(eq(pageAssetRefs.pageId, pageId))
  if (referenced.length) {
    await db.insert(pageAssetRefs).ignore().values(referenced.map((asset) => ({ pageId, assetId: asset.id })))
  }
}
