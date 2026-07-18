import { eq, sql } from 'drizzle-orm'
import { isUniqueConstraintError } from '../../errors.ts'
import type { PostgresDb } from '../client.ts'
import { users } from '../schema.ts'
import {
  DuplicateUserEmailError,
  type UserPatch,
  type UserRecord,
  type UserRepository,
} from '../../../repositories/users.ts'

/** PostgreSQL implementation of the driver-neutral user contract. */
export const createPostgresUserRepository = (db: PostgresDb): UserRepository => ({
  async count() {
    const [row] = await db.select({ count: sql<number>`count(*)` }).from(users)
    return Number(row?.count ?? 0)
  },

  async findById(id) {
    const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1)
    return row
  },

  async findByEmail(email) {
    const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1)
    return row
  },

  async insert(user: UserRecord) {
    try {
      await db.insert(users).values(user)
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new DuplicateUserEmailError()
      throw error
    }
  },

  async update(id: string, patch: UserPatch) {
    await db.update(users).set(patch).where(eq(users.id, id))
  },
})
