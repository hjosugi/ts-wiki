import { afterEach, describe, expect, test } from 'bun:test'
import { asc } from 'drizzle-orm'
import type { DB } from '../client.ts'
import { createLibsqlDb, createSqliteDb } from '../client.ts'
import { auditLog } from '../schema.ts'
import { createSqliteAuditLogRepository } from './audit-log.ts'

const databases: DB[] = []
afterEach(() => {
  while (databases.length) databases.pop()?.$client.close()
})

const rows = (db: DB) =>
  db.select({ action: auditLog.action, createdAt: auditLog.createdAt }).from(auditLog).orderBy(asc(auditLog.createdAt)).all()

const drivers = [
  ['sqlite', () => createSqliteDb(':memory:')],
  ['libsql', () => createLibsqlDb({ driver: 'libsql', url: ':memory:', authToken: null, replicaPath: null })],
] as const

const GENEROUS = { retentionMs: Number.MAX_SAFE_INTEGER, maxRows: 1_000 }

describe.each(drivers)('%s audit log repository contract', (_driver, create) => {
  test('appends an entry with its serialised payload', async () => {
    const db = create()
    databases.push(db)
    const repo = createSqliteAuditLogRepository(db)

    await repo.record(
      { action: 'page.create', userId: 'u1', path: 'docs/home', data: '{"title":"Home"}', createdAt: 1000 },
      GENEROUS,
    )

    expect(db.select().from(auditLog).all()).toEqual([
      expect.objectContaining({ action: 'page.create', userId: 'u1', path: 'docs/home', data: '{"title":"Home"}', createdAt: 1000 }),
    ])
  })

  test('prunes rows older than the retention window relative to the new entry', async () => {
    const db = create()
    databases.push(db)
    const repo = createSqliteAuditLogRepository(db)

    await repo.record({ action: 'old', userId: null, path: null, data: '{}', createdAt: 1_000 }, { retentionMs: 100, maxRows: 1_000 })
    await repo.record({ action: 'new', userId: null, path: null, data: '{}', createdAt: 1_000_000 }, { retentionMs: 100, maxRows: 1_000 })

    expect(rows(db)).toEqual([{ action: 'new', createdAt: 1_000_000 }])
  })

  test('caps the table to the most-recent maxRows entries', async () => {
    const db = create()
    databases.push(db)
    const repo = createSqliteAuditLogRepository(db)

    for (const createdAt of [1, 2, 3, 4, 5]) {
      await repo.record({ action: `a${createdAt}`, userId: null, path: null, data: '{}', createdAt }, { retentionMs: Number.MAX_SAFE_INTEGER, maxRows: 3 })
    }

    expect(rows(db)).toEqual([
      { action: 'a3', createdAt: 3 },
      { action: 'a4', createdAt: 4 },
      { action: 'a5', createdAt: 5 },
    ])
  })
})
