import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { DB } from '../client.ts'
import { assets, pageAssetRefs } from '../schema.ts'
import { assetStorageNamesFromContent } from '../../services/asset-references.ts'

export const syncPageAssetReferences = (db: DB, pageId: string, content: string): void => {
  const storageNames = assetStorageNamesFromContent(content)
  const referenced = storageNames.length
    ? db.select({ id: assets.id }).from(assets)
        .where(and(inArray(assets.storageName, storageNames), isNull(assets.deletedAt)))
        .all()
    : []
  db.delete(pageAssetRefs).where(eq(pageAssetRefs.pageId, pageId)).run()
  if (referenced.length) {
    db.insert(pageAssetRefs).values(referenced.map((asset) => ({ pageId, assetId: asset.id }))).onConflictDoNothing().run()
  }
}
