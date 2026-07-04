/**
 * User service — registration and lookup. Returns `Result` for expected
 * failures (duplicate email); throws only on genuinely exceptional states.
 */
import { eq, sql } from 'drizzle-orm'
import { type Result, ok, err, conflict, type AppError, type Role } from '@ts-wiki/core'
import type { DB } from '../db/client.ts'
import { users, type User } from '../db/schema.ts'
import { hashPassword } from './auth.ts'

export interface CreateUserInput {
  readonly email: string
  readonly name: string
  readonly password: string
  readonly role: Role
}

export interface UserService {
  count(): number
  findById(id: string): User | undefined
  findByEmail(email: string): User | undefined
  create(input: CreateUserInput): Promise<Result<User, AppError>>
}

export const createUserService = (db: DB): UserService => ({
  count() {
    const row = db.select({ c: sql<number>`count(*)` }).from(users).get()
    return row?.c ?? 0
  },

  findById(id) {
    return db.select().from(users).where(eq(users.id, id)).get()
  },

  findByEmail(email) {
    return db.select().from(users).where(eq(users.email, email.toLowerCase())).get()
  },

  async create(input) {
    const email = input.email.trim().toLowerCase()
    if (this.findByEmail(email)) return err(conflict('An account with that email already exists'))

    const now = Date.now()
    const user: User = {
      id: crypto.randomUUID(),
      email,
      name: input.name.trim() || email,
      passwordHash: await hashPassword(input.password),
      role: input.role,
      totpSecret: null,
      totpEnabled: 0,
      createdAt: now,
    }
    db.insert(users).values(user).run()
    return ok(user)
  },
})
