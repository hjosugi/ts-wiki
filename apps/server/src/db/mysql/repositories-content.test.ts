/**
 * MySQL content repository contract tests — integration. Env-gated.
 * Mirrors `../postgres/repositories-content.test.ts` (comments land in a later
 * batch); own isolated database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { pages, users } from './schema.ts'
import { createMysqlContractDb, testMysqlUrl, type MysqlContractDb } from './test-support.ts'
import { createMysqlLinkPreviewRepository } from './repositories/link-previews.ts'
import { createMysqlPageTemplateRepository } from './repositories/page-templates.ts'
import { createMysqlNotificationRepository } from './repositories/notifications.ts'
import { createMysqlAssetRepository } from './repositories/assets.ts'
import type { LinkPreviewRecord } from '../../repositories/link-previews.ts'
import type { StoredPageTemplate } from '../../repositories/page-templates.ts'
import type { NotificationRecord } from '../../repositories/notifications.ts'
import type { AssetRecord } from '../../repositories/assets.ts'

describe.skipIf(!testMysqlUrl)('mysql content repository contracts', () => {
  let harness: MysqlContractDb
  // MySQL carries no DB default on the profile/body text columns, so the raw
  // fixtures supply them (the driver-neutral repos always do).
  const seedUser = (id: string, name: string) =>
    harness.db.insert(users).values({
      id, email: `${id}@x`, name, passwordHash: 'h',
      profileBio: '', profileLinks: '[]', profileFavoritePages: '[]', createdAt: 1,
    })
  const seedPage = (id: string, path: string) =>
    harness.db.insert(pages).values({
      id, path, title: path, content: '', renderedHtml: '', toc: '[]', labels: '[]', createdAt: 1, updatedAt: 1,
    })

  beforeAll(async () => { harness = await createMysqlContractDb('kw_content_contract') }, 30_000)
  beforeEach(async () => { await harness.reset() }, 30_000)
  afterAll(async () => { await harness?.close() }, 30_000)

  test('link previews: find and upsert-on-conflict', async () => {
    const repo = createMysqlLinkPreviewRepository(harness.db)
    const preview = (over: Partial<LinkPreviewRecord> = {}): LinkPreviewRecord => ({
      url: 'https://x', kind: 'unfurl', provider: 'p', title: 'T', description: 'D',
      image: null, author: null, siteName: null, contentType: null, data: '{}',
      fetchedAt: 1, expiresAt: 100, ...over,
    })
    expect(await repo.findByUrl('https://x')).toBeUndefined()
    await repo.upsert(preview({ title: 'First' }))
    expect((await repo.findByUrl('https://x'))?.title).toBe('First')
    await repo.upsert(preview({ title: 'Second', fetchedAt: 2, expiresAt: 200 }))
    const stored = await repo.findByUrl('https://x')
    expect(stored?.title).toBe('Second')
    expect(stored?.expiresAt).toBe(200)
  })

  test('page templates: ordering, crud', async () => {
    const repo = createMysqlPageTemplateRepository(harness.db)
    const template = (over: Partial<StoredPageTemplate>): StoredPageTemplate => ({
      id: 't', name: 'N', description: '', icon: '', content: '', metadata: '{}',
      createdBy: null, createdAt: 1, updatedAt: 1, ...over,
    })
    await repo.insert(template({ id: 't1', name: 'B', updatedAt: 1 }))
    await repo.insert(template({ id: 't2', name: 'A', updatedAt: 2 }))
    await repo.insert(template({ id: 't3', name: 'A', updatedAt: 1 }))
    // name asc, then updatedAt desc
    expect((await repo.list()).map((t) => t.id)).toEqual(['t2', 't3', 't1'])
    expect((await repo.findById('t1'))?.name).toBe('B')
    await repo.update('t1', { name: 'B2', description: 'd', icon: 'i', content: 'c', metadata: '{}', updatedAt: 9 })
    expect((await repo.findById('t1'))?.name).toBe('B2')
    await repo.delete('t1')
    expect(await repo.findById('t1')).toBeUndefined()
  })

  test('notifications: list, mark read, page/user lookups', async () => {
    await seedUser('u1', 'One')
    await seedUser('u2', 'Two')
    await seedPage('p1', 'docs/a')
    const repo = createMysqlNotificationRepository(harness.db)
    const notif = (over: Partial<NotificationRecord>): NotificationRecord => ({
      id: 'n', userId: 'u1', kind: 'mention', path: 'docs/a', message: 'm', payload: '{}',
      readAt: null, createdAt: 1, ...over,
    })
    await repo.insert(notif({ id: 'n1', createdAt: 1 }))
    await repo.insert(notif({ id: 'n2', createdAt: 2 }))
    expect((await repo.listByUser('u1', 10)).map((n) => n.id)).toEqual(['n2', 'n1'])
    expect((await repo.listByUser('u1', 1)).map((n) => n.id)).toEqual(['n2'])

    await repo.markRead('u1', 'n1', 5)
    expect((await repo.listByUser('u1', 10)).find((n) => n.id === 'n1')?.readAt).toBe(5)
    await repo.markRead('u1', undefined, 9)
    expect((await repo.listByUser('u1', 10)).every((n) => n.readAt !== null)).toBe(true)

    expect((await repo.findPage('docs/a'))?.title).toBe('docs/a')
    expect((await repo.listUsers()).map((u) => u.id).sort()).toEqual(['u1', 'u2'])
  })

  test('notifications: watchers set/list/move/delete', async () => {
    const repo = createMysqlNotificationRepository(harness.db)
    await repo.setWatching('u1', 'docs/a', true, 1)
    await repo.setWatching('u1', 'docs/a', true, 2) // idempotent
    await repo.setWatching('u2', 'docs/a', true, 1)
    expect(await repo.isWatching('u1', 'docs/a')).toBe(true)
    expect((await repo.listWatchers('docs/a')).map((w) => w.userId).sort()).toEqual(['u1', 'u2'])

    await repo.setWatching('u1', 'docs/a', false, 0)
    expect(await repo.isWatching('u1', 'docs/a')).toBe(false)

    // move: u2 watches /a, u2 already watches /b -> merge without conflict
    await repo.setWatching('u2', 'docs/b', true, 1)
    await repo.moveWatchers('docs/a', 'docs/b')
    expect((await repo.listWatchers('docs/a'))).toEqual([])
    expect((await repo.listWatchers('docs/b')).map((w) => w.userId)).toEqual(['u2'])

    await repo.deleteWatchers('docs/b')
    expect(await repo.listWatchers('docs/b')).toEqual([])
  })

  test('assets: active/deleted lifecycle, references, and access paths', async () => {
    const repo = createMysqlAssetRepository(harness.db)
    const asset = (over: Partial<AssetRecord>): AssetRecord => ({
      id: 'a', filename: 'f.png', storageName: 'store/f.png', folder: '', mime: 'image/png',
      size: 10, authorId: null, createdAt: 1, deletedAt: null, ...over,
    })
    await repo.insert(asset({ id: 'a1', folder: '', storageName: 'store/a1', createdAt: 1 }))
    await repo.insert(asset({ id: 'a2', folder: 'img', storageName: 'store/a2', createdAt: 2 }))
    await repo.insert(asset({ id: 'a3', storageName: 'store/a3', createdAt: 3, deletedAt: 5 }))

    expect((await repo.listActive()).map((a) => a.id)).toEqual(['a2', 'a1']) // desc createdAt
    expect((await repo.listActive('img')).map((a) => a.id)).toEqual(['a2'])
    expect((await repo.listDeleted()).map((a) => a.id)).toEqual(['a3'])
    expect((await repo.findActive('a1'))?.id).toBe('a1')
    expect(await repo.findActive('a3')).toBeUndefined()
    expect((await repo.findDeleted('a3'))?.id).toBe('a3')

    await repo.update('a1', { deletedAt: 9 }) // soft delete
    expect((await repo.listActive()).map((a) => a.id)).toEqual(['a2'])

    // references + access paths
    await seedPage('p1', 'docs/a')
    await repo.insertReferences(['p1'], 'a2')
    await repo.insertReferences(['p1'], 'a2') // insert-ignore, no duplicate
    expect((await repo.listReferences(['p1'])).map((r) => [r.pageId, r.assetId])).toEqual([['p1', 'a2']])
    expect(await repo.listReferences([])).toEqual([])
    expect(await repo.listAffectedPageIds('a2')).toEqual(['p1'])
    expect(await repo.listAccessPaths('store/a2')).toEqual(['docs/a'])
    expect((await repo.listActivePages()).map((p) => p.id)).toEqual(['p1'])

    await repo.delete('a2')
    expect(await repo.findActive('a2')).toBeUndefined()
  })
})
