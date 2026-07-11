/**
 * Admin service — admin-only operations. Every method gates on
 * `requirePermission(principal, 'admin:access')` (the same pure check from @kawaii-wiki/core), so the
 * HTTP layer stays a thin `unwrap(...)`.
 */
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
} from '@kawaii-wiki/core'
import type { AdminRepository, AdminUserRecord } from '../repositories/admin.ts'
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
  stats(principal: Principal | null): Promise<Result<AdminStats, AppError>>
  historyStats(principal: Principal | null): Promise<Result<AdminHistoryStats, AppError>>
  purgeHistory(principal: Principal | null, input: PurgeHistoryInput): Promise<Result<PurgeHistoryResult, AppError>>
  listPages(principal: Principal | null, input?: AdminPageListInput): Promise<Result<AdminPageList, AppError>>
  listAudit(principal: Principal | null, input?: AdminAuditListInput): Promise<Result<AdminAuditList, AppError>>
  listUsers(principal: Principal | null): Promise<Result<AdminUserView[], AppError>>
  setUserRole(principal: Principal | null, userId: string, role: Role): Promise<Result<AdminUserView, AppError>>
  setUserPassword(principal: Principal | null, userId: string, password: string): Promise<Result<AdminUserView, AppError>>
  deactivateUser(principal: Principal | null, userId: string): Promise<Result<AdminUserView, AppError>>
}

const ROLES: readonly Role[] = ['admin', 'editor', 'viewer']
const roleGroup = (role: Role): string => role === 'admin' ? 'admins' : role === 'editor' ? 'editors' : 'viewers'

export const createAdminService = (repository: AdminRepository, authz?: AuthzService): AdminService => {
  const toView = (u: AdminUserRecord, groupKeys?: readonly string[]): AdminUserView => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    groups: groupKeys ?? [roleGroup(u.role)],
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

  const protectLastActiveAdminDemotion = async (target: AdminUserRecord, nextRole: Role): Promise<Result<true, AppError>> => {
    if (target.role === 'admin' && nextRole !== 'admin' && target.disabledAt === null && await repository.activeAdminCount() <= 1) {
      return err(conflict('Cannot demote the last active admin'))
    }
    return ok(true)
  }

  const protectLastActiveAdminDeactivation = async (target: AdminUserRecord): Promise<Result<true, AppError>> => {
    if (target.role === 'admin' && target.disabledAt === null && await repository.activeAdminCount() <= 1) {
      return err(conflict('Cannot deactivate the last active admin'))
    }
    return ok(true)
  }

  return {
    async stats(principal) {
      const allowed = requirePermission(principal, 'admin:access')
      if (!allowed.ok) return allowed
      return ok(await repository.stats())
    },

    async historyStats(principal) {
      const allowed = requirePermission(principal, 'admin:access')
      if (!allowed.ok) return allowed
      return ok(await repository.historyStats())
    },

    async purgeHistory(principal, input) {
      const allowed = requirePermission(principal, 'admin:access')
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
      const rows = await repository.listRevisionCandidates()
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

      await repository.deleteRevisions(deleteIds)
      return ok({
        ...await repository.historyStats(),
        deleted: deleteIds.length,
        olderThan,
        keepLatest,
      })
    },

    async listPages(principal, input = {}) {
      const allowed = requirePermission(principal, 'admin:access')
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
      const { rows, total } = await repository.listPages({
        limit,
        offset,
        ...(status ? { status } : {}),
        ...(label ? { label } : {}),
        ...(spaceKey ? { spaceKey } : {}),
        ...(authorId ? { authorId } : {}),
      })
      return ok({
        pages: rows,
        total,
        limit,
        offset,
      })
    },

    async listAudit(principal, input = {}) {
      const allowed = requirePermission(principal, 'admin:access')
      if (!allowed.ok) return allowed
      const limit = Math.min(Math.max(Math.trunc(input.limit ?? 50), 1), 200)
      const offset = Math.max(Math.trunc(input.offset ?? 0), 0)
      const action = input.action?.trim()
      const userId = input.userId?.trim()
      const from = typeof input.from === 'number' && Number.isFinite(input.from) ? Math.trunc(input.from) : undefined
      const to = typeof input.to === 'number' && Number.isFinite(input.to) ? Math.trunc(input.to) : undefined
      const { rows, total } = await repository.listAudit({
        limit,
        offset,
        ...(action ? { action } : {}),
        ...(userId ? { userId } : {}),
        ...(from !== undefined ? { from } : {}),
        ...(to !== undefined ? { to } : {}),
      })
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

    async listUsers(principal) {
      const allowed = requirePermission(principal, 'admin:access')
      if (!allowed.ok) return allowed
      const rows = await repository.listUsers()
      if (!authz) return ok(rows.map((user) => toView(user, [])))
      const memberships = await repository.listGroupMemberships()
      const keysByUser = new Map<string, string[]>()
      for (const membership of memberships) {
        const list = keysByUser.get(membership.userId) ?? []
        if (!list.includes(membership.key)) list.push(membership.key)
        keysByUser.set(membership.userId, list)
      }
      return ok(rows.map((user) => toView(user, [...new Set([user.role === 'admin' ? 'admins' : user.role === 'editor' ? 'editors' : 'viewers', ...(keysByUser.get(user.id) ?? [])])])))
    },

    async setUserRole(principal, userId, role) {
      const allowed = requirePermission(principal, 'admin:access')
      if (!allowed.ok) return allowed
      if (!ROLES.includes(role)) return err(validationError('Unknown role', 'role'))

      const target = await repository.findUser(userId)
      if (!target) return err(notFound('User not found'))

      const guarded = await protectLastActiveAdminDemotion(target, role)
      if (!guarded.ok) return guarded

      await repository.updateUserRole(userId, role)
      if (authz) await authz.syncRoleGroup(userId, role)
      return ok(toView({ ...target, role }))
    },

    async setUserPassword(principal, userId, password) {
      const allowed = requirePermission(principal, 'admin:access')
      if (!allowed.ok) return allowed
      if (password.length < 6) return err(validationError('Password must be at least 6 characters', 'password'))
      const target = await repository.findUser(userId)
      if (!target) return err(notFound('User not found'))
      const passwordHash = await hashPassword(password)
      const tokenInvalidBefore = Date.now()
      await repository.updateUserPassword(userId, passwordHash, tokenInvalidBefore)
      return ok({ ...toView(target), tokenInvalidBefore })
    },

    async deactivateUser(principal, userId) {
      const allowed = requirePermission(principal, 'admin:access')
      if (!allowed.ok) return allowed
      const target = await repository.findUser(userId)
      if (!target) return err(notFound('User not found'))
      if (target.disabledAt !== null) return ok(toView(target))
      const guarded = await protectLastActiveAdminDeactivation(target)
      if (!guarded.ok) return guarded
      const disabledAt = Date.now()
      await repository.deactivateUser(userId, disabledAt)
      return ok({ ...toView(target), disabledAt, tokenInvalidBefore: disabledAt })
    },
  }
}
