/**
 * PostgreSQL realtime-ticket repository contract — integration. Env-gated.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createPostgresContractDb, testPostgresUrl, type PostgresContractDb } from './test-support.ts'
import { createPostgresRealtimeTicketRepository } from './repositories/realtime-tickets.ts'

describe.skipIf(!testPostgresUrl)('postgres realtime ticket repository contract', () => {
  let harness: PostgresContractDb
  beforeAll(async () => { harness = await createPostgresContractDb('kw_rt_ticket_contract') })
  beforeEach(async () => { await harness.reset() })
  afterAll(async () => { await harness?.close() })

  test('mints, single-use consumes, and prunes expired tickets', async () => {
    const repo = createPostgresRealtimeTicketRepository(harness.db)

    await repo.insert({ ticket: 't1', userId: 'u1', expiresAt: 100, createdAt: 1 })
    expect(await repo.consume('t1')).toEqual({ userId: 'u1', expiresAt: 100 })
    expect(await repo.consume('t1')).toBeUndefined()
    expect(await repo.consume('missing')).toBeUndefined()

    await repo.insert({ ticket: 't2', userId: 'u2', expiresAt: 10, createdAt: 1 })
    await repo.insert({ ticket: 't3', userId: 'u3', expiresAt: 100, createdAt: 1 })
    await repo.cleanupExpired(50)
    expect(await repo.consume('t2')).toBeUndefined()
    expect(await repo.consume('t3')).toEqual({ userId: 'u3', expiresAt: 100 })
  })
})
