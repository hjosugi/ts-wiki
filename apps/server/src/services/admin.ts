/**
 * Admin service — admin-only operations. Every method gates on
 * `can(principal, 'admin:access')` (the same pure check from @ts-wiki/core), so the
 * HTTP layer stays a thin `unwrap(...)`.
 */
import { eq, asc, sql } from 'drizzle-orm'
import {
  type Result,
  ok,
  err,
  type AppError,
  type Principal,
  type Role,
  can,
  forbidden,
  notFound,
  conflict,
  validationError,
} from '@ts-wiki/core'
import type { DB } from '../db/client.ts'
import { users, pages, pageRevisions } from '../db/schema.ts'
import type { AuthzService } from './authz.ts'
import { hashPassword } from './auth.ts'

export interface AdminUserView {
  readonly id: string
  readonly email: string
  readonly name: string
  readonly role: Role
  readonly groups: readonly string[]
  readonly disabledAt: number | null
  readonly tokenInvalidBefore: number
  readonly createdAt: number
}

export interface AdminStats {
  readonly users: number
  readonly pages: number
  readonly revisions: number
}

export interface AdminService {
  stats(principal: Principal | null): Result<AdminStats, AppError>
  listUsers(principal: Principal | null): Result<AdminUserView[], AppError>
  setUserRole(principal: Principal | null, userId: string, role: Role): Result<AdminUserView, AppError>
  setUserPassword(principal: Principal | null, userId: string, password: string): Promise<Result<AdminUserView, AppError>>
  deactivateUser(principal: Principal | null, userId: string): Result<AdminUserView, AppError>
}

const ROLES: readonly Role[] = ['admin', 'editor', 'viewer']

export const createAdminService = (db: DB, authz?: AuthzService): AdminService => {
  const countOf = (table: typeof users | typeof pages | typeof pageRevisions): number =>
    db.select({ c: sql<number>`count(*)` }).from(table).get()?.c ?? 0

  const toView = (u: typeof users.$inferSelect): AdminUserView => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    groups: authz?.principalForUser(u).groups ?? [],
    disabledAt: u.disabledAt,
    tokenInvalidBefore: u.tokenInvalidBefore,
    createdAt: u.createdAt,
  })

  const activeAdminCount = (): number =>
    db
      .select()
      .from(users)
      .where(eq(users.role, 'admin'))
      .all()
      .filter((user) => user.disabledAt === null).length

  const protectLastActiveAdminDemotion = (target: typeof users.$inferSelect, nextRole: Role): Result<true, AppError> => {
    if (target.role === 'admin' && nextRole !== 'admin' && target.disabledAt === null && activeAdminCount() <= 1) {
      return err(conflict('Cannot demote the last active admin'))
    }
    return ok(true)
  }

  const protectLastActiveAdminDeactivation = (target: typeof users.$inferSelect): Result<true, AppError> => {
    if (target.role === 'admin' && target.disabledAt === null && activeAdminCount() <= 1) {
      return err(conflict('Cannot deactivate the last active admin'))
    }
    return ok(true)
  }

  return {
    stats(principal) {
      if (!can(principal, 'admin:access')) return err(forbidden())
      return ok({ users: countOf(users), pages: countOf(pages), revisions: countOf(pageRevisions) })
    },

    listUsers(principal) {
      if (!can(principal, 'admin:access')) return err(forbidden())
      const rows = db.select().from(users).orderBy(asc(users.createdAt)).all()
      return ok(rows.map(toView))
    },

    setUserRole(principal, userId, role) {
      if (!can(principal, 'admin:access')) return err(forbidden())
      if (!ROLES.includes(role)) return err(validationError('Unknown role', 'role'))

      const target = db.select().from(users).where(eq(users.id, userId)).get()
      if (!target) return err(notFound('User not found'))

      const guarded = protectLastActiveAdminDemotion(target, role)
      if (!guarded.ok) return guarded

      db.update(users).set({ role }).where(eq(users.id, userId)).run()
      authz?.syncRoleGroup(userId, role)
      return ok({ ...toView(target), role })
    },

    async setUserPassword(principal, userId, password) {
      if (!can(principal, 'admin:access')) return err(forbidden())
      if (password.length < 6) return err(validationError('Password must be at least 6 characters', 'password'))
      const target = db.select().from(users).where(eq(users.id, userId)).get()
      if (!target) return err(notFound('User not found'))
      const passwordHash = await hashPassword(password)
      const tokenInvalidBefore = Date.now()
      db.update(users).set({ passwordHash, tokenInvalidBefore }).where(eq(users.id, userId)).run()
      return ok({ ...toView(target), tokenInvalidBefore })
    },

    deactivateUser(principal, userId) {
      if (!can(principal, 'admin:access')) return err(forbidden())
      const target = db.select().from(users).where(eq(users.id, userId)).get()
      if (!target) return err(notFound('User not found'))
      if (target.disabledAt !== null) return ok(toView(target))
      const guarded = protectLastActiveAdminDeactivation(target)
      if (!guarded.ok) return guarded
      const disabledAt = Date.now()
      db.update(users).set({ disabledAt, tokenInvalidBefore: disabledAt }).where(eq(users.id, userId)).run()
      return ok({ ...toView(target), disabledAt, tokenInvalidBefore: disabledAt })
    },
  }
}
