/**
 * Asset service — records uploaded-file metadata. The bytes live behind the
 * configured asset storage boundary; this just tracks them.
 */
import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { fileTypeFromBlob } from 'file-type'
import {
  type Action,
  type AppError,
  type Principal,
  type Result,
  can,
  err,
  normalizePath,
  ok,
  requirePermission,
  validationError,
} from '@kawaii-wiki/core'
import type { DB } from '../db/client.ts'
import { assets, pageAssetRefs, pages, type Asset } from '../db/schema.ts'
import type { SearchIndexer } from './search.ts'
import { assetStorageNamesFromContent } from './asset-references.ts'

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

export type AllowedAssetMime = (typeof ALLOWED_ASSET_MIME_TYPES)[number]

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

const normalizeAssetMime = (mime: string): string => mime.split(';', 1)[0]!.trim().toLowerCase()

const isAllowedAssetMime = (mime: string): mime is AllowedAssetMime =>
  ALLOWED_ASSET_MIME_TYPES.includes(mime as AllowedAssetMime)

export const assetExtensionForMime = (mime: string): string | null => {
  const normalized = normalizeAssetMime(mime)
  return isAllowedAssetMime(normalized) ? ASSET_EXTENSIONS[normalized] : null
}

const TEXT_ASSET_MIME_TYPES = new Set<AllowedAssetMime>([
  'text/plain',
  'text/markdown',
  'text/csv',
])

const ZIP_ASSET_MIME_TYPES = new Set<AllowedAssetMime>([
  'application/zip',
  'application/x-zip-compressed',
])

const fileBytes = async (file: File): Promise<Uint8Array> => new Uint8Array(await file.arrayBuffer())

