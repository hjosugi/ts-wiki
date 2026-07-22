/**
 * Asset service — records uploaded-file metadata. The bytes live behind the
 * configured asset storage boundary; this just tracks them.
 */
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
import type { AssetRecord, AssetRepository } from '../repositories/assets.ts'
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
  record(input: RecordAssetInput, principal: Principal | null): Promise<Result<AssetView, AppError>>
  list(principal: Principal | null, folder?: string | null, query?: string | null): Promise<Result<AssetView[], AppError>>
  folders(principal: Principal | null): Promise<Result<string[], AppError>>
  trash(principal: Principal | null): Promise<Result<AssetView[], AppError>>
  usage(principal: Principal | null, path?: string): Promise<Result<AssetUsageView[], AppError>>
  orphans(principal: Principal | null): Promise<Result<AssetView[], AppError>>
  findById(id: string, principal: Principal | null): Promise<Result<AssetView | null, AppError>>
  findDeletedById(id: string, principal: Principal | null): Promise<Result<AssetView | null, AppError>>
  accessPaths(storageName: string): Promise<string[]>
  update(id: string, input: UpdateAssetInput, principal: Principal | null): Promise<Result<AssetView | null, AppError>>
  rename(id: string, filename: string, principal: Principal | null): Promise<Result<AssetView | null, AppError>>
  remove(id: string, principal: Principal | null): Promise<Result<AssetView | null, AppError>>
  restore(id: string, principal: Principal | null): Promise<Result<AssetView | null, AppError>>
  purge(id: string, principal: Principal | null): Promise<Result<AssetView | null, AppError>>
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

const toView = (asset: AssetRecord, urlForStorageName: (storageName: string) => string): AssetView => ({
  ...asset,
  url: urlForStorageName(asset.storageName),
  thumbUrl: isImageAssetMime(asset.mime) ? `${defaultAssetUrl(asset.storageName)}?size=thumb` : null,
})

