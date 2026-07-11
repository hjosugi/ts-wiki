import { eq, sql } from 'drizzle-orm'
import type { DB } from '../client.ts'
import { isUniqueConstraintError } from '../errors.ts'
import { users } from '../schema.ts'
import {
  DuplicateUserEmailError,
  type UserPatch,
  type UserRecord,
  type UserRepository,
} from '../../repositories/users.ts'

export const createSqliteUserRepository = (db: DB): UserRepository => ({
  async count() {
    const row = db.select({ count: sql<number>`count(*)` }).from(users).get()
    return Number(row?.count ?? 0)
  },

  async findById(id) {
    return db.select().from(users).where(eq(users.id, id)).get()
  },

  async findByEmail(email) {
    return db.select().from(users).where(eq(users.email, email)).get()
  },

  async insert(user: UserRecord) {
    try {
      db.insert(users).values(user).run()
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new DuplicateUserEmailError()
      throw error
    }
  },

  async update(id: string, patch: UserPatch) {
    db.update(users).set(patch).where(eq(users.id, id)).run()
  },
})
