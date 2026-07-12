import { describe, expect, test } from 'bun:test'
import { Database as BunDatabase } from 'bun:sqlite'
import { createDb } from './client.ts'
import { runMigrations } from './migrate.ts'
import { createServices } from './services.ts'

describe('createDb', () => {
  test('email verification backfill runs only when the column is first added', async () => {
    const sqlite = new BunDatabase(':memory:')
    sqlite.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'viewer',
        totp_secret TEXT,
        totp_enabled INTEGER NOT NULL DEFAULT 0,
        disabled_at INTEGER,
        token_invalid_before INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      INSERT INTO users(id, email, name, password_hash, role, created_at)
      VALUES ('legacy', 'legacy@example.com', 'Legacy', 'hash', 'viewer', 1234);
    `)
    runMigrations(sqlite)
    expect(sqlite.query('SELECT email_verified_at AS verified FROM users WHERE id = ?').get('legacy')).toEqual({ verified: 1234 })

    sqlite.exec("UPDATE users SET email_verified_at = NULL WHERE id = 'legacy'")
    runMigrations(sqlite)
    expect(sqlite.query('SELECT email_verified_at AS verified FROM users WHERE id = ?').get('legacy')).toEqual({ verified: null })
    sqlite.close()
  })

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

      const principal = await services.authz.principalForUser(created.value)
      const page = await services.pages.create({
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