export const createAssetService = (repository: AssetRepository, options: AssetServiceOptions = {}): AssetService => {
  const urlForStorageName = options.urlForStorageName ?? defaultAssetUrl
  const searchIndexer = options.searchIndexer
  const requireAssetPermission = (principal: Principal | null, action: Action, path?: string): Result<true, AppError> =>
    requirePermission(principal, action, path ? { path } : {})
  const matchesAssetQuery = (asset: AssetRecord, query?: string | null): boolean => {
    const needle = query?.trim().toLowerCase()
    if (!needle) return true
    return `${asset.filename} ${asset.folder} ${asset.mime} ${asset.storageName}`.toLowerCase().includes(needle)
  }
  const activeRecords = async (folder?: string | null, query?: string | null): Promise<AssetRecord[]> => {
    const normalizedFolder = folder === undefined ? undefined : normalizeAssetFolder(folder)
    return (await repository.listActive(normalizedFolder)).filter((asset) => matchesAssetQuery(asset, query))
  }
  const deletedRecords = () => repository.listDeleted()
  const findActive = (id: string) => repository.findActive(id)
  const findDeleted = (id: string) => repository.findDeleted(id)
  const usageFor = async (principal: Principal | null, path?: string): Promise<AssetUsageView[]> => {
    const targetPath = path ? normalizePath(path) : null
    const visiblePages = (await repository.listActivePages())
      .filter((page) => (!targetPath || page.path === targetPath) && can(principal, 'page:read', { path: page.path }))

    const pageById = new Map(visiblePages.map((page) => [page.id, page]))
    const references = visiblePages.length
      ? await repository.listReferences(visiblePages.map((page) => page.id))
      : []

    return (await activeRecords()).map((asset) => {
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
  const attachExistingPages = async (asset: AssetRecord): Promise<void> => {
    const matchingPages = (await repository.listActivePages())
      .filter((page) => assetStorageNamesFromContent(page.content).includes(asset.storageName))
    await repository.insertReferences(matchingPages.map((page) => page.id), asset.id)
  }
  const refreshPagesForAsset = async (...records: AssetRecord[]): Promise<void> => {
    const ids = new Set((await Promise.all(records.map((asset) => repository.listAffectedPageIds(asset.id)))).flat())
    for (const id of ids) await searchIndexer?.indexPageById(id)
  }
  return {
    async record(input, principal) {
      const allowed = requireAssetPermission(principal, 'asset:write')
      if (!allowed.ok) return allowed
      const asset: AssetRecord = {
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
      await repository.insert(asset)
      await attachExistingPages(asset)
      await refreshPagesForAsset(asset)
      return ok(toView(asset, urlForStorageName))
    },
    async list(principal, folder, query) {
      const allowed = requireAssetPermission(principal, 'asset:read')
      if (!allowed.ok) return allowed
      return ok((await activeRecords(folder, query)).map((asset) => toView(asset, urlForStorageName)))
    },
    async folders(principal) {
      const allowed = requireAssetPermission(principal, 'asset:read')
      if (!allowed.ok) return allowed
      return ok([...new Set((await activeRecords()).map((asset) => asset.folder).filter(Boolean))].sort())
    },
    async trash(principal) {
      const allowed = requireAssetPermission(principal, 'admin:access')
      if (!allowed.ok) return allowed
      return ok((await deletedRecords()).map((asset) => toView(asset, urlForStorageName)))
    },
    async usage(principal, path) {
      const allowed = requireAssetPermission(principal, 'asset:read')
      if (!allowed.ok) return allowed
      const targetPath = path ? normalizePath(path) : null
      if (targetPath) {
        const pageAllowed = requireAssetPermission(principal, 'page:read', targetPath)
        if (!pageAllowed.ok) return pageAllowed
      }

      return ok(await usageFor(principal, path))
    },
    async orphans(principal) {
      const allowed = requireAssetPermission(principal, 'asset:read')
      if (!allowed.ok) return allowed
      return ok((await usageFor(principal)).filter((entry) => entry.pages.length === 0).map((entry) => entry.asset))
    },
    async findById(id, principal) {
      const allowed = requireAssetPermission(principal, 'asset:read')
      if (!allowed.ok) return allowed
      const asset = await findActive(id)
      return ok(asset ? toView(asset, urlForStorageName) : null)
    },
    async findDeletedById(id, principal) {
      const allowed = requireAssetPermission(principal, 'admin:access')
      if (!allowed.ok) return allowed
      const asset = await findDeleted(id)
      return ok(asset ? toView(asset, urlForStorageName) : null)
    },
    async accessPaths(storageName) {
      return await repository.listAccessPaths(storageName)
    },
    async update(id, input, principal) {
      const allowed = requireAssetPermission(principal, 'asset:write')
      if (!allowed.ok) return allowed
      const asset = await findActive(id)
      if (!asset) return ok(null)
      const patch: { filename?: string; folder?: string } = {}
      if (input.filename !== undefined) {
        const clean = input.filename.trim()
        if (!clean) return err(validationError('Filename is required', 'filename'))
        patch.filename = clean
      }
      if (input.folder !== undefined) {
        patch.folder = normalizeAssetFolder(input.folder)
      }
      if (Object.keys(patch).length === 0) return ok(toView(asset, urlForStorageName))
      await repository.update(id, patch)
      const updated = { ...asset, ...patch }
      await refreshPagesForAsset(asset, updated)
      return ok(toView(updated, urlForStorageName))
    },
    async rename(id, filename, principal) {
      return await this.update(id, { filename }, principal)
    },
    async remove(id, principal) {
      const allowed = requireAssetPermission(principal, 'asset:delete')
      if (!allowed.ok) return allowed
      const asset = await findActive(id)
      if (!asset) return ok(null)
      const deletedAt = Date.now()
      await repository.update(id, { deletedAt })
      await refreshPagesForAsset(asset)
      return ok(toView({ ...asset, deletedAt }, urlForStorageName))
    },
    async restore(id, principal) {
      const allowed = requireAssetPermission(principal, 'admin:access')
      if (!allowed.ok) return allowed
      const asset = await findDeleted(id)
      if (!asset) return ok(null)
      await repository.update(id, { deletedAt: null })
      await refreshPagesForAsset({ ...asset, deletedAt: null })
      return ok(toView({ ...asset, deletedAt: null }, urlForStorageName))
    },
    async purge(id, principal) {
      const allowed = requireAssetPermission(principal, 'admin:access')
      if (!allowed.ok) return allowed
      const asset = await findDeleted(id)
      if (!asset) return ok(null)
      await repository.delete(id)
      await refreshPagesForAsset({ ...asset, deletedAt: null })
      return ok(toView(asset, urlForStorageName))
    },
  }
}
