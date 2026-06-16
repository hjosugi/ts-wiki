import { describe, test, expect } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createDb } from '../db/client.ts'
import { createDbEventBus, createEventBus, type WikiEvent } from './bus.ts'

const eventually = async (predicate: () => boolean): Promise<void> => {
  for (let i = 0; i < 50; i += 1) {
    if (predicate()) return
    await Bun.sleep(20)
  }
  throw new Error('condition was not met in time')
}

describe('event bus', () => {
  test('delivers events, then stops after unsubscribe', () => {
    const bus = createEventBus()
    const seen: WikiEvent[] = []
    const unsubscribe = bus.subscribe((e) => seen.push(e))

    bus.emit({ type: 'page:changed', action: 'created', path: 'a' })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.path).toBe('a')

    unsubscribe()
    expect(bus.size()).toBe(0)
    bus.emit({ type: 'page:changed', action: 'updated', path: 'b' })
    expect(seen).toHaveLength(1)
  })

  test('a throwing subscriber does not break the others', () => {
    const bus = createEventBus()
    let delivered = false
    bus.subscribe(() => {
      throw new Error('boom')
    })
    bus.subscribe(() => {
      delivered = true
    })
    bus.emit({ type: 'page:changed', action: 'deleted', path: 'x' })
    expect(delivered).toBe(true)
  })

  test('DB-backed bus delivers events across instances without local duplicates', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'open-wiki-bus-'))
    const path = join(dir, 'wiki.sqlite')
    const dbA = createDb(path)
    const dbB = createDb(path)
    const busA = createDbEventBus(dbA, { sourceId: 'a', pollIntervalMs: 10 })
    const busB = createDbEventBus(dbB, { sourceId: 'b', pollIntervalMs: 10 })

    try {
      const seenA: WikiEvent[] = []
      const seenB: WikiEvent[] = []
      busA.subscribe((e) => seenA.push(e))
      busB.subscribe((e) => seenB.push(e))

      busA.emit({ type: 'page:changed', action: 'moved', path: 'new', from: 'old' })

      expect(seenA).toHaveLength(1)
      await eventually(() => seenB.length === 1)
      await Bun.sleep(40)

      expect(seenA).toHaveLength(1)
      expect(seenB[0]).toEqual({ type: 'page:changed', action: 'moved', path: 'new', from: 'old' })
    } finally {
      busA.close()
      busB.close()
      dbA.$client.close()
      dbB.$client.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
