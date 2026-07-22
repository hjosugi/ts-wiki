/**
 * MySQL page-write repository contract tests — integration. Env-gated.
 * Mirrors `../postgres/repositories-page-writes.test.ts`; own isolated database.
 * A spy SearchIndexer records index/remove calls so the write orchestration is
 * verified without a real search backend (MySQL FULLTEXT is a later slice).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { pageAnalytics, pageAssetRefs, pageComments, pageRedirects, searchOutbox } from './schema.ts'
import { createMysqlContractDb, testMysqlUrl, type MysqlContractDb } from './test-support.ts'
import { createMysqlPageReadRepository, createMysqlPageWriteRepository } from './repositories/pages.ts'
import { DuplicatePagePathError, type PageRecord, type PageRevisionRecord } from '../../repositories/pages.ts'
import type { SearchIndexer } from '../../services/search.ts'

const makePage = (over: Partial<PageRecord> = {}): PageRecord => ({
  id: 'p1', path: 'docs/a', title: 'A', description: '', icon: '', coverUrl: '', coverPosition: 'center',
  content: '', renderedHtml: '', toc: '[]', contentType: 'markdown', lifecycle: 'active', status: 'draft',
  labels: '[]', ownerId: null, reviewAt: null, publishAt: null, navOrder: null, pinned: false,
  spaceKey: 'main', locale: 'und', authorId: null, createdAt: 1, updatedAt: 1, ...over,
})

const makeRevision = (over: Partial<PageRevisionRecord> = {}): PageRevisionRecord => ({
  id: 'rev1', pageId: 'p1', path: 'docs/a', title: 'A', description: '', content: '', authorId: null,
  action: 'created', createdAt: 1, ...over,
})

const makeSpy = () => {
  const indexed: string[] = []
  const removed: string[] = []
  const indexer: SearchIndexer = {
    indexPage: (page) => { indexed.push(page.id) },
    indexPageById: () => {},
    removePage: (id) => { removed.push(id) },
    search: () => { throw new Error('search not exercised here') },
    rebuild: () => {},
    status: () => { throw new Error('status not exercised here') },
  }
  return { indexer, indexed, removed }
}

describe.skipIf(!testMysqlUrl)('mysql page-write contracts', () => {
  let harness: MysqlContractDb
  beforeAll(async () => { harness = await createMysqlContractDb('kw_page_write_contract') }, 30_000)
  beforeEach(async () => { await harness.reset() }, 30_000)
  afterAll(async () => { await harness?.close() }, 30_000)

  test('create: persists page + revision, clears redirects, indexes, and guards duplicate paths', async () => {
    const spy = makeSpy()
    const write = createMysqlPageWriteRepository(harness.db, spy.indexer)
    await write.createRedirect({ fromPath: 'docs/a', toPath: 'old/x', createdAt: 1 })

    const created = await write.create(makePage({ id: 'p1', path: 'docs/a' }), makeRevision({ id: 'rev1' }))
    expect(created?.id).toBe('p1')
    expect(spy.indexed).toEqual(['p1'])
    expect((await write.findByPath('docs/a'))?.id).toBe('p1')
    expect((await write.findById('p1'))?.path).toBe('docs/a')
    expect((await write.findRevision('rev1'))?.pageId).toBe('p1')
    expect(await write.findRedirect('docs/a')).toBeNull() // create cleared the redirect at its path

    await expect(write.create(makePage({ id: 'p2', path: 'docs/a' }), makeRevision({ id: 'rev2' }))).rejects.toThrow(DuplicatePagePathError)
  })

  test('Elasticsearch mode commits page and outbox together without calling the remote indexer', async () => {
    const unavailable = makeSpy()
    unavailable.indexer.indexPage = () => { throw new Error('elasticsearch unavailable') }
    unavailable.indexer.removePage = () => { throw new Error('elasticsearch unavailable') }
    const write = createMysqlPageWriteRepository(harness.db, unavailable.indexer, { searchBackend: 'elasticsearch' })

    await expect(write.create(makePage(), makeRevision())).resolves.toMatchObject({ id: 'p1' })
    await write.writeExisting({ pageId: 'p1', changes: { title: 'updated', updatedAt: 2 }, revision: null })
    await write.remove({ pageId: 'p1', path: 'docs/a', updatedAt: 3, revision: makeRevision({ id: 'rev2', action: 'deleted' }) })
    expect((await harness.db.select({ operation: searchOutbox.operation }).from(searchOutbox)).map((row) => row.operation))
      .toEqual(['index', 'index', 'delete'])

    await expect(write.create(makePage({ id: 'p2' }), makeRevision({ id: 'rev3', pageId: 'p2' })))
      .rejects.toThrow(DuplicatePagePathError)
    expect(await harness.db.select().from(searchOutbox)).toHaveLength(3)
  })

  test('writeExisting: applies changes, records a revision, and reindexes', async () => {
    const spy = makeSpy()
    const write = createMysqlPageWriteRepository(harness.db, spy.indexer)
    await write.create(makePage({ id: 'p1', path: 'docs/a', title: 'A' }), makeRevision({ id: 'rev1' }))

    const updated = await write.writeExisting({
      pageId: 'p1',
      changes: { title: 'A2', status: 'verified', updatedAt: 5 },
      revision: makeRevision({ id: 'rev2', title: 'A2', action: 'updated', createdAt: 5 }),
    })
    expect(updated?.title).toBe('A2')
    expect(updated?.status).toBe('verified')
    expect((await write.findRevision('rev2'))?.title).toBe('A2')
    expect(spy.indexed).toEqual(['p1', 'p1'])
  })

  test('setLifecycle: indexes when kept, removes when hidden', async () => {
    const spy = makeSpy()
    const write = createMysqlPageWriteRepository(harness.db, spy.indexer)
    await write.create(makePage({ id: 'p1' }), makeRevision({ id: 'rev1' }))
    spy.indexed.length = 0

    const archived = await write.setLifecycle({ pageId: 'p1', lifecycle: 'archived', updatedAt: 5, revision: makeRevision({ id: 'rev2', action: 'archived' }), index: false })
    expect(archived?.lifecycle).toBe('archived')
    expect(spy.removed).toEqual(['p1'])

    const restored = await write.setLifecycle({ pageId: 'p1', lifecycle: 'active', updatedAt: 6, revision: makeRevision({ id: 'rev3', action: 'restored' }), index: true })
    expect(restored?.lifecycle).toBe('active')
    expect(spy.indexed).toEqual(['p1'])
  })

  test('move: repaths page + comments, rewrites redirects, updates linked pages, indexes all', async () => {
    const spy = makeSpy()
    const write = createMysqlPageWriteRepository(harness.db, spy.indexer)
    await write.create(makePage({ id: 'p1', path: 'docs/a' }), makeRevision({ id: 'rev1' }))
    await write.create(makePage({ id: 'p2', path: 'docs/link', content: 'see docs/a' }), makeRevision({ id: 'rev2', pageId: 'p2', path: 'docs/link' }))
    await harness.db.insert(pageComments).values({ id: 'c1', pageId: 'p1', path: 'docs/a', body: 'hi', authorId: null, resolvedAt: null, createdAt: 1, updatedAt: 1 })
    // an existing redirect pointing at the old path should be rewritten to the new path
    await write.createRedirect({ fromPath: 'legacy/a', toPath: 'docs/a', createdAt: 1 })
    spy.indexed.length = 0

    const moved = await write.move({
      pageId: 'p1', oldPath: 'docs/a', newPath: 'docs/b', spaceKey: 'main', updatedAt: 10,
      revision: makeRevision({ id: 'rev3', path: 'docs/b', action: 'moved', createdAt: 10 }),
      rewrittenPages: [{ pageId: 'p2', content: 'see docs/b', renderedHtml: '', toc: '[]', updatedAt: 10, revision: makeRevision({ id: 'rev4', pageId: 'p2', path: 'docs/link', action: 'updated', createdAt: 10 }) }],
    })
    expect(moved?.path).toBe('docs/b')
    expect((await write.findByPath('docs/b'))?.id).toBe('p1')
    expect(await write.findRedirect('docs/a')).toBe('docs/b') // old path now redirects to new
    expect(await write.findRedirect('legacy/a')).toBe('docs/b') // chained redirect rewritten
    expect((await write.findById('p2'))?.content).toBe('see docs/b')
    const [comment] = await harness.db.select().from(pageComments).where(eq(pageComments.id, 'c1'))
    expect(comment?.path).toBe('docs/b')
    expect(spy.indexed.sort()).toEqual(['p1', 'p2'])
  })

  test('remove: soft-deletes, drops redirects, and removes from the index', async () => {
    const spy = makeSpy()
    const write = createMysqlPageWriteRepository(harness.db, spy.indexer)
    await write.create(makePage({ id: 'p1', path: 'docs/a' }), makeRevision({ id: 'rev1' }))
    await write.createRedirect({ fromPath: 'docs/a', toPath: 'x', createdAt: 1 })
    await harness.db.insert(pageRedirects).values({ fromPath: 'y', toPath: 'docs/a', createdAt: 1 })

    const removed = await write.remove({ pageId: 'p1', path: 'docs/a', updatedAt: 9, revision: makeRevision({ id: 'rev2', action: 'deleted' }) })
    expect(removed?.lifecycle).toBe('deleted')
    expect(await write.findRedirect('docs/a')).toBeNull()
    expect(spy.removed).toEqual(['p1'])
    const read = createMysqlPageReadRepository(harness.db)
    expect((await read.listInactive()).map((p) => p.id)).toEqual(['p1'])
  })

  test('redirects: create, find, and delete', async () => {
    const spy = makeSpy()
    const write = createMysqlPageWriteRepository(harness.db, spy.indexer)
    await write.createRedirect({ fromPath: 'old', toPath: 'new', createdAt: 1 })
    expect(await write.findRedirect('old')).toBe('new')
    expect(await write.findRedirect('missing')).toBeNull()
    await write.deleteRedirect('old')
    expect(await write.findRedirect('old')).toBeNull()
  })

  test('purge: removes the page and all its dependent rows', async () => {
    const spy = makeSpy()
    const write = createMysqlPageWriteRepository(harness.db, spy.indexer)
    await write.create(makePage({ id: 'p1', path: 'docs/a' }), makeRevision({ id: 'rev1', path: 'docs/a' }))
    await write.writeExisting({ pageId: 'p1', changes: { updatedAt: 2 }, revision: makeRevision({ id: 'rev2', path: 'moved/a', action: 'moved', createdAt: 2 }) })
    await harness.db.insert(pageComments).values({ id: 'c1', pageId: 'p1', path: 'other/a', body: 'x', authorId: null, resolvedAt: null, createdAt: 1, updatedAt: 1 })
    await harness.db.insert(pageAnalytics).values([{ path: 'docs/a', views: 1, lastViewedAt: 1 }, { path: 'moved/a', views: 1, lastViewedAt: 1 }])
    await harness.db.insert(pageAssetRefs).values({ pageId: 'p1', assetId: 'a1' })
    await harness.db.insert(pageRedirects).values({ fromPath: 'other/a', toPath: 'docs/a', createdAt: 1 })

    await write.purge('p1', 'docs/a')
    expect(await write.findById('p1')).toBeUndefined()
    expect(await write.findRevision('rev1')).toBeUndefined()
    expect(await harness.db.select().from(pageComments)).toEqual([])
    expect(await harness.db.select().from(pageAssetRefs)).toEqual([])
    expect(await harness.db.select().from(pageAnalytics)).toEqual([])
    expect(await harness.db.select().from(pageRedirects)).toEqual([])
    expect(spy.removed).toEqual(['p1'])
  })
})
