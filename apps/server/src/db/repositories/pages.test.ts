import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { DB } from '../client.ts'
import { createLibsqlDb, createSqliteDb } from '../client.ts'
import { pageRedirects, pageRevisions, pages, searchOutbox, users } from '../schema.ts'
import { DuplicatePagePathError, type PageRecord, type PageRevisionRecord } from '../../repositories/pages.ts'
import { createFtsSearchIndexer } from './search.ts'
import { createSqlitePageReadRepository, createSqlitePageWriteRepository } from './pages.ts'
import type { SearchIndexer } from '../../services/search.ts'

const databases: DB[] = []
const externalReplicaDir = mkdtempSync(join(process.cwd(), '.kawaii-wiki-libsql-contract-'))
let externalReplicaSequence = 0

afterEach(() => {
  while (databases.length) databases.pop()?.$client.close()
})

afterAll(() => rmSync(externalReplicaDir, { recursive: true, force: true }))

const localDrivers = [
  ['sqlite', () => createSqliteDb(':memory:')],
  ['libsql', () => createLibsqlDb({ driver: 'libsql', url: ':memory:', authToken: null, replicaPath: null })],
] as const

const externalLibsqlUrl = process.env.KAWAII_WIKI_TEST_LIBSQL_URL?.trim()
const drivers: ReadonlyArray<readonly [string, () => DB]> = localDrivers

const seedPage = (db: DB, id: string, lifecycle: 'active' | 'archived', updatedAt: number): void => {
  db.insert(pages).values({
    id, path: `docs/${id}`, title: id, description: '', icon: '', coverUrl: '', coverPosition: 'center',
    content: id, renderedHtml: '', toc: '[]', contentType: 'markdown', lifecycle, status: 'verified',
    labels: '[]', ownerId: null, reviewAt: null, publishAt: null, navOrder: null, pinned: false,
    spaceKey: 'docs', locale: 'ja', authorId: 'user-1', createdAt: 1, updatedAt,
  }).run()
}

const pageRecord = (id: string, path = `docs/${id}`, content = id): PageRecord => ({
  id, path, title: id, description: '', icon: '', coverUrl: '', coverPosition: 'center',
  content, renderedHtml: `<p>${content}</p>`, toc: '[]', contentType: 'markdown', lifecycle: 'active',
  status: 'verified', labels: '[]', ownerId: null, reviewAt: null, publishAt: null, navOrder: null,
  pinned: false, spaceKey: path.split('/')[0] || 'main', locale: 'ja', authorId: null,
  createdAt: 1, updatedAt: 1,
})

const revisionRecord = (
  page: PageRecord,
  id: string,
  action: PageRevisionRecord['action'],
  createdAt: number,
): PageRevisionRecord => ({
  id, pageId: page.id, path: page.path, title: page.title, description: page.description,
  content: page.content, authorId: null, action, createdAt,
})

const ftsCount = (db: DB, term: string): number =>
  Number((db.$client.prepare('SELECT count(*) AS count FROM pages_fts WHERE pages_fts MATCH ?').get(term) as { count: number }).count)

