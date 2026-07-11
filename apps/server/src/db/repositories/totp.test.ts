import { afterEach, describe, expect, test } from 'bun:test'
import type { DB } from '../client.ts'
import { createLibsqlDb, createSqliteDb } from '../client.ts'
import type { TotpRecoveryCodeRecord } from '../../repositories/totp.ts'
import type { UserRecord } from '../../repositories/users.ts'
import { createSqliteTotpRepository } from './totp.ts'
import { createSqliteUserRepository } from './users.ts'

const databases: DB[] = []

afterEach(() => {
  while (databases.length) databases.pop()?.$client.close()
})

const drivers = [
  ['sqlite', () => createSqliteDb(':memory:')],
  ['libsql', () => createLibsqlDb({ driver: 'libsql', url: ':memory:', authToken: null, replicaPath: null })],
] as const

const user: UserRecord = {
  id: 'user-1',
  email: 'totp@example.com',
  name: 'TOTP User',
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
}

const recoveryCode = (id: string, codeHash = `hash-${id}`): TotpRecoveryCodeRecord => ({
  id,
  userId: user.id,
  codeHash,
  createdAt: 20,
  usedAt: null,
})

describe.each(drivers)('%s TOTP repository contract', (_driver, create) => {
  test('atomically enables, replaces, consumes, and disables recovery state', async () => {
    const db = create()
    databases.push(db)
    const users = createSqliteUserRepository(db)
    const repository = createSqliteTotpRepository(db)
    await users.insert(user)

    await repository.saveSecret(user.id, 'SECRET', 0)
    expect(await users.findById(user.id)).toMatchObject({ totpSecret: 'SECRET', totpEnabled: 0 })

    await repository.enable(user.id, [recoveryCode('code-1'), recoveryCode('code-2')])
    expect(await users.findById(user.id)).toMatchObject({ totpSecret: 'SECRET', totpEnabled: 1 })
    expect((await repository.listUnusedRecoveryCodes(user.id)).map((row) => row.id).sort()).toEqual(['code-1', 'code-2'])

    await repository.replaceRecoveryCodes(user.id, [recoveryCode('code-3')])
    expect((await repository.listUnusedRecoveryCodes(user.id)).map((row) => row.id)).toEqual(['code-3'])
    expect(await repository.consumeRecoveryCode('code-3', 30)).toBe(true)
    expect(await repository.consumeRecoveryCode('code-3', 31)).toBe(false)
    expect(await repository.listUnusedRecoveryCodes(user.id)).toEqual([])

    await repository.replaceRecoveryCodes(user.id, [recoveryCode('code-4')])
    await repository.disable(user.id)
    expect(await users.findById(user.id)).toMatchObject({ totpSecret: null, totpEnabled: 0 })
    expect(await repository.listUnusedRecoveryCodes(user.id)).toEqual([])
  })
})
