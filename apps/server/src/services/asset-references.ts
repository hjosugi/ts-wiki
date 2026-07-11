import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { DB } from '../db/client.ts'
import { assets, pageAssetRefs } from '../db/schema.ts'

const ASSET_URL = /\/assets\/([^\s)'"?#]+)/g

const decodeStorageName = (value: string): string => {
  try {
    return value.split('/').map(decodeURIComponent).join('/')
  } catch {
    return value
  }
}

export const assetStorageNamesFromContent = (content: string): string[] =>
  [...new Set([...content.matchAll(ASSET_URL)].map((match) => decodeStorageName(match[1] ?? '')).filter(Boolean))]

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
