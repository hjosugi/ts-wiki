import { afterEach, describe, expect, test } from 'bun:test'
import { createDb, type DB } from '../client.ts'
import { assets, pageComments, pages, users } from '../schema.ts'
import { createSqliteElasticsearchDataSource } from './elasticsearch.ts'

const databases: DB[] = []
afterEach(() => {
  while (databases.length) databases.pop()?.$client.close()
})

describe('sqlite Elasticsearch data source', () => {
  test('loads active page, author, comment, and referenced asset text', async () => {
    const db = createDb(':memory:')
    databases.push(db)
    db.insert(users).values({
      id: 'u1', email: 'alice@example.com', name: 'Alice', passwordHash: 'hash', role: 'editor',
      totpSecret: null, totpEnabled: 0, disabledAt: null, tokenInvalidBefore: 0, emailVerifiedAt: 1,
      profileBio: '', profileCoverUrl: '', profileLinks: '[]', profileFavoritePages: '[]', createdAt: 1,
    }).run()
    db.insert(assets).values({
      id: 'a1', filename: 'diagram.png', storageName: 'uploads/diagram.png', folder: 'art',
      mime: 'image/png', size: 1, authorId: null, createdAt: 1, deletedAt: null,
    }).run()
    db.insert(pages).values({
      id: 'p1', path: 'docs/a', title: 'A', description: '', icon: '', coverUrl: '', coverPosition: 'center',
      content: 'Body ![diagram](/assets/uploads/diagram.png)', renderedHtml: '', toc: '[]', contentType: 'markdown',
      lifecycle: 'active', status: 'verified', labels: '["guide"]', ownerId: null, reviewAt: null,
      publishAt: null, navOrder: null, pinned: false, spaceKey: 'docs', locale: 'en', authorId: 'u1',
      createdAt: 1, updatedAt: 2,
    }).run()
    db.insert(pageComments).values({
      id: 'c1', pageId: 'p1', path: 'docs/a', body: '**Decision** note', authorId: 'u1', resolvedAt: null,
      createdAt: 1, updatedAt: 1,
    }).run()

    const source = createSqliteElasticsearchDataSource(db)
    expect(await source.loadPageSource('p1')).toMatchObject({
      path: 'docs/a',
      authorName: 'Alice',
      authorEmail: 'alice@example.com',
      comments: 'Decision note',
      assets: 'diagram.png art',
    })
    expect(await source.loadAllPageSources()).toHaveLength(1)
    db.update(pages).set({ lifecycle: 'archived' }).run()
    expect(await source.loadPageSource('p1')).toBeNull()
  })
})
