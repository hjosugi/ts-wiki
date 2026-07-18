/**
 * PostgreSQL DB event bus contract test — integration.
 * Mirrors the SQLite DB-bus contract (cross-instance delivery without local
 * duplicates, resume-from-tail, pruning) against a real Postgres database,
 * using two clients on the same isolated schema. Env-gated.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { asc } from 'drizzle-orm'
import { createPostgresContractDb, testPostgresUrl, type PostgresContractDb } from './test-support.ts'
import { createPostgresClient, type PostgresClient } from './client.ts'
import { createPostgresDbEventBus } from './event-bus.ts'
import { wikiEvents } from './schema.ts'
import type { WikiEvent } from '../../realtime/bus.ts'

const SCHEMA = 'kw_eventbus_contract'

const eventually = async (predicate: () => boolean): Promise<void> => {
  for (let i = 0; i < 100; i += 1) {
    if (predicate()) return
    await Bun.sleep(20)
  }
  throw new Error('condition was not met in time')
}

describe.skipIf(!testPostgresUrl)('postgres db event bus', () => {
  let harness: PostgresContractDb
  let clientB: PostgresClient

  beforeAll(async () => {
    harness = await createPostgresContractDb(SCHEMA)
    const url = new URL(testPostgresUrl ?? '')
    url.searchParams.set('options', `-c search_path=${SCHEMA}`)
    clientB = createPostgresClient({ driver: 'postgres', url: url.toString(), ssl: false, maxConnections: 4 })
  })
  beforeEach(async () => { await harness.reset() })
  afterAll(async () => {
    await clientB?.close()
    await harness?.close()
  })

  test('delivers events across instances without local duplicates', async () => {
    const busA = createPostgresDbEventBus(harness.client, { sourceId: 'a', pollIntervalMs: 10 })
    const busB = createPostgresDbEventBus(clientB, { sourceId: 'b', pollIntervalMs: 10 })
    try {
      const seenA: WikiEvent[] = []
      const seenB: WikiEvent[] = []
      busA.subscribe((event) => seenA.push(event))
      busB.subscribe((event) => seenB.push(event))
      await Bun.sleep(40) // let both buses initialize lastSeenId from the (empty) tail

      const event: WikiEvent = { type: 'page:changed', action: 'moved', path: 'new', from: 'old' }
      busA.emit(event)
      expect(seenA).toHaveLength(1) // local delivery is synchronous

      await eventually(() => seenB.length === 1)
      await Bun.sleep(40)
      expect(seenA).toHaveLength(1) // no local duplicate from the poll
      expect(seenB[0]).toEqual(event)
    } finally {
      busA.close()
      busB.close()
    }
  })

  test('resumes from the current tail when a subscriber joins after idle', async () => {
    const busA = createPostgresDbEventBus(harness.client, { sourceId: 'a', pollIntervalMs: 10 })
    const busB = createPostgresDbEventBus(clientB, { sourceId: 'b', pollIntervalMs: 10 })
    try {
      const seenA: WikiEvent[] = []
      await Bun.sleep(40)

      busB.emit({ type: 'page:changed', action: 'created', path: 'before-subscribe' })
      await Bun.sleep(60)
      busA.subscribe((event) => seenA.push(event))
      await Bun.sleep(60)
      expect(seenA).toEqual([]) // history emitted before subscribe is not replayed

      busB.emit({ type: 'page:changed', action: 'updated', path: 'after-subscribe' })
      await eventually(() => seenA.length === 1)
      expect(seenA[0]).toEqual({ type: 'page:changed', action: 'updated', path: 'after-subscribe' })
    } finally {
      busA.close()
      busB.close()
    }
  })

  test('prunes stored events past the retention limit', async () => {
    const bus = createPostgresDbEventBus(harness.client, { sourceId: 'a', pollIntervalMs: 10, maxStoredEvents: 3 })
    try {
      const seen: WikiEvent[] = []
      bus.subscribe((event) => seen.push(event))
      await Bun.sleep(40)
      for (let i = 0; i < 5; i += 1) bus.emit({ type: 'page:changed', action: 'updated', path: `page-${i}` })
      expect(seen).toHaveLength(5) // all delivered locally, synchronously

      // Wait for all writes to land AND pruning to settle on the final tail —
      // `length === 3` alone would race an intermediate mid-insert state.
      let paths: string[] = []
      for (let i = 0; i < 100; i += 1) {
        const rows = await harness.db.select({ path: wikiEvents.path }).from(wikiEvents).orderBy(asc(wikiEvents.id))
        paths = rows.map((row) => row.path)
        if (paths.join(',') === 'page-2,page-3,page-4') break
        await Bun.sleep(20)
      }
      expect(paths).toEqual(['page-2', 'page-3', 'page-4'])
    } finally {
      bus.close()
    }
  })
})
