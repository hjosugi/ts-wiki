/**
 * PostgreSQL migration foundation — integration test.
 *
 * Runs only when KAWAII_WIKI_TEST_POSTGRES_URL points at a real Postgres server.
 * Proves the schema materializes, matches the pg-core declarations (no drift),
 * re-runs idempotently, and that the chosen type mappings (bigint millis,
 * boolean flags, bigserial ids, composite primary keys) behave as intended.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { createPostgresClient } from './client.ts'
import { runPostgresMigrations, verifyPostgresSchema, postgresSchemaStatements, postgresSearchStatements, postgresTableNames } from './migrate.ts'
import { testPostgresUrl, waitForPostgres } from './test-support.ts'

const one = <T>(rows: T[]): T => {
  const [row] = rows
  if (!row) throw new Error('expected at least one row')
  return row
}

describe.skipIf(!testPostgresUrl)('postgres migrations (integration)', () => {
  const client = createPostgresClient({ driver: 'postgres', url: testPostgresUrl ?? '', ssl: false, maxConnections: 4 })

  beforeAll(async () => {
    await waitForPostgres(client)
    // Start from a clean slate so parity/counts are deterministic. Drop only
    // our own tables (not the whole `public` schema) so a concurrently loaded
    // sibling test file's pooled connections keep their namespace.
    for (const table of postgresTableNames()) {
      await client.sql.unsafe(`DROP TABLE IF EXISTS "${table}" CASCADE`)
    }
  })

  afterAll(async () => {
    await client.close()
  })

  test('materializes the full relational schema and matches the declarations', async () => {
    await runPostgresMigrations(client.sql)
    await verifyPostgresSchema(client.sql) // throws on any column/index drift

    const expectedTables = [...postgresSchemaStatements(), ...postgresSearchStatements()]
      .filter((statement) => statement.startsWith('CREATE TABLE')).length
    const rows = (await client.sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `) as Array<{ table_name: string }>
    expect(rows.length).toBe(expectedTables)
    expect(expectedTables).toBeGreaterThanOrEqual(30)
  })

  test('is idempotent on re-run', async () => {
    await runPostgresMigrations(client.sql)
    await verifyPostgresSchema(client.sql)
  })

  test('type mappings round-trip: bigint millis, text-enum defaults, bigserial, boolean', async () => {
    await client.sql`
      INSERT INTO users (id, email, name, password_hash, created_at)
      VALUES ('u1', 'u1@example.com', 'User One', 'hash', 1000)
    `
    const user = one((await client.sql`
      SELECT role, totp_enabled, created_at FROM users WHERE id = 'u1'
    `) as Array<{ role: string; totp_enabled: number; created_at: number }>)
    expect(user.role).toBe('viewer') // text-enum default
    expect(Number(user.totp_enabled)).toBe(0) // bigint default
    expect(Number(user.created_at)).toBe(1000) // bigint millis round-trip

    const event = one((await client.sql`
      INSERT INTO wiki_events (source_id, event_type, action, path, created_at)
      VALUES ('src', 'page:changed', 'created', '/a', 1) RETURNING id
    `) as Array<{ id: number }>)
    expect(Number(event.id)).toBeGreaterThan(0) // bigserial autoincrement

    await client.sql`
      INSERT INTO pages (id, path, title, created_at, updated_at)
      VALUES ('p1', '/a', 'A', 1, 1)
    `
    const page = one((await client.sql`
      SELECT pinned, lifecycle, status FROM pages WHERE id = 'p1'
    `) as Array<{ pinned: boolean; lifecycle: string; status: string }>)
    expect(page.pinned).toBe(false) // boolean default
    expect(page.lifecycle).toBe('active')
    expect(page.status).toBe('draft')
  })

  test('composite primary keys and unique constraints are enforced', async () => {
    await client.sql`INSERT INTO page_watchers (user_id, path, created_at) VALUES ('u1', '/a', 1)`
    let compositeConflict = false
    try {
      await client.sql`INSERT INTO page_watchers (user_id, path, created_at) VALUES ('u1', '/a', 2)`
    } catch {
      compositeConflict = true
    }
    expect(compositeConflict).toBe(true)

    let uniqueConflict = false
    try {
      await client.sql`
        INSERT INTO users (id, email, name, password_hash, created_at)
        VALUES ('u2', 'u1@example.com', 'Dup', 'hash', 1)
      `
    } catch {
      uniqueConflict = true
    }
    expect(uniqueConflict).toBe(true) // users.email UNIQUE
  })
})
