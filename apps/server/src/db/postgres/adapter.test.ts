/**
 * PostgreSQL database-adapter contract — integration. Env-gated.
 *
 * Proves `createPostgresDatabaseAdapter` composes the same driver-neutral seam
 * `createApp` consumes: a working service layer, realtime bus, and repositories,
 * with in-memory rate limiting (Postgres has no synchronous rate-limit handle).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createPostgresContractDb, testPostgresUrl, type PostgresContractDb } from './test-support.ts'
import { createPostgresDatabaseAdapter } from '../../http/postgres-adapter.ts'

describe.skipIf(!testPostgresUrl)('postgres database adapter', () => {
  let harness: PostgresContractDb
  beforeAll(async () => { harness = await createPostgresContractDb('kw_pg_adapter') })
  beforeEach(async () => { await harness.reset() })
  afterAll(async () => { await harness?.close() })

  test('builds composition roots, repositories, and opts into in-memory rate limiting', async () => {
    const adapter = createPostgresDatabaseAdapter(harness.client)

    expect(adapter.driver).toBe('postgres')
    expect(adapter.rateLimitDatabase).toBeNull() // no synchronous handle → in-memory limiters

    const services = adapter.createServices({})
    await expect(services.ping()).resolves.toBeUndefined()
    expect(await services.admin.adminExists()).toBe(false)

    const bus = adapter.createRealtimeBus({ eventBus: 'memory', instanceId: 'a', pollIntervalMs: 1000 })
    const unsubscribe = bus.subscribe(() => {})
    expect(bus.size()).toBe(1)
    unsubscribe()
    bus.close()

    await adapter.realtimeTicketRepo.insert({ ticket: 't', userId: 'u', expiresAt: 1, createdAt: 0 })
    expect(await adapter.realtimeTicketRepo.consume('t')).toEqual({ userId: 'u', expiresAt: 1 })
    await adapter.auditLogRepo.record(
      { action: 'test', userId: null, path: null, data: '{}', createdAt: 1 },
      { retentionMs: Number.MAX_SAFE_INTEGER, maxRows: 10 },
    )
    // The harness owns the client lifecycle; calling adapter.close() would drop the shared pool.
  })
})
