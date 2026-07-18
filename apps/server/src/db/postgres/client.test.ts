/**
 * PostgreSQL connection foundation — integration test.
 *
 * Runs only when KAWAII_WIKI_TEST_POSTGRES_URL points at a real Postgres server
 * (provisioned by scripts/test-postgres.sh / the CI postgres job). Proves the
 * Bun.SQL pool, TLS option plumbing, and the Drizzle seam connect and execute.
 */
import { describe, test, expect, afterAll } from 'bun:test'
import { sql as drizzleSql } from 'drizzle-orm'
import { createPostgresClient } from './client.ts'

const url = process.env.KAWAII_WIKI_TEST_POSTGRES_URL?.trim()

describe.skipIf(!url)('postgres client (integration)', () => {
  const client = createPostgresClient({
    driver: 'postgres',
    url: url ?? '',
    ssl: false,
    maxConnections: 4,
  })

  afterAll(async () => {
    await client.close()
  })

  test('ping succeeds against a live server', async () => {
    await client.ping()
  })

  test('runs parameterized SQL through a pooled transaction', async () => {
    const rows = await client.sql.begin(async (tx: typeof client.sql) => {
      await tx`create temporary table t364 (id serial primary key, v text)`
      await tx`insert into t364 (v) values (${'hello'}), (${'world'})`
      return tx`select v from t364 order by id`
    })
    expect((rows as Array<{ v: string }>).map((row) => row.v)).toEqual(['hello', 'world'])
  })

  test('the drizzle seam executes raw SQL', async () => {
    const result = await client.db.execute(drizzleSql`select 1 as one`)
    const rows = Array.isArray(result) ? result : (result as { rows: Array<{ one: number }> }).rows
    expect(Number((rows as Array<{ one: number }>)[0]?.one)).toBe(1)
  })
})
