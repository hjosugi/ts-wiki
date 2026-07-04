/**
 * User service — registration and lookup. Returns `Result` for expected
 * failures (duplicate email); throws only on genuinely exceptional states.
 */
import { eq, sql } from 'drizzle-orm'
import {
  type Result,
  ok,
  err,
  conflict,
  type AppError,
  type Role,
  type Principal,
  unauthorized,
  validationError,
} from '@ts-wiki/core'
import type { DB } from '../db/client.ts'
import { users, type User } from '../db/schema.ts'
import { hashPassword, verifyPassword } from './auth.ts'

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
  updateProfile(principal: Principal | null, input: { name?: string }): Result<User, AppError>
  changePassword(
    principal: Principal | null,
    input: { currentPassword: string; newPassword: string },
  ): Promise<Result<User, AppError>>
  invalidateTokens(userId: string, invalidBefore?: number): void
  create(input: CreateUserInput): Promise<Result<User, AppError>>
}

export const isUserActive = <T extends Pick<User, 'disabledAt'>>(user: T | null | undefined): user is T =>
  Boolean(user && user.disabledAt === null)

const cleanName = (value: string | undefined, fallback: string): string => value?.trim() || fallback

const validatePassword = (password: string): AppError | null =>
  password.length >= 6 ? null : validationError('Password must be at least 6 characters', 'password')

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

  updateProfile(principal, input) {
    if (!principal) return err(unauthorized())
    const user = this.findById(principal.id)
    if (!user || !isUserActive(user)) return err(unauthorized())
    const name = cleanName(input.name, user.email)
    db.update(users).set({ name }).where(eq(users.id, user.id)).run()
    return ok({ ...user, name })
  },

  async changePassword(principal, input) {
    if (!principal) return err(unauthorized())
    const user = this.findById(principal.id)
    if (!user || !isUserActive(user)) return err(unauthorized())
    const invalid = validatePassword(input.newPassword)
    if (invalid) return err(invalid)
    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
      return err(unauthorized('Current password is incorrect'))
    }
    const passwordHash = await hashPassword(input.newPassword)
    const tokenInvalidBefore = Date.now()
    db.update(users).set({ passwordHash, tokenInvalidBefore }).where(eq(users.id, user.id)).run()
    return ok({ ...user, passwordHash, tokenInvalidBefore })
  },

  invalidateTokens(userId, invalidBefore = Date.now()) {
    db.update(users).set({ tokenInvalidBefore: invalidBefore }).where(eq(users.id, userId)).run()
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
      disabledAt: null,
      tokenInvalidBefore: 0,
      createdAt: now,
    }
    db.insert(users).values(user).run()
    return ok(user)
  },
})
