/**
 * PostgreSQL search-outbox contract — integration. Env-gated.
 * Mirrors the SQLite outbox contract against a real Postgres database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createPostgresContractDb, testPostgresUrl, type PostgresContractDb } from './test-support.ts'
import { createPostgresSearchOutboxRepository } from './repositories/search-outbox.ts'

describe.skipIf(!testPostgresUrl)('postgres search outbox', () => {
  let harness: PostgresContractDb
  beforeAll(async () => { harness = await createPostgresContractDb('kw_outbox_contract') })
  beforeEach(async () => { await harness.reset() })
  afterAll(async () => { await harness?.close() })

  test('enqueue + claimDue returns due entries oldest-first and skips future ones', async () => {
    const repo = createPostgresSearchOutboxRepository(harness.db)
    await repo.enqueue({ pageId: 'p1', operation: 'index', enqueuedAt: 1, nextAttemptAt: 1 })
    await repo.enqueue({ pageId: 'p2', operation: 'delete', enqueuedAt: 2, nextAttemptAt: 100 })
    await repo.enqueue({ pageId: 'p3', operation: 'index', enqueuedAt: 3, nextAttemptAt: 5 })

    const due = await repo.claimDue(10, 50, 5)
    expect(due.map((entry) => entry.pageId)).toEqual(['p1', 'p3'])
    expect(due[0]).toMatchObject({ operation: 'index', attempts: 0, lastError: null })
    expect(await repo.pendingCount(10, 5)).toBe(2)
  })

  test('complete removes an entry', async () => {
    const repo = createPostgresSearchOutboxRepository(harness.db)
    await repo.enqueue({ pageId: 'p1', operation: 'index', enqueuedAt: 1, nextAttemptAt: 1 })
    const [entry] = await repo.claimDue(10, 50, 5)
    await repo.complete(entry!.id)
    expect(await repo.claimDue(10, 50, 5)).toEqual([])
  })

  test('fail increments attempts, records the error, reschedules, and dead-letters at the cap', async () => {
    const repo = createPostgresSearchOutboxRepository(harness.db)
    await repo.enqueue({ pageId: 'p1', operation: 'index', enqueuedAt: 1, nextAttemptAt: 1 })

    const [first] = await repo.claimDue(10, 50, 2)
    await repo.fail(first!.id, 'boom', 20)
    expect(await repo.claimDue(10, 50, 2)).toEqual([])

    const [retry] = await repo.claimDue(20, 50, 2)
    expect(retry).toMatchObject({ attempts: 1, lastError: 'boom' })

    await repo.fail(retry!.id, 'boom2', 30)
    expect(await repo.claimDue(1000, 50, 2)).toEqual([])
    expect(await repo.deadLetterCount(2)).toBe(1)
    expect(await repo.pendingCount(1000, 2)).toBe(0)
  })
})
