import { and, eq } from 'drizzle-orm'
import { isUniqueConstraintError } from '../../errors.ts'
import type { PostgresDb } from '../client.ts'
import { authAccounts, users } from '../schema.ts'
import type {
  AuthAccountRecord,
  AuthAccountRepository,
} from '../../../repositories/auth-accounts.ts'
import { DuplicateUserEmailError, type UserRecord } from '../../../repositories/users.ts'

/** PostgreSQL implementation of the driver-neutral auth-account contract. */
export const createPostgresAuthAccountRepository = (db: PostgresDb): AuthAccountRepository => ({
  async findLinkedUser(provider, providerSubject) {
    const [row] = await db
      .select({ user: users })
      .from(authAccounts)
      .innerJoin(users, eq(users.id, authAccounts.userId))
      .where(and(eq(authAccounts.provider, provider), eq(authAccounts.providerSubject, providerSubject)))
      .limit(1)
    return row?.user
  },

  async link(account: AuthAccountRecord) {
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: authAccounts.id })
        .from(authAccounts)
        .where(and(
          eq(authAccounts.provider, account.provider),
          eq(authAccounts.providerSubject, account.providerSubject),
        ))
        .limit(1)
      if (existing) {
        await tx
          .update(authAccounts)
          .set({ userId: account.userId, email: account.email, updatedAt: account.updatedAt })
          .where(eq(authAccounts.id, existing.id))
        return
      }
      await tx.insert(authAccounts).values(account)
    })
  },

  async createUserWithAccount(user: UserRecord, account: AuthAccountRecord) {
    try {
      await db.transaction(async (tx) => {
        await tx.insert(users).values(user)
        await tx.insert(authAccounts).values(account)
      })
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new DuplicateUserEmailError()
      throw error
    }
  },
})
