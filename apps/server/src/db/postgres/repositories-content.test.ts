/**
 * PostgreSQL content repository contract tests — integration.
 * Runs only when KAWAII_WIKI_TEST_POSTGRES_URL is set; own isolated schema.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { pages, users } from './schema.ts'
import { createPostgresContractDb, testPostgresUrl, type PostgresContractDb } from './test-support.ts'
import { createPostgresLinkPreviewRepository } from './repositories/link-previews.ts'
import { createPostgresPageTemplateRepository } from './repositories/page-templates.ts'
import { createPostgresNotificationRepository } from './repositories/notifications.ts'
import { createPostgresCommentRepository } from './repositories/comments.ts'
import { createPostgresAssetRepository } from './repositories/assets.ts'
import type { LinkPreviewRecord } from '../../repositories/link-previews.ts'
import type { StoredPageTemplate } from '../../repositories/page-templates.ts'
import type { NotificationRecord } from '../../repositories/notifications.ts'
import type { CommentRecord } from '../../repositories/comments.ts'
import type { AssetRecord } from '../../repositories/assets.ts'

describe.skipIf(!testPostgresUrl)('postgres content repository contracts', () => {
  let harness: PostgresContractDb
  const seedUser = (id: string, name: string) =>
    harness.db.insert(users).values({ id, email: `${id}@x`, name, passwordHash: 'h', createdAt: 1 })
  const seedPage = (id: string, path: string) =>
    harness.db.insert(pages).values({ id, path, title: path, createdAt: 1, updatedAt: 1 })

  beforeAll(async () => { harness = await createPostgresContractDb('kw_content_contract') })
  beforeEach(async () => { await harness.reset() })
  afterAll(async () => { await harness?.close() })

  test('link previews: find and upsert-on-conflict', async () => {
    const repo = createPostgresLinkPreviewRepository(harness.db)
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
    const repo = createPostgresPageTemplateRepository(harness.db)
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
    const repo = createPostgresNotificationRepository(harness.db)
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
    const repo = createPostgresNotificationRepository(harness.db)
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

  test('comments: active page, author join, and returning-based mutations', async () => {
    await seedUser('u1', 'Alice')
    await seedPage('p1', 'docs/a')
    const repo = createPostgresCommentRepository(harness.db)
    expect((await repo.findActivePage('docs/a'))?.id).toBe('p1')
    expect(await repo.findActivePage('missing')).toBeUndefined()

    const comment = (over: Partial<CommentRecord>): CommentRecord => ({
      id: 'c', pageId: 'p1', path: 'docs/a', body: 'hi', authorId: 'u1',
      resolvedAt: null, createdAt: 1, updatedAt: 1, ...over,
    })
    await repo.insert(comment({ id: 'c1', createdAt: 1 }))
    await repo.insert(comment({ id: 'c2', createdAt: 2, authorId: null }))
    expect((await repo.findById('c1'))?.body).toBe('hi')

    const listed = await repo.listByPageId('p1')
    expect(listed.map((r) => [r.comment.id, r.authorName])).toEqual([['c1', 'Alice'], ['c2', null]])
    expect(await repo.findAuthorName('u1')).toBe('Alice')
    expect(await repo.findAuthorName('missing')).toBeNull()

    expect(await repo.updateBody('c1', 'edited', 10)).toBe(true)
    expect(await repo.updateBody('missing', 'x', 10)).toBe(false)
    expect((await repo.findById('c1'))?.body).toBe('edited')

    expect(await repo.resolve('c1', 5, 11)).toBe(true)
    expect((await repo.findById('c1'))?.resolvedAt).toBe(5)

    expect(await repo.delete('c1')).toBe(true)
    expect(await repo.delete('c1')).toBe(false)
  })

  test('assets: active/deleted lifecycle, references, and access paths', async () => {
    const repo = createPostgresAssetRepository(harness.db)
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
    await repo.insertReferences(['p1'], 'a2') // onConflictDoNothing
    expect((await repo.listReferences(['p1'])).map((r) => [r.pageId, r.assetId])).toEqual([['p1', 'a2']])
    expect(await repo.listReferences([])).toEqual([])
    expect(await repo.listAffectedPageIds('a2')).toEqual(['p1'])
    expect(await repo.listAccessPaths('store/a2')).toEqual(['docs/a'])
    expect((await repo.listActivePages()).map((p) => p.id)).toEqual(['p1'])

    await repo.delete('a2')
    expect(await repo.findActive('a2')).toBeUndefined()
  })
})