describe.each(drivers)('%s page read repository contract', (_driver, create) => {
  test('orders lifecycle, revision, redirect, and contributor reads deterministically', async () => {
    const db = create()
    databases.push(db)
    db.insert(users).values({
      id: 'user-1', email: 'author@example.com', name: 'Author', passwordHash: 'hash', role: 'editor',
      totpSecret: null, totpEnabled: 0, disabledAt: null, tokenInvalidBefore: 0, emailVerifiedAt: 1,
      profileBio: '', profileCoverUrl: '', profileLinks: '[]', profileFavoritePages: '[]', createdAt: 1,
    }).run()
    seedPage(db, 'b', 'active', 20)
    seedPage(db, 'a', 'active', 10)
    seedPage(db, 'archived', 'archived', 30)
    db.insert(pageRevisions).values([
      { id: 'revision-1', pageId: 'a', path: 'docs/a', title: 'a', description: '', content: 'one', authorId: 'user-1', action: 'created', createdAt: 100 },
      { id: 'revision-2', pageId: 'a', path: 'docs/a', title: 'a', description: '', content: 'two', authorId: 'user-1', action: 'updated', createdAt: 100 },
      { id: 'revision-3', pageId: 'b', path: 'docs/b', title: 'b', description: '', content: 'three', authorId: null, action: 'created', createdAt: 200 },
    ]).run()
    db.insert(pageRedirects).values([
      { fromPath: 'old/z', toPath: 'docs/b', createdAt: 1 },
      { fromPath: 'old/a', toPath: 'docs/a', createdAt: 2 },
    ]).run()
    const repository = createSqlitePageReadRepository(db)

    expect((await repository.listActive()).map((page) => page.id)).toEqual(['a', 'b'])
    expect((await repository.listInactive()).map((page) => page.id)).toEqual(['archived'])
    expect((await repository.listRecentRevisions(null, 2)).map((row) => row.id)).toEqual(['revision-3', 'revision-2'])
    expect((await repository.listRecentRevisions(200, 10)).map((row) => row.id)).toEqual(['revision-2', 'revision-1'])
    expect((await repository.listRedirects()).map((row) => row.fromPath)).toEqual(['old/a', 'old/z'])
    expect((await repository.listRevisions('a')).map((row) => row.id)).toEqual(['revision-2', 'revision-1'])
    expect(await repository.revisionContributors('a')).toEqual([{
      authorId: 'user-1', authorName: 'Author', revisions: 2, lastContributionAt: 100,
    }])
  })
})

const assertPageWriteContract = async (db: DB): Promise<void> => {
    const search = createFtsSearchIndexer(db, { configuredTokenizer: 'unicode61' })
    const repository = createSqlitePageWriteRepository(db, search)
    const original = pageRecord('page-1', 'docs/old', 'searchable banana')

    expect(await repository.create(original, revisionRecord(original, 'revision-created', 'created', 1))).toEqual(original)
    expect(await repository.findRevision('revision-created')).toMatchObject({ pageId: original.id, action: 'created' })
    expect(ftsCount(db, 'banana')).toBe(1)

    const updated = await repository.writeExisting({
      pageId: original.id,
      revision: revisionRecord(original, 'revision-updated', 'updated', 2),
      changes: { content: 'searchable orange', renderedHtml: '<p>searchable orange</p>', updatedAt: 2 },
    })
    expect(updated).toMatchObject({ content: 'searchable orange', updatedAt: 2 })
    expect(ftsCount(db, 'banana')).toBe(0)
    expect(ftsCount(db, 'orange')).toBe(1)

    const reference = pageRecord('page-2', 'docs/reference', 'See [[docs/old]].')
    await repository.create(reference, revisionRecord(reference, 'reference-created', 'created', 3))
    const current = (await repository.findById(original.id))!
    const moved = await repository.move({
      pageId: current.id,
      oldPath: current.path,
      newPath: 'docs/new',
      spaceKey: 'docs',
      updatedAt: 4,
      revision: revisionRecord(current, 'revision-moved', 'moved', 4),
      rewrittenPages: [{
        pageId: reference.id,
        content: 'See [[docs/new]].',
        renderedHtml: '<p>See docs/new.</p>',
        toc: '[]',
        updatedAt: 4,
        revision: revisionRecord(reference, 'reference-updated', 'updated', 4),
      }],
    })
    expect(moved).toMatchObject({ path: 'docs/new' })
    expect(await repository.findRedirect('docs/old')).toBe('docs/new')
    expect(await repository.findById(reference.id)).toMatchObject({ content: 'See [[docs/new]].' })

    const archived = await repository.setLifecycle({
      pageId: current.id, lifecycle: 'archived', updatedAt: 5,
      revision: revisionRecord(moved!, 'revision-archived', 'archived', 5), index: false,
    })
    expect(archived?.lifecycle).toBe('archived')
    expect(ftsCount(db, 'orange')).toBe(0)
    const restored = await repository.setLifecycle({
      pageId: current.id, lifecycle: 'active', updatedAt: 6,
      revision: revisionRecord(archived!, 'revision-restored', 'restored', 6), index: true,
    })
    expect(restored?.lifecycle).toBe('active')
    expect(ftsCount(db, 'orange')).toBe(1)

    const removed = await repository.remove({
      pageId: current.id, path: 'docs/new', updatedAt: 7,
      revision: revisionRecord(restored!, 'revision-deleted', 'deleted', 7),
    })
    expect(removed?.lifecycle).toBe('deleted')
    expect(await repository.findRedirect('docs/old')).toBeNull()
    await repository.purge(current.id, 'docs/new')
    expect(await repository.findById(current.id)).toBeUndefined()
    expect(await repository.findRevision('revision-created')).toBeUndefined()
}