const decodeUtf8 = (bytes: Uint8Array): string | null => {
  if (bytes.includes(0)) return null
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

const validateTextAsset = async (file: File, mime: AllowedAssetMime): Promise<boolean> => {
  const text = decodeUtf8(await fileBytes(file))
  if (text === null) return false
  if (mime !== 'application/json') return true
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

const assetMimeMatches = (declared: AllowedAssetMime, detected: string): boolean =>
  declared === detected ||
  (ZIP_ASSET_MIME_TYPES.has(declared) && detected === 'application/zip')

export const validateAssetUpload = async (file: File): Promise<Result<AllowedAssetMime, AppError>> => {
  const declared = normalizeAssetMime(file.type)
  if (!isAllowedAssetMime(declared)) {
    return err(validationError('Unsupported asset type', 'file'))
  }

  if (TEXT_ASSET_MIME_TYPES.has(declared) || declared === 'application/json') {
    return (await validateTextAsset(file, declared))
      ? ok(declared)
      : err(validationError('Asset contents do not match the declared type', 'file'))
  }

  const detected = await fileTypeFromBlob(file).catch(() => undefined)
  if (!detected || !assetMimeMatches(declared, detected.mime)) {
    return err(validationError('Asset contents do not match the declared type', 'file'))
  }

  return ok(declared)
}

export const safeAssetFilename = (file: File, mime: string = file.type): string => {
  const stem =
    file.name
      .replace(/\.[^.]*$/, '')
      .replace(/[^\w.-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80) || 'upload'
  const extension = assetExtensionForMime(mime) ?? '.bin'
  return `${stem}${extension}`
}

export const safeAssetStorageName = (
  file: File,
  id: string = crypto.randomUUID(),
  mime: string = file.type,
): string =>
  `${id}-${safeAssetFilename(file, mime)}`

export const normalizeAssetFolder = (folder: string | null | undefined): string =>
  normalizePath((folder ?? '').replace(/\\/g, '/'))

export interface RecordAssetInput {
  readonly id?: string
  readonly filename: string
  readonly storageName: string
  readonly folder?: string | null
  readonly mime: string
  readonly size: number
  readonly authorId: string | null
}

export interface UpdateAssetInput {
  readonly filename?: string
  readonly folder?: string | null
}

export interface AssetView {
  readonly id: string
  readonly filename: string
  readonly storageName: string
  readonly folder: string
  readonly mime: string
  readonly size: number
  readonly authorId: string | null
  readonly createdAt: number
  readonly deletedAt: number | null
  readonly url: string
  readonly thumbUrl: string | null
}

export interface AssetUsagePage {
  readonly path: string
  readonly title: string
}

export interface AssetUsageView {
  readonly asset: AssetView
  readonly pages: AssetUsagePage[]
}

export interface AssetService {
  record(input: RecordAssetInput, principal: Principal | null): Result<AssetView, AppError>
  list(principal: Principal | null, folder?: string | null, query?: string | null): Result<AssetView[], AppError>
  folders(principal: Principal | null): Result<string[], AppError>
  trash(principal: Principal | null): Result<AssetView[], AppError>
  usage(principal: Principal | null, path?: string): Result<AssetUsageView[], AppError>
  orphans(principal: Principal | null): Result<AssetView[], AppError>
  findById(id: string, principal: Principal | null): Result<AssetView | null, AppError>
  findDeletedById(id: string, principal: Principal | null): Result<AssetView | null, AppError>
  accessPaths(storageName: string): string[]
  update(id: string, input: UpdateAssetInput, principal: Principal | null): Result<AssetView | null, AppError>
  rename(id: string, filename: string, principal: Principal | null): Result<AssetView | null, AppError>
  remove(id: string, principal: Principal | null): Result<AssetView | null, AppError>
  restore(id: string, principal: Principal | null): Result<AssetView | null, AppError>
  purge(id: string, principal: Principal | null): Result<AssetView | null, AppError>
}

export interface AssetServiceOptions {
  readonly urlForStorageName?: (storageName: string) => string
  readonly searchIndexer?: SearchIndexer
}

const encodeAssetPath = (storageName: string): string =>
  storageName.split('/').map(encodeURIComponent).join('/')

const defaultAssetUrl = (storageName: string): string => `/assets/${encodeAssetPath(storageName)}`

export const isImageAssetMime = (mime: string): boolean => normalizeAssetMime(mime).startsWith('image/')

export const thumbnailStorageName = (storageName: string): string => {
  if (storageName.includes('/')) {
    const parts = storageName.split('/')
    parts[parts.length - 1] = 'thumb.webp'
    return parts.join('/')
  }
  return `${storageName.replace(/\.[^.]+$/, '')}.thumb.webp`
}

const toView = (asset: Asset, urlForStorageName: (storageName: string) => string): AssetView => ({
  ...asset,
  url: urlForStorageName(asset.storageName),
  thumbUrl: isImageAssetMime(asset.mime) ? `${defaultAssetUrl(asset.storageName)}?size=thumb` : null,
})

export const createAssetService = (db: DB, options: AssetServiceOptions = {}): AssetService => {
  const urlForStorageName = options.urlForStorageName ?? defaultAssetUrl
  const searchIndexer = options.searchIndexer
  const requireAssetPermission = (principal: Principal | null, action: Action, path?: string): Result<true, AppError> =>
    requirePermission(principal, action, path ? { path } : {})
  const matchesAssetQuery = (asset: Asset, query?: string | null): boolean => {
    const needle = query?.trim().toLowerCase()
    if (!needle) return true
    return `${asset.filename} ${asset.folder} ${asset.mime} ${asset.storageName}`.toLowerCase().includes(needle)
  }
  const activeRecords = (folder?: string | null, query?: string | null): Asset[] => {
    const normalizedFolder = folder === undefined ? undefined : normalizeAssetFolder(folder)
    const conditions = [isNull(assets.deletedAt)]
    if (normalizedFolder !== undefined) conditions.push(eq(assets.folder, normalizedFolder))
    return db.select().from(assets).where(and(...conditions)).orderBy(desc(assets.createdAt)).all()
      .filter((asset) => matchesAssetQuery(asset, query))
  }
  const deletedRecords = (): Asset[] =>
    db.select().from(assets).where(isNotNull(assets.deletedAt)).orderBy(desc(assets.deletedAt)).all()
  const findActive = (id: string): Asset | undefined =>
    db.select().from(assets).where(and(eq(assets.id, id), isNull(assets.deletedAt))).get()
  const findDeleted = (id: string): Asset | undefined =>
    db.select().from(assets).where(and(eq(assets.id, id), isNotNull(assets.deletedAt))).get()
  const usageFor = (principal: Principal | null, path?: string): AssetUsageView[] => {
    const targetPath = path ? normalizePath(path) : null
    const visiblePages = db
      .select({
        id: pages.id,
        path: pages.path,
        title: pages.title,
      })
      .from(pages)
      .where(eq(pages.lifecycle, 'active'))
      .orderBy(asc(pages.path))
      .all()
      .filter((page) => (!targetPath || page.path === targetPath) && can(principal, 'page:read', { path: page.path }))

    const pageById = new Map(visiblePages.map((page) => [page.id, page]))
    const references = visiblePages.length
      ? db.select().from(pageAssetRefs).where(inArray(pageAssetRefs.pageId, visiblePages.map((page) => page.id))).all()
      : []

    return activeRecords().map((asset) => {
      const view = toView(asset, urlForStorageName)
      return {
        asset: view,
        pages: references
          .filter((reference) => reference.assetId === asset.id)
          .flatMap((reference) => {
            const page = pageById.get(reference.pageId)
            return page ? [{ path: page.path, title: page.title }] : []
          }),
      }
    })
  }
  const affectedPageIds = (asset: Asset): string[] => {
    return db.select({ id: pageAssetRefs.pageId }).from(pageAssetRefs)
      .where(eq(pageAssetRefs.assetId, asset.id)).all().map((page) => page.id)
  }
  const attachExistingPages = (asset: Asset): void => {
    const matchingPages = db.select({ id: pages.id, content: pages.content }).from(pages)
      .where(eq(pages.lifecycle, 'active')).all()
      .filter((page) => assetStorageNamesFromContent(page.content).includes(asset.storageName))
    if (matchingPages.length) {
      db.insert(pageAssetRefs)
        .values(matchingPages.map((page) => ({ pageId: page.id, assetId: asset.id })))
        .onConflictDoNothing()
        .run()
    }
  }
  const refreshPagesForAsset = (...records: Asset[]): void => {
    const ids = new Set(records.flatMap((asset) => affectedPageIds(asset)))
    for (const id of ids) searchIndexer?.indexPageById(id)
  }
  return {
    record(input, principal) {
      const allowed = requireAssetPermission(principal, 'asset:write')
      if (!allowed.ok) return allowed
      const asset: Asset = {
        id: input.id ?? crypto.randomUUID(),
        filename: input.filename,
        storageName: input.storageName,
        folder: normalizeAssetFolder(input.folder),
        mime: input.mime,
        size: input.size,
        authorId: input.authorId,
        createdAt: Date.now(),
        deletedAt: null,
      }
      db.insert(assets).values(asset).run()
      attachExistingPages(asset)
      refreshPagesForAsset(asset)
      return ok(toView(asset, urlForStorageName))
    },
    list(principal, folder, query) {
      const allowed = requireAssetPermission(principal, 'asset:read')
      if (!allowed.ok) return allowed
      return ok(activeRecords(folder, query).map((asset) => toView(asset, urlForStorageName)))
    },
    folders(principal) {
      const allowed = requireAssetPermission(principal, 'asset:read')
      if (!allowed.ok) return allowed
      return ok([...new Set(activeRecords().map((asset) => asset.folder).filter(Boolean))].sort())
    },
    trash(principal) {
      const allowed = requireAssetPermission(principal, 'admin:access')
      if (!allowed.ok) return allowed
      return ok(deletedRecords().map((asset) => toView(asset, urlForStorageName)))
    },
    usage(principal, path) {
      const allowed = requireAssetPermission(principal, 'asset:read')
      if (!allowed.ok) return allowed
      const targetPath = path ? normalizePath(path) : null
      if (targetPath) {
        const pageAllowed = requireAssetPermission(principal, 'page:read', targetPath)
        if (!pageAllowed.ok) return pageAllowed
      }

      return ok(usageFor(principal, path))
    },
    orphans(principal) {
      const allowed = requireAssetPermission(principal, 'asset:read')
      if (!allowed.ok) return allowed
      return ok(usageFor(principal).filter((entry) => entry.pages.length === 0).map((entry) => entry.asset))
    },
    findById(id, principal) {
      const allowed = requireAssetPermission(principal, 'asset:read')
      if (!allowed.ok) return allowed
      const asset = findActive(id)
      return ok(asset ? toView(asset, urlForStorageName) : null)
    },
    findDeletedById(id, principal) {
      const allowed = requireAssetPermission(principal, 'admin:access')
      if (!allowed.ok) return allowed
      const asset = findDeleted(id)
      return ok(asset ? toView(asset, urlForStorageName) : null)
    },
    accessPaths(storageName) {
      return db
        .select({ path: pages.path })
        .from(assets)
        .innerJoin(pageAssetRefs, eq(pageAssetRefs.assetId, assets.id))
        .innerJoin(pages, eq(pages.id, pageAssetRefs.pageId))
        .where(and(eq(assets.storageName, storageName), eq(pages.lifecycle, 'active')))
        .all()
        .map((row) => row.path)
    },
    update(id, input, principal) {
      const allowed = requireAssetPermission(principal, 'asset:write')
      if (!allowed.ok) return allowed
      const asset = findActive(id)
      if (!asset) return ok(null)
      const patch: Partial<Pick<Asset, 'filename' | 'folder'>> = {}
      if (input.filename !== undefined) {
        const clean = input.filename.trim()
        if (!clean) return err(validationError('Filename is required', 'filename'))
        patch.filename = clean
      }
      if (input.folder !== undefined) {
        patch.folder = normalizeAssetFolder(input.folder)
      }
      if (Object.keys(patch).length === 0) return ok(toView(asset, urlForStorageName))
      db.update(assets).set(patch).where(eq(assets.id, id)).run()
      const updated = { ...asset, ...patch }
      refreshPagesForAsset(asset, updated)
      return ok(toView(updated, urlForStorageName))
    },
    rename(id, filename, principal) {
      return this.update(id, { filename }, principal)
    },
    remove(id, principal) {
      const allowed = requireAssetPermission(principal, 'asset:delete')
      if (!allowed.ok) return allowed
      const asset = findActive(id)
      if (!asset) return ok(null)
      const deletedAt = Date.now()
      db.update(assets).set({ deletedAt }).where(eq(assets.id, id)).run()
      refreshPagesForAsset(asset)
      return ok(toView({ ...asset, deletedAt }, urlForStorageName))
    },
    restore(id, principal) {
      const allowed = requireAssetPermission(principal, 'admin:access')
      if (!allowed.ok) return allowed
      const asset = findDeleted(id)
      if (!asset) return ok(null)
      db.update(assets).set({ deletedAt: null }).where(eq(assets.id, id)).run()
      refreshPagesForAsset({ ...asset, deletedAt: null })
      return ok(toView({ ...asset, deletedAt: null }, urlForStorageName))
    },
    purge(id, principal) {
      const allowed = requireAssetPermission(principal, 'admin:access')
      if (!allowed.ok) return allowed
      const asset = findDeleted(id)
      if (!asset) return ok(null)
      db.delete(assets).where(eq(assets.id, id)).run()
      refreshPagesForAsset({ ...asset, deletedAt: null })
      return ok(toView(asset, urlForStorageName))
    },
  }
}
