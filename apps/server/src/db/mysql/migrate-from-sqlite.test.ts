/**
 * SQLite → MySQL data-migration contract — integration. Env-gated.
 *
 * Seeds a real SQLite database through the service layer, copies it into a fresh
 * MySQL target with `migrateToDriver`, and asserts the rows land and the target
 * search index is rebuilt from the migrated pages. Also covers dry-run (writes
 * nothing) and the non-empty-target guard.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import type { Principal } from '@kawaii-wiki/core'
import { createDb, type DB } from '../client.ts'
import { createServices } from '../services.ts'
import { createMysqlMigrationTarget, migrateToDriver } from '../cross-driver-migrate.ts'
import { createMysqlContractDb, testMysqlUrl, type MysqlContractDb } from './test-support.ts'
import { createMysqlSearchIndexer } from './repositories/search.ts'
import { pageRevisions, pages, users } from './schema.ts'
import type { SearchRequest } from '../../services/search.ts'

const request: Required<SearchRequest> = { limit: 20, offset: 0, filters: {}, scope: 'all', sort: 'relevance' }

/** Seed a source SQLite database with an admin and a page (+ its revision). */
const seedSource = async (source: DB): Promise<void> => {
  const services = createServices(source)
  await services.authz.ensureDefaults()
  const admin = await services.users.create({ email: 'migrate@example.com', name: 'Mig', password: 'password', role: 'admin' })
  if (!admin.ok) throw new Error('seed admin failed')
  const principal: Principal = { id: admin.value.id, role: 'admin' }
  const page = await services.pages.create({ path: 'docs/migrated', title: 'Migrated', content: 'uniquebodyword here' }, principal)
  if (!page.ok) throw new Error(`seed page failed: ${page.error.message}`)
}

describe.skipIf(!testMysqlUrl)('sqlite → mysql migration', () => {
  let harness: MysqlContractDb
  let source: DB
  beforeAll(async () => { harness = await createMysqlContractDb('kw_migrate_mysql') }, 30_000)
  beforeEach(async () => {
    await harness.reset()
    source = createDb(':memory:', { ftsTokenizer: 'unicode61' })
    await seedSource(source)
  }, 30_000)
  afterEach(() => { source.$client.close() })
  afterAll(async () => { await harness?.close() }, 30_000)

  test('copies every table and rebuilds search on the target', async () => {
    const report = await migrateToDriver(source, createMysqlMigrationTarget(harness.client, 'unicode61'), { mode: 'apply' })
    expect(report.target).toBe('mysql')
    expect(report.totalRows).toBeGreaterThan(0)

    expect((await harness.client.db.select().from(users)).map((row) => row.email)).toContain('migrate@example.com')
    expect((await harness.client.db.select().from(pages)).map((row) => row.path)).toContain('docs/migrated')
    expect((await harness.client.db.select().from(pageRevisions)).length).toBeGreaterThan(0)

    const found = await createMysqlSearchIndexer(harness.client).search('uniquebodyword', request)
    expect(found.hits.map((hit) => hit.path)).toContain('docs/migrated')
  })

  test('dry-run writes nothing but reports the counts', async () => {
    const report = await migrateToDriver(source, createMysqlMigrationTarget(harness.client, 'unicode61'), { mode: 'dry-run' })
    expect(report.mode).toBe('dry-run')
    expect(report.totalRows).toBeGreaterThan(0)
    expect((await harness.client.db.select().from(users)).length).toBe(0)
  })

  test('refuses to migrate into a non-empty target', async () => {
    await migrateToDriver(source, createMysqlMigrationTarget(harness.client, 'unicode61'), { mode: 'apply' })
    await expect(
      migrateToDriver(source, createMysqlMigrationTarget(harness.client, 'unicode61'), { mode: 'apply' }),
    ).rejects.toThrow(/not empty/i)
  })
})
