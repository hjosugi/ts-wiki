/**
 * PostgreSQL audit-log repository contract — integration. Env-gated.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { asc } from 'drizzle-orm'
import { createPostgresContractDb, testPostgresUrl, type PostgresContractDb } from './test-support.ts'
import { auditLog } from './schema.ts'
import { createPostgresAuditLogRepository } from './repositories/audit-log.ts'

describe.skipIf(!testPostgresUrl)('postgres audit log repository contract', () => {
  let harness: PostgresContractDb
  beforeAll(async () => { harness = await createPostgresContractDb('kw_audit_log_contract') })
  beforeEach(async () => { await harness.reset() })
  afterAll(async () => { await harness?.close() })

  const actions = () =>
    harness.db.select({ action: auditLog.action, createdAt: auditLog.createdAt }).from(auditLog).orderBy(asc(auditLog.createdAt))

  test('appends, prunes by retention window, and caps to maxRows', async () => {
    const repo = createPostgresAuditLogRepository(harness.db)

    await repo.record(
      { action: 'page.create', userId: 'u1', path: 'docs/home', data: '{"title":"Home"}', createdAt: 1000 },
      { retentionMs: Number.MAX_SAFE_INTEGER, maxRows: 1_000 },
    )
    expect(await harness.db.select().from(auditLog)).toEqual([
      expect.objectContaining({ action: 'page.create', userId: 'u1', path: 'docs/home', data: '{"title":"Home"}', createdAt: 1000 }),
    ])

    // Retention: a far-newer entry drops the earlier one within its window.
    await repo.record({ action: 'new', userId: null, path: null, data: '{}', createdAt: 1_000_000 }, { retentionMs: 100, maxRows: 1_000 })
    expect(await actions()).toEqual([{ action: 'new', createdAt: 1_000_000 }])

    // Cap: keep only the most-recent maxRows rows.
    await harness.reset()
    for (const createdAt of [1, 2, 3, 4, 5]) {
      await repo.record({ action: `a${createdAt}`, userId: null, path: null, data: '{}', createdAt }, { retentionMs: Number.MAX_SAFE_INTEGER, maxRows: 3 })
    }
    expect(await actions()).toEqual([
      { action: 'a3', createdAt: 3 },
      { action: 'a4', createdAt: 4 },
      { action: 'a5', createdAt: 5 },
    ])
  })
})
