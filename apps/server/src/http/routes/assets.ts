import { Buffer } from 'node:buffer'
import { t } from 'elysia'
import {
  type Principal,
  unauthorized,
  validationError,
} from '@kawaii-wiki/core'
import type { Services } from '../../services/index.ts'
import type { AssetStorage, AssetObject } from '../../storage/assets.ts'
import {
  ASSET_HARD_MAX_SIZE,
  isImageAssetMime,
  thumbnailStorageName,
  validateAssetUpload,
  type AssetView,
} from '../../services/assets.ts'
import type { AutomationEvent } from '../../services/webhooks.ts'
import { audit, type StructuredLogger } from '../../observability/logging.ts'
import { HttpError, unwrap } from '../errors.ts'
import { requireHttpPermission } from '../permissions.ts'
import type { RequestIpServer } from '../rate-limit.ts'
import { assetSnapshot } from '../representations.ts'
import type { BaseApp } from '../base.ts'

const ASSET_RESPONSE_HEADER_ALLOWLIST = [
  'cache-control',
  'content-length',
  'content-type',
  'etag',
  'last-modified',
] as const

const assetResponse = (asset: AssetObject): Response => {
  const headers = new Headers()
  for (const header of ASSET_RESPONSE_HEADER_ALLOWLIST) {
    const value = asset.headers.get(header)
    if (value) headers.set(header, value)
  }
  headers.set('x-content-type-options', 'nosniff')
  const contentType = headers.get('content-type') ?? ''
  headers.set('content-disposition', contentType.startsWith('image/') ? 'inline' : 'attachment')
  return new Response(asset.body, { headers })
}

const formatBytes = (bytes: number): string => {
  if (bytes % (1024 * 1024) === 0) return `${bytes / (1024 * 1024)}MB`
  if (bytes % 1024 === 0) return `${bytes / 1024}KB`
  return `${bytes}B`
}

const safeAssetRequestPath = (rawPath: string): string | null => {
  let decoded: string
  try {
    decoded = decodeURIComponent(rawPath)
  } catch {
    return null
  }
  if (!decoded || decoded.startsWith('/') || decoded.includes('\\') || decoded.includes('\0')) return null
  if (decoded.split('/').some((part) => part === '.' || part === '..' || part.length === 0)) return null
  return decoded
}

const pagedAssets = (assets: AssetView[], limit = 100, offset = 0) => {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 1_000)
  const safeOffset = Math.max(Math.trunc(offset), 0)
  return { assets: assets.slice(safeOffset, safeOffset + safeLimit), total: assets.length, limit: safeLimit, offset: safeOffset }
}

const generateImageThumbnail = async (file: File, mime: string): Promise<File | null> => {
  if (!isImageAssetMime(mime)) return null
  try {
    const { default: sharp } = await import('sharp')
    const output = await sharp(Buffer.from(await file.arrayBuffer()), { animated: false })
      .rotate()
      .resize({ width: 360, height: 240, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 76 })
      .toBuffer()
    return new File([output], 'thumb.webp', { type: 'image/webp' })
  } catch {
    return null
  }
}

export interface AssetRoutesContext {
  readonly logger: StructuredLogger
  readonly assetStorage: AssetStorage
  readonly assetPolicy: () => { readonly maxBytes: number }
  readonly privateWiki: () => boolean
  readonly canReadPage: (principal: Principal | null, path?: string) => boolean
  readonly enforceAssetUploadLimit: (
    request: Request,
    server: RequestIpServer | null | undefined,
    principal: Principal | null,
  ) => void
  readonly publishAutomation: (event: AutomationEvent) => Promise<void>
}

