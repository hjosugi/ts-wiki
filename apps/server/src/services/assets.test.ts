import { describe, expect, test } from 'bun:test'
import type { Principal } from '@kawaii-wiki/core'
import { createDb } from '../db/client.ts'
import { createServices } from '../db/services.ts'
import { createAssetService } from './assets.ts'
import { createSqliteAssetRepository } from '../db/repositories/assets.ts'
import type { SearchIndexer } from './search.ts'

const admin: Principal = { id: 'admin-1', role: 'admin' }
const editor: Principal = { id: 'editor-1', role: 'editor' }

const fakeIndexer = (indexed: string[]): SearchIndexer => ({
  indexPage: (page) => {
    indexed.push(page.id)
  },
  indexPageById: (pageId) => {
    indexed.push(pageId)
  },
  removePage: () => {},
  search: () => {
    throw new Error('not used')
  },
  rebuild: () => {},
  status: () => {
    throw new Error('not used')
  },
})

describe('asset service', () => {
  test('tracks usage, filters folders, and manages trash lifecycle', async () => {
    const db = createDb(':memory:')
    const services = createServices(db)
    const page = await services.pages.create({
      path: 'docs/asset',
      title: 'Asset page',
      content: 'Uses ![image](/assets/docs/image.png)',
    }, admin)
    if (!page.ok) throw new Error('page seed failed')
    const indexed: string[] = []
    const assets = createAssetService(createSqliteAssetRepository(db), { searchIndexer: fakeIndexer(indexed) })

    const recorded = await assets.record({
      id: 'asset-1',
      filename: 'image.png',
      storageName: 'docs/image.png',
      folder: 'Docs\\Images',
      mime: 'image/png',
      size: 1024,
      authorId: editor.id,
    }, editor)
    expect(recorded.ok).toBe(true)
    if (!recorded.ok) throw new Error('asset record failed')
    expect(recorded.value.folder).toBe('docs/images')
    expect(recorded.value.thumbUrl).toBe('/assets/docs/image.png?size=thumb')
    expect(indexed).toEqual([page.value.id])

    const folders = await assets.folders(editor)
    expect(folders.ok).toBe(true)
    if (folders.ok) expect(folders.value).toEqual(['docs/images'])

    const usage = await assets.usage(editor)
    expect(usage.ok).toBe(true)
    if (usage.ok) expect(usage.value[0]?.pages).toEqual([{ path: 'docs/asset', title: 'Asset page' }])

    const orphans = await assets.orphans(editor)
    expect(orphans.ok).toBe(true)
    if (orphans.ok) expect(orphans.value).toHaveLength(0)

    const removed = await assets.remove('asset-1', editor)
    expect(removed.ok).toBe(true)
    const trash = await assets.trash(admin)
    expect(trash.ok).toBe(true)
    if (trash.ok) expect(trash.value[0]?.id).toBe('asset-1')

    const restored = await assets.restore('asset-1', admin)
    expect(restored.ok).toBe(true)
    if (restored.ok) expect(restored.value?.deletedAt).toBeNull()

    await assets.remove('asset-1', editor)
    const purged = await assets.purge('asset-1', admin)
    expect(purged.ok).toBe(true)
    const missing = await assets.findById('asset-1', editor)
    expect(missing.ok).toBe(true)
    if (missing.ok) expect(missing.value).toBeNull()
  })
})
