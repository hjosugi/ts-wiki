import { describe, test, expect } from 'bun:test'
import type { Principal } from '@ts-wiki/core'
import { createDb } from './db/client.ts'
import { createServices } from './services/index.ts'

const admin: Principal = { id: 'admin-1', role: 'admin' }
const viewer: Principal = { id: 'viewer-1', role: 'viewer' }

describe('admin service (in-memory db)', () => {
  test('non-admins are forbidden', () => {
    const { admin: a } = createServices(createDb(':memory:'))
    expect(a.stats(viewer).ok).toBe(false)
    expect(a.listUsers(null).ok).toBe(false)
    expect(a.setUserRole(viewer, 'x', 'admin').ok).toBe(false)
  })

  test('stats counts users, pages, revisions', async () => {
    const s = createServices(createDb(':memory:'))
    await s.users.create({ email: 'a@x.com', name: 'A', password: 'password', role: 'admin' })
    s.pages.create({ path: 'p', title: 'P', content: 'x' }, admin)
    const r = s.admin.stats(admin)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.users).toBe(1)
      expect(r.value.pages).toBe(1)
      expect(r.value.revisions).toBe(1) // 'created' snapshot
    }
  })

  test('setUserRole changes a role', async () => {
    const s = createServices(createDb(':memory:'))
    const u = await s.users.create({ email: 'e@x.com', name: 'E', password: 'password', role: 'editor' })
    if (!u.ok) throw new Error('seed failed')
    const r = s.admin.setUserRole(admin, u.value.id, 'viewer')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.role).toBe('viewer')
  })

  test('refuses to demote the last admin', async () => {
    const s = createServices(createDb(':memory:'))
    const u = await s.users.create({ email: 'admin@x.com', name: 'Ad', password: 'password', role: 'admin' })
    if (!u.ok) throw new Error('seed failed')
    const r = s.admin.setUserRole(admin, u.value.id, 'viewer')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('conflict')
  })

  test('unknown user → not_found', () => {
    const s = createServices(createDb(':memory:'))
    const r = s.admin.setUserRole(admin, 'nope', 'editor')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('not_found')
  })
})