const assertDuplicatePathContract = async (db: DB): Promise<void> => {
    const repository = createSqlitePageWriteRepository(
      db,
      createFtsSearchIndexer(db, { configuredTokenizer: 'unicode61' }),
    )
    const first = pageRecord('first', 'docs/same')
    const second = pageRecord('second', 'docs/same')
    await repository.create(first, revisionRecord(first, 'first-created', 'created', 1))
    await expect(repository.create(second, revisionRecord(second, 'second-created', 'created', 2)))
      .rejects.toBeInstanceOf(DuplicatePagePathError)
}

describe.each(drivers)('%s page write repository contract', (_driver, create) => {
  test('keeps page, revision, redirect, lifecycle, and FTS mutations consistent', async () => {
    const db = create()
    databases.push(db)
    await assertPageWriteContract(db)
  })

  test('normalizes duplicate page paths at the repository boundary', async () => {
    const db = create()
    databases.push(db)
    await assertDuplicatePathContract(db)
  })

  test('writes Elasticsearch outbox operations atomically without contacting Elasticsearch', async () => {
    const db = create()
    databases.push(db)
    const unavailableIndexer: SearchIndexer = {
      indexPage: () => { throw new Error('elasticsearch unavailable') },
      indexPageById: () => { throw new Error('elasticsearch unavailable') },
      removePage: () => { throw new Error('elasticsearch unavailable') },
      search: () => { throw new Error('not exercised') },
      rebuild: () => { throw new Error('not exercised') },
      status: () => { throw new Error('not exercised') },
    }
    const repository = createSqlitePageWriteRepository(db, unavailableIndexer, { searchBackend: 'elasticsearch' })
    const page = pageRecord('outbox-page', 'docs/outbox', 'body')

    expect(await repository.create(page, revisionRecord(page, 'outbox-created', 'created', 1))).toMatchObject({ id: page.id })
    await repository.writeExisting({ pageId: page.id, changes: { content: 'updated', updatedAt: 2 }, revision: null })
    await repository.setLifecycle({
      pageId: page.id,
      lifecycle: 'archived',
      updatedAt: 3,
      revision: revisionRecord(page, 'outbox-archived', 'archived', 3),
      index: false,
    })
    await repository.setLifecycle({
      pageId: page.id,
      lifecycle: 'active',
      updatedAt: 4,
      revision: revisionRecord(page, 'outbox-restored', 'restored', 4),
      index: true,
    })
    await repository.remove({
      pageId: page.id,
      path: page.path,
      updatedAt: 5,
      revision: revisionRecord(page, 'outbox-deleted', 'deleted', 5),
    })

    expect(db.select({ operation: searchOutbox.operation }).from(searchOutbox).all().map((row) => row.operation))
      .toEqual(['index', 'index', 'delete', 'index', 'delete'])
    // If the page transaction rolls back, its outbox write rolls back too.
    const duplicate = pageRecord('duplicate', page.path)
    await expect(repository.create(duplicate, revisionRecord(duplicate, 'duplicate-created', 'created', 6)))
      .rejects.toBeInstanceOf(DuplicatePagePathError)
    expect(db.select().from(searchOutbox).all()).toHaveLength(5)
  })
})

if (externalLibsqlUrl) {
  test('provisions an external libSQL page repository and runs the write contract', async () => {
    const db = createLibsqlDb({
      driver: 'libsql',
      url: externalLibsqlUrl,
      authToken: process.env.KAWAII_WIKI_TEST_LIBSQL_AUTH_TOKEN?.trim() || null,
      replicaPath: join(externalReplicaDir, `replica-${externalReplicaSequence += 1}.db`),
    })
    databases.push(db)
    await assertPageWriteContract(db)
    await assertDuplicatePathContract(db)
  })
}
