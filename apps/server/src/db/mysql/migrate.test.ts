/**
 * MySQL migrations contract — integration. Env-gated on KAWAII_WIKI_TEST_MYSQL_URL.
 *
 * Proves the mysql-core declarations materialize on a real MySQL server, that
 * `runMysqlMigrations` is idempotent, and that the live schema matches the
 * declarations (no drift).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createMysqlContractDb, testMysqlUrl, type MysqlContractDb } from './test-support.ts'
import { mysqlSchemaStatements, mysqlTableNames, runMysqlMigrations, verifyMysqlSchema } from './migrate.ts'

describe.skipIf(!testMysqlUrl)('mysql migrations', () => {
  let harness: MysqlContractDb
  beforeAll(async () => { harness = await createMysqlContractDb('kw_migrate_contract') })
  afterAll(async () => { await harness?.close() })

  test('materializes every declared table', async () => {
    const [rows] = (await harness.client.pool.query(
      'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()',
    )) as [Array<{ name: string }>, unknown]
    const present = new Set(rows.map((row) => row.name.toLowerCase()))
    for (const name of mysqlTableNames()) {
      expect(present.has(name.toLowerCase())).toBe(true)
    }
  })

  test('is idempotent and passes schema verification', async () => {
    await runMysqlMigrations(harness.client.pool) // a second run must not error
    await expect(verifyMysqlSchema(harness.client.pool)).resolves.toBeUndefined()
  })

  test('emits one CREATE TABLE per declared table', () => {
    expect(mysqlSchemaStatements().length).toBe(mysqlTableNames().length)
  })
})
