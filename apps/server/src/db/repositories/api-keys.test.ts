import { afterEach, describe, expect, test } from 'bun:test'
import type { DB } from '../client.ts'
import { createLibsqlDb, createSqliteDb } from '../client.ts'
import {
  DuplicateApiKeyHashError,
  type ApiKeyRecord,
} from '../../repositories/api-keys.ts'
import { createSqliteApiKeyRepository } from './api-keys.ts'

const databases: DB[] = []

afterEach(() => {
  while (databases.length) databases.pop()?.$client.close()
})

const drivers = [
  ['sqlite', () => createSqliteDb(':memory:')],
  ['libsql', () => createLibsqlDb({ driver: 'libsql', url: ':memory:', authToken: null, replicaPath: null })],
] as const

const apiKey = (overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord => ({
  id: 'key-1',
  name: 'Automation',
  keyHash: 'hash-1',
  role: 'editor',
  expiresAt: null,
  lastUsedAt: null,
  revokedAt: null,
  createdAt: 10,
  ...overrides,
})

describe.each(drivers)('%s API key repository contract', (_driver, create) => {
  test('stores, lists, finds, and normalizes duplicate key hashes', async () => {
    const db = create()
    databases.push(db)
    const repository = createSqliteApiKeyRepository(db)
    await repository.insert(apiKey())
    await repository.insert(apiKey({ id: 'key-2', keyHash: 'hash-2', createdAt: 20 }))

    expect(await repository.findById('key-1')).toEqual(apiKey())
    expect(await repository.findByHash('hash-2')).toEqual(apiKey({ id: 'key-2', keyHash: 'hash-2', createdAt: 20 }))
    expect((await repository.list()).map((row) => row.id)).toEqual(['key-1', 'key-2'])
    await expect(repository.insert(apiKey({ id: 'key-3' }))).rejects.toBeInstanceOf(DuplicateApiKeyHashError)
  })

  test('marks only active keys as used and revokes idempotently', async () => {
    const db = create()
    databases.push(db)
    const repository = createSqliteApiKeyRepository(db)
    await repository.insert(apiKey())
    await repository.insert(apiKey({ id: 'expired', keyHash: 'expired-hash', expiresAt: 20 }))

    expect(await repository.markUsedIfActive('key-1', 30)).toBe(true)
    expect(await repository.findById('key-1')).toMatchObject({ lastUsedAt: 30 })
    expect(await repository.markUsedIfActive('expired', 20)).toBe(false)
    expect(await repository.markUsedIfActive('missing', 30)).toBe(false)

    expect(await repository.revoke('missing', 40)).toBeUndefined()
    expect(await repository.revoke('key-1', 40)).toMatchObject({ id: 'key-1', revokedAt: 40 })
    expect(await repository.revoke('key-1', 50)).toMatchObject({ id: 'key-1', revokedAt: 40 })
    expect(await repository.markUsedIfActive('key-1', 60)).toBe(false)
    expect(await repository.findById('key-1')).toMatchObject({ lastUsedAt: 30, revokedAt: 40 })
  })
})
