import { afterEach, describe, expect, test } from 'bun:test'
import type { DB } from '../client.ts'
import { createLibsqlDb, createSqliteDb } from '../client.ts'
import { createSqliteAnalyticsRepository } from './analytics.ts'

const databases: DB[] = []

afterEach(() => {
  while (databases.length) databases.pop()?.$client.close()
})

const drivers = [
  ['sqlite', () => createSqliteDb(':memory:')],
  ['libsql', () => createLibsqlDb({ driver: 'libsql', url: ':memory:', authToken: null, replicaPath: null })],
] as const

describe.each(drivers)('%s analytics repository contract', (_driver, create) => {
  test('atomically increments batches and returns deterministic summaries', async () => {
    const db = create()
    databases.push(db)
    const repository = createSqliteAnalyticsRepository(db)

    await repository.incrementBatch([
      { path: 'docs/a', views: 2, lastViewedAt: 20 },
      { path: 'docs/b', views: 1, lastViewedAt: 10 },
    ])
    await repository.incrementBatch([
      { path: 'docs/a', views: 3, lastViewedAt: 30 },
    ])

    expect(await repository.find('docs/a')).toEqual({ path: 'docs/a', views: 5, lastViewedAt: 30 })
    expect(await repository.find('missing')).toBeUndefined()
    expect(await repository.summary(1)).toEqual({
      totalViews: 6,
      topPages: [{ path: 'docs/a', views: 5, lastViewedAt: 30 }],
    })
    expect(await repository.popular(20, 10)).toEqual([
      { path: 'docs/a', views: 5, lastViewedAt: 30 },
    ])
  })
})
