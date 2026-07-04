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

export interface AdminUserView {
  readonly id: string
  readonly email: string
  readonly name: string
  readonly role: Role
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
}

const ROLES: readonly Role[] = ['admin', 'editor', 'viewer']

export const createAdminService = (db: DB): AdminService => {
  const countOf = (table: typeof users | typeof pages | typeof pageRevisions): number =>
    db.select({ c: sql<number>`count(*)` }).from(table).get()?.c ?? 0

  const toView = (u: typeof users.$inferSelect): AdminUserView => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    createdAt: u.createdAt,
  })

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

      // Safety: never let the last admin be demoted — it would lock everyone out.
      if (target.role === 'admin' && role !== 'admin') {
        const admins = db
          .select({ c: sql<number>`count(*)` })
          .from(users)
          .where(eq(users.role, 'admin'))
          .get()?.c ?? 0
        if (admins <= 1) return err(conflict('Cannot demote the last remaining admin'))
      }

      db.update(users).set({ role }).where(eq(users.id, userId)).run()
      return ok({ ...toView(target), role })
    },
  }
}
