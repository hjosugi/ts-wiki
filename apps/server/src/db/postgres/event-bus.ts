/**
 * PostgreSQL DB-backed event bus — the async analogue of the SQLite
 * `createDbEventBus`. Page mutations `emit` events; each process persists them
 * to the shared `wiki_events` log and polls it, so multiple server instances on
 * the same Postgres see each other's page-change notifications.
 *
 * Postgres reads always see committed rows (no libSQL snapshot pinning), so the
 * poll is a straightforward async query. `emit` delivers to local subscribers
 * synchronously and persists fire-and-forget; peers pick the row up on their
 * next poll. Own rows are skipped by `sourceId` on read — no synchronous insert
 * id is needed, which is what lets `emit` stay synchronous over an async driver.
 */
import { asc, gt, lte, sql } from 'drizzle-orm'
import { unrefTimer } from '../../utils/timers.ts'
import {
  deliver,
  maxStoredEventsFrom,
  type DbEventBusOptions,
  type EventBus,
  type Listener,
} from '../../realtime/bus.ts'
import type { PostgresClient } from './client.ts'
import { wikiEvents } from './schema.ts'

const fireAndForget = (work: PromiseLike<unknown>): void => {
  Promise.resolve(work).catch(() => {
    /* best-effort: persistence/pruning failures must not break delivery */
  })
}

export const createPostgresDbEventBus = (client: PostgresClient, options: DbEventBusOptions = {}): EventBus => {
  const { db } = client
  const listeners = new Set<Listener>()
  const sourceId = options.sourceId ?? crypto.randomUUID()
  const pollIntervalMs = Math.max(25, options.pollIntervalMs ?? 250)
  const pruneIntervalMs = Math.max(pollIntervalMs, options.pruneIntervalMs ?? Math.max(60_000, pollIntervalMs * 20))
  const maxStoredEvents = maxStoredEventsFrom(options.maxStoredEvents)

  let lastSeenId = 0
  let ready = false
  let polling = false

  // Serialize persistence so the stored `wiki_events.id` order matches the emit
  // order (fire-and-forget inserts would otherwise race and reorder). `emit`
  // stays synchronous — it only appends to this chain.
  let writeChain: Promise<unknown> = Promise.resolve()
  const enqueueWrite = (work: () => PromiseLike<unknown>): void => {
    writeChain = writeChain.then(work, work).catch(() => {})
  }

  const maxEventId = async (): Promise<number> => {
    const [row] = await db.select({ id: sql<number>`coalesce(max(${wikiEvents.id}), 0)` }).from(wikiEvents)
    return Number(row?.id ?? 0)
  }

  // Start from the current tail so a fresh bus never replays existing history.
  fireAndForget(maxEventId().then((id) => { lastSeenId = id }).finally(() => { ready = true }))

  const prune = async (): Promise<void> => {
    const pruneThroughId = (await maxEventId()) - maxStoredEvents
    if (pruneThroughId <= 0) return
    await db.delete(wikiEvents).where(lte(wikiEvents.id, pruneThroughId))
  }
  const pruneBestEffort = (): void => fireAndForget(prune())

  const poll = async (): Promise<void> => {
    if (!ready || listeners.size === 0 || polling) return
    polling = true
    try {
      const rows = await db.select().from(wikiEvents).where(gt(wikiEvents.id, lastSeenId)).orderBy(asc(wikiEvents.id)).limit(100)
      for (const row of rows) {
        lastSeenId = Math.max(lastSeenId, row.id)
        if (row.sourceId === sourceId) continue // own events were delivered in emit
        deliver(listeners, {
          type: row.eventType,
          action: row.action,
          path: row.path,
          ...(row.fromPath ? { from: row.fromPath } : {}),
        })
      }
      pruneBestEffort()
    } finally {
      polling = false
    }
  }
  const pollBestEffort = (): void => fireAndForget(poll())

  const timer = setInterval(pollBestEffort, pollIntervalMs)
  unrefTimer(timer)
  const pruneTimer = setInterval(pruneBestEffort, pruneIntervalMs)
  unrefTimer(pruneTimer)

  return {
    emit(event) {
      deliver(listeners, event)
      enqueueWrite(() =>
        db.insert(wikiEvents).values({
          sourceId,
          eventType: event.type,
          action: event.action,
          path: event.path,
          fromPath: event.from ?? null,
          createdAt: Date.now(),
        }),
      )
    },
    subscribe(listener) {
      // Resume from the current tail so joining after an idle period doesn't
      // replay events emitted while there were no subscribers. Gate polling
      // (`ready = false`) until the tail is read, or a poll could race the
      // async reset and deliver history with the stale `lastSeenId`.
      if (listeners.size === 0) {
        ready = false
        fireAndForget(maxEventId().then((id) => { if (id > lastSeenId) lastSeenId = id }).finally(() => { ready = true }))
      }
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    size() {
      return listeners.size
    },
    close() {
      clearInterval(timer)
      clearInterval(pruneTimer)
      listeners.clear()
    },
  }
}
