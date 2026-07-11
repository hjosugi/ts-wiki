import { afterEach, describe, expect, test } from 'bun:test'
import type { DB } from '../client.ts'
import { createLibsqlDb, createSqliteDb } from '../client.ts'
import type { OidcStateRecord } from '../../repositories/oidc-states.ts'
import { createSqliteOidcStateRepository } from './oidc-states.ts'

const databases: DB[] = []

afterEach(() => {
  while (databases.length) databases.pop()?.$client.close()
})

const drivers = [
  ['sqlite', () => createSqliteDb(':memory:')],
  ['libsql', () => createLibsqlDb({ driver: 'libsql', url: ':memory:', authToken: null, replicaPath: null })],
] as const

const state = (value: string, expiresAt = 100): OidcStateRecord => ({
  state: value,
  provider: 'oidc-main',
  nonce: `nonce-${value}`,
  codeVerifier: `verifier-${value}`,
  redirectAfter: '/docs',
  expiresAt,
  createdAt: 10,
})

describe.each(drivers)('%s OIDC state repository contract', (_driver, create) => {
  test('consumes a valid provider state exactly once without consuming mismatches', async () => {
    const db = create()
    databases.push(db)
    const repository = createSqliteOidcStateRepository(db)
    await repository.insert(state('valid'))

    expect(await repository.consume('valid', 'other-provider', 50)).toBeNull()
    expect(await repository.consume('valid', 'oidc-main', 50)).toEqual(state('valid'))
    expect(await repository.consume('valid', 'oidc-main', 50)).toBeNull()
  })

  test('removes expired state during cleanup and atomic consumption', async () => {
    const db = create()
    databases.push(db)
    const repository = createSqliteOidcStateRepository(db)
    await repository.insert(state('cleanup', 20))
    await repository.insert(state('consume', 20))
    await repository.insert(state('fresh', 30))

    expect(await repository.consume('consume', 'oidc-main', 20)).toBeNull()
    expect(await repository.consume('consume', 'oidc-main', 10)).toBeNull()
    await repository.cleanupExpired(20)
    expect(await repository.consume('cleanup', 'oidc-main', 10)).toBeNull()
    expect(await repository.consume('fresh', 'oidc-main', 20)).toEqual(state('fresh', 30))
  })
})
