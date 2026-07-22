import { describe, expect, test } from 'bun:test'
import { createDb } from '../client.ts'
import { createSqliteSearchOutboxRepository } from './search-outbox.ts'

const freshRepo = () => createSqliteSearchOutboxRepository(createDb(':memory:', { ftsTokenizer: 'unicode61' }))

describe('sqlite search outbox', () => {
  test('enqueue + claimDue returns due entries oldest-first and skips future ones', async () => {
    const repo = freshRepo()
    await repo.enqueue({ pageId: 'p1', operation: 'index', enqueuedAt: 1, nextAttemptAt: 1 })
    await repo.enqueue({ pageId: 'p2', operation: 'delete', enqueuedAt: 2, nextAttemptAt: 100 }) // not yet due
    await repo.enqueue({ pageId: 'p3', operation: 'index', enqueuedAt: 3, nextAttemptAt: 5 })

    const due = await repo.claimDue(10, 50, 5)
    expect(due.map((entry) => entry.pageId)).toEqual(['p1', 'p3'])
    expect(due[0]).toMatchObject({ operation: 'index', attempts: 0, lastError: null })
    expect(await repo.pendingCount(10, 5)).toBe(2)
  })

  test('complete removes an entry', async () => {
    const repo = freshRepo()
    await repo.enqueue({ pageId: 'p1', operation: 'index', enqueuedAt: 1, nextAttemptAt: 1 })
    const [entry] = await repo.claimDue(10, 50, 5)
    await repo.complete(entry!.id)
    expect(await repo.claimDue(10, 50, 5)).toEqual([])
  })

  test('fail increments attempts, records the error, reschedules, and dead-letters at the cap', async () => {
    const repo = freshRepo()
    await repo.enqueue({ pageId: 'p1', operation: 'index', enqueuedAt: 1, nextAttemptAt: 1 })

    const [first] = await repo.claimDue(10, 50, 2)
    await repo.fail(first!.id, 'boom', 20)
    expect(await repo.claimDue(10, 50, 2)).toEqual([]) // rescheduled to 20, not due at 10

    const [retry] = await repo.claimDue(20, 50, 2)
    expect(retry).toMatchObject({ attempts: 1, lastError: 'boom' })

    await repo.fail(retry!.id, 'boom2', 30)
    // attempts now 2 >= maxAttempts 2 → dead-lettered, never claimed again
    expect(await repo.claimDue(1000, 50, 2)).toEqual([])
    expect(await repo.deadLetterCount(2)).toBe(1)
    expect(await repo.pendingCount(1000, 2)).toBe(0)
  })
})
