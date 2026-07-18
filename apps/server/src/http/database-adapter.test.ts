import { describe, expect, test } from 'bun:test'
import { createDb } from '../db/client.ts'
import { createSqliteDatabaseAdapter } from './database-adapter.ts'

describe('createSqliteDatabaseAdapter', () => {
  test('exposes the driver, composition roots, and repositories over one DB', async () => {
    const db = createDb(':memory:')
    const adapter = createSqliteDatabaseAdapter(db)

    expect(adapter.driver).toBe('sqlite')
    // The raw client is offered for shared DB-backed rate limiting.
    expect(adapter.rateLimitDatabase).toBe(db.$client)

    // The service layer composes and reaches the database.
    const services = adapter.createServices({})
    await expect(services.ping()).resolves.toBeUndefined()
    expect(await services.admin.adminExists()).toBe(false)

    // In-memory realtime bus for the 'memory' event-bus setting.
    const bus = adapter.createRealtimeBus({ eventBus: 'memory', instanceId: 'test', pollIntervalMs: 1000 })
    const unsubscribe = bus.subscribe(() => {})
    expect(bus.size()).toBe(1)
    unsubscribe()
    expect(bus.size()).toBe(0)
    bus.close()

    // Repositories are functional against the same handle.
    await adapter.realtimeTicketRepo.insert({ ticket: 't', userId: 'u', expiresAt: 1, createdAt: 0 })
    expect(await adapter.realtimeTicketRepo.consume('t')).toEqual({ userId: 'u', expiresAt: 1 })
    await adapter.auditLogRepo.record(
      { action: 'test', userId: null, path: null, data: '{}', createdAt: 1 },
      { retentionMs: Number.MAX_SAFE_INTEGER, maxRows: 10 },
    )

    adapter.close()
  })
})
