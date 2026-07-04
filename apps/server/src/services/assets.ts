/**
 * Asset service — records uploaded-file metadata. The bytes live behind the
 * configured asset storage boundary; this just tracks them.
 */
import { eq, desc } from 'drizzle-orm'
import { type AppError, type Principal, type Result, can, err, forbidden, ok } from '@ts-wiki/core'
import type { DB } from '../db/client.ts'
import { assets, type Asset } from '../db/schema.ts'

export const ASSET_MAX_SIZE = '25m' as const
export const ASSET_MAX_BYTES = 25 * 1024 * 1024
export const ASSET_HARD_MAX_SIZE = '100m' as const
export const ALLOWED_ASSET_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
] as const

type AllowedAssetMime = (typeof ALLOWED_ASSET_MIME_TYPES)[number]

const ASSET_EXTENSIONS: Record<AllowedAssetMime, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/csv': '.csv',
  'application/json': '.json',
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.oasis.opendocument.text': '.odt',
  'application/vnd.oasis.opendocument.spreadsheet': '.ods',
  'application/vnd.oasis.opendocument.presentation': '.odp',
}

export const assetExtensionForMime = (mime: string): string | null =>
  ALLOWED_ASSET_MIME_TYPES.includes(mime as AllowedAssetMime)
    ? ASSET_EXTENSIONS[mime as AllowedAssetMime]
    : null

export const safeAssetFilename = (file: File): string => {
  const stem =
    file.name
      .replace(/\.[^.]*$/, '')
      .replace(/[^\w.\-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80) || 'upload'
  const extension = assetExtensionForMime(file.type) ?? '.bin'
  return `${stem}${extension}`
}

export const safeAssetStorageName = (file: File, id: string = crypto.randomUUID()): string =>
  `${id}-${safeAssetFilename(file)}`

export interface RecordAssetInput {
  readonly id?: string
  readonly filename: string
  readonly storageName: string
  readonly mime: string
  readonly size: number
  readonly authorId: string | null
}

export interface AssetView {
  readonly id: string
  readonly filename: string
  readonly storageName: string
  readonly mime: string
  readonly size: number
  readonly authorId: string | null
  readonly createdAt: number
  readonly url: string
}

export interface AssetService {
  record(input: RecordAssetInput, principal: Principal | null): Result<AssetView, AppError>
  list(principal: Principal | null): Result<AssetView[], AppError>
  findById(id: string, principal: Principal | null): Result<AssetView | null, AppError>
  rename(id: string, filename: string, principal: Principal | null): Result<AssetView | null, AppError>
  remove(id: string, principal: Principal | null): Result<AssetView | null, AppError>
}

export interface AssetServiceOptions {
  readonly urlForStorageName?: (storageName: string) => string
}

const encodeAssetPath = (storageName: string): string =>
  storageName.split('/').map(encodeURIComponent).join('/')

const defaultAssetUrl = (storageName: string): string => `/assets/${encodeAssetPath(storageName)}`

const toView = (asset: Asset, urlForStorageName: (storageName: string) => string): AssetView => ({
  ...asset,
  url: urlForStorageName(asset.storageName),
})

export const createAssetService = (db: DB, options: AssetServiceOptions = {}): AssetService => {
  const urlForStorageName = options.urlForStorageName ?? defaultAssetUrl
  return {
    record(input, principal) {
      if (!can(principal, 'asset:write')) return err(forbidden())
      const asset: Asset = {
        id: input.id ?? crypto.randomUUID(),
        filename: input.filename,
        storageName: input.storageName,
        mime: input.mime,
        size: input.size,
        authorId: input.authorId,
        createdAt: Date.now(),
      }
      db.insert(assets).values(asset).run()
      return ok(toView(asset, urlForStorageName))
    },
    list(principal) {
      if (!can(principal, 'asset:read')) return err(forbidden())
      return ok(db.select().from(assets).orderBy(desc(assets.createdAt)).all().map((asset) =>
        toView(asset, urlForStorageName)
      ))
    },
    findById(id, principal) {
      if (!can(principal, 'asset:read')) return err(forbidden())
      const asset = db.select().from(assets).where(eq(assets.id, id)).get()
      return ok(asset ? toView(asset, urlForStorageName) : null)
    },
    rename(id, filename, principal) {
      if (!can(principal, 'asset:write')) return err(forbidden())
      const asset = db.select().from(assets).where(eq(assets.id, id)).get()
      const clean = filename.trim()
      if (!asset || !clean) return ok(null)
      db.update(assets).set({ filename: clean }).where(eq(assets.id, id)).run()
      return ok(toView({ ...asset, filename: clean }, urlForStorageName))
    },
    remove(id, principal) {
      if (!can(principal, 'asset:delete')) return err(forbidden())
      const asset = db.select().from(assets).where(eq(assets.id, id)).get()
      if (!asset) return ok(null)
      db.delete(assets).where(eq(assets.id, id)).run()
      return ok(toView(asset, urlForStorageName))
    },
  }
}
