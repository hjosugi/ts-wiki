import { describe, expect, test } from 'bun:test'
import type { Principal } from '@kawaii-wiki/core'
import { createDb } from '../db/client.ts'
import { createServices } from './index.ts'

describe('notification service', () => {
  test('watches pages, notifies other editors, and marks notifications read', async () => {
    const services = createServices(createDb(':memory:'))
    const actorUser = await services.users.create({
      email: 'actor@example.com',
      name: 'Actor',
      password: 'password',
      role: 'editor',
    })
    const watcherUser = await services.users.create({
      email: 'watcher@example.com',
      name: 'Watcher',
      password: 'password',
      role: 'editor',
    })
    if (!actorUser.ok || !watcherUser.ok) throw new Error('user seed failed')
    const actor: Principal = { id: actorUser.value.id, role: actorUser.value.role }
    const watcher: Principal = { id: watcherUser.value.id, role: watcherUser.value.role }

    const page = services.pages.create({
      path: 'docs/notifications',
      title: 'Notifications',
      content: 'Initial',
      status: 'verified',
    }, actor)
    if (!page.ok) throw new Error('page seed failed')

    expect(services.notifications.watch(watcher, page.value.path, true)).toEqual({
      ok: true,
      value: { path: page.value.path, watching: true },
    })
    services.notifications.pageChanged('updated', page.value.path, undefined, actor.id)

    const listed = services.notifications.list(watcher)
    expect(listed.ok).toBe(true)
    if (!listed.ok) throw new Error('notification list failed')
    expect(listed.value.unread).toBe(1)
    expect(listed.value.notifications[0]).toMatchObject({
      kind: 'page',
      path: page.value.path,
      message: 'Notifications was updated',
      readAt: null,
    })

    services.notifications.markRead(watcher, listed.value.notifications[0]!.id)
    const read = services.notifications.list(watcher)
    expect(read.ok && read.value.unread).toBe(0)
  })

  test('does not let viewers watch draft or future-scheduled pages', async () => {
    const services = createServices(createDb(':memory:'))
    const viewerUser = await services.users.create({
      email: 'viewer@example.com',
      name: 'Viewer',
      password: 'password',
      role: 'viewer',
    })
    if (!viewerUser.ok) throw new Error('viewer seed failed')
    const viewer: Principal = { id: viewerUser.value.id, role: viewerUser.value.role }
    const editor: Principal = { id: 'editor', role: 'editor' }

    expect(services.pages.create({ path: 'docs/draft', title: 'Draft', content: 'Hidden' }, editor).ok).toBe(true)
    expect(services.pages.create({
      path: 'docs/future',
      title: 'Future',
      content: 'Later',
      status: 'verified',
      publishAt: Date.now() + 60_000,
    }, editor).ok).toBe(true)

    const draft = services.notifications.watch(viewer, 'docs/draft', true)
    const future = services.notifications.watch(viewer, 'docs/future', true)
    expect(!draft.ok && draft.error.kind).toBe('not_found')
    expect(!future.ok && future.error.kind).toBe('not_found')
  })

  test('merges conflicting watches on move and removes watches on delete', async () => {
    const services = createServices(createDb(':memory:'))
    const watcherUser = await services.users.create({
      email: 'watcher@example.com',
      name: 'Watcher',
      password: 'password',
      role: 'editor',
    })
    if (!watcherUser.ok) throw new Error('watcher seed failed')
    const watcher: Principal = { id: watcherUser.value.id, role: watcherUser.value.role }

    expect(services.pages.create({ path: 'docs/old', title: 'Old', content: 'Old', status: 'verified' }, watcher).ok).toBe(true)
    expect(services.pages.create({ path: 'docs/new', title: 'New', content: 'New', status: 'verified' }, watcher).ok).toBe(true)

    expect(services.notifications.watch(watcher, 'docs/old', true).ok).toBe(true)
    expect(services.notifications.watch(watcher, 'docs/new', true).ok).toBe(true)
    expect(() => services.notifications.pageChanged('moved', 'docs/new', 'docs/old', 'actor')).not.toThrow()
    expect(services.notifications.watching(watcher, 'docs/old')).toEqual({ ok: true, value: { path: 'docs/old', watching: false } })
    expect(services.notifications.watching(watcher, 'docs/new')).toEqual({ ok: true, value: { path: 'docs/new', watching: true } })

    services.notifications.pageChanged('deleted', 'docs/new', undefined, 'actor')
    expect(services.notifications.watching(watcher, 'docs/new')).toEqual({ ok: true, value: { path: 'docs/new', watching: false } })
  })
})
