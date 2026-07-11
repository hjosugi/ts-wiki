import { afterEach, describe, expect, test } from 'bun:test'
import type { DB } from '../client.ts'
import { createLibsqlDb, createSqliteDb } from '../client.ts'
import { auditLog, groupMemberships, groups, pageRevisions, pages, users } from '../schema.ts'
import { createSqliteAdminRepository } from './admin.ts'

const databases: DB[] = []

afterEach(() => {
  while (databases.length) databases.pop()?.$client.close()
})

const drivers = [
  ['sqlite', () => createSqliteDb(':memory:')],
  ['libsql', () => createLibsqlDb({ driver: 'libsql', url: ':memory:', authToken: null, replicaPath: null })],
] as const

const insertUser = (db: DB, id: string, role: 'admin' | 'editor' | 'viewer', createdAt: number) => {
  db.insert(users).values({
    id,
    email: `${id}@example.com`,
    name: id,
    passwordHash: 'hash',
    role,
    totpSecret: null,
    totpEnabled: 0,
    disabledAt: null,
    tokenInvalidBefore: 0,
    emailVerifiedAt: createdAt,
    profileBio: '',
    profileCoverUrl: '',
    profileLinks: '[]',
    profileFavoritePages: '[]',
    createdAt,
  }).run()
}

const insertPage = (db: DB, id: string, path: string, authorId: string, updatedAt: number, lifecycle: 'active' | 'archived' = 'active') => {
  db.insert(pages).values({
    id,
    path,
    title: path,
    description: '',
    icon: '',
    coverUrl: '',
    coverPosition: 'center',
    content: '',
    renderedHtml: '',
    toc: '[]',
    contentType: 'markdown',
    lifecycle,
    status: 'verified',
    labels: '["guide"]',
    ownerId: authorId,
    reviewAt: null,
    publishAt: null,
    navOrder: null,
    pinned: false,
    spaceKey: 'docs',
    locale: 'ja',
    authorId,
    createdAt: updatedAt,
    updatedAt,
  }).run()
}

describe.each(drivers)('%s admin repository contract', (_driver, create) => {
  test('reports stats and deletes revision batches atomically', async () => {
    const db = create()
    databases.push(db)
    insertUser(db, 'admin-1', 'admin', 1)
    insertPage(db, 'page-1', 'docs/one', 'admin-1', 2)
    db.insert(pageRevisions).values([
      { id: 'rev-1', pageId: 'page-1', path: 'docs/one', title: 'One', description: '', content: 'abc', authorId: 'admin-1', action: 'created', createdAt: 10 },
      { id: 'rev-2', pageId: 'page-1', path: 'docs/one', title: 'Two', description: '', content: 'defg', authorId: 'admin-1', action: 'updated', createdAt: 20 },
    ]).run()
    const repository = createSqliteAdminRepository(db)

    expect(await repository.stats()).toEqual({ users: 1, pages: 1, revisions: 2 })
    expect(await repository.historyStats()).toEqual({ revisions: 2, historyBytes: 13 })
    expect((await repository.listRevisionCandidates()).map((row) => row.id)).toEqual(['rev-2', 'rev-1'])
    await repository.deleteRevisions(['rev-1', 'rev-2'])
    expect((await repository.historyStats()).revisions).toBe(0)
  })

  test('filters active pages and audit entries with stable pagination metadata', async () => {
    const db = create()
    databases.push(db)
    insertUser(db, 'editor-1', 'editor', 1)
    insertPage(db, 'page-1', 'docs/active', 'editor-1', 30)
    insertPage(db, 'page-2', 'docs/archived', 'editor-1', 40, 'archived')
    db.insert(auditLog).values([
      { action: 'page.create', userId: 'editor-1', path: 'docs/active', data: '{"ok":true}', createdAt: 10 },
      { action: 'user.login', userId: 'editor-1', path: null, data: '{}', createdAt: 20 },
    ]).run()
    const repository = createSqliteAdminRepository(db)

    const listed = await repository.listPages({ limit: 10, offset: 0, status: 'verified', label: 'guide', spaceKey: 'docs', authorId: 'editor-1' })
    expect(listed.total).toBe(1)
    expect(listed.rows).toEqual([expect.objectContaining({ path: 'docs/active', authorName: 'editor-1' })])

    const audit = await repository.listAudit({ limit: 10, offset: 0, action: 'page', userId: 'editor-1', from: 5, to: 15 })
    expect(audit.total).toBe(1)
    expect(audit.rows).toEqual([expect.objectContaining({ action: 'page.create', path: 'docs/active' })])
  })

  test('lists user groups and persists role, password, and deactivation changes', async () => {
    const db = create()
    databases.push(db)
    insertUser(db, 'admin-1', 'admin', 1)
    insertUser(db, 'editor-1', 'editor', 2)
    db.insert(groups).values({ id: 'group-1', key: 'docs-team', name: 'Docs', description: '', createdAt: 3 }).run()
    db.insert(groupMemberships).values({ id: 'member-1', userId: 'editor-1', groupId: 'group-1', createdAt: 4 }).run()
    const repository = createSqliteAdminRepository(db)

    expect((await repository.listUsers()).map((user) => user.id)).toEqual(['admin-1', 'editor-1'])
    expect(await repository.listGroupMemberships()).toEqual([{ userId: 'editor-1', key: 'docs-team' }])
    expect(await repository.activeAdminCount()).toBe(1)

    await repository.updateUserRole('editor-1', 'viewer')
    await repository.updateUserPassword('editor-1', 'new-hash', 50)
    await repository.deactivateUser('editor-1', 60)
    expect(await repository.findUser('editor-1')).toMatchObject({
      role: 'viewer',
      passwordHash: 'new-hash',
      disabledAt: 60,
      tokenInvalidBefore: 60,
    })
  })
})
