import { afterEach, describe, expect, test } from 'bun:test'
import type { DB } from '../client.ts'
import { createLibsqlDb, createSqliteDb } from '../client.ts'
import {
  DuplicatePasskeyCredentialError,
  type PasskeyRecord,
  type WebauthnChallengeRecord,
} from '../../repositories/passkeys.ts'
import { createSqlitePasskeyRepository } from './passkeys.ts'

const databases: DB[] = []

afterEach(() => {
  while (databases.length) databases.pop()?.$client.close()
})

const drivers = [
  ['sqlite', () => createSqliteDb(':memory:')],
  ['libsql', () => createLibsqlDb({ driver: 'libsql', url: ':memory:', authToken: null, replicaPath: null })],
] as const

const passkey = (id = 'credential-1'): PasskeyRecord => ({
  id,
  userId: 'user-1',
  name: 'Laptop',
  publicKey: 'AQIDBA',
  counter: 7,
  transports: '["internal"]',
  deviceType: 'singleDevice',
  backedUp: false,
  createdAt: 10,
  lastUsedAt: null,
})

const challenge = (
  value: string,
  purpose: WebauthnChallengeRecord['purpose'] = 'authentication',
  expiresAt = 100,
): WebauthnChallengeRecord => ({
  challenge: value,
  userId: 'user-1',
  purpose,
  expiresAt,
  createdAt: 10,
})

describe.each(drivers)('%s passkey repository contract', (_driver, create) => {
  test('stores credentials and protects counter updates with compare-and-set', async () => {
    const db = create()
    databases.push(db)
    const repository = createSqlitePasskeyRepository(db)
    await repository.insert(passkey())
    expect(await repository.findById('credential-1')).toEqual(passkey())
    expect(await repository.listByUser('user-1')).toEqual([passkey()])
    await expect(repository.insert(passkey())).rejects.toBeInstanceOf(DuplicatePasskeyCredentialError)

    expect(await repository.updateAuthentication('credential-1', 6, {
      counter: 8,
      deviceType: 'multiDevice',
      backedUp: true,
      lastUsedAt: 20,
    })).toBe(false)
    expect(await repository.updateAuthentication('credential-1', 7, {
      counter: 8,
      deviceType: 'multiDevice',
      backedUp: true,
      lastUsedAt: 20,
    })).toBe(true)
    expect(await repository.findById('credential-1')).toMatchObject({
      counter: 8,
      deviceType: 'multiDevice',
      backedUp: true,
      lastUsedAt: 20,
    })
    expect(await repository.updateAuthentication('credential-1', 7, {
      counter: 9,
      deviceType: 'multiDevice',
      backedUp: true,
      lastUsedAt: 30,
    })).toBe(false)

    await repository.delete('credential-1')
    expect(await repository.findById('credential-1')).toBeUndefined()
  })

  test('consumes matching challenges once and removes expired records', async () => {
    const db = create()
    databases.push(db)
    const repository = createSqlitePasskeyRepository(db)
    await repository.insertChallenge(challenge('valid'))
    expect(await repository.consumeChallenge('valid', 'registration', 50)).toBeNull()
    expect(await repository.consumeChallenge('valid', 'authentication', 50)).toEqual(challenge('valid'))
    expect(await repository.consumeChallenge('valid', 'authentication', 50)).toBeNull()

    await repository.insertChallenge(challenge('expired', 'authentication', 20))
    expect(await repository.consumeChallenge('expired', 'authentication', 21)).toBeNull()
    expect(await repository.consumeChallenge('expired', 'authentication', 10)).toBeNull()

    await repository.insertChallenge(challenge('cleanup', 'registration', 20))
    await repository.insertChallenge(challenge('fresh', 'registration', 21))
    await repository.cleanupChallenges(21)
    expect(await repository.consumeChallenge('cleanup', 'registration', 10)).toBeNull()
    expect(await repository.consumeChallenge('fresh', 'registration', 21)).toEqual(challenge('fresh', 'registration', 21))
  })
})
