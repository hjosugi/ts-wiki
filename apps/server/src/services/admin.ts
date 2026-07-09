/**
 * Admin service — admin-only operations. Every method gates on
 * `requirePermission(principal, 'admin:access')` (the same pure check from @ts-wiki/core), so the
 * HTTP layer stays a thin `unwrap(...)`.
 */
import { and, eq, asc, desc, gte, like, lte, sql, type SQL } from 'drizzle-orm'
import {
  type Result,
  ok,
  err,
  type AppError,
  type Principal,
  type Role,
  type PageStatus,
  requirePermission,
  notFound,
  conflict,
  validationError,
  isPageStatus,
} from '@ts-wiki/core'
import type { DB } from '../db/client.ts'
import { auditLog, users, pages, pageRevisions } from '../db/schema.ts'
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

export interface AdminHistoryStats {
  readonly revisions: number
  readonly historyBytes: number
}

export interface PurgeHistoryInput {
  readonly olderThanDays: number
  readonly keepLatest: number
}

export interface PurgeHistoryResult extends AdminHistoryStats {
  readonly deleted: number
  readonly olderThan: number
  readonly keepLatest: number
}

export interface AdminPageView {
  readonly path: string
  readonly title: string
  readonly status: PageStatus
  readonly labels: string
  readonly ownerId: string | null
  readonly authorId: string | null
  readonly authorName: string | null
  readonly spaceKey: string
  readonly locale: string
  readonly updatedAt: number
}

export interface AdminPageListInput {
  readonly limit?: number
  readonly offset?: number
  readonly status?: string
  readonly label?: string
  readonly spaceKey?: string
  readonly authorId?: string
}

export interface AdminPageList {
  readonly pages: AdminPageView[]
  readonly total: number
  readonly limit: number
  readonly offset: number
}

export interface AdminAuditEvent {
  readonly id: number
  readonly action: string
  readonly userId: string | null
  readonly path: string | null
  readonly data: Record<string, unknown>
  readonly createdAt: number
}

export interface AdminAuditListInput {
  readonly limit?: number
  readonly offset?: number
  readonly action?: string
  readonly userId?: string
  readonly from?: number
  readonly to?: number
}

export interface AdminAuditList {
  readonly events: AdminAuditEvent[]
  readonly total: number
  readonly limit: number
  readonly offset: number
}

export interface AdminService {
  stats(principal: Principal | null): Result<AdminStats, AppError>
  historyStats(principal: Principal | null): Result<AdminHistoryStats, AppError>
  purgeHistory(principal: Principal | null, input: PurgeHistoryInput): Result<PurgeHistoryResult, AppError>
  listPages(principal: Principal | null, input?: AdminPageListInput): Result<AdminPageList, AppError>
  listAudit(principal: Principal | null, input?: AdminAuditListInput): Result<AdminAuditList, AppError>
  listUsers(principal: Principal | null): Result<AdminUserView[], AppError>
  setUserRole(principal: Principal | null, userId: string, role: Role): Result<AdminUserView, AppError>
  setUserPassword(principal: Principal | null, userId: string, password: string): Promise<Result<AdminUserView, AppError>>
  deactivateUser(principal: Principal | null, userId: string): Result<AdminUserView, AppError>
}

const ROLES: readonly Role[] = ['admin', 'editor', 'viewer']

