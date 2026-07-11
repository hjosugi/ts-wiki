import { describe, test, expect } from 'bun:test'
import type { Principal } from '@kawaii-wiki/core'
import { createDb } from './db/client.ts'
import { createServices } from './services/index.ts'

const admin: Principal = { id: 'admin-1', role: 'admin' }
const viewer: Principal = { id: 'viewer-1', role: 'viewer' }

describe('admin service (in-memory db)', () => {
  test('non-admins are forbidden', async () => {
    const { admin: a } = createServices(createDb(':memory:'))
    expect((await a.stats(viewer)).ok).toBe(false)
    expect((await a.listPages(viewer)).ok).toBe(false)
    expect((await a.listUsers(null)).ok).toBe(false)
    expect((await a.setUserRole(viewer, 'x', 'admin')).ok).toBe(false)
  })

  test('stats counts users, pages, revisions', async () => {
    const s = createServices(createDb(':memory:'))
    await s.users.create({ email: 'a@x.com', name: 'A', password: 'password', role: 'admin' })
    s.pages.create({ path: 'p', title: 'P', content: 'x' }, admin)
    const r = await s.admin.stats(admin)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.users).toBe(1)
      expect(r.value.pages).toBe(1)
      expect(r.value.revisions).toBe(1) // 'created' snapshot
    }
  })

  test('purgeHistory removes old revisions while keeping the latest per page', async () => {
    const db = createDb(':memory:')
    const s = createServices(db)
    s.pages.create({ path: 'docs/a', title: 'A', content: 'one' }, admin)
    s.pages.update('docs/a', { content: 'two' }, admin)
    s.pages.update('docs/a', { content: 'three' }, admin)
    s.pages.create({ path: 'docs/b', title: 'B', content: 'one' }, admin)
    s.pages.update('docs/b', { content: 'two' }, admin)
    db.$client.prepare('UPDATE page_revisions SET created_at = ?').run(Date.now() - 10 * 24 * 60 * 60 * 1000)

    const before = await s.admin.historyStats(admin)
    expect(before.ok).toBe(true)
    if (!before.ok) throw new Error('stats failed')
    expect(before.value.revisions).toBe(5)

    const purged = await s.admin.purgeHistory(admin, { olderThanDays: 1, keepLatest: 1 })
    expect(purged.ok).toBe(true)
    if (!purged.ok) throw new Error('purge failed')
    expect(purged.value.deleted).toBe(3)
    expect(purged.value.revisions).toBe(2)
  })

  test('setUserRole changes a role', async () => {
    const s = createServices(createDb(':memory:'))
    const u = await s.users.create({ email: 'e@x.com', name: 'E', password: 'password', role: 'editor' })
    if (!u.ok) throw new Error('seed failed')
    const r = await s.admin.setUserRole(admin, u.value.id, 'viewer')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.role).toBe('viewer')
  })

  test('listPages filters and paginates active pages', async () => {
    const s = createServices(createDb(':memory:'))
    s.pages.create({
      path: 'docs/a',
      title: 'A',
      content: 'a',
      labels: ['guide'],
      status: 'verified',
    }, admin)
    s.pages.create({
      path: 'docs/b',
      title: 'B',
      content: 'b',
      labels: ['guide', 'ops'],
      status: 'draft',
    }, admin)
    s.pages.create({
      path: 'notes/c',
      title: 'C',
      content: 'c',
      labels: ['notes'],
      status: 'verified',
    }, admin)

    const verified = await s.admin.listPages(admin, { status: 'verified', limit: 1 })
    expect(verified.ok).toBe(true)
    if (verified.ok) {
      expect(verified.value.total).toBe(2)
      expect(verified.value.pages).toHaveLength(1)
      expect(verified.value.limit).toBe(1)
    }

    const guide = await s.admin.listPages(admin, { label: 'guide', spaceKey: 'docs' })
    expect(guide.ok).toBe(true)
    if (guide.ok) {
      expect(guide.value.total).toBe(2)
      expect(guide.value.pages.every((page) => page.path.startsWith('docs/'))).toBe(true)
    }
  })

  test('refuses to demote the last admin', async () => {
    const s = createServices(createDb(':memory:'))
    const u = await s.users.create({ email: 'admin@x.com', name: 'Ad', password: 'password', role: 'admin' })
    if (!u.ok) throw new Error('seed failed')
    const r = await s.admin.setUserRole(admin, u.value.id, 'viewer')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('conflict')
  })

  test('unknown user → not_found', async () => {
    const s = createServices(createDb(':memory:'))
    const r = await s.admin.setUserRole(admin, 'nope', 'editor')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('not_found')
  })
})
