/**
 * Asset service — records uploaded-file metadata. The bytes live on disk under
 * DATA_DIR/assets and are served statically; this just tracks them.
 */
import { desc } from 'drizzle-orm'
import type { DB } from '../db/client.ts'
import { assets, type Asset } from '../db/schema.ts'

export const ASSET_MAX_SIZE = '5m' as const
export const ASSET_MAX_BYTES = 5 * 1024 * 1024
export const ALLOWED_ASSET_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
] as const

type AllowedAssetMime = (typeof ALLOWED_ASSET_MIME_TYPES)[number]

const ASSET_EXTENSIONS: Record<AllowedAssetMime, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
}

export const assetExtensionForMime = (mime: string): string | null =>
  ALLOWED_ASSET_MIME_TYPES.includes(mime as AllowedAssetMime)
    ? ASSET_EXTENSIONS[mime as AllowedAssetMime]
    : null

export const safeAssetStorageName = (file: File, id = crypto.randomUUID()): string => {
  const stem =
    file.name
      .replace(/\.[^.]*$/, '')
      .replace(/[^\w.\-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80) || 'upload'
  const extension = assetExtensionForMime(file.type) ?? '.bin'
  return `${id}-${stem}${extension}`
}

export interface RecordAssetInput {
  readonly filename: string
  readonly mime: string
  readonly size: number
  readonly authorId: string | null
}

export interface AssetService {
  record(input: RecordAssetInput): Asset
  list(): Asset[]
}

export const createAssetService = (db: DB): AssetService => ({
  record(input) {
    const asset: Asset = { id: crypto.randomUUID(), ...input, createdAt: Date.now() }
    db.insert(assets).values(asset).run()
    return asset
  },
  list() {
    return db.select().from(assets).orderBy(desc(assets.createdAt)).all()
  },
})
