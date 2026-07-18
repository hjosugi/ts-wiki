/**
 * PostgreSQL repository contract tests — integration.
 *
 * Runs only when KAWAII_WIKI_TEST_POSTGRES_URL points at a real Postgres server.
 * Exercises the full driver-neutral contract of each implemented PG repository
 * against a live database, isolated in its own schema (`search_path`) so it
 * never collides with the sibling schema/migration test files. Each test starts
 * from a truncated database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { pages } from './schema.ts'
import { createPostgresContractDb, testPostgresUrl, type PostgresContractDb } from './test-support.ts'
import { createPostgresSettingsRepository } from './repositories/settings.ts'
import { createPostgresUserPreferenceRepository } from './repositories/user-preferences.ts'
import { createPostgresOidcStateRepository } from './repositories/oidc-states.ts'
import { createPostgresAnalyticsRepository } from './repositories/analytics.ts'
import { createPostgresPageShareRepository } from './repositories/page-shares.ts'

describe.skipIf(!testPostgresUrl)('postgres repository contracts', () => {
  let harness: PostgresContractDb

  beforeAll(async () => {
    harness = await createPostgresContractDb('kw_repo_contract')
  })
  beforeEach(async () => {
    await harness.reset()
  })
  afterAll(async () => {
    await harness?.close()
  })

  test('settings: lists and atomically upserts complete batches', async () => {
    const repository = createPostgresSettingsRepository(harness.db)
    expect(await repository.list()).toEqual([])

    await repository.upsertAll([
      { key: 'siteTitle', value: 'First', updatedAt: 10 },
      { key: 'theme', value: 'dark', updatedAt: 10 },
    ])
    expect((await repository.list()).sort((a, b) => a.key.localeCompare(b.key))).toEqual([
      { key: 'siteTitle', value: 'First', updatedAt: 10 },
      { key: 'theme', value: 'dark', updatedAt: 10 },
    ])

    await repository.upsertAll([
      { key: 'siteTitle', value: 'Updated', updatedAt: 20 },
      { key: 'homePath', value: 'docs/home', updatedAt: 20 },
    ])
    expect((await repository.list()).sort((a, b) => a.key.localeCompare(b.key))).toEqual([
      { key: 'homePath', value: 'docs/home', updatedAt: 20 },
      { key: 'siteTitle', value: 'Updated', updatedAt: 20 },
      { key: 'theme', value: 'dark', updatedAt: 10 },
    ])
  })

  test('user preferences: set, update, and delete per user', async () => {
    const repository = createPostgresUserPreferenceRepository(harness.db)
    expect(await repository.listForUser('u1')).toEqual([])

    await repository.applyForUser('u1', [
      { key: 'theme', value: 'dark' },
      { key: 'density', value: 'compact' },
    ], 10)
    await repository.applyForUser('u2', [{ key: 'theme', value: 'light' }], 10)

    expect((await repository.listForUser('u1')).map((p) => [p.key, p.value]).sort()).toEqual([
      ['density', 'compact'],
      ['theme', 'dark'],
    ])

    await repository.applyForUser('u1', [
      { key: 'theme', value: 'system' }, // update
      { key: 'density', value: null }, // delete
      { key: 'sidebar', value: 'pinned' }, // add
    ], 20)
    expect((await repository.listForUser('u1')).map((p) => [p.key, p.value, p.updatedAt]).sort()).toEqual([
      ['sidebar', 'pinned', 20],
      ['theme', 'system', 20],
    ])
    // Other users are untouched.
    expect((await repository.listForUser('u2')).map((p) => p.value)).toEqual(['light'])
  })

  test('oidc states: single-use consume with provider and expiry checks', async () => {
    const repository = createPostgresOidcStateRepository(harness.db)
    const record = {
      state: 's1', provider: 'google', nonce: 'n', codeVerifier: 'v',
      redirectAfter: '/home', expiresAt: 100, createdAt: 1,
    }
    await repository.insert(record)

    // Wrong provider does not consume.
    expect(await repository.consume('s1', 'github', 50)).toBeNull()
    // Correct provider returns the record and deletes it.
    expect(await repository.consume('s1', 'google', 50)).toEqual(record)
    expect(await repository.consume('s1', 'google', 50)).toBeNull()

    // Expired matching state is consumed but returns null.
    await repository.insert({ ...record, state: 's2', expiresAt: 100 })
    expect(await repository.consume('s2', 'google', 200)).toBeNull()
    expect(await repository.consume('s2', 'google', 50)).toBeNull()

    // cleanupExpired removes stale rows.
    await repository.insert({ ...record, state: 's3', expiresAt: 10 })
    await repository.cleanupExpired(50)
    expect(await repository.consume('s3', 'google', 5)).toBeNull()
  })

  test('analytics: increment, find, summary, and popular', async () => {
    const repository = createPostgresAnalyticsRepository(harness.db)
    expect(await repository.find('/a')).toBeUndefined()

    await repository.incrementBatch([{ path: '/a', views: 2, lastViewedAt: 10 }])
    expect(await repository.find('/a')).toEqual({ path: '/a', views: 2, lastViewedAt: 10 })

    await repository.incrementBatch([
      { path: '/a', views: 3, lastViewedAt: 20 },
      { path: '/b', views: 1, lastViewedAt: 20 },
    ])
    expect(await repository.find('/a')).toEqual({ path: '/a', views: 5, lastViewedAt: 20 })

    const summary = await repository.summary(10)
    expect(summary.totalViews).toBe(6)
    expect(summary.topPages.map((p) => p.path)).toEqual(['/a', '/b'])

    expect((await repository.popular(15, 10)).map((p) => p.path)).toEqual(['/a', '/b'])
    expect(await repository.popular(25, 10)).toEqual([])
  })

  test('page shares: create, duplicate rejection, lookup, expiry, and revoke', async () => {
    await harness.db.insert(pages).values({ id: 'p1', path: 'docs/a', title: 'A', createdAt: 1, updatedAt: 1 })
    const repository = createPostgresPageShareRepository(harness.db)

    const active = await repository.findActivePage('docs/a')
    expect(active?.path).toBe('docs/a')

    const share = { token: 't1', path: 'docs/a', createdBy: 'u1', expiresAt: null, revokedAt: null, createdAt: 1 }
    await repository.insert(share)
    expect(await repository.findByToken('t1')).toEqual(share)

    // Duplicate token is mapped to the domain error.
    await expect(repository.insert(share)).rejects.toThrow(/token already exists/i)

    expect((await repository.findActiveForPath('docs/a', 50))?.token).toBe('t1')

    const revoked = await repository.revoke('t1', 5)
    expect(revoked).toEqual({ ...share, revokedAt: 5 })
    expect(await repository.findActiveForPath('docs/a', 50)).toBeUndefined()
    // Revoking again returns the already-revoked share unchanged.
    expect((await repository.revoke('t1', 9))?.revokedAt).toBe(5)

    // Expiry excludes a share from the active lookup.
    await repository.insert({ token: 't2', path: 'docs/a', createdBy: 'u1', expiresAt: 100, revokedAt: null, createdAt: 2 })
    expect((await repository.findActiveForPath('docs/a', 50))?.token).toBe('t2')
    expect(await repository.findActiveForPath('docs/a', 150)).toBeUndefined()
  })
})
