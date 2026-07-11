import { afterEach, describe, expect, test } from 'bun:test'
import type { DB } from '../client.ts'
import { createLibsqlDb, createSqliteDb } from '../client.ts'
import { assets, pageComments, pages } from '../schema.ts'
import type { SearchRequest } from '../../services/search.ts'
import { createFtsSearchIndexer } from './search.ts'

const databases: DB[] = []

afterEach(() => {
  while (databases.length) databases.pop()?.$client.close()
})

const drivers = [
  ['sqlite', () => createSqliteDb(':memory:')],
  ['libsql', () => createLibsqlDb({ driver: 'libsql', url: ':memory:', authToken: null, replicaPath: null })],
] as const

const request: Required<SearchRequest> = {
  limit: 20,
  offset: 0,
  filters: {},
  scope: 'all',
  sort: 'relevance',
}

const seedPage = (db: DB): void => {
  db.insert(pages).values({
    id: 'page-1', path: 'docs/search', title: 'Search Guide', description: 'Japanese 検索',
    icon: '', coverUrl: '', coverPosition: 'center', content: 'Bodyterm ![diagram](/assets/uploads/diagram.png)',
    renderedHtml: '', toc: '[]', contentType: 'markdown', lifecycle: 'active', status: 'verified',
    labels: '[]', ownerId: null, reviewAt: null, publishAt: null, navOrder: null, pinned: false,
    spaceKey: 'docs', locale: 'ja', authorId: null, createdAt: 1, updatedAt: 1,
  }).run()
  db.insert(pageComments).values({
    id: 'comment-1', pageId: 'page-1', path: 'docs/search', body: 'Decisionterm', authorId: null,
    resolvedAt: null, createdAt: 1, updatedAt: 1,
  }).run()
  db.insert(assets).values({
    id: 'asset-1', filename: 'diagram.png', storageName: 'uploads/diagram.png', folder: 'art',
    mime: 'image/png', size: 10, authorId: null, createdAt: 1, deletedAt: null,
  }).run()
}

describe.each(drivers)('%s FTS search adapter contract', (_driver, create) => {
  test('indexes page, comment, and asset text with ACL filtering and rebuild support', () => {
    const db = create()
    databases.push(db)
    seedPage(db)
    const indexer = createFtsSearchIndexer(db, { configuredTokenizer: 'unicode61' })

    indexer.indexPageById('page-1')
    expect(indexer.search('bodyterm', request).hits[0]?.path).toBe('docs/search')
    expect(indexer.search('decisionterm', request).hits[0]).toMatchObject({ kind: 'comment', anchor: 'comments' })
    expect(indexer.search('diagram', request).hits[0]).toMatchObject({ kind: 'asset', anchor: 'attachments' })
    expect(indexer.search('bodyterm', request, () => false).hits).toEqual([])
    expect(indexer.status()).toMatchObject({ tokenizer: 'unicode61', totalPages: 1, cjkPages: 1 })

    indexer.rebuild('trigram')
    expect(indexer.status()).toMatchObject({ tokenizer: 'trigram', configuredTokenizer: 'unicode61' })
    expect(indexer.search('検索', request).hits[0]?.path).toBe('docs/search')
    indexer.removePage('page-1')
    expect(indexer.search('bodyterm', request).hits).toEqual([])
  })
})
