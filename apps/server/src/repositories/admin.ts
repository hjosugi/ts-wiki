import type { PageStatus, Role } from '@kawaii-wiki/core'

export interface AdminStatsRecord {
  readonly users: number
  readonly pages: number
  readonly revisions: number
}

export interface AdminHistoryStatsRecord {
  readonly revisions: number
  readonly historyBytes: number
}

export interface AdminRevisionRecord {
  readonly id: string
  readonly pageId: string
  readonly createdAt: number
}

export interface AdminPageRecord {
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

export interface AdminPageQuery {
  readonly limit: number
  readonly offset: number
  readonly status?: PageStatus
  readonly label?: string
  readonly spaceKey?: string
  readonly authorId?: string
}

export interface AdminAuditRecord {
  readonly id: number
  readonly action: string
  readonly userId: string | null
  readonly path: string | null
  readonly data: string
  readonly createdAt: number
}

export interface AdminAuditQuery {
  readonly limit: number
  readonly offset: number
  readonly action?: string
  readonly userId?: string
  readonly from?: number
  readonly to?: number
}

export interface AdminUserRecord {
  readonly id: string
  readonly email: string
  readonly name: string
  readonly passwordHash: string
  readonly role: Role
  readonly disabledAt: number | null
  readonly tokenInvalidBefore: number
  readonly createdAt: number
}

export interface AdminGroupMembershipRecord {
  readonly userId: string
  readonly key: string
}

export interface AdminRepository {
  stats(): Promise<AdminStatsRecord>
  historyStats(): Promise<AdminHistoryStatsRecord>
  listRevisionCandidates(): Promise<AdminRevisionRecord[]>
  deleteRevisions(ids: readonly string[]): Promise<void>
  listPages(query: AdminPageQuery): Promise<{ rows: AdminPageRecord[]; total: number }>
  listAudit(query: AdminAuditQuery): Promise<{ rows: AdminAuditRecord[]; total: number }>
  listUsers(): Promise<AdminUserRecord[]>
  listGroupMemberships(): Promise<AdminGroupMembershipRecord[]>
  findUser(id: string): Promise<AdminUserRecord | undefined>
  activeAdminCount(): Promise<number>
  updateUserRole(id: string, role: Role): Promise<void>
  updateUserPassword(id: string, passwordHash: string, tokenInvalidBefore: number): Promise<void>
  deactivateUser(id: string, disabledAt: number): Promise<void>
}