export const createAssetRoutes = ({
  logger,
  assetStorage,
  assetPolicy,
  privateWiki,
  canReadPage,
  enforceAssetUploadLimit,
  publishAutomation,
}: AssetRoutesContext) => {
  const updateAssetMetadata = async (
    id: string,
    body: { filename?: string; folder?: string },
    principal: Principal | null,
    services: Services,
  ): Promise<{ asset: AssetView }> => {
    requireHttpPermission(principal, 'asset:write')
    if (body.filename === undefined && body.folder === undefined) {
      throw new HttpError(validationError('Filename or folder is required', 'asset'))
    }
    const asset = unwrap(services.assets.update(id, body, principal))
    if (!asset) throw new HttpError(validationError('Asset not found', 'id'))
    audit(logger, 'asset.rename', {
      userId: principal?.id ?? null,
      assetId: asset.id,
      filename: asset.filename,
      folder: asset.folder,
    })
    await publishAutomation({
      type: 'asset.renamed',
      actorId: principal?.id ?? null,
      data: { asset: assetSnapshot(asset) },
    })
    return { asset }
  }

  return (app: BaseApp) =>
    app
      .get('/api/assets', ({ query, services, principal }) => {
        requireHttpPermission(principal, 'asset:read')
        return pagedAssets(unwrap(services.assets.list(principal, query.folder, query.q)), query.limit, query.offset)
      }, { query: t.Object({ folder: t.Optional(t.String()), q: t.Optional(t.String()), limit: t.Optional(t.Numeric()), offset: t.Optional(t.Numeric()) }) })
      .get('/api/assets/folders', ({ services, principal }) => {
        requireHttpPermission(principal, 'asset:read')
        return { folders: unwrap(services.assets.folders(principal)) }
      })
      .get('/api/assets/trash', ({ query, services, principal }) => {
        requireHttpPermission(principal, 'admin:access')
        return pagedAssets(unwrap(services.assets.trash(principal)), query.limit, query.offset)
      }, { query: t.Object({ limit: t.Optional(t.Numeric()), offset: t.Optional(t.Numeric()) }) })
      .get(
        '/api/assets/usage',
        ({ query, services, principal }) => {
          requireHttpPermission(principal, 'asset:read')
          return { usage: unwrap(services.assets.usage(principal, query.path)) }
        },
        { query: t.Object({ path: t.Optional(t.String()) }) },
      )
      .get('/api/assets/orphans', ({ services, principal }) => {
        requireHttpPermission(principal, 'admin:access')
        return { assets: unwrap(services.assets.orphans(principal)) }
      })
      .post(
        '/api/assets/orphans/delete',
        async ({ body, services, principal }) => {
          requireHttpPermission(principal, 'admin:access')
          const requestedIds = new Set(body.ids)
          const currentOrphans = unwrap(services.assets.orphans(principal))
          const currentOrphanIds = new Set(currentOrphans.map((asset) => asset.id))
          const targets = currentOrphans.filter((asset) => requestedIds.has(asset.id))
          const removed: AssetView[] = []
          for (const asset of targets) {
            const removedAsset = unwrap(services.assets.remove(asset.id, principal))
            if (!removedAsset) continue
            removed.push(removedAsset)
            await publishAutomation({
              type: 'asset.deleted',
              actorId: principal?.id ?? null,
              data: { asset: assetSnapshot(removedAsset) },
            })
          }
          const skipped = [...requestedIds].filter((id) => !currentOrphanIds.has(id)).length
          audit(logger, 'asset.orphans.delete', {
            userId: principal?.id ?? null,
            requested: requestedIds.size,
            deleted: removed.length,
            skipped,
          })
          return { assets: removed, skipped }
        },
        { body: t.Object({ ids: t.Array(t.String()) }) },
      )
      .post(
        '/api/assets',
        async ({ body, services, principal, request, server }) => {
          enforceAssetUploadLimit(request, server, principal)
          requireHttpPermission(principal, 'asset:write')
          const file = body.file
          const maxBytes = assetPolicy().maxBytes
          if (file.size > maxBytes) {
            throw new HttpError(validationError(`Asset must be ${formatBytes(maxBytes)} or smaller`, 'file'))
          }
          const mime = unwrap(await validateAssetUpload(file))
          const id = crypto.randomUUID()
          const storageName = assetStorage.storageNameForUpload(id, file, mime)
          await assetStorage.put({ storageName, file, contentType: mime })
          const thumbnail = await generateImageThumbnail(file, mime)
          if (thumbnail) {
            await assetStorage.put({
              storageName: thumbnailStorageName(storageName),
              file: thumbnail,
              contentType: 'image/webp',
            })
          }
          const asset = unwrap(services.assets.record({
            id,
            filename: file.name,
            storageName,
            folder: body.folder,
            mime,
            size: file.size,
            authorId: principal?.id ?? null,
          }, principal))
          audit(logger, 'asset.upload', {
            userId: principal?.id ?? null,
            assetId: asset.id,
            filename: asset.filename,
            size: asset.size,
          })
          await publishAutomation({
            type: 'asset.uploaded',
            actorId: principal?.id ?? null,
            data: { asset: assetSnapshot(asset) },
          })
          return { id: asset.id, filename: asset.filename, folder: asset.folder, url: asset.url }
        },
        {
          body: t.Object({
            file: t.File({ maxSize: ASSET_HARD_MAX_SIZE }),
            folder: t.Optional(t.String()),
          }),
        },
      )
      .post(
        '/api/assets/:id/restore',
        async ({ params, services, principal }) => {
          requireHttpPermission(principal, 'admin:access')
          const asset = unwrap(services.assets.restore(params.id, principal))
          if (!asset) throw new HttpError(validationError('Asset not found in trash', 'id'))
          audit(logger, 'asset.restore', {
            userId: principal?.id ?? null,
            assetId: asset.id,
            filename: asset.filename,
          })
          await publishAutomation({
            type: 'asset.restored',
            actorId: principal?.id ?? null,
            data: { asset: assetSnapshot(asset) },
          })
          return { asset }
        },
        { params: t.Object({ id: t.String() }) },
      )
      .delete(
        '/api/assets/:id/purge',
        async ({ params, services, principal }) => {
          requireHttpPermission(principal, 'admin:access')
          const asset = unwrap(services.assets.findDeletedById(params.id, principal))
          if (!asset) throw new HttpError(validationError('Asset not found in trash', 'id'))
          await assetStorage.delete(asset.storageName)
          if (asset.thumbUrl) await assetStorage.delete(thumbnailStorageName(asset.storageName))
          const purged = unwrap(services.assets.purge(params.id, principal)) ?? asset
          audit(logger, 'asset.purge', {
            userId: principal?.id ?? null,
            assetId: purged.id,
            filename: purged.filename,
          })
          await publishAutomation({
            type: 'asset.purged',
            actorId: principal?.id ?? null,
            data: { asset: assetSnapshot(purged) },
          })
          return { asset: purged }
        },
        { params: t.Object({ id: t.String() }) },
      )
      .delete(
        '/api/assets/:id',
        async ({ params, services, principal }) => {
          requireHttpPermission(principal, 'asset:delete')
          const asset = unwrap(services.assets.findById(params.id, principal))
          if (!asset) throw new HttpError(validationError('Asset not found', 'id'))
          const removed = unwrap(services.assets.remove(params.id, principal)) ?? asset
          audit(logger, 'asset.delete', {
            userId: principal?.id ?? null,
            assetId: removed.id,
            filename: removed.filename,
          })
          await publishAutomation({
            type: 'asset.deleted',
            actorId: principal?.id ?? null,
            data: { asset: assetSnapshot(removed) },
          })
          return { asset: removed }
        },
        { params: t.Object({ id: t.String() }) },
      )
      .put(
        '/api/assets/:id',
        async ({ params, body, principal, services }) => updateAssetMetadata(params.id, body, principal, services),
        {
          params: t.Object({ id: t.String() }),
          body: t.Object({
            filename: t.Optional(t.String({ minLength: 1 })),
            folder: t.Optional(t.String()),
          }),
        },
      )
      .patch(
        '/api/assets/:id',
        async ({ params, body, principal, services }) => updateAssetMetadata(params.id, body, principal, services),
        {
          params: t.Object({ id: t.String() }),
          body: t.Object({
            filename: t.Optional(t.String({ minLength: 1 })),
            folder: t.Optional(t.String()),
          }),
        },
      )
      .get('/assets/*', async ({ params, query, principal, services }) => {
        if (privateWiki() && !principal) throw new HttpError(unauthorized())
        const storageName = safeAssetRequestPath(params['*'])
        if (!storageName) return new Response('Not found', { status: 404 })
        const accessPaths = services.assets.accessPaths(storageName)
        if (accessPaths.length > 0 && !accessPaths.some((path) => canReadPage(principal, path))) {
          return new Response('Not found', { status: 404 })
        }
        const thumbnail = query.size === 'thumb'
          ? await assetStorage.get(thumbnailStorageName(storageName))
          : null
        const asset = thumbnail ?? await assetStorage.get(storageName)
        return asset ? assetResponse(asset) : new Response('Not found', { status: 404 })
      }, { query: t.Object({ size: t.Optional(t.String()) }) })
}
