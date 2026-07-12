import { describe, expect, test } from 'bun:test'
import type { Principal } from '@kawaii-wiki/core'
import { createDb } from '../db/client.ts'
import { createServices } from '../db/services.ts'
import { createEventBus, type WikiEvent } from '../realtime/bus.ts'
import { createGitSyncHandlers, startGitSyncScheduler } from './git-sync.ts'
import type { GitStorage } from './git.ts'

const admin: Principal = { id: 'admin', role: 'admin' }

describe('git sync runtime wiring', () => {
  test('upsert creates/updates pages and emits page-change events', async () => {
    const db = createDb(':memory:')
    const services = createServices(db)
    const bus = createEventBus()
    const events: WikiEvent[] = []
    bus.subscribe((event) => events.push(event))
    const handlers = createGitSyncHandlers({ services, bus, systemPrincipal: admin })

    await handlers.upsert('docs/git', { title: 'Git', description: 'from git', content: 'first' })
    await handlers.upsert('docs/git', { title: 'Git v2', description: 'updated', content: 'second' })

    const page = await services.pages.getByPath('docs/git')
    expect(page.ok).toBe(true)
    if (page.ok) {
      expect(page.value.title).toBe('Git v2')
      expect(page.value.content).toBe('second')
    }
    expect(events.map((event) => event.action)).toEqual(['created', 'updated'])
    db.$client.close()
  })

  test('remove deletes pages and emits a delete event', async () => {
    const db = createDb(':memory:')
    const services = createServices(db)
    await services.pages.create({ path: 'docs/remove', title: 'Remove', content: 'x' }, admin)
    const bus = createEventBus()
    const events: WikiEvent[] = []
    bus.subscribe((event) => events.push(event))
    const handlers = createGitSyncHandlers({ services, bus, systemPrincipal: admin })

    await handlers.remove('docs/remove')

    expect((await services.pages.getByPath('docs/remove')).ok).toBe(false)
    expect(events).toEqual([{ type: 'page:changed', action: 'deleted', path: 'docs/remove' }])
    db.$client.close()
  })

  test('authoritative reconciliation removes database pages absent from Git', async () => {
    const db = createDb(':memory:')
    const services = createServices(db)
    await services.pages.create({ path: 'docs/tracked', title: 'Tracked', content: 'x' }, admin)
    await services.pages.create({ path: 'docs/db-only', title: 'DB only', content: 'x' }, admin)
    const events: WikiEvent[] = []
    const bus = createEventBus()
    bus.subscribe((event) => events.push(event))
    const handlers = createGitSyncHandlers({ services, bus, systemPrincipal: admin, authoritative: true })

    await handlers.reconcile?.(['docs/tracked'])

    expect((await services.pages.getByPath('docs/tracked')).ok).toBe(true)
    expect((await services.pages.getByPath('docs/db-only')).ok).toBe(false)
    expect(events).toContainEqual({ type: 'page:changed', action: 'deleted', path: 'docs/db-only' })
    db.$client.close()
  })

  test('authoritative imports restore archived paths and publish Git-reviewed pages', async () => {
    const db = createDb(':memory:')
    const services = createServices(db)
    await services.pages.create({ path: 'docs/restored', title: 'Old', content: 'old' }, admin)
    await services.pages.remove('docs/restored', admin)
    const handlers = createGitSyncHandlers({ services, bus: createEventBus(), systemPrincipal: admin, authoritative: true })

    await handlers.upsert('docs/restored', { title: 'Restored', description: '', content: 'from git' })
    await handlers.upsert('docs/new', { title: 'New', description: '', content: 'from git' })

    const restored = await services.pages.getByPath('docs/restored')
    const created = await services.pages.getByPath('docs/new')
    expect(restored.ok && restored.value.title).toBe('Restored')
    expect(restored.ok && restored.value.status).toBe('verified')
    expect(created.ok && created.value.status).toBe('verified')
    db.$client.close()
  })

  test('scheduler is inert unless git sync is enabled with a remote interval', async () => {
    let syncCalls = 0
    const git = {
      enabled: true,
      sync: async () => {
        syncCalls += 1
        return { enabled: true, pulled: false, pushed: false, upserted: [], deleted: [] }
      },
    } as unknown as GitStorage

    const stop = startGitSyncScheduler(
      git,
      {
        enabled: true,
        sourceOfTruth: false,
        dir: 'repo',
        branch: 'main',
        remote: null,
        remoteUrl: null,
        authorName: 'Test',
        authorEmail: 'test@example.com',
        syncIntervalMs: 1,
      },
      { upsert: () => {}, remove: () => {} },
    )
    stop()
    expect(syncCalls).toBe(0)
  })
})
