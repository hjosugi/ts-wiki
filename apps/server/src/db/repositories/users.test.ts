import { afterEach, describe, expect, test } from 'bun:test'
import type { DB } from '../client.ts'
import { createLibsqlDb, createSqliteDb } from '../client.ts'
import { DuplicateUserEmailError, type UserRecord } from '../../repositories/users.ts'
import { createSqliteUserRepository } from './users.ts'

const databases: DB[] = []

afterEach(() => {
  while (databases.length) databases.pop()?.$client.close()
})

const drivers = [
  ['sqlite', () => createSqliteDb(':memory:')],
  ['libsql', () => createLibsqlDb({ driver: 'libsql', url: ':memory:', authToken: null, replicaPath: null })],
] as const

const user = (overrides: Partial<UserRecord> = {}): UserRecord => ({
  id: 'user-1',
  email: 'user@example.com',
  name: 'User',
  passwordHash: 'hash',
  role: 'viewer',
  totpSecret: null,
  totpEnabled: 0,
  disabledAt: null,
  tokenInvalidBefore: 0,
  emailVerifiedAt: 10,
  profileBio: '',
  profileCoverUrl: '',
  profileLinks: '[]',
  profileFavoritePages: '[]',
  createdAt: 10,
  ...overrides,
})

describe.each(drivers)('%s user repository contract', (_driver, create) => {
  test('counts, finds, inserts, and updates users asynchronously', async () => {
    const db = create()
    databases.push(db)
    const repository = createSqliteUserRepository(db)

    expect(await repository.count()).toBe(0)
    await repository.insert(user())
    expect(await repository.count()).toBe(1)
    expect(await repository.findById('user-1')).toEqual(user())
    expect(await repository.findByEmail('user@example.com')).toEqual(user())

    await repository.update('user-1', { name: 'Renamed', tokenInvalidBefore: 20 })
    expect(await repository.findById('user-1')).toMatchObject({ name: 'Renamed', tokenInvalidBefore: 20 })
  })

  test('normalizes duplicate-email failures into a driver-neutral error', async () => {
    const db = create()
    databases.push(db)
    const repository = createSqliteUserRepository(db)
    await repository.insert(user())
    await expect(repository.insert(user({ id: 'user-2' }))).rejects.toBeInstanceOf(DuplicateUserEmailError)
  })
})