export const createAdminService = (db: DB, authz?: AuthzService): AdminService => {
  const requireAdmin = (principal: Principal | null): Result<true, AppError> =>
    requirePermission(principal, 'admin:access')

  const countOf = (table: typeof users | typeof pages | typeof pageRevisions): number =>
    db.select({ c: sql<number>`count(*)` }).from(table).get()?.c ?? 0

  const historyStats = (): AdminHistoryStats => ({
    revisions: countOf(pageRevisions),
    historyBytes: db
      .select({
        bytes: sql<number>`coalesce(sum(length(${pageRevisions.title}) + length(${pageRevisions.description}) + length(${pageRevisions.content})), 0)`,
      })
      .from(pageRevisions)
      .get()?.bytes ?? 0,
  })

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

  const parseAuditData = (value: string): Record<string, unknown> => {
    try {
      const parsed = JSON.parse(value) as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
    } catch {
      return {}
    }
  }

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
      const allowed = requireAdmin(principal)
      if (!allowed.ok) return allowed
      return ok({ users: countOf(users), pages: countOf(pages), revisions: countOf(pageRevisions) })
    },

    historyStats(principal) {
      const allowed = requireAdmin(principal)
      if (!allowed.ok) return allowed
      return ok(historyStats())
    },

    purgeHistory(principal, input) {
      const allowed = requireAdmin(principal)
      if (!allowed.ok) return allowed
      const olderThanDays = Math.trunc(input.olderThanDays)
      const keepLatest = Math.trunc(input.keepLatest)
      if (!Number.isFinite(olderThanDays) || olderThanDays < 1) {
        return err(validationError('olderThanDays must be at least 1', 'olderThanDays'))
      }
      if (!Number.isFinite(keepLatest) || keepLatest < 0) {
        return err(validationError('keepLatest must be 0 or greater', 'keepLatest'))
      }

      const olderThan = Date.now() - olderThanDays * 24 * 60 * 60 * 1000
      const rows = db
        .select({
          id: pageRevisions.id,
          pageId: pageRevisions.pageId,
          createdAt: pageRevisions.createdAt,
        })
        .from(pageRevisions)
        .orderBy(desc(pageRevisions.createdAt), sql`page_revisions.rowid desc`)
        .all()
      const keptByPage = new Map<string, number>()
      const deleteIds: string[] = []
      for (const row of rows) {
        const kept = keptByPage.get(row.pageId) ?? 0
        if (kept < keepLatest) {
          keptByPage.set(row.pageId, kept + 1)
          continue
        }
        if (row.createdAt < olderThan) deleteIds.push(row.id)
      }

      db.transaction((tx) => {
        for (const id of deleteIds) {
          tx.delete(pageRevisions).where(eq(pageRevisions.id, id)).run()
        }
      })
      return ok({
        ...historyStats(),
        deleted: deleteIds.length,
        olderThan,
        keepLatest,
      })
    },

    listPages(principal, input = {}) {
      const allowed = requireAdmin(principal)
      if (!allowed.ok) return allowed
      const limit = Math.min(Math.max(Math.trunc(input.limit ?? 25), 1), 100)
      const offset = Math.max(Math.trunc(input.offset ?? 0), 0)
      const statusInput = input.status?.trim()
      let status: PageStatus | undefined
      if (statusInput) {
        if (!isPageStatus(statusInput)) return err(validationError('Unknown page status', 'status'))
        status = statusInput
      }
      const label = input.label?.trim()
      const spaceKey = input.spaceKey?.trim()
      const authorId = input.authorId?.trim()
      const filters = [
        eq(pages.lifecycle, 'active'),
        ...(status ? [eq(pages.status, status)] : []),
        ...(label ? [like(pages.labels, `%${label}%`)] : []),
        ...(spaceKey ? [eq(pages.spaceKey, spaceKey)] : []),
        ...(authorId ? [eq(pages.authorId, authorId)] : []),
      ]
      const where = and(...filters)
      const total = db.select({ c: sql<number>`count(*)` }).from(pages).where(where).get()?.c ?? 0
      const rows = db
        .select({
          path: pages.path,
          title: pages.title,
          status: pages.status,
          labels: pages.labels,
          ownerId: pages.ownerId,
          authorId: pages.authorId,
          authorName: users.name,
          spaceKey: pages.spaceKey,
          locale: pages.locale,
          updatedAt: pages.updatedAt,
        })
        .from(pages)
        .leftJoin(users, eq(users.id, pages.authorId))
        .where(where)
        .orderBy(desc(pages.updatedAt), asc(pages.path))
        .limit(limit)
        .offset(offset)
        .all()
      return ok({
        pages: rows.map((page) => ({ ...page, authorName: page.authorName ?? null })),
        total,
        limit,
        offset,
      })
    },

    listAudit(principal, input = {}) {
      const allowed = requireAdmin(principal)
      if (!allowed.ok) return allowed
      const limit = Math.min(Math.max(Math.trunc(input.limit ?? 50), 1), 200)
      const offset = Math.max(Math.trunc(input.offset ?? 0), 0)
      const action = input.action?.trim()
      const userId = input.userId?.trim()
      const from = typeof input.from === 'number' && Number.isFinite(input.from) ? Math.trunc(input.from) : undefined
      const to = typeof input.to === 'number' && Number.isFinite(input.to) ? Math.trunc(input.to) : undefined
      const filters: SQL[] = [
        ...(action ? [like(auditLog.action, `%${action}%`)] : []),
        ...(userId ? [eq(auditLog.userId, userId)] : []),
        ...(from !== undefined ? [gte(auditLog.createdAt, from)] : []),
        ...(to !== undefined ? [lte(auditLog.createdAt, to)] : []),
      ]
      const where = filters.length ? and(...filters) : undefined
      const totalQuery = db.select({ c: sql<number>`count(*)` }).from(auditLog)
      const total = (where ? totalQuery.where(where) : totalQuery).get()?.c ?? 0
      const rowsQuery = db.select().from(auditLog)
      const rows = (where ? rowsQuery.where(where) : rowsQuery)
        .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
        .limit(limit)
        .offset(offset)
        .all()
      return ok({
        events: rows.map((row) => ({
          id: row.id,
          action: row.action,
          userId: row.userId,
          path: row.path,
          data: parseAuditData(row.data),
          createdAt: row.createdAt,
        })),
        total,
        limit,
        offset,
      })
    },

    listUsers(principal) {
      const allowed = requireAdmin(principal)
      if (!allowed.ok) return allowed
      const rows = db.select().from(users).orderBy(asc(users.createdAt)).all()
      return ok(rows.map(toView))
    },

    setUserRole(principal, userId, role) {
      const allowed = requireAdmin(principal)
      if (!allowed.ok) return allowed
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
      const allowed = requireAdmin(principal)
      if (!allowed.ok) return allowed
      if (password.length < 6) return err(validationError('Password must be at least 6 characters', 'password'))
      const target = db.select().from(users).where(eq(users.id, userId)).get()
      if (!target) return err(notFound('User not found'))
      const passwordHash = await hashPassword(password)
      const tokenInvalidBefore = Date.now()
      db.update(users).set({ passwordHash, tokenInvalidBefore }).where(eq(users.id, userId)).run()
      return ok({ ...toView(target), tokenInvalidBefore })
    },

    deactivateUser(principal, userId) {
      const allowed = requireAdmin(principal)
      if (!allowed.ok) return allowed
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
