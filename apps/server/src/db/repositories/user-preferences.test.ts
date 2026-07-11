import { afterEach, describe, expect, test } from 'bun:test'
import type { DB } from '../client.ts'
import { createLibsqlDb, createSqliteDb } from '../client.ts'
import { createSqliteUserPreferenceRepository } from './user-preferences.ts'

const databases: DB[] = []

afterEach(() => {
  while (databases.length) databases.pop()?.$client.close()
})

const drivers = [
  ['sqlite', () => createSqliteDb(':memory:')],
  ['libsql', () => createLibsqlDb({ driver: 'libsql', url: ':memory:', authToken: null, replicaPath: null })],
] as const

describe.each(drivers)('%s user preference repository contract', (_driver, create) => {
  test('lists, upserts, replaces, and deletes preferences asynchronously', async () => {
    const db = create()
    databases.push(db)
    const repository = createSqliteUserPreferenceRepository(db)

    expect(await repository.listForUser('user-1')).toEqual([])

    await repository.applyForUser('user-1', [{ key: 'editor:mode', value: '"markdown"' }], 10)
    await repository.applyForUser('user-1', [{ key: 'editor:mode', value: '"visual"' }], 20)

    expect(await repository.listForUser('user-1')).toEqual([{
      userId: 'user-1',
      key: 'editor:mode',
      value: '"visual"',
      updatedAt: 20,
    }])
    expect(await repository.listForUser('user-2')).toEqual([])

    await repository.applyForUser('user-1', [{ key: 'editor:mode', value: null }], 30)
    expect(await repository.listForUser('user-1')).toEqual([])
  })
})
