import { afterEach, describe, expect, test } from 'bun:test'
import type { DB } from '../client.ts'
import { createLibsqlDb, createSqliteDb } from '../client.ts'
import { createSqliteRealtimeTicketRepository } from './realtime-tickets.ts'

const databases: DB[] = []
afterEach(() => {
  while (databases.length) databases.pop()?.$client.close()
})

const drivers = [
  ['sqlite', () => createSqliteDb(':memory:')],
  ['libsql', () => createLibsqlDb({ driver: 'libsql', url: ':memory:', authToken: null, replicaPath: null })],
] as const

describe.each(drivers)('%s realtime ticket repository contract', (_driver, create) => {
  test('mints, single-use consumes, and prunes expired tickets', async () => {
    const db = create()
    databases.push(db)
    const repo = createSqliteRealtimeTicketRepository(db)

    await repo.insert({ ticket: 't1', userId: 'u1', expiresAt: 100, createdAt: 1 })
    expect(await repo.consume('t1')).toEqual({ userId: 'u1', expiresAt: 100 })
    expect(await repo.consume('t1')).toBeUndefined() // single-use
    expect(await repo.consume('missing')).toBeUndefined()

    await repo.insert({ ticket: 't2', userId: 'u2', expiresAt: 10, createdAt: 1 })
    await repo.insert({ ticket: 't3', userId: 'u3', expiresAt: 100, createdAt: 1 })
    await repo.cleanupExpired(50)
    expect(await repo.consume('t2')).toBeUndefined() // pruned as expired
    expect(await repo.consume('t3')).toEqual({ userId: 'u3', expiresAt: 100 })
  })
})
