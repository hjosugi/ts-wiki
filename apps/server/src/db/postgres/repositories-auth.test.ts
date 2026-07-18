/**
 * PostgreSQL auth/identity repository contract tests — integration.
 *
 * Runs only when KAWAII_WIKI_TEST_POSTGRES_URL is set. Isolated in its own
 * `search_path` schema so it never collides with the sibling contract files.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { users } from './schema.ts'
import { createPostgresContractDb, testPostgresUrl, type PostgresContractDb } from './test-support.ts'
import { createPostgresUserRepository } from './repositories/users.ts'
import { createPostgresAuthAccountRepository } from './repositories/auth-accounts.ts'
import { createPostgresAuthRecoveryRepository } from './repositories/auth-recovery.ts'
import { createPostgresPasskeyRepository } from './repositories/passkeys.ts'
import { createPostgresTotpRepository } from './repositories/totp.ts'
import { createPostgresApiKeyRepository } from './repositories/api-keys.ts'
import { DuplicateUserEmailError, type UserRecord } from '../../repositories/users.ts'
import { DuplicatePasskeyCredentialError } from '../../repositories/passkeys.ts'
import { DuplicateApiKeyHashError } from '../../repositories/api-keys.ts'

const makeUser = (over: Partial<UserRecord> = {}): UserRecord => ({
  id: 'u1',
  email: 'u1@example.com',
  name: 'User',
  passwordHash: 'hash',
  role: 'viewer',
  totpSecret: null,
  totpEnabled: 0,
  disabledAt: null,
  tokenInvalidBefore: 0,
  emailVerifiedAt: null,
  profileBio: '',
  profileCoverUrl: '',
  profileLinks: '[]',
  profileFavoritePages: '[]',
  createdAt: 1,
  ...over,
})

describe.skipIf(!testPostgresUrl)('postgres auth repository contracts', () => {
  let harness: PostgresContractDb
  const seedUser = (over: Partial<UserRecord> = {}) => harness.db.insert(users).values(makeUser(over))

  beforeAll(async () => {
    harness = await createPostgresContractDb('kw_auth_contract')
  })
  beforeEach(async () => {
    await harness.reset()
  })
  afterAll(async () => {
    await harness?.close()
  })

  test('users: count, duplicate-email guard, find, and update', async () => {
    const repo = createPostgresUserRepository(harness.db)
    expect(await repo.count()).toBe(0)
    await repo.insert(makeUser({ id: 'u1', email: 'a@x' }))
    expect(await repo.count()).toBe(1)
    expect((await repo.findById('u1'))?.email).toBe('a@x')
    expect((await repo.findByEmail('a@x'))?.id).toBe('u1')
    expect(await repo.findById('missing')).toBeUndefined()

    await expect(repo.insert(makeUser({ id: 'u2', email: 'a@x' }))).rejects.toThrow(DuplicateUserEmailError)
    expect(await repo.count()).toBe(1)

    await repo.update('u1', { name: 'Renamed', role: 'admin' })
    const updated = await repo.findById('u1')
    expect(updated?.name).toBe('Renamed')
    expect(updated?.role).toBe('admin')
  })

  test('auth accounts: create-with-account, linked lookup, and relink', async () => {
    const repo = createPostgresAuthAccountRepository(harness.db)
    expect(await repo.findLinkedUser('google', 'sub-1')).toBeUndefined()

    await repo.createUserWithAccount(
      makeUser({ id: 'u1', email: 'a@x' }),
      { id: 'acc1', userId: 'u1', provider: 'google', providerSubject: 'sub-1', email: 'a@x', createdAt: 1, updatedAt: 1 },
    )
    expect((await repo.findLinkedUser('google', 'sub-1'))?.id).toBe('u1')

    await expect(
      repo.createUserWithAccount(
        makeUser({ id: 'u2', email: 'a@x' }),
        { id: 'acc2', userId: 'u2', provider: 'github', providerSubject: 's', email: 'a@x', createdAt: 1, updatedAt: 1 },
      ),
    ).rejects.toThrow(DuplicateUserEmailError)
    expect(await repo.findLinkedUser('github', 's')).toBeUndefined() // rolled back

    // Relinking the same provider+subject updates the existing row to a new user.
    await seedUser({ id: 'u3', email: 'c@x' })
    await repo.link({ id: 'ignored', userId: 'u3', provider: 'google', providerSubject: 'sub-1', email: 'c@x', createdAt: 2, updatedAt: 2 })
    expect((await repo.findLinkedUser('google', 'sub-1'))?.id).toBe('u3')
  })

  test('auth recovery: password reset + email verification lifecycle', async () => {
    await seedUser({ id: 'u1', email: 'a@x' })
    await seedUser({ id: 'u2', email: 'b@x', disabledAt: 5 })
    const repo = createPostgresAuthRecoveryRepository(harness.db)
    expect((await repo.findUserByEmail('a@x'))?.id).toBe('u1')

    await repo.replacePasswordReset({ token: 't1', userId: 'u1', expiresAt: 100, createdAt: 1 })
    expect(await repo.consumePasswordReset('missing', 50, 'newhash', 60)).toBeNull()
    expect(await repo.consumePasswordReset('t1', 50, 'newhash', 60)).toBe('u1')
    expect(await repo.consumePasswordReset('t1', 50, 'newhash', 60)).toBeNull() // single-use

    const afterReset = await repo.findUserByEmail('a@x')
    expect(afterReset?.passwordHash).toBe('newhash')
    expect(afterReset?.tokenInvalidBefore).toBe(60)
    expect(afterReset?.emailVerifiedAt).toBe(60) // null before → set to tokenInvalidBefore

    // Disabled users cannot consume.
    await repo.replacePasswordReset({ token: 't2', userId: 'u2', expiresAt: 100, createdAt: 1 })
    expect(await repo.consumePasswordReset('t2', 50, 'h', 1)).toBeNull()

    // Email verification.
    await repo.replaceEmailVerification({ token: 'v1', userId: 'u1', email: 'a@x', expiresAt: 100, createdAt: 1 })
    expect(await repo.consumeEmailVerification('v1', 40)).toBe('u1')
    expect((await repo.findUserByEmail('a@x'))?.emailVerifiedAt).toBe(40)
    // Mismatched email is rejected.
    await repo.replaceEmailVerification({ token: 'v2', userId: 'u1', email: 'stale@x', expiresAt: 100, createdAt: 1 })
    expect(await repo.consumeEmailVerification('v2', 40)).toBeNull()

    // cleanupExpired prunes stale rows.
    await repo.replaceEmailVerification({ token: 'v3', userId: 'u1', email: 'a@x', expiresAt: 10, createdAt: 1 })
    await repo.cleanupExpired(50)
    expect(await repo.consumeEmailVerification('v3', 5)).toBeNull()
  })

  test('passkeys: crud, optimistic counter update, and challenge lifecycle', async () => {
    const repo = createPostgresPasskeyRepository(harness.db)
    const passkey = {
      id: 'p1', userId: 'u1', name: 'Key', publicKey: 'pub', counter: 0,
      transports: '[]', deviceType: 'singleDevice', backedUp: false, createdAt: 1, lastUsedAt: null,
    }
    await repo.insert(passkey)
    expect((await repo.listByUser('u1')).length).toBe(1)
    expect((await repo.findById('p1'))?.publicKey).toBe('pub')
    await expect(repo.insert(passkey)).rejects.toThrow(DuplicatePasskeyCredentialError)

    expect(await repo.updateAuthentication('p1', 0, { counter: 5, deviceType: 'multiDevice', backedUp: true, lastUsedAt: 10 })).toBe(true)
    expect(await repo.updateAuthentication('p1', 0, { counter: 6, deviceType: 'x', backedUp: false, lastUsedAt: 20 })).toBe(false)
    const advanced = await repo.findById('p1')
    expect(advanced?.counter).toBe(5)
    expect(advanced?.backedUp).toBe(true)
    expect(advanced?.deviceType).toBe('multiDevice')

    await repo.delete('p1')
    expect(await repo.findById('p1')).toBeUndefined()

    await repo.insertChallenge({ challenge: 'c1', userId: 'u1', purpose: 'registration', expiresAt: 100, createdAt: 1 })
    expect(await repo.consumeChallenge('c1', 'authentication', 50)).toBeNull() // wrong purpose
    expect((await repo.consumeChallenge('c1', 'registration', 50))?.challenge).toBe('c1')
    expect(await repo.consumeChallenge('c1', 'registration', 50)).toBeNull() // single-use

    await repo.insertChallenge({ challenge: 'c2', userId: null, purpose: 'authentication', expiresAt: 10, createdAt: 1 })
    expect(await repo.consumeChallenge('c2', 'authentication', 50)).toBeNull() // expired
    await repo.insertChallenge({ challenge: 'c3', userId: null, purpose: 'authentication', expiresAt: 10, createdAt: 1 })
    await repo.cleanupChallenges(50)
    expect(await repo.consumeChallenge('c3', 'authentication', 5)).toBeNull() // cleaned
  })

  test('totp: secret, enable with recovery codes, consume, replace, and disable', async () => {
    await seedUser({ id: 'u1', email: 'a@x' })
    const repo = createPostgresTotpRepository(harness.db)
    const users_ = createPostgresUserRepository(harness.db)

    await repo.saveSecret('u1', 'SECRET', 0)
    await repo.enable('u1', [
      { id: 'r1', userId: 'u1', codeHash: 'h1', createdAt: 1, usedAt: null },
      { id: 'r2', userId: 'u1', codeHash: 'h2', createdAt: 1, usedAt: null },
    ])
    expect((await repo.listUnusedRecoveryCodes('u1')).length).toBe(2)
    expect((await users_.findById('u1'))?.totpEnabled).toBe(1)
    expect((await users_.findById('u1'))?.totpSecret).toBe('SECRET')

    expect(await repo.consumeRecoveryCode('r1', 10)).toBe(true)
    expect(await repo.consumeRecoveryCode('r1', 10)).toBe(false) // already used
    expect((await repo.listUnusedRecoveryCodes('u1')).map((c) => c.id)).toEqual(['r2'])

    await repo.replaceRecoveryCodes('u1', [{ id: 'r3', userId: 'u1', codeHash: 'h3', createdAt: 2, usedAt: null }])
    expect((await repo.listUnusedRecoveryCodes('u1')).map((c) => c.id)).toEqual(['r3'])

    await repo.disable('u1')
    expect(await repo.listUnusedRecoveryCodes('u1')).toEqual([])
    expect((await users_.findById('u1'))?.totpEnabled).toBe(0)
    expect((await users_.findById('u1'))?.totpSecret).toBeNull()
  })

  test('api keys: ordering, duplicate hash, revoke, and markUsedIfActive', async () => {
    const repo = createPostgresApiKeyRepository(harness.db)
    await repo.insert({ id: 'k1', name: 'A', keyHash: 'h1', role: 'admin', expiresAt: null, lastUsedAt: null, revokedAt: null, createdAt: 1 })
    await repo.insert({ id: 'k2', name: 'B', keyHash: 'h2', role: 'viewer', expiresAt: 100, lastUsedAt: null, revokedAt: null, createdAt: 2 })
    expect((await repo.list()).map((k) => k.id)).toEqual(['k1', 'k2'])
    expect((await repo.findByHash('h2'))?.id).toBe('k2')

    await expect(
      repo.insert({ id: 'k3', name: 'C', keyHash: 'h1', role: 'viewer', expiresAt: null, lastUsedAt: null, revokedAt: null, createdAt: 3 }),
    ).rejects.toThrow(DuplicateApiKeyHashError)

    expect(await repo.markUsedIfActive('k1', 50)).toBe(true)
    expect((await repo.findById('k1'))?.lastUsedAt).toBe(50)

    expect((await repo.revoke('k1', 60))?.revokedAt).toBe(60)
    expect((await repo.revoke('k1', 70))?.revokedAt).toBe(60) // unchanged
    expect(await repo.markUsedIfActive('k1', 80)).toBe(false) // revoked

    expect(await repo.markUsedIfActive('k2', 150)).toBe(false) // expired
    expect(await repo.markUsedIfActive('k2', 50)).toBe(true) // active
  })
})
