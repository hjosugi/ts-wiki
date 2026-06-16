/**
 * Event bus — the transport-agnostic core of realtime.
 *
 * Page mutations emit `WikiEvent`s here; transports just subscribe. Today that's
 * SSE (`GET /api/events`); a WebSocket endpoint can subscribe to the SAME bus
 * later with no other change.
 *
 * `createEventBus()` is the tiny in-memory implementation used by focused unit
 * tests. `createDbEventBus()` persists events into SQLite and polls that shared
 * log, so multiple server processes attached to the same database see each
 * other's page-change notifications.
 */
import type { DB } from '../db/client.ts'

export interface WikiEvent {
  readonly type: 'page:changed'
  readonly action: 'created' | 'updated' | 'moved' | 'deleted'
  readonly path: string
  /** Previous path, present on moves. */
  readonly from?: string
}

export type Listener = (event: WikiEvent) => void

export interface EventBus {
  emit(event: WikiEvent): void
  /** Subscribe; returns an unsubscribe function. */
  subscribe(listener: Listener): () => void
  /** Current subscriber count (diagnostics/tests). */
  size(): number
  /** Stop background work. Mostly used by tests. */
  close(): void
}

const deliver = (listeners: Set<Listener>, event: WikiEvent): void => {
  for (const listener of listeners) {
    try {
      listener(event)
    } catch {
      /* a broken subscriber must not break the emit loop */
    }
  }
}

export const createEventBus = (): EventBus => {
  const listeners = new Set<Listener>()
  return {
    emit(event) {
      deliver(listeners, event)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    size() {
      return listeners.size
    },
    close() {
      listeners.clear()
    },
  }
}

interface EventRow {
  readonly id: number
  readonly source_id: string
  readonly event_type: WikiEvent['type']
  readonly action: WikiEvent['action']
  readonly path: string
  readonly from_path: string | null
}

export interface DbEventBusOptions {
  /** Stable per-process id. Defaults to a random UUID on boot. */
  readonly sourceId?: string
  /** How quickly this process observes events emitted by peers. */
  readonly pollIntervalMs?: number
}

export const createDbEventBus = (db: DB, options: DbEventBusOptions = {}): EventBus => {
  const listeners = new Set<Listener>()
  const sourceId = options.sourceId ?? crypto.randomUUID()
  const pollIntervalMs = Math.max(25, options.pollIntervalMs ?? 250)
  const ownDelivered = new Set<number>()

  let lastSeenId =
    (db.$client.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM wiki_events').get() as { id: number } | undefined)
      ?.id ?? 0
  let polling = false

  const insertEvent = db.$client.prepare(`
    INSERT INTO wiki_events(source_id, event_type, action, path, from_path, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const readEvents = db.$client.prepare(`
    SELECT id, source_id, event_type, action, path, from_path
    FROM wiki_events
    WHERE id > ?
    ORDER BY id
    LIMIT 100
  `)

  const poll = (): void => {
    if (polling) return
    polling = true
    try {
      const rows = readEvents.all(lastSeenId) as EventRow[]
      for (const row of rows) {
        lastSeenId = row.id
        const alreadyDeliveredLocally = row.source_id === sourceId && ownDelivered.delete(row.id)
        if (alreadyDeliveredLocally) continue
        deliver(listeners, {
          type: row.event_type,
          action: row.action,
          path: row.path,
          ...(row.from_path ? { from: row.from_path } : {}),
        })
      }
    } finally {
      polling = false
    }
  }

  const timer = setInterval(poll, pollIntervalMs)
  ;(timer as unknown as { unref?: () => void }).unref?.()

  return {
    emit(event) {
      const result = insertEvent.run(
        sourceId,
        event.type,
        event.action,
        event.path,
        event.from ?? null,
        Date.now(),
      )
      ownDelivered.add(Number(result.lastInsertRowid))
      deliver(listeners, event)
    },
    subscribe(listener) {
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
      listeners.clear()
      ownDelivered.clear()
    },
  }
}
