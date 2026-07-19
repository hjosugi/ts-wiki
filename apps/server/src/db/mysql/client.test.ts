/**
 * MySQL connection foundation — integration. Env-gated on KAWAII_WIKI_TEST_MYSQL_URL.
 *
 * Proves the mysql2 pool + Drizzle seam connect, ping, run a trivial query, and
 * close against a real MySQL server. The repository contracts land in later
 * slices; this just guards the foundation.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { createMysqlTestClient, testMysqlUrl } from './test-support.ts'
import type { MysqlClient } from './client.ts'

describe.skipIf(!testMysqlUrl)('mysql client foundation', () => {
  let client: MysqlClient
  beforeAll(async () => { client = await createMysqlTestClient() }, 30_000)
  afterAll(async () => { await client?.close() }, 30_000)

  test('pings the server', async () => {
    await expect(client.ping()).resolves.toBeUndefined()
  })

  test('runs a trivial query through Drizzle', async () => {
    const rows = await client.db.execute(sql`select 1 as ok`)
    // mysql2 returns [rows, fields]; the first row carries the projected column.
    const [result] = rows as unknown as [Array<{ ok: number }>]
    expect(Number(result[0]?.ok)).toBe(1)
  })
})
