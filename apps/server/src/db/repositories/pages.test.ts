import { afterEach, describe, expect, test } from 'bun:test'
import type { DB } from '../client.ts'
import { createLibsqlDb, createSqliteDb } from '../client.ts'
import { pageRedirects, pageRevisions, pages, users } from '../schema.ts'
import { createSqlitePageReadRepository } from './pages.ts'

const databases: DB[] = []

afterEach(() => {
  while (databases.length) databases.pop()?.$client.close()
})

const drivers = [
  ['sqlite', () => createSqliteDb(':memory:')],
  ['libsql', () => createLibsqlDb({ driver: 'libsql', url: ':memory:', authToken: null, replicaPath: null })],
] as const

const seedPage = (db: DB, id: string, lifecycle: 'active' | 'archived', updatedAt: number): void => {
  db.insert(pages).values({
    id, path: `docs/${id}`, title: id, description: '', icon: '', coverUrl: '', coverPosition: 'center',
    content: id, renderedHtml: '', toc: '[]', contentType: 'markdown', lifecycle, status: 'verified',
    labels: '[]', ownerId: null, reviewAt: null, publishAt: null, navOrder: null, pinned: false,
    spaceKey: 'docs', locale: 'ja', authorId: 'user-1', createdAt: 1, updatedAt,
  }).run()
}

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
