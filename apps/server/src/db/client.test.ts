import { describe, expect, test } from 'bun:test'
import { createDb } from './client.ts'
import { createServices } from '../services/index.ts'

describe('createDb', () => {
  test('opens a migrated libSQL database and supports core wiki flows', async () => {
    const db = createDb({
      driver: 'libsql',
      url: ':memory:',
      authToken: null,
      replicaPath: null,
    })
    try {
      expect(db.$driver).toBe('libsql')
      const services = createServices(db)
      const created = await services.users.create({
        email: 'admin@example.com',
        name: 'Admin',
        password: 'password',
        role: 'admin',
      })
      expect(created.ok).toBe(true)
      if (!created.ok) return

      const principal = services.authz.principalForUser(created.value)
      const page = services.pages.create({
        path: 'docs/libsql',
        title: 'libSQL runtime',
        content: 'Hello from Turso search',
      }, principal)
      expect(page.ok).toBe(true)

      const hits = services.search.search('turso').hits
      expect(hits[0]?.path).toBe('docs/libsql')
    } finally {
      db.$client.close()
    }
  })
})
